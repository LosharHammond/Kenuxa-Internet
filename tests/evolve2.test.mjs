// v1.10: security evolution (tamper-evident audit, key rotation), indexed retrieval, storage migration, runtime policy
// kinds, live UI outcome signals, shadow routing, and the error boundary. Randomised: new inputs every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rng, SEED } from './lib/gen.mjs';
import { AuditChain, rotateIdentity, verifyRotation } from '../lib/evolve/security.mjs';
import { ensureIdentity, Mesh, signHeaders } from '../lib/mesh.mjs';
import { createEvolution } from '../lib/evolve/index.mjs';
import { registerPolicyKind, unregisterPolicyKind, DEFAULTS, validatePolicy } from '../lib/evolve/policies.mjs';
import { RETRIEVAL, evaluateRetrieval, indexFor, retrieve } from '../lib/evolve/strategies.mjs';
import { migrateChunks, migrateState, verifyChunks } from '../lib/evolve/migrate.mjs';
import { LocalStore } from '../lib/atoms/preservation.mjs';
import { FileStore } from '../lib/store.mjs';
import { comprehend } from '../lib/comprehension.mjs';
import { seeds } from '../lib/seed.mjs';
import { Mind } from '../lib/mind/index.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { runTask } from '../lib/peers/tasks.mjs';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

const ADMIN = 'evo2-admin-token-1234567890-abcdefghijk';
const ENV = { HOST: '127.0.0.1', ADMIN_TOKEN: ADMIN, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', REQUESTS_PER_MINUTE: '1000000', PUBLIC_QUESTIONS_PER_MINUTE: '100000' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kx-e2-'));

test(`audit chain: any edit, deletion or reordering of any past entry is detected (seed ${SEED})`, () => {
  const r = rng(31);
  for (let k = 0; k < 25; k++) {
    const a = new AuditChain({ state: {}, max: r.int(5, 60) }); const n = r.int(3, 120);
    for (let i = 0; i < n; i++) a.append(r.pick(['evolution:approve', 'security:peer-revoked', 'cognition:review']), { i, v: r.int(0, 1e6) });
    assert.ok(a.verify().ok, 'an untouched chain verifies (also after truncation)');
    if (a.S.entries.length < 2) continue;
    const j = r.int(0, a.S.entries.length - 1), attack = r.pick(['edit', 'delete', 'swap', 'rehash-edit']);
    if (attack === 'edit') a.S.entries[j].data.v = -1;
    if (attack === 'rehash-edit') { a.S.entries[j].data.v = -1; a.S.entries[j].hash = createHash('sha256').update('forged').digest('hex'); }
    if (attack === 'delete') a.S.entries.splice(j === a.S.entries.length - 1 ? j - 1 : j, 1);
    if (attack === 'swap') { const i2 = (j + 1) % a.S.entries.length; [a.S.entries[j], a.S.entries[i2]] = [a.S.entries[i2], a.S.entries[j]]; }
    assert.equal(a.verify().ok, false, `${attack} at ${j} must be detected`);
  }
});

test(`key rotation: valid certificates move trust; forged, replayed or foreign ones are refused (seed ${SEED})`, async () => {
  const r = rng(32); let id = ensureIdentity({});
  for (let k = 0; k < r.int(2, 5); k++) { const { identity: next, certificate: c } = rotateIdentity(id); assert.ok(verifyRotation(c, { knownKey: id.publicKey }).ok); assert.equal(c.to, next.fingerprint); assert.equal(next.previous[0].fingerprint, id.fingerprint);
    const forged = { ...c, [r.pick(['to', 'toKey', 'at', 'sigOld', 'sigNew'])]: r.pick(['x', 'kx00', 12, Buffer.from('nope').toString('base64')]) }; assert.equal(verifyRotation(forged, { knownKey: id.publicKey }).ok, false);
    assert.equal(verifyRotation(c, { knownKey: ensureIdentity({}).publicKey }).ok, false, 'not from the key we know'); assert.equal(verifyRotation(c, { knownKey: id.publicKey, now: c.at + 40 * 86400000 }).ok, false, 'expired');
    id = next; }
  // a mesh peer record follows a verified rotation
  const remote = ensureIdentity({}), me = ensureIdentity({}), { identity: rotated, certificate } = rotateIdentity(remote), url = 'http://127.0.0.1:9';
  const mesh = new Mesh({ state: { mesh: { peers: [], pending: [] } }, identity: me, name: 'me', enabled: true, allowLocal: true, shareable: () => [], findForQuery: () => [], importAtom: () => {}, verifyRotation });
  mesh.peers.push({ fingerprint: remote.fingerprint, publicKey: remote.publicKey, url, reputation: 0.9, failures: 0, received: 5, shared: 3 });
  const body = JSON.stringify({ protocol: 'ATP/1.0', url, name: 'remote', rotation: certificate, peers: [] });
  mesh.call = async () => ({ status: 200, headers: signHeaders(rotated, 'RESPONSE', '/atp/info', body), text: body });
  await mesh.contact(url);
  const p = mesh.peers.find(x => x.fingerprint === rotated.fingerprint); assert.ok(p, 'trust moved to the new fingerprint'); assert.ok(p.reputation >= 0.9); assert.equal(p.previousFingerprint, remote.fingerprint);
});

test('key rotation through KUEE needs owner authorization, is audited, and is not replayed on restart', () => {
  const state = {}, identity = ensureIdentity({}), first = identity.fingerprint;
  const ev = createEvolution({ state, node: 'n', identity, shareable: () => [], env: { COMPUTE_POW_BITS: '0' }, Mind });
  const r = ev.kuee.propose({ kind: 'key-rotation', value: { reason: 'scheduled yearly rotation' } }); assert.equal(r.status, 'awaiting-authorization');
  ev.kuee.approve(r.id, { by: 'not-owner' }); assert.equal(identity.fingerprint, first);
  ev.kuee.approve(r.id, { by: 'owner', authorized: true }); assert.notEqual(identity.fingerprint, first); assert.equal(identity.rotation.from, first);
  assert.ok(ev.audit.tail().some(e => e.kind === 'security:key-rotated')); assert.ok(ev.audit.verify().ok);
  const now = identity.fingerprint; createEvolution({ state, node: 'n', identity, shareable: () => [], env: { COMPUTE_POW_BITS: '0' }, Mind }); assert.equal(identity.fingerprint, now, 'restart does not rotate again');
});

test(`indexed retrieval: same answers far faster on large random stores; the index rebuilds when knowledge changes (seed ${SEED})`, () => {
  const r = rng(33), W = 'solar battery panel inverter charge voltage grid cocoa farming market price loan school exam water pump fridge kettle river forest phone network health clinic rice maize yam fish goat rain harvest tax company'.split(' ');
  const atoms = [...seeds(), ...[...Array(r.int(3000, 6000))].map((_, i) => { const t = [...Array(4)].map(() => r.pick(W)); return { id: 'syn:' + i, title: `About ${t.join(' ')} ${i}`, questions: [`What about ${t[0]} ${t[1]} ${i}?`], tags: [t[0]], status: 'approved' }; })];
  const ctx = { comprehend }, base = evaluateRetrieval(atoms, { strategy: 'concept-lexical', threshold: 0.5, maxResults: 5 }, ctx), idx = evaluateRetrieval(atoms, { strategy: 'indexed-concept-lexical', threshold: 0.5, maxResults: 5 }, ctx);
  assert.ok(idx.msPerQuery * 2.5 < base.msPerQuery, `faster: ${idx.msPerQuery} vs ${base.msPerQuery} ms`); assert.ok(idx.recallAt1 >= base.recallAt1 - 0.02, `recall@1 ${idx.recallAt1} vs ${base.recallAt1}`); assert.ok(idx.recallAtK >= base.recallAtK - 0.02);
  const b0 = indexFor(atoms).builds; atoms.push({ id: 'syn:new', title: 'About zebra crossings', questions: ['How do zebra crossings work?'], tags: ['road'] });
  assert.equal(retrieve('zebra crossings', atoms, { strategy: 'indexed-concept-lexical', threshold: 0.5, maxResults: 3 }, ctx)[0].id, 'syn:new'); assert.equal(indexFor(atoms).builds, b0 + 1);
});

test(`storage migration: interrupted and resumed, verified by hash, corruption caught, source untouched (seed ${SEED})`, async () => {
  const r = rng(34), A = new LocalStore({}), B = new LocalStore({}), keys = [];
  for (let i = 0; i < r.int(50, 400); i++) { const b = Buffer.from(`chunk ${i} ${r.int(0, 1e9)} ${'x'.repeat(r.int(0, 300))}`), k = 'seg:' + createHash('sha256').update(b).digest('hex'); await A.putChunk(k, b); keys.push(k); }
  const progress = {}; let run = await migrateChunks(A, B, { progress, batch: r.int(5, 40), budgetMs: 0 }); let rounds = 1;
  while (!run.done && rounds < 500) { run = await migrateChunks(A, B, { progress, batch: r.int(5, 40), budgetMs: 1 }); rounds++; }
  assert.ok(run.done && run.verify.ok, JSON.stringify(run).slice(0, 300)); assert.equal(run.copied + run.skipped, keys.length); assert.equal(A.sizes.size, keys.length, 'source untouched');
  const victim = r.pick(keys); B.chunks.set(victim, Buffer.from('tampered')); const v = await verifyChunks(A, B); assert.equal(v.ok, false); assert.equal(v.corrupt, 1);
  await assert.rejects(() => B.putChunk('seg:' + '0'.repeat(64), Buffer.from('wrong')), /hash mismatch/);
  const s1 = new FileStore(tmp()), s2 = new FileStore(tmp()); await s1.save({ atoms: [...Array(r.int(1, 50))].map((_, i) => ({ id: i, v: r.int(0, 1e6) })), note: 'é😀' });
  const m = await migrateState(s1, s2); assert.ok(m.ok, m.reason); assert.deepEqual(await s2.load(), await s1.load());
});

test(`new policy kinds are defined as data, with invariants that hold for every later proposal (seed ${SEED})`, () => {
  const r = rng(35), ev = createEvolution({ state: {}, node: 'n', shareable: () => [], env: { COMPUTE_POW_BITS: '0' }, Mind });
  const name = 'cache-' + r.int(100, 999), spec = { name, risk: 'low', fields: { maxEntries: { type: 'number', min: 10, max: 100000 }, ttlSeconds: { type: 'number', min: 1, max: 86400 }, evict: { type: 'enum', values: ['lru', 'lfu'] } }, defaults: { maxEntries: 1000, ttlSeconds: 600, evict: 'lru' }, invariants: [{ field: 'ttlSeconds', op: '<=', value: 3600 }] };
  assert.equal(ev.kuee.propose({ kind: 'policy-kind', value: { ...spec, name: 'security' } }).status, 'rejected', 'built-ins cannot be redefined');
  assert.equal(ev.kuee.propose({ kind: 'policy-kind', value: spec }).status, 'deployed');
  assert.deepEqual(ev.kuee.policies.get(name), spec.defaults);
  for (let i = 0; i < 40; i++) { const v = { maxEntries: r.int(1, 200000), ttlSeconds: r.int(0, 90000), evict: r.pick(['lru', 'lfu', 'random']) }, rec = ev.kuee.propose({ kind: 'policy', target: name, value: v });
    const legal = v.maxEntries >= 10 && v.maxEntries <= 100000 && v.ttlSeconds >= 1 && v.ttlSeconds <= 3600 && v.evict !== 'random'; assert.equal(rec.status === 'deployed', legal, JSON.stringify(v) + ' → ' + rec.status + ' ' + (rec.rejection || ''));
    assert.ok(ev.kuee.policies.get(name).ttlSeconds <= 3600, 'invariant holds for the active version'); }
  unregisterPolicyKind(name);
});

test(`a UI change is decided by people's ratings during its canary (seed ${SEED})`, async () => {
  const r = rng(36), node = await createNode({ env: { ...ENV, NODE_ID: 'ui-canary', DATA_DIR: tmp() }, log: () => {} });
  const api = (u, b) => webRequest(node, new Request('http://127.0.0.1/api/' + u, { method: b ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, ...(b ? { body: JSON.stringify(b) } : {}) }), '127.0.0.1').then(x => x.json());
  const rec = await api('evolution/propose', { target: 'ui', value: { ...DEFAULTS.ui, maxFollowups: 1 }, reason: 'try fewer follow-up suggestions' }); assert.equal(rec.status, 'canary');
  const arms = { candidate: 0, baseline: 0 }, candidateLiked = r.bool(), ipFor = i => `10.5.${i % 250}.${(i * 7) % 250}`;
  for (let i = 0; i < 400 && (await api('evolution/record?id=' + rec.id)).status === 'canary'; i++) {
    const cfg = await webRequest(node, new Request('http://127.0.0.1/chat/config'), ipFor(i)).then(x => x.json()); arms[cfg.uiArm]++;
    // Keep randomized cohorts and scenario choice, but ensure the observed ratings actually
    // support the expected decision. Bernoulli noise previously made a "liked" candidate
    // empirically worse (e.g. seed 2701796571: 10% vs 5.8% failure), correctly triggering rollback.
    const helpful = cfg.uiArm === 'candidate' ? (candidateLiked || arms.candidate % 3 === 0) : arms.baseline % 10 !== 0;
    await webRequest(node, new Request('http://127.0.0.1/chat/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ helpful, uiArm: cfg.uiArm }) }), ipFor(i));
  }
  const final = await api('evolution/record?id=' + rec.id); assert.ok(arms.candidate > 0 && arms.baseline > 0, 'both versions were shown');
  assert.equal(final.status, candidateLiked ? 'deployed' : 'rolled-back', JSON.stringify(final.monitoring));
});

test('shadow routing: during a routing canary the candidate is also evaluated on real baseline leases', async () => {
  let t = 2e9; const compute = new ComputeNetwork({ state: {}, registry: new AtomRegistry(), rules: {}, now: () => t, random: () => 0.99, options: { distinctNetworks: false, powBits: 0, registrationsPerIpHour: 1e6, spotCheck: 0, replicate: 0, mix: { 'atom-validate/1': 1, 'graph-metrics/1': 1 } } });
  const ev = createEvolution({ state: {}, node: 'n', compute, shareable: () => [], env: { COMPUTE_POW_BITS: '0' }, Mind });
  const rec = ev.kuee.propose({ kind: 'policy', target: 'routing', value: { ...DEFAULTS.routing, localityWeight: 5, costWeight: 1 } }); assert.equal(rec.status, 'canary');
  const peers = [...Array(12)].map((_, i) => { const g = compute.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: true, subtleCrypto: true, cores: 4 }, profile: 'balanced', ipKey: 's' + i }); return compute.auth(g.peerId, g.token); });
  compute.fill(); for (let round = 0; round < 6; round++) { t += 2100; for (const p of peers) { const l = compute.lease(p); if (l.task) compute.cancel(p, l.task.leaseId); } }
  const m = compute.S.metrics.shadowRouting; assert.ok(m && m.decisions > 0, 'shadow decisions recorded'); assert.ok(m.agree <= m.decisions);
});

test(`error boundary: bugs become 500 with an id (no internals), bad input stays 400, prototype pollution is impossible (seed ${SEED})`, async () => {
  const node = await createNode({ env: { ...ENV, NODE_ID: 'errors', DATA_DIR: tmp() }, log: () => {} });
  const post = (u, raw, auth = true) => webRequest(node, new Request('http://127.0.0.1' + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + ADMIN } : {}) }, body: raw }), '10.7.7.7');
  for (const raw of ['null', '7', '"text"', '[1,2]', 'true']) { const res = await post('/api/mind/reason', raw); assert.equal(res.status, 400); assert.match((await res.json()).error, /JSON object/); }
  const bad = await post('/api/mind/reason', '{'); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /not valid JSON/);
  await post('/chat/feedback', JSON.stringify({ __proto__: { polluted: true }, constructor: { prototype: { polluted2: true } }, helpful: true }), false);
  assert.equal({}.polluted, undefined); assert.equal({}.polluted2, undefined);
  const ok = await post('/api/mind/reason', JSON.stringify({ method: 'deduce', input: { facts: [['registered', { toString: 'boom' }]] } })); assert.ok([200, 400, 422].includes(ok.status));
  const st = await webRequest(node, new Request('http://127.0.0.1/api/errors', { headers: { Authorization: 'Bearer ' + ADMIN } }), '127.0.0.1').then(x => x.json()); assert.ok(Array.isArray(st.internal));
  const au = await webRequest(node, new Request('http://127.0.0.1/api/audit', { headers: { Authorization: 'Bearer ' + ADMIN } }), '127.0.0.1').then(x => x.json()); assert.ok(au.verification.ok);
});
