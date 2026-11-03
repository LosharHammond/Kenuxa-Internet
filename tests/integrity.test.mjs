// LAW 2 — atomic correctness audit, and the repository snapshot used as durable public backup on ephemeral hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { auditRegistry } from '../lib/atoms/audit.mjs';
import { PACKS, loadPack } from '../lib/knowledge/packs.mjs';
import { learnClassification } from '../lib/atoms/reasoning.mjs';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

test('audit: the shipped knowledge is clean; corruption, broken references, contradictions and IS_A cycles are detected', () => {
  const r = new AtomRegistry(); for (const p of PACKS) loadPack(r, p); learnClassification(r, 'kente', 'cloth', { source: 's' });
  const clean = auditRegistry(r); assert.equal(clean.ok, true, JSON.stringify(clean.byKind)); assert.equal(clean.scanned, r.manifests.size);
  const bad = new AtomRegistry();
  const k = bad.manifest('lex:en:learning'); bad.revisions.set(k.head, { ...bad.revisions.get(k.head), semantic: { senses: ['sense:en:nope#x'] } }); // tampered content
  learnClassification(bad, 'alpha', 'beta', { source: 'a' }); learnClassification(bad, 'beta', 'alpha', { source: 'a' }); // cycle
  learnClassification(bad, 'gamma', 'delta', { source: 'a' }); learnClassification(bad, 'gamma', 'delta', { source: 'b', negative: true }); // contradiction
  const a = auditRegistry(bad); for (const kind of ['corrupted', 'broken-reference', 'isa-cycle', 'contradiction']) assert.ok(a.byKind[kind] >= 1, kind + ' ' + JSON.stringify(a.byKind));
  const page = auditRegistry(bad, { limit: 100 }); assert.equal(page.scanned, 100); assert.equal(page.next, 100, 'incremental: resumes where it stopped');
});

test('snapshot: exports only public, validated, non-genesis atoms (never users or conversations) and is merged at boot', async () => {
  const admin = 'integrity-test-admin-token-1234567890ab', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-snap-'));
  const node = await createNode({ env: { HOST: '127.0.0.1', NODE_ID: 'snap-node', DATA_DIR: dir, ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' }, log: () => {} });
  const reg = node.atomRegistry(); reg.discover('adinkra', { lang: 'en', node: 'remote' }); reg.propose('lex:en:adinkra', { linguistic: { pos: 'noun', lemma: 'adinkra' }, semantic: { senses: [], definition: 'Akan symbols', hypernyms: ['symbol'] } }, { node: 'remote' }); reg.endorse('lex:en:adinkra', { from: 'other', agrees: true });
  node.state.users = { u_x: { username: 'secret-user' } };
  const snap = await (await webRequest(node, new Request('http://127.0.0.1/api/atoms/snapshot', { headers: { Authorization: 'Bearer ' + admin } }), '127.0.0.1')).json();
  assert.equal(snap.format, 'kenuxa-atoms-snapshot/1'); assert.ok(snap.records.some(x => x.manifest.id === 'lex:en:adinkra')); assert.ok(!snap.records.some(x => x.manifest.createdBy === 'genesis'));
  assert.doesNotMatch(JSON.stringify(snap), /secret-user/);
  const audit = await (await webRequest(node, new Request('http://127.0.0.1/api/atoms/audit', { headers: { Authorization: 'Bearer ' + admin } }), '127.0.0.1')).json(); assert.ok('byKind' in audit);
});
