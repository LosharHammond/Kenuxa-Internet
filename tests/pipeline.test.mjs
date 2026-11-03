// PART 14 — the training pipeline is separate from knowledge, gated, versioned and reversible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { curateDataset, gate, privacyIssue } from '../lib/transformer/pipeline.mjs';
import { TransformerService } from '../lib/transformer/index.mjs';

test('dataset curation: dedupe, length bounds, privacy scrub, deterministic held-out split', () => {
  const docs = ['Q: What is Accra?\nA: The capital of Ghana.', 'Q: What is Accra?\nA: The capital of Ghana.', 'hi', 'Contact me at kofi@example.com for the answer.', 'My key is gsk_abcdefghijklmnop1234 ok', ...Array.from({ length: 60 }, (_, i) => `Q: Fact ${i}?\nA: Statement number ${i} about the world.`)];
  const a = curateDataset(docs), b = curateDataset([...docs].reverse());
  assert.equal(a.dropped.duplicates, 1); assert.equal(a.dropped.length, 1); assert.equal(a.dropped.privacy, 2);
  assert.deepEqual(a.privacy, { 'email address': 1, 'API key': 1 });
  assert.ok(a.eval.length >= 1 && a.train.length > 40);
  assert.deepEqual([...a.eval].sort(), [...b.eval].sort(), 'the split depends on content, not order');
  assert.ok(!a.train.some(t => a.eval.includes(t)), 'held-out documents are never trained on');
  assert.equal(privacyIssue('call +233 24 123 4567 now'), 'phone or account number'); assert.equal(privacyIssue('The sun is a star.'), null);
});

test('promotion gate: worse, diverged or too-early candidates are rejected; manual and off modes hold', () => {
  const live = { step: 100, evalLoss: 2.0, regressionLoss: 2.0 }, P = { mode: 'gated', tolerance: 0, regressionTolerance: 0.02, minStepsBetween: 25 };
  assert.equal(gate({ candidate: { step: 200, evalLoss: 1.8, regressionLoss: 1.9 }, live, policy: P }).decision, 'promote');
  assert.equal(gate({ candidate: { step: 200, evalLoss: 2.1, regressionLoss: 1.9 }, live, policy: P }).decision, 'rejected');
  assert.equal(gate({ candidate: { step: 200, evalLoss: 1.8, regressionLoss: 2.2 }, live, policy: P }).decision, 'rejected');
  assert.equal(gate({ candidate: { step: 110, evalLoss: 1.0, regressionLoss: 1.0 }, live, policy: P }).decision, 'rejected');
  assert.equal(gate({ candidate: { step: 200, evalLoss: NaN, regressionLoss: 1 }, live, policy: P }).decision, 'rejected');
  assert.equal(gate({ candidate: { step: 200, evalLoss: 1.8, regressionLoss: 1.9 }, live, policy: { ...P, mode: 'manual' } }).decision, 'awaiting-approval');
  assert.equal(gate({ candidate: { step: 200, evalLoss: 1.8, regressionLoss: 1.9 }, live, policy: { ...P, mode: 'off' } }).decision, 'held (promotion disabled)');
});

const corpus = { atoms: Array.from({ length: 40 }, (_, i) => ({ status: 'approved', title: `What is item ${i}?`, answer: `Item ${i} is a simple thing that people use every day.`, questions: [], dna: { meaning: { claims: [] } } })) };
const blobsOf = () => { const files = new Map(); return { files, read: async n => files.get(n) || null, write: async (n, b) => files.set(n, b) }; };

test('candidate training never changes the served model until it passes evaluation; versions roll back', { timeout: 240000 }, async () => {
  const blobs = blobsOf(), s = await new TransformerService({ profile: 'nano', blobs, env: { TRANSFORMER_MIN_STEPS_PER_RELEASE: '5' } }).init();
  const before = Float32Array.from(s.P.get('gf'));
  const r1 = await s.trainSync(corpus, 3); // too few steps → not promoted, served weights untouched
  assert.equal(r1.review.status, 'rejected'); assert.deepEqual(s.P.get('gf'), before); assert.equal(s.release.live.version, 0);
  const r2 = await s.trainSync(corpus, 8);
  assert.equal(r2.review.status, 'promoted', JSON.stringify(r2.review)); assert.equal(s.release.live.version, 1);
  assert.ok(s.release.live.evalLoss < s.release.history[0].evalLoss + 1e-9 && r2.review.evalLoss != null);
  assert.notDeepEqual(s.P.get('gf'), before); assert.ok(blobs.files.get('transformer.v1.ckpt').length > 1000);
  assert.ok(s.release.regression.length >= 1, 'first release freezes a regression set');
  const v1 = Float32Array.from(s.P.get('gf'));
  await s.trainSync(corpus, 8); assert.equal(s.release.live.version, 2, JSON.stringify(s.release.candidate));
  await s.rollback(1); assert.equal(s.release.live.version, 1); assert.equal(s.release.live.approvedBy, 'rollback'); const g = s.P.get('gf'); assert.ok(v1.every((x, i) => Math.abs(x - g[i]) < 2e-3), 'restored weights equal version 1 (fp16 storage precision)');
  const again = await new TransformerService({ profile: 'nano', blobs, env: {} }).init(); assert.equal(again.release.live.version, 1, 'release state persists');
  assert.ok(s.status().dataset.heldOut >= 1); assert.equal(s.status().release.policy.mode, 'gated');
});

test('manual release mode requires explicit approval', { timeout: 240000 }, async () => {
  const s = await new TransformerService({ profile: 'nano', blobs: blobsOf(), env: { TRANSFORMER_PROMOTION: 'manual', TRANSFORMER_MIN_STEPS_PER_RELEASE: '5' } }).init();
  const r = await s.trainSync(corpus, 8); assert.equal(r.review.status, 'awaiting-approval'); assert.equal(s.release.live.version, 0);
  await s.approve('test-admin'); assert.equal(s.release.live.version, 1); assert.equal(s.release.live.approvedBy, 'test-admin');
  await assert.rejects(() => s.approve(), /No candidate/);
});
