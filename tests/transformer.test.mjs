import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, Transformer, initParams, expandLayers, AdamW } from '../lib/transformer/core.mjs';
import { serialize, deserialize, encode, decode, toHalf, fromHalf } from '../lib/transformer/io.mjs';
import { Trainer, trainKernel, mergeKernels } from '../lib/transformer/train.mjs';
import { TransformerService } from '../lib/transformer/index.mjs';

const tiny = () => makeConfig('test', { layers: 2, heads: 4, kvHeads: 2, headDim: 2, ffn: 6, vocab: 11 });

test('spec profiles: 9 layers, 81 heads, GQA 9:1, RoPE-ready, 32K context', () => {
  for (const p of ['nano', 'lite', 'core']) { const c = makeConfig(p); assert.equal(c.layers, 9); assert.equal(c.heads, 81); assert.equal(c.kvHeads, 9); assert.equal(c.context, 32768); assert.equal(c.dim, 81 * c.headDim); }
  const m = new Transformer(makeConfig('nano')); assert.ok(m.parameters > 1_000_000);
});

test('hand-written backward pass matches numerical gradients (weights and atom-kernel prefix), with and without checkpointing', () => {
  const c = tiny(), P = initParams(c, 3); for (const a of P.values()) for (let i = 0; i < a.length; i++) a[i] *= 3;
  for (const checkpointing of [false, true]) {
    const m = new Transformer(c, P, { checkpointing }), toks = [1, 4, 2, 7, 3], tg = [4, 2, 7, 3, 9], prefix = new Float32Array(2 * c.dim).map((_, i) => Math.sin(i));
    const L = () => { const f = m.forward(toks, { prefix }); return m.loss(f.logits, f.T, f.pre, tg).loss; };
    const f = m.forward(toks, { prefix }), { dlogits } = m.loss(f.logits, f.T, f.pre, tg), { G, dPrefix } = m.backward(f, dlogits);
    const check = (num, an) => assert.ok(Math.abs(num - an) / Math.max(1e-4, Math.abs(num) + Math.abs(an)) < 0.02, `${num} vs ${an}`);
    for (const k of ['emb', '0.wq', '0.wk', '0.wv', '0.wo', '1.w1', '1.w3', '1.w2', '0.g1', '1.g2', 'gf']) {
      const p = P.get(k); for (const i of [0, p.length - 1]) { const o = p[i]; p[i] = o + 1e-3; const a = L(); p[i] = o - 1e-3; const b = L(); p[i] = o; check((a - b) / 2e-3, G.get(k)[i]); }
    }
    for (const i of [0, 5]) { const o = prefix[i]; prefix[i] = o + 1e-3; const a = L(); prefix[i] = o - 1e-3; const b = L(); prefix[i] = o; check((a - b) / 2e-3, dPrefix[i]); }
  }
});

test('KV-cache tiled attention reproduces full attention; modular stacking preserves the function', () => {
  const c = tiny(), P = initParams(c, 4), m = new Transformer(c, P), toks = [1, 4, 2, 7, 3, 9, 9, 2];
  const full = m.forward(toks, { keep: false }).logits, cache = m.newCache(), E = P.get('emb'); let last;
  for (const t of toks) last = m.step(E.slice(t * c.dim, (t + 1) * c.dim), cache);
  for (let w = 0; w < c.vocab; w++) assert.ok(Math.abs(last.logits[w] - full[(toks.length - 1) * c.vocab + w]) < 1e-4);
  expandLayers(c, P, 2); assert.equal(c.layers, 4);
  const after = new Transformer(c, P).forward(toks, { keep: false }).logits; for (let i = 0; i < full.length; i++) assert.ok(Math.abs(after[i] - full[i]) < 1e-5);
});

test('training lowers loss; fp16 checkpoints round-trip; atoms grow and merge kernels', () => {
  const c = makeConfig('test', { layers: 2, heads: 4, kvHeads: 2, headDim: 4, ffn: 24 }), t = new Trainer(c, initParams(c, 2), { lr: 1e-2, warmup: 5, seq: 24 });
  t.setCorpus(['Q: What is solar energy?\nA: Light from the sun.']); const first = t.trainStep(); for (let i = 0; i < 60; i++) t.trainStep();
  assert.ok(t.loss < first * 0.6, `loss ${first} -> ${t.loss}`);
  const buf = serialize(c, t.model.P, { step: t.step }), { header, P } = deserialize(buf);
  assert.equal(header.step, 61); assert.equal(header.config.layers, 2); assert.ok(Math.abs(P.get('gf')[0] - t.model.P.get('gf')[0]) < 1e-2);
  assert.equal(fromHalf(toHalf(0.5)), 0.5); assert.equal(decode(encode('Akwaaba 🌍')), 'Akwaaba 🌍');
  const k1 = trainKernel(t.model, ['Q: What is a shoe?\nA: Footwear.'], { steps: 3 }), k2 = trainKernel(t.model, ['Q: What is a dress?\nA: A garment.'], { steps: 3 });
  assert.equal(k1.prefix.length, 4 * c.dim); const merged = mergeKernels([k1.prefix, k2.prefix]); assert.ok(Math.abs(merged[0] - (k1.prefix[0] + k2.prefix[0]) / 2) < 1e-6);
});

test('transformer service persists checkpoints through any blob store and gates nothing on the network', async () => {
  const files = new Map(), blobs = { read: async n => files.get(n) || null, write: async (n, b) => files.set(n, b) };
  const s = await new TransformerService({ profile: 'nano', blobs, env: {} }).init();
  const state = { atoms: [{ status: 'approved', title: 'What is Accra?', answer: 'The capital of Ghana.', questions: [], dna: { meaning: { claims: [] } } }] };
  await s.trainSync(state, 1); assert.equal(s.step, 1); assert.ok(files.get('transformer.ckpt').length > 1000);
  const again = await new TransformerService({ profile: 'nano', blobs, env: {} }).init(); assert.equal(again.step, 1);
  const st = again.status(); assert.equal(st.layers, 9); assert.equal(st.heads, 81); assert.match(st.grouping, /GQA 9:1/);
});
