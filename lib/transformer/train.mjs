// Training loop shared by the background worker and synchronous (serverless/test) training.
import { Transformer, AdamW, rng } from './core.mjs';
import { encode, BOS, EOS } from './io.mjs';

export function corpusFromState(state, { allowPrivate = true } = {}) {
  const docs = [];
  for (const a of state.atoms || []) {
    if (a.status !== 'approved' || (!allowPrivate && a.visibility !== 'public' && a.origin !== 'seed')) continue;
    const claims = (a.dna?.meaning?.claims || []).map(c => c.text).filter(t => t && t !== a.answer);
    if (typeof a.answer !== 'string' || typeof a.title !== 'string') continue;
    for (const q of [a.title, ...(a.questions || [])].slice(0, 6)) docs.push(`Q: ${q}\nA: ${a.answer}`);
    for (const c of claims.slice(-5)) docs.push(`About ${a.title}: ${c}`);
  }
  return docs.slice(0, 5000);
}

export class Trainer {
  constructor(config, P, { lr = 2e-3, warmup = 50, seq = 48, seed = 11, checkpointing = true } = {}) {
    this.model = new Transformer(config, P, { checkpointing }); this.opt = new AdamW(this.model.P, { lr });
    Object.assign(this, { lr, warmup, seq, step: 0, tokens: 0, loss: null, ema: null }); this.r = rng(seed); this.docs = [];
  }
  setCorpus(texts) { this.docs = texts.map(t => encode(t, { bos: true, eos: true })).filter(d => d.length > 2); }
  sample() {
    const d = this.docs[Math.floor(this.r() * this.docs.length)], n = Math.min(this.seq + 1, d.length), start = d.length > n ? Math.floor(this.r() * (d.length - n + 1)) : 0;
    return d.slice(start, start + n);
  }
  trainStep() {
    if (!this.docs.length) return null;
    const w = this.sample(), m = this.model, f = m.forward(w.slice(0, -1)), { loss, dlogits } = m.loss(f.logits, f.T, f.pre, w.slice(1));
    const { G } = m.backward(f, dlogits), lr = this.lr * Math.min(1, (this.step + 1) / this.warmup);
    this.opt.step(m.P, G, lr); this.step++; this.tokens += w.length - 1; this.loss = loss; this.ema = this.ema == null ? loss : 0.98 * this.ema + 0.02 * loss;
    return loss;
  }
}

// Prefix-tuning: an atom grows its own small reasoning kernel (learned soft-prompt vectors)
// while the shared transformer stays frozen. Molecules/cells merge member kernels.
export function trainKernel(model, texts, { tokens = 4, steps = 12, lr = 0.05, seed = 5, init = null } = {}) {
  const D = model.c.dim, r = rng(seed), prefix = init ? Float32Array.from(init) : new Float32Array(tokens * D).map(() => r.normal() * 0.02);
  const m = new Float32Array(prefix.length), v = new Float32Array(prefix.length), docs = texts.map(t => encode(t, { bos: true, eos: true }).slice(0, 49)).filter(d => d.length > 2);
  let last = null;
  for (let s = 0; s < steps && docs.length; s++) {
    const d = docs[s % docs.length], f = model.forward(d.slice(0, -1), { prefix }), { loss, dlogits } = model.loss(f.logits, f.T, f.pre, d.slice(1));
    const { dPrefix } = model.backward(f, dlogits); last = loss;
    for (let i = 0; i < prefix.length; i++) { m[i] = 0.9 * m[i] + 0.1 * dPrefix[i]; v[i] = 0.999 * v[i] + 0.001 * dPrefix[i] ** 2; prefix[i] -= lr * (m[i] / (1 - 0.9 ** (s + 1))) / (Math.sqrt(v[i] / (1 - 0.999 ** (s + 1))) + 1e-8); }
  }
  return { prefix, loss: last, tokens: prefix.length / D };
}
export function mergeKernels(prefixes) {
  const valid = prefixes.filter(Boolean); if (!valid.length) return null;
  const n = Math.min(...valid.map(p => p.length)), out = new Float32Array(n);
  for (const p of valid) for (let i = 0; i < n; i++) out[i] += p[i] / valid.length;
  return out;
}
export { BOS, EOS };
