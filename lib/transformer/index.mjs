// TransformerService — the transformer as a component that serves the graph:
//  • meaning embeddings for atoms (relationship discovery, pgvector rows)
//  • experimental generative drafts (always labelled; never used as evidence)
//  • per-atom reasoning kernels (prefix vectors) that merge into molecules and cells
//  • background training of a CANDIDATE on curated, privacy-scrubbed approved knowledge; the served
//    model changes only via the gated release pipeline (pipeline.mjs): evaluate → promote → rollback
import { Worker } from 'node:worker_threads';
import { makeConfig, initParams, Transformer, countParams, expandLayers } from './core.mjs';
import { serialize, deserialize, encode, decode, vecToB64, b64ToVec, EOS } from './io.mjs';
import { Trainer, corpusFromState, trainKernel, mergeKernels } from './train.mjs';
import { curateDataset, evaluate, gate, DEFAULT_RELEASE_POLICY } from './pipeline.mjs';

const CKPT = 'transformer.ckpt', CAND = 'transformer.candidate.ckpt', version = n => `transformer.v${n}.ckpt`;
const cloneP = P => new Map([...P].map(([k, a]) => [k, Float32Array.from(a)]));
export class TransformerService {
  constructor({ profile = process.env.TRANSFORMER_PROFILE || 'nano', blobs, log = () => {}, env = process.env } = {}) {
    Object.assign(this, { profile, blobs, log, env }); this.step = 0; this.loss = null; this.ema = null; this.tokens = 0; this.worker = null; this.savedAt = null;
    this.enabled = env.TRANSFORMER_ENABLED !== 'false';
    this.policy = { ...DEFAULT_RELEASE_POLICY, mode: ['gated', 'manual', 'off'].includes(env.TRANSFORMER_PROMOTION) ? env.TRANSFORMER_PROMOTION : 'gated', minStepsBetween: Number(env.TRANSFORMER_MIN_STEPS_PER_RELEASE || DEFAULT_RELEASE_POLICY.minStepsBetween) };
    // live = the version that serves drafts/embeddings; candidate = what training is producing (never served until promoted).
    this.release = { live: { version: 0, step: 0, evalLoss: null, regressionLoss: null, at: null, approvedBy: 'initialisation' }, candidate: null, history: [], regression: [], log: [] };
    this.dataset = { train: [], eval: [], dropped: { duplicates: 0, length: 0, privacy: 0 }, privacy: {} };
  }
  async init() {
    let loaded = null, cand = null;
    try { const buf = await this.blobs?.read(CKPT); if (buf) loaded = deserialize(buf); } catch (e) { this.log('transformer checkpoint unreadable: ' + e.message); }
    try { const buf = await this.blobs?.read(CAND); if (buf) cand = deserialize(buf); } catch (e) { this.log('transformer candidate unreadable: ' + e.message); }
    if (loaded && loaded.header.config.profile === this.profile) {
      this.config = loaded.header.config; this.P = loaded.P; Object.assign(this, { step: loaded.header.step || 0, loss: loaded.header.loss ?? null, ema: loaded.header.ema ?? null, tokens: loaded.header.tokens || 0 });
      if (loaded.header.release) this.release = { ...this.release, ...loaded.header.release, candidate: null };
    } else { this.config = makeConfig(this.profile); this.P = initParams(this.config, 7); }
    if (cand && cand.header.config.profile === this.profile && cand.header.config.layers === this.config.layers) { this.candP = cand.P; Object.assign(this, { step: cand.header.step ?? this.step, loss: cand.header.loss ?? this.loss, ema: cand.header.ema ?? this.ema, tokens: cand.header.tokens ?? this.tokens }); }
    else this.candP = cloneP(this.P);
    const extra = Number(this.env.TRANSFORMER_EXTRA_LAYERS || 0);
    if (extra > 0 && extra <= 27 && this.config.layers < 9 + extra) { const add = 9 + extra - this.config.layers; const c2 = { ...this.config }; expandLayers(this.config, this.P, add); expandLayers(c2, this.candP, add); }
    this.model = new Transformer(this.config, this.P); return this;
  }
  status() {
    const c = this.config, r = this.release;
    return { enabled: this.enabled, architecture: 'KENUXA Core Transformer (decoder-only)', profile: c.profile, layers: c.layers, heads: c.heads, kvHeads: c.kvHeads, grouping: `GQA ${c.heads / c.kvHeads}:1`, headDim: c.headDim, hiddenDim: c.dim, ffnDim: c.ffn,
      contextWindow: c.context, positional: `RoPE (base ${c.ropeBase})`, norm: 'RMSNorm', feedForward: 'SwiGLU', attention: 'causal; training exact, inference tiled online-softmax with KV cache', precision: 'fp32 compute, fp16 checkpoint storage', gradientCheckpointing: true,
      parameters: countParams(this.P), trainingSteps: this.step, trainedTokens: this.tokens, loss: this.loss, smoothedLoss: this.ema, training: !!this.worker, savedAt: this.savedAt,
      release: { policy: this.policy, live: r.live, candidate: r.candidate, versions: r.history.map(v => ({ version: v.version, step: v.step, evalLoss: v.evalLoss, at: v.at, approvedBy: v.approvedBy })), regressionDocs: r.regression.length, recent: r.log.slice(-8) },
      dataset: { train: this.dataset.train.length, heldOut: this.dataset.eval.length, dropped: this.dataset.dropped, privacy: this.dataset.privacy, fingerprint: this.dataset.fingerprint || null },
      role: 'Serves atoms, capabilities, outcomes and evolution. Not the system centre and not a source of truth. Knowledge updates go to the atom network immediately; weights change only through the gated release pipeline.' };
  }
  header() { return { step: this.step, loss: this.loss, ema: this.ema, tokens: this.tokens }; }
  async save() { if (!this.blobs) return; await this.blobs.write(CKPT, serialize(this.config, this.P, { ...this.header(), release: { ...this.release, candidate: null, log: this.release.log.slice(-30) } })); await this.blobs.write(CAND, serialize(this.config, this.candP, this.header())); this.savedAt = new Date().toISOString(); }
  curate(texts) { this.dataset = curateDataset(texts); if (this.dataset.dropped.privacy) this.log(`transformer dataset: excluded ${this.dataset.dropped.privacy} document(s) with personal data or secrets`); return this.dataset.train; }
  note(msg) { this.release.log.push({ at: new Date().toISOString(), msg }); this.release.log = this.release.log.slice(-60); }
  // Evaluate the candidate against the live model and apply the promotion policy.
  async review({ force = false } = {}) {
    const r = this.release, evalDocs = this.dataset.eval, reg = r.regression.length ? r.regression : evalDocs;
    if (!evalDocs.length) { r.candidate = { step: this.step, status: 'not-evaluated', reasons: ['no held-out evaluation data yet'] }; return r.candidate; }
    if (r.live.evalFingerprint !== this.dataset.fingerprint || r.live.evalLoss == null) { r.live.evalLoss = evaluate(this.config, this.P, evalDocs); r.live.regressionLoss = evaluate(this.config, this.P, reg); r.live.evalFingerprint = this.dataset.fingerprint; }
    const candidate = { step: this.step, evalLoss: evaluate(this.config, this.candP, evalDocs), regressionLoss: evaluate(this.config, this.candP, reg), at: new Date().toISOString(), dataset: this.dataset.fingerprint };
    const g = gate({ candidate, live: r.live, policy: force ? { ...this.policy, minStepsBetween: 0, mode: 'gated' } : this.policy });
    r.candidate = { ...candidate, status: g.decision, reasons: g.reasons };
    if (g.decision === 'promote') await this.promote({ approvedBy: force ? 'admin (forced gate)' : 'automatic gate: held-out + regression' });
    else this.note(`candidate @${this.step} ${g.decision}${g.reasons.length ? ': ' + g.reasons.join('; ') : ''}`);
    return r.candidate;
  }
  async promote({ approvedBy = 'admin' } = {}) {
    const r = this.release, c = r.candidate; if (!c || c.evalLoss == null) throw new Error('No evaluated candidate to promote');
    if (c.status === 'rejected') throw new Error('The candidate failed its evaluation gate: ' + (c.reasons || []).join('; '));
    const v = (r.history.at(-1)?.version || r.live.version || 0) + 1;
    this.P = cloneP(this.candP); this.model = new Transformer(this.config, this.P);
    if (!r.regression.length) r.regression = this.dataset.eval.slice(0, 32); // frozen regression set from the first release
    r.live = { version: v, step: c.step, evalLoss: c.evalLoss, regressionLoss: c.regressionLoss, evalFingerprint: this.dataset.fingerprint, at: new Date().toISOString(), approvedBy, dataset: c.dataset };
    r.history.push({ ...r.live }); r.candidate = { ...c, status: 'promoted' };
    if (this.blobs) { await this.blobs.write(version(v), serialize(this.config, this.P, { ...this.header(), version: v }));
      const old = r.history.slice(0, -this.policy.keepVersions); for (const o of old) { o.checkpoint = 'pruned'; try { await this.blobs.write(version(o.version), Buffer.alloc(0)); } catch {} } }
    this.note(`promoted version ${v} (step ${c.step}, held-out loss ${c.evalLoss}) — ${approvedBy}`); await this.save(); return r.live;
  }
  async approve(by = 'admin') { const c = this.release.candidate; if (!c || c.status !== 'awaiting-approval') throw new Error('No candidate is awaiting approval'); return this.promote({ approvedBy: by }); }
  async rollback(target) {
    const r = this.release, rec = r.history.find(v => v.version === Number(target)); if (!rec) throw new Error('Unknown model version');
    const buf = await this.blobs?.read(version(rec.version)); if (!buf?.length) throw new Error(`Checkpoint for version ${rec.version} is no longer kept`);
    const { P } = deserialize(buf); this.P = P; this.model = new Transformer(this.config, this.P);
    const running = !!this.worker; if (running) await this.stop(); this.candP = cloneP(this.P); // training resumes from the restored weights
    r.live = { ...rec, at: new Date().toISOString(), approvedBy: 'rollback', rolledBackFrom: r.live.version }; r.candidate = null; this.note(`rolled back to version ${rec.version}`); await this.save();
    if (running && this._getCorpus) this.startBackground(this._getCorpus);
    return r.live;
  }
  // Long-running hosts: train the CANDIDATE continuously in a worker thread.
  startBackground(getCorpus, { reportEvery = 25 } = {}) {
    if (!this.enabled || this.worker || this.env.TRANSFORMER_TRAINING === 'false') return false;
    this._getCorpus = getCorpus;
    const weights = Object.fromEntries([...this.candP].map(([k, a]) => [k, a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)]));
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { config: this.config, weights, corpus: this.curate(getCorpus()), options: { reportEvery, startStep: this.step, lr: Number(this.env.TRANSFORMER_LR || 2e-3), throttleMs: Number(this.env.TRANSFORMER_THROTTLE_MS || (this.env.RENDER ? 250 : 25)) } } });
    this._baseTokens = this.tokens; this.worker.unref();
    this.worker.on('message', async msg => {
      if (msg.type !== 'weights') return;
      for (const [k, a] of Object.entries(msg.weights)) this.candP.set(k, a);
      Object.assign(this, { step: msg.step, loss: msg.loss, ema: msg.ema, tokens: this._baseTokens + (msg.tokens || 0) });
      const every = Number(this.env.TRANSFORMER_SAVE_SECONDS || 300) * 1000, evalEvery = Number(this.env.TRANSFORMER_EVAL_SECONDS || 600) * 1000;
      if (!this._lastEval || Date.now() - this._lastEval >= evalEvery) { this._lastEval = Date.now(); try { await this.review(); } catch (e) { this.log('transformer review failed: ' + e.message); } }
      if (!this._lastSave || Date.now() - this._lastSave >= every) { this._lastSave = Date.now(); try { await this.save(); } catch (e) { this.log('transformer save failed: ' + e.message); } }
    });
    this.worker.on('error', e => { this.log('transformer worker error: ' + e.message); this.worker = null; });
    this.worker.on('exit', () => { this.worker = null; });
    return true;
  }
  setInteractiveLoad(active) { this.worker?.postMessage({type:'pressure',active:Number(active)>0}); }
  refreshCorpus(texts) { const train = this.curate(texts); this.worker?.postMessage({ type: 'corpus', corpus: train }); }
  async stop() { if (!this.worker) return; try { await this.save(); } catch {} const w = this.worker; await new Promise(r => { w.once('exit', r); w.postMessage({ type: 'stop' }); setTimeout(() => { w.terminate().then(r); }, 3000); }); this.worker = null; }
  // Serverless hosts / tests: a bounded number of synchronous steps on the candidate, then review.
  async trainSync(state, steps = 2, { corpus = null } = {}) {
    if (!this.enabled) return null; const t = new Trainer(this.config, this.candP); t.step = this.step; t.setCorpus(this.curate(corpus || corpusFromState(state)));
    for (let i = 0; i < steps; i++) t.trainStep();
    Object.assign(this, { step: t.step, loss: t.loss ?? this.loss, ema: t.ema ?? this.ema, tokens: this.tokens + t.tokens });
    const review = await this.review(); await this.save();
    return { step: this.step, loss: this.loss, review };
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
