// KENUXA Core Transformer — a real decoder-only transformer written in plain JavaScript.
// No dependencies, no downloaded weights: every parameter is trained by KENUXA itself.
//
// Architecture (all profiles): 9 layers · 81 query heads · 9 KV heads (GQA, 9 queries per KV head)
// RMSNorm (pre-norm) · RoPE · SwiGLU feed-forward · tied byte embeddings · 32K positional range.
// Training uses exact hand-derived backward passes (verified by numerical gradient tests),
// AdamW, gradient clipping and optional per-layer gradient checkpointing (recompute in backward).
// Inference uses a KV cache with tiled online-softmax ("flash-style") attention, which never
// materialises the full attention matrix, so long contexts only cost the KV cache memory.
//
// The transformer is a reasoning component that SERVES the graph (embeddings, drafts, atom kernels).
// It does not control the network and it is never treated as a source of truth.

export const PROFILES = {
  // Same depth/width-of-attention as the spec; head dimension scales with hardware.
  nano: { layers: 9, heads: 81, kvHeads: 9, headDim: 2, ffn: 432 },   // ~1.9M params — any CPU
  lite: { layers: 9, heads: 81, kvHeads: 9, headDim: 4, ffn: 864 },   // ~7.8M params — desktop CPU
  core: { layers: 9, heads: 81, kvHeads: 9, headDim: 8, ffn: 1728 },  // ~39M params — strong machine
};
export const BASE = { vocab: 260, context: 32768, ropeBase: 500000, eps: 1e-5 };

export function makeConfig(profile = 'nano', overrides = {}) {
  const p = PROFILES[profile];
  if (!p && !overrides.layers) throw new Error(`Unknown transformer profile: ${profile}`);
  const c = { profile, ...BASE, ...(p || {}), ...overrides };
  c.dim = c.heads * c.headDim; c.kvDim = c.kvHeads * c.headDim;
  if (c.heads % c.kvHeads) throw new Error('heads must be a multiple of kvHeads (GQA)');
  if (c.headDim % 2) throw new Error('RoPE needs an even head dimension');
  return c;
}

// ---------- deterministic randomness ----------
export function rng(seed = 1) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.normal = () => { const u = Math.max(next(), 1e-12), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return next;
}

// ---------- dense kernels (row-major Float32Array) ----------
// Y[T,O] (+)= X[T,I] · W[I,O]
function mm(X, T, I, W, O, Y = new Float32Array(T * O)) {
  for (let t = 0; t < T; t++) {
    const yo = t * O, xo = t * I;
    for (let i = 0; i < I; i++) { const x = X[xo + i]; if (x === 0) continue; const wo = i * O; for (let o = 0; o < O; o++) Y[yo + o] += x * W[wo + o]; }
  }
  return Y;
}
// dX[T,I] += dY[T,O] · W[I,O]^T
function mmDX(dY, T, O, W, I, dX) {
  for (let t = 0; t < T; t++) { const yo = t * O, xo = t * I; for (let i = 0; i < I; i++) { const wo = i * O; let s = 0; for (let o = 0; o < O; o++) s += dY[yo + o] * W[wo + o]; dX[xo + i] += s; } }
}
// dW[I,O] += X[T,I]^T · dY[T,O]
function mmDW(X, dY, T, I, O, dW) {
  for (let t = 0; t < T; t++) { const xo = t * I, yo = t * O; for (let i = 0; i < I; i++) { const x = X[xo + i]; if (x === 0) continue; const wo = i * O; for (let o = 0; o < O; o++) dW[wo + o] += x * dY[yo + o]; } }
}

function rmsnorm(x, T, D, g, eps) {
  const y = new Float32Array(T * D), r = new Float32Array(T);
  for (let t = 0; t < T; t++) { let ss = 0; const o = t * D; for (let d = 0; d < D; d++) ss += x[o + d] * x[o + d]; const inv = 1 / Math.sqrt(ss / D + eps); r[t] = inv; for (let d = 0; d < D; d++) y[o + d] = x[o + d] * inv * g[d]; }
  return { y, r };
}
function rmsnormBack(x, r, T, D, g, dy, dx, dg) {
  for (let t = 0; t < T; t++) {
    const o = t * D, inv = r[t]; let dot = 0;
    for (let d = 0; d < D; d++) { const a = g[d] * dy[o + d]; dot += a * x[o + d]; dg[d] += dy[o + d] * x[o + d] * inv; }
    const k = inv * inv * inv * dot / D;
    for (let d = 0; d < D; d++) dx[o + d] += g[d] * dy[o + d] * inv - x[o + d] * k;
  }
}

// ---------- RoPE ----------
const ropeCache = new Map();
function ropeTable(headDim, base, upTo) {
  const key = headDim + ':' + base; let tab = ropeCache.get(key);
  if (!tab || tab.n < upTo) {
    const n = Math.max(upTo, (tab?.n || 0) * 2, 256), half = headDim / 2, cos = new Float32Array(n * half), sin = new Float32Array(n * half);
    for (let p = 0; p < n; p++) for (let j = 0; j < half; j++) { const a = p * Math.pow(base, -2 * j / headDim); cos[p * half + j] = Math.cos(a); sin[p * half + j] = Math.sin(a); }
    tab = { n, cos, sin }; ropeCache.set(key, tab);
  }
  return tab;
}
// Rotates every head of X[T, nHeads*headDim] in place; sign=-1 applies the inverse (used by backward).
function rope(X, T, nHeads, headDim, base, pos0, sign = 1) {
  const half = headDim / 2, tab = ropeTable(headDim, base, pos0 + T), W = nHeads * headDim;
  for (let t = 0; t < T; t++) {
    const po = (pos0 + t) * half;
    for (let h = 0; h < nHeads; h++) for (let j = 0; j < half; j++) {
      const i = t * W + h * headDim + 2 * j, c = tab.cos[po + j], s = sign * tab.sin[po + j], a = X[i], b = X[i + 1];
      X[i] = a * c - b * s; X[i + 1] = a * s + b * c;
    }
  }
}

const silu = u => u / (1 + Math.exp(-u));
const dsilu = u => { const s = 1 / (1 + Math.exp(-u)); return s * (1 + u * (1 - s)); };

// ---------- parameters ----------
export function initParams(c, seed = 7) {
  const r = rng(seed), P = new Map(), mat = (n, std) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r.normal() * std; return a; };
  const ones = n => new Float32Array(n).fill(1), proj = 0.02 / Math.sqrt(2 * c.layers);
  P.set('emb', mat(c.vocab * c.dim, 0.02));
  for (let l = 0; l < c.layers; l++) {
    P.set(`${l}.g1`, ones(c.dim)); P.set(`${l}.wq`, mat(c.dim * c.dim, 0.02)); P.set(`${l}.wk`, mat(c.dim * c.kvDim, 0.02));
    P.set(`${l}.wv`, mat(c.dim * c.kvDim, 0.02)); P.set(`${l}.wo`, mat(c.dim * c.dim, proj)); P.set(`${l}.g2`, ones(c.dim));
    P.set(`${l}.w1`, mat(c.dim * c.ffn, 0.02)); P.set(`${l}.w3`, mat(c.dim * c.ffn, 0.02)); P.set(`${l}.w2`, mat(c.ffn * c.dim, proj));
  }
  P.set('gf', ones(c.dim));
  return P;
}
export const countParams = P => [...P.values()].reduce((s, a) => s + a.length, 0);

// Modular stacking: append layers that start as exact identities (zero output projections),
// so the network's function is preserved and new depth is learned incrementally.
export function expandLayers(c, P, extra, seed = 99) {
  const fresh = initParams({ ...c, layers: extra }, seed);
  for (let l = 0; l < extra; l++) for (const k of ['g1', 'wq', 'wk', 'wv', 'wo', 'g2', 'w1', 'w3', 'w2']) {
    const a = fresh.get(`${l}.${k}`); if (k === 'wo' || k === 'w2') a.fill(0); P.set(`${c.layers + l}.${k}`, a);
  }
  c.layers += extra; return c;
}

// ---------- one transformer block ----------
function blockForward(c, P, l, x, T, pos0) {
  const D = c.dim, K = c.kvDim, F = c.ffn, H = c.heads, hd = c.headDim, G = H / c.kvHeads, sc = 1 / Math.sqrt(hd);
  const n1 = rmsnorm(x, T, D, P.get(`${l}.g1`), c.eps);
  const q = mm(n1.y, T, D, P.get(`${l}.wq`), D), k = mm(n1.y, T, D, P.get(`${l}.wk`), K), v = mm(n1.y, T, D, P.get(`${l}.wv`), K);
  rope(q, T, H, hd, c.ropeBase, pos0); rope(k, T, c.kvHeads, hd, c.ropeBase, pos0);
  const att = new Float32Array(H * T * T), o = new Float32Array(T * D);
  for (let h = 0; h < H; h++) {
    const qo = h * hd, ko = Math.floor(h / G) * hd, base = h * T * T;
    for (let t = 0; t < T; t++) {
      let mx = -Infinity; const row = base + t * T;
      for (let s = 0; s <= t; s++) { let d = 0; for (let j = 0; j < hd; j++) d += q[t * D + qo + j] * k[s * K + ko + j]; d *= sc; att[row + s] = d; if (d > mx) mx = d; }
      let sum = 0; for (let s = 0; s <= t; s++) { const e = Math.exp(att[row + s] - mx); att[row + s] = e; sum += e; }
      for (let s = 0; s <= t; s++) { const p = att[row + s] / sum; att[row + s] = p; for (let j = 0; j < hd; j++) o[t * D + qo + j] += p * v[s * K + ko + j]; }
    }
  }
  const a = mm(o, T, D, P.get(`${l}.wo`), D), x2 = new Float32Array(T * D);
  for (let i = 0; i < T * D; i++) x2[i] = x[i] + a[i];
  const n2 = rmsnorm(x2, T, D, P.get(`${l}.g2`), c.eps);
  const u = mm(n2.y, T, D, P.get(`${l}.w1`), F), g = mm(n2.y, T, D, P.get(`${l}.w3`), F), s = new Float32Array(T * F);
  for (let i = 0; i < T * F; i++) s[i] = silu(u[i]) * g[i];
  const f = mm(s, T, F, P.get(`${l}.w2`), D), out = new Float32Array(T * D);
  for (let i = 0; i < T * D; i++) out[i] = x2[i] + f[i];
  return { out, cache: { x, n1, q, k, v, att, o, x2, n2, u, g, s } };
}

function blockBackward(c, P, Gd, l, cache, dOut, T, pos0) {
  const D = c.dim, K = c.kvDim, F = c.ffn, H = c.heads, hd = c.headDim, G = H / c.kvHeads, sc = 1 / Math.sqrt(hd);
  const { x, n1, q, k, v, att, o, x2, n2, u, g, s } = cache, gr = n => Gd.get(`${l}.${n}`);
  // FFN
  const dx2 = Float32Array.from(dOut), ds = new Float32Array(T * F);
  mmDW(s, dOut, T, F, D, gr('w2')); mmDX(dOut, T, D, P.get(`${l}.w2`), F, ds);
  const du = new Float32Array(T * F), dg = new Float32Array(T * F);
  for (let i = 0; i < T * F; i++) { du[i] = ds[i] * g[i] * dsilu(u[i]); dg[i] = ds[i] * silu(u[i]); }
  const dn2 = new Float32Array(T * D);
  mmDW(n2.y, du, T, D, F, gr('w1')); mmDX(du, T, F, P.get(`${l}.w1`), D, dn2);
  mmDW(n2.y, dg, T, D, F, gr('w3')); mmDX(dg, T, F, P.get(`${l}.w3`), D, dn2);
  rmsnormBack(x2, n2.r, T, D, P.get(`${l}.g2`), dn2, dx2, gr('g2'));
  // attention
  const dx = Float32Array.from(dx2), do_ = new Float32Array(T * D);
  mmDW(o, dx2, T, D, D, gr('wo')); mmDX(dx2, T, D, P.get(`${l}.wo`), D, do_);
  const dq = new Float32Array(T * D), dk = new Float32Array(T * K), dv = new Float32Array(T * K), dp = new Float32Array(T);
  for (let h = 0; h < H; h++) {
    const qo = h * hd, ko = Math.floor(h / G) * hd, base = h * T * T;
    for (let t = 0; t < T; t++) {
      const row = base + t * T; let dot = 0;
      for (let s2 = 0; s2 <= t; s2++) { let d = 0; for (let j = 0; j < hd; j++) { d += do_[t * D + qo + j] * v[s2 * K + ko + j]; dv[s2 * K + ko + j] += att[row + s2] * do_[t * D + qo + j]; } dp[s2] = d; dot += d * att[row + s2]; }
      for (let s2 = 0; s2 <= t; s2++) { const dsc = att[row + s2] * (dp[s2] - dot) * sc; for (let j = 0; j < hd; j++) { dq[t * D + qo + j] += dsc * k[s2 * K + ko + j]; dk[s2 * K + ko + j] += dsc * q[t * D + qo + j]; } }
    }
  }
  rope(dq, T, H, hd, c.ropeBase, pos0, -1); rope(dk, T, c.kvHeads, hd, c.ropeBase, pos0, -1);
  const dn1 = new Float32Array(T * D);
  mmDW(n1.y, dq, T, D, D, gr('wq')); mmDX(dq, T, D, P.get(`${l}.wq`), D, dn1);
  mmDW(n1.y, dk, T, D, K, gr('wk')); mmDX(dk, T, K, P.get(`${l}.wk`), D, dn1);
  mmDW(n1.y, dv, T, D, K, gr('wv')); mmDX(dv, T, K, P.get(`${l}.wv`), D, dn1);
  rmsnormBack(x, n1.r, T, D, P.get(`${l}.g1`), dn1, dx, gr('g1'));
  return dx;
}

// ---------- full model ----------
export class Transformer {
  constructor(config, params, { checkpointing = true } = {}) {
    this.c = config; this.P = params || initParams(config); this.checkpointing = checkpointing;
  }
  get parameters() { return countParams(this.P); }
  embedTokens(tokens, prefix) {
    const D = this.c.dim, E = this.P.get('emb'), pre = prefix ? prefix.length / D : 0, T = pre + tokens.length, x = new Float32Array(T * D);
    if (prefix) x.set(prefix, 0);
    tokens.forEach((tk, t) => x.set(E.subarray(tk * D, tk * D + D), (pre + t) * D));
    return { x, T, pre };
  }
  // Forward over a whole sequence. Returns logits and the state needed for backward.
  forward(tokens, { prefix = null, keep = true } = {}) {
    const c = this.c, D = c.dim; let { x, T, pre } = this.embedTokens(tokens, prefix);
    const layers = [];
    for (let l = 0; l < c.layers; l++) {
      const r = blockForward(c, this.P, l, x, T, 0);
      layers.push(keep ? (this.checkpointing ? { x } : r.cache) : null); x = r.out;
    }
    const nf = rmsnorm(x, T, D, this.P.get('gf'), c.eps), E = this.P.get('emb'), V = c.vocab, logits = new Float32Array(T * V);
    for (let t = 0; t < T; t++) for (let w = 0; w < V; w++) { let s = 0; for (let d = 0; d < D; d++) s += nf.y[t * D + d] * E[w * D + d]; logits[t * V + w] = s; }
    return { logits, T, pre, hidden: nf.y, state: { layers, final: x, nf, tokens, pre } };
  }
  // Mean next-token cross-entropy. targets[i] predicts from position pre+i; -1 = ignore.
  loss(logits, T, pre, targets) {
    const V = this.c.vocab, dlogits = new Float32Array(T * V); let loss = 0, n = 0;
    for (let i = 0; i < targets.length; i++) if (targets[i] >= 0) n++;
    for (let i = 0; i < targets.length; i++) {
      const y = targets[i]; if (y < 0) continue; const t = pre + i, o = t * V; let mx = -Infinity;
      for (let w = 0; w < V; w++) if (logits[o + w] > mx) mx = logits[o + w];
      let sum = 0; for (let w = 0; w < V; w++) sum += Math.exp(logits[o + w] - mx);
      loss += -(logits[o + y] - mx - Math.log(sum));
      for (let w = 0; w < V; w++) dlogits[o + w] = Math.exp(logits[o + w] - mx) / sum / n;
      dlogits[o + y] -= 1 / n;
    }
    return { loss: loss / Math.max(n, 1), dlogits };
  }
  zeroGrads() { const G = new Map(); for (const [k, a] of this.P) G.set(k, new Float32Array(a.length)); return G; }
  // Backward; returns gradient for the (prefix) inputs as well, enabling atom-kernel training.
  backward(fw, dlogits, G = this.zeroGrads()) {
    const c = this.c, D = c.dim, V = c.vocab, T = fw.T, E = this.P.get('emb'), { nf, layers, tokens, pre } = fw.state;
    const dE = G.get('emb'), dnf = new Float32Array(T * D);
    for (let t = 0; t < T; t++) for (let w = 0; w < V; w++) { const g = dlogits[t * V + w]; if (g === 0) continue; for (let d = 0; d < D; d++) { dnf[t * D + d] += g * E[w * D + d]; dE[w * D + d] += g * nf.y[t * D + d]; } }
    let dx = new Float32Array(T * D);
    rmsnormBack(fw.state.final, nf.r, T, D, this.P.get('gf'), dnf, dx, G.get('gf'));
    for (let l = c.layers - 1; l >= 0; l--) {
      const cache = layers[l].n1 ? layers[l] : blockForward(c, this.P, l, layers[l].x, T, 0).cache; // recompute when checkpointed
      dx = blockBackward(c, this.P, G, l, cache, dx, T, 0);
    }
    tokens.forEach((tk, t) => { for (let d = 0; d < D; d++) dE[tk * D + d] += dx[(pre + t) * D + d]; });
    return { G, dPrefix: pre ? dx.slice(0, pre * D) : null };
  }

  // ----- inference with KV cache and tiled online-softmax attention -----
  newCache() { return { len: 0, k: Array.from({ length: this.c.layers }, () => []), v: Array.from({ length: this.c.layers }, () => []) }; }
  step(xRow, cache) {
    const c = this.c, D = c.dim, K = c.kvDim, F = c.ffn, H = c.heads, hd = c.headDim, G = H / c.kvHeads, sc = 1 / Math.sqrt(hd), pos = cache.len, TILE = 64;
    if (pos >= c.context) throw new Error(`Context window of ${c.context} tokens reached`);
    let x = xRow;
    for (let l = 0; l < c.layers; l++) {
      const n1 = rmsnorm(x, 1, D, this.P.get(`${l}.g1`), c.eps).y;
      const q = mm(n1, 1, D, this.P.get(`${l}.wq`), D), k = mm(n1, 1, D, this.P.get(`${l}.wk`), K), v = mm(n1, 1, D, this.P.get(`${l}.wv`), K);
      rope(q, 1, H, hd, c.ropeBase, pos); rope(k, 1, c.kvHeads, hd, c.ropeBase, pos);
      cache.k[l].push(k); cache.v[l].push(v);
      const keys = cache.k[l], vals = cache.v[l], n = keys.length, o = new Float32Array(D);
      for (let h = 0; h < H; h++) {
        const qo = h * hd, ko = Math.floor(h / G) * hd; let m = -Infinity, sum = 0; const acc = new Float32Array(hd);
        for (let s0 = 0; s0 < n; s0 += TILE) {          // process keys tile by tile, rescaling the running sum
          const e = Math.min(n, s0 + TILE); let tm = -Infinity; const sc_ = new Float32Array(e - s0);
          for (let s = s0; s < e; s++) { let d = 0; for (let j = 0; j < hd; j++) d += q[qo + j] * keys[s][ko + j]; sc_[s - s0] = d * sc; if (sc_[s - s0] > tm) tm = sc_[s - s0]; }
          const nm = Math.max(m, tm), scale = Math.exp(m - nm); sum *= scale; for (let j = 0; j < hd; j++) acc[j] *= scale;
          for (let s = s0; s < e; s++) { const p = Math.exp(sc_[s - s0] - nm); sum += p; for (let j = 0; j < hd; j++) acc[j] += p * vals[s][ko + j]; }
          m = nm;
        }
        for (let j = 0; j < hd; j++) o[qo + j] = acc[j] / sum;
      }
      const a = mm(o, 1, D, this.P.get(`${l}.wo`), D), x2 = new Float32Array(D); for (let i = 0; i < D; i++) x2[i] = x[i] + a[i];
      const n2 = rmsnorm(x2, 1, D, this.P.get(`${l}.g2`), c.eps).y, u = mm(n2, 1, D, this.P.get(`${l}.w1`), F), g = mm(n2, 1, D, this.P.get(`${l}.w3`), F);
      for (let i = 0; i < F; i++) u[i] = silu(u[i]) * g[i];
      const f = mm(u, 1, F, this.P.get(`${l}.w2`), D); x = new Float32Array(D); for (let i = 0; i < D; i++) x[i] = x2[i] + f[i];
    }
    cache.len++;
    const nf = rmsnorm(x, 1, D, this.P.get('gf'), c.eps).y, E = this.P.get('emb'), logits = new Float32Array(c.vocab);
    for (let w = 0; w < c.vocab; w++) { let s = 0; for (let d = 0; d < D; d++) s += nf[d] * E[w * D + d]; logits[w] = s; }
    return { logits, hidden: nf };
  }
  generate(prompt, { max = 160, temperature = 0.8, topK = 20, seed = 1, prefix = null, stop = [] } = {}) {
    const D = this.c.dim, E = this.P.get('emb'), cache = this.newCache(), r = rng(seed), out = [];
    let last = null;
    if (prefix) for (let p = 0; p < prefix.length / D; p++) last = this.step(prefix.slice(p * D, p * D + D), cache);
    for (const tk of prompt) last = this.step(E.slice(tk * D, tk * D + D), cache);
    for (let i = 0; i < max && last; i++) {
      const l = last.logits, idx = [...l.keys()].sort((a, b) => l[b] - l[a]).slice(0, topK), mx = l[idx[0]];
      const w = idx.map(j => Math.exp((l[j] - mx) / Math.max(temperature, 1e-3))), sum = w.reduce((a, b) => a + b, 0);
      let pick = r() * sum, tk = idx[0]; for (let j = 0; j < idx.length; j++) { pick -= w[j]; if (pick <= 0) { tk = idx[j]; break; } }
      if (stop.includes(tk)) break; out.push(tk); last = this.step(E.slice(tk * D, tk * D + D), cache);
    }
    return out;
  }
  // Meaning vector: mean of final normalised hidden states, L2-normalised.
  embed(tokens, prefix = null) {
    const D = this.c.dim, { hidden, T, pre } = this.forward(tokens.slice(-256), { prefix, keep: false }), v = new Float32Array(D);
    for (let t = pre; t < T; t++) for (let d = 0; d < D; d++) v[d] += hidden[t * D + d];
    let n = 0; for (let d = 0; d < D; d++) n += v[d] * v[d]; n = Math.sqrt(n) || 1;
    for (let d = 0; d < D; d++) v[d] /= n; return v;
  }
}

// ---------- AdamW ----------
export class AdamW {
  constructor(P, { lr = 3e-3, b1 = 0.9, b2 = 0.98, eps = 1e-8, wd = 0.01, clip = 1 } = {}) {
    Object.assign(this, { lr, b1, b2, eps, wd, clip, t: 0 }); this.m = new Map(); this.v = new Map();
    for (const [k, a] of P) { this.m.set(k, new Float32Array(a.length)); this.v.set(k, new Float32Array(a.length)); }
  }
  step(P, G, lr = this.lr) {
    let norm = 0; for (const g of G.values()) for (let i = 0; i < g.length; i++) norm += g[i] * g[i];
    norm = Math.sqrt(norm); const scale = norm > this.clip ? this.clip / norm : 1; this.t++;
    const c1 = 1 - Math.pow(this.b1, this.t), c2 = 1 - Math.pow(this.b2, this.t);
    for (const [k, p] of P) {
      const g = G.get(k); if (!g) continue; const m = this.m.get(k), v = this.v.get(k), decay = /\.g[12f]?$|^gf$/.test(k) ? 0 : this.wd;
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] * scale; m[i] = this.b1 * m[i] + (1 - this.b1) * gi; v[i] = this.b2 * v[i] + (1 - this.b2) * gi * gi;
        p[i] -= lr * (m[i] / c1 / (Math.sqrt(v[i] / c2) + this.eps) + decay * p[i]);
      }
    }
    return norm;
  }
}
