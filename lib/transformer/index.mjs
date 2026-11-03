// TransformerService — the transformer as a component that serves the graph:
//  • meaning embeddings for atoms (relationship discovery, pgvector rows)
//  • experimental generative drafts (always labelled; never used as evidence)
//  • per-atom reasoning kernels (prefix vectors) that merge into molecules and cells
//  • continuous background training on approved knowledge only
import { Worker } from 'node:worker_threads';
import { makeConfig, initParams, Transformer, countParams, expandLayers } from './core.mjs';
import { serialize, deserialize, encode, decode, vecToB64, b64ToVec, EOS } from './io.mjs';
import { Trainer, corpusFromState, trainKernel, mergeKernels } from './train.mjs';

const CKPT = 'transformer.ckpt';
export class TransformerService {
  constructor({ profile = process.env.TRANSFORMER_PROFILE || 'nano', blobs, log = () => {}, env = process.env } = {}) {
    Object.assign(this, { profile, blobs, log, env }); this.step = 0; this.loss = null; this.ema = null; this.tokens = 0; this.worker = null; this.savedAt = null;
    this.enabled = env.TRANSFORMER_ENABLED !== 'false';
  }
  async init() {
    let loaded = null;
    try { const buf = await this.blobs?.read(CKPT); if (buf) loaded = deserialize(buf); } catch (e) { this.log('transformer checkpoint unreadable: ' + e.message); }
    if (loaded && loaded.header.config.profile === this.profile) {
      this.config = loaded.header.config; this.P = loaded.P; Object.assign(this, { step: loaded.header.step || 0, loss: loaded.header.loss ?? null, ema: loaded.header.ema ?? null, tokens: loaded.header.tokens || 0 });
    } else { this.config = makeConfig(this.profile); this.P = initParams(this.config, 7); }
    const extra = Number(this.env.TRANSFORMER_EXTRA_LAYERS || 0);
    if (extra > 0 && extra <= 27 && this.config.layers < 9 + extra) expandLayers(this.config, this.P, 9 + extra - this.config.layers);
    this.model = new Transformer(this.config, this.P); return this;
  }
  status() {
    const c = this.config;
    return { enabled: this.enabled, architecture: 'KENUXA Core Transformer (decoder-only)', profile: c.profile, layers: c.layers, heads: c.heads, kvHeads: c.kvHeads, grouping: `GQA ${c.heads / c.kvHeads}:1`, headDim: c.headDim, hiddenDim: c.dim, ffnDim: c.ffn,
      contextWindow: c.context, positional: `RoPE (base ${c.ropeBase})`, norm: 'RMSNorm', feedForward: 'SwiGLU', attention: 'causal; training exact, inference tiled online-softmax with KV cache', precision: 'fp32 compute, fp16 checkpoint storage', gradientCheckpointing: true,
      parameters: countParams(this.P), trainingSteps: this.step, trainedTokens: this.tokens, loss: this.loss, smoothedLoss: this.ema, training: !!this.worker, savedAt: this.savedAt,
      role: 'Serves atoms, capabilities, outcomes and evolution. Not the system centre and not a source of truth.' };
  }
  async save() { if (!this.blobs) return; await this.blobs.write(CKPT, serialize(this.config, this.P, { step: this.step, loss: this.loss, ema: this.ema, tokens: this.tokens })); this.savedAt = new Date().toISOString(); }
  // Long-running hosts: train continuously in a worker thread.
  startBackground(getCorpus, { reportEvery = 25 } = {}) {
    if (!this.enabled || this.worker || this.env.TRANSFORMER_TRAINING === 'false') return false;
    const weights = Object.fromEntries([...this.P].map(([k, a]) => [k, a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)]));
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { config: this.config, weights, corpus: getCorpus(), options: { reportEvery, startStep: this.step, lr: Number(this.env.TRANSFORMER_LR || 2e-3) } } });
    this._baseTokens = this.tokens; this.worker.unref();
    this.worker.on('message', async msg => {
      if (msg.type !== 'weights') return;
      for (const [k, a] of Object.entries(msg.weights)) this.P.set(k, a);
      Object.assign(this, { step: msg.step, loss: msg.loss, ema: msg.ema, tokens: this._baseTokens + (msg.tokens || 0) });
      this.model = new Transformer(this.config, this.P);
      const every = Number(this.env.TRANSFORMER_SAVE_SECONDS || 300) * 1000; // throttle checkpoint uploads
      if (!this._lastSave || Date.now() - this._lastSave >= every) { this._lastSave = Date.now(); try { await this.save(); } catch (e) { this.log('transformer save failed: ' + e.message); } }
    });
    this.worker.on('error', e => { this.log('transformer worker error: ' + e.message); this.worker = null; });
    this.worker.on('exit', () => { this.worker = null; });
    return true;
  }
  refreshCorpus(texts) { this.worker?.postMessage({ type: 'corpus', corpus: texts }); }
  async stop() { if (!this.worker) return; try { await this.save(); } catch {} const w = this.worker; await new Promise(r => { w.once('exit', r); w.postMessage({ type: 'stop' }); setTimeout(() => { w.terminate().then(r); }, 3000); }); this.worker = null; }
  // Serverless hosts / tests: a bounded number of synchronous steps.
  async trainSync(state, steps = 2) {
    if (!this.enabled) return null; const t = new Trainer(this.config, this.P); t.step = this.step; t.setCorpus(corpusFromState(state));
    for (let i = 0; i < steps; i++) t.trainStep();
    Object.assign(this, { step: t.step, loss: t.loss ?? this.loss, ema: t.ema ?? this.ema, tokens: this.tokens + t.tokens }); this.model = new Transformer(this.config, this.P); await this.save();
    return { step: this.step, loss: this.loss };
  }
  draft(question, { kernel = null, max = Number(this.env.TRANSFORMER_DRAFT_TOKENS || 120) } = {}) {
    if (!this.enabled) return null;
    const out = this.model.generate(encode(`Q: ${question}\nA:`, { bos: true }), { max, prefix: kernel ? b64ToVec(kernel) : null, stop: [EOS], temperature: 0.7, topK: 12, seed: question.length });
    const text = decode(out).split(/\n\n|\nQ:/)[0].trim();
    return { text, tokens: out.length, trainingSteps: this.step, loss: this.loss, label: 'Experimental KENUXA transformer draft — generated, not retrieved; not evidence.' };
  }
  embed(text, kernel = null) { return this.model.embed(encode(text, { bos: true }), kernel ? b64ToVec(kernel) : null); }
  // An atom grows its own kernel from its DNA. Runs inside the training worker when one is active,
  // so long-running servers stay responsive; otherwise inline (bounded steps).
  async growKernel(atom, { steps = 4 } = {}) {
    const texts = [`Q: ${atom.title}\nA: ${atom.answer}`, ...(atom.dna?.meaning?.claims || []).slice(-4).map(c => `About ${atom.title}: ${c.text}`)];
    const prev = atom.dna?.kernel?.prefix ? b64ToVec(atom.dna.kernel.prefix) : null, embedText = `${atom.title}. ${atom.answer}`;
    let k, emb;
    if (this.worker) {
      const id = Math.random().toString(36).slice(2), w = this.worker;
      const r = await new Promise((resolve, reject) => { const on = m => { if (m.type === 'kernel' && m.id === id) { w.off('message', on); clearTimeout(t); m.error ? reject(new Error(m.error)) : resolve(m); } }; const t = setTimeout(() => { w.off('message', on); reject(new Error('Kernel growth timed out')); }, 180000); w.on('message', on); w.postMessage({ type: 'kernel', id, texts, steps, init: prev, embedText }); });
      k = { prefix: r.prefix, loss: r.loss, tokens: r.tokens }; emb = r.embedding;
    } else { k = trainKernel(this.model, texts, { steps, init: prev }); emb = this.embed(embedText, vecToB64(k.prefix)); }
    atom.dna.kernel = { ...atom.dna.kernel, architecture: 'kenuxa-core-transformer + atom prefix kernel', prefix: vecToB64(k.prefix), prefixTokens: k.tokens, kernelLoss: k.loss, kernelSteps: (atom.dna.kernel?.kernelSteps || 0) + steps, baseStep: this.step, grownAt: new Date().toISOString(), parameterTraining: 'own prefix vectors trained against the frozen shared transformer' };
    atom.dna.embedding = { model: `kenuxa-core-${this.profile}@${this.step}`, dims: emb.length, vector: vecToB64(emb) };
    return atom.dna.kernel;
  }
  // Molecules and cells merge the kernels of their members (atoms merge reasoning states).
  mergeComposites(state) {
    const find = id => [...state.atoms, ...(state.organism?.molecules || [])].find(e => e.id === id);
    for (const e of [...(state.organism?.molecules || []), ...(state.organism?.cells || [])]) {
      const prefixes = e.memberIds.map(id => find(id)?.dna?.kernel?.prefix).filter(Boolean).map(b64ToVec), merged = mergeKernels(prefixes);
      if (merged) e.dna.kernel = { architecture: 'merged member prefix kernels', members: prefixes.length, prefix: vecToB64(merged), baseStep: this.step };
    }
  }
}
export { corpusFromState, vecToB64, b64ToVec };
export function cosine(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na * nb) || 1); }
