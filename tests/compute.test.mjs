// KUNPP v1 — voluntary compute peers: consent, identity, leasing, verification, failure handling, privacy, fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { encode } from '../lib/atoms/codec.mjs';
import { RELATIONS, DNA_SCHEMA, ATOM_TYPES, VALIDATION } from '../lib/atoms/schema.mjs';
import { auditRegistry } from '../lib/atoms/audit.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { runTask, encodeCanonical } from '../lib/peers/tasks.mjs';
import { createHash } from 'node:crypto';
export function solvePow({ challenge, bits }) { for (let n = 0; ; n++) { const h = createHash('sha256').update(`${challenge}:${n}`).digest('hex'); let z = 0; for (const ch of h) { const v = parseInt(ch, 16); if (v === 0) { z += 4; continue; } z += Math.clz32(v) - 28; break; } if (z >= bits) return { challenge, nonce: String(n) }; } }

const rules = { schema: DNA_SCHEMA, types: ATOM_TYPES, validation: VALIDATION, relations: Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, { from: v.from, to: v.to }])) };
const caps = { workers: true, subtleCrypto: true, cores: 8, wasm: true };
const reg = (net0, ip = 'ip-a', extra = {}) => net0.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, profile: 'balanced', ipKey: ip, ...extra });
function world(options = {}) { const r = new AtomRegistry(); let t = 1e9; const n = new ComputeNetwork({ state: {}, registry: r, rules, isPublic: id => r.manifest(id)?.scope !== 'private', now: () => t, random: options.random || (() => 0.99), options }); return { r, n, tick: ms => { t += ms; }, now: () => t }; }
async function work(n, p, cheat = null) { const l = n.lease(p); if (!l.task) return l; let res = await runTask(l.task.kind, l.task.payload); if (cheat) res = cheat(res, l.task); return { lease: l.task, out: await n.submit(p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: res }) }; }

test('the shared task module encodes atoms byte-for-byte like the core codec and finds the same problems as the core audit', async () => {
  const r = new AtomRegistry(); let same = 0; for (const m of r.manifests.values()) if (Buffer.from(encodeCanonical(r.revisions.get(m.head))).equals(encode(r.revisions.get(m.head)))) same++;
  assert.equal(same, r.manifests.size);
  const bank = r.get('lex:en:bank'); bank.relational.push({ type: 'RELATED_TO', target: 'lex:en:doesnotexist', confidence: 0.1 }); // corrupts its hash AND adds a broken reference
  const n = new ComputeNetwork({ state: {}, registry: r, rules }), payload = n.payloadFor({ atomIds: ['lex:en:bank', 'lex:en:money'] }), out = await runTask('atom-validate/1', payload);
  const kinds = out.issues.filter(i => i.id === 'lex:en:bank').map(i => i.kind).sort(); assert.deepEqual(kinds, ['broken-reference', 'corrupted']);
  const core = auditRegistry(r, { from: [...r.manifests.keys()].indexOf('lex:en:bank'), limit: 1 }); assert.deepEqual([...new Set(core.issues.map(i => i.kind))].sort(), kinds, 'same verdict as the core audit');
  assert.ok(!out.issues.some(i => i.id === 'lex:en:money'));
});

test('consent, identity and limits: no consent → no work; tokens are required and never stored; capability-limited profiles; registration rate limits by network', () => {
  const { n } = world({ registrationsPerIpHour: 3 });
  assert.throws(() => n.register({ consent: false, consentVersion: CONSENT_VERSION, capabilities: caps }), /explicit consent/);
  assert.throws(() => n.register({ consent: true, consentVersion: 'old', capabilities: caps }), /explicit consent/);
  assert.throws(() => n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: false } }), /cannot run/);
  const a = reg(n); assert.match(a.peerId, /^p_[0-9a-f]{32}$/); assert.equal(a.token.length, 64); assert.ok(!JSON.stringify(n.S).includes(a.token), 'only a hash of the token is kept');
  assert.throws(() => n.auth(a.peerId, 'x'.repeat(64)), /invalid peer token/); assert.equal(n.auth(a.peerId, a.token).id, a.peerId);
  const phone = n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { ...caps, mobile: true }, profile: 'balanced', ipKey: 'ip-a' }); assert.ok(phone.limits.batch <= 40 && phone.limits.minIntervalMs >= 8000, 'mobile devices get small, slow tasks');
  reg(n); assert.throws(() => reg(n), /too many registrations from this network/); assert.ok(reg(n, 'ip-b').peerId, 'another network is unaffected');
});

test('lifecycle: lease → execute → submit → verify → accept; idempotent duplicates; backpressure and profile pacing; private atoms never leave the core', async () => {
  const { r, n, tick } = world({ replicate: 0, spotCheck: 0 }); r.manifest('lex:en:bank').scope = 'private';
  const a = reg(n), p = n.auth(a.peerId, a.token);
  const w1 = await work(n, p); assert.equal(w1.out.status, 'accepted'); assert.ok(w1.lease.payload.atoms.length > 0);
  assert.equal((await n.submit(p, { leaseId: w1.lease.leaseId, taskId: w1.lease.taskId, result: {} })).duplicate, true, 'a duplicate submission returns the recorded outcome');
  const again = n.lease(p); assert.equal(again.task, null); assert.match(again.reason, /profile interval/, 'pacing enforced on the node');
  tick(2500); const l2 = n.lease(p); assert.ok(l2.task); tick(10); assert.match(n.lease(p).reason, /concurrency/, 'one task at a time');
  for (let i = 0; i < 40; i++) { tick(2500); const l = n.lease(p); if (l.task) { assert.ok(!l.task.payload.atoms.some(x => x.id === 'lex:en:bank'), 'private atom never sent'); await n.submit(p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: await runTask(l.task.kind, l.task.payload) }); } }
  const sent = Object.values(n.S.tasks).flatMap(x => x.atomIds); assert.ok(!sent.includes('lex:en:bank'));
});

test('malicious peers: false issues are refuted by the core, hidden issues are caught by replicas/arbitration; reputation falls; repeat offenders are revoked', async () => {
  const { r, n, tick } = world({ replicate: 1, spotCheck: 0, mix: { 'atom-validate/1': 1 } });
  const bank = r.get('lex:en:bank'); bank.relational.push({ type: 'RELATED_TO', target: 'lex:en:ghostword', confidence: 0.1 });
  const good = reg(n, 'ip-g'), evil = reg(n, 'ip-e'), liar = reg(n, 'ip-l'); const G = n.auth(good.peerId, good.token), E = n.auth(evil.peerId, evil.token), Lr = n.auth(liar.peerId, liar.token);
  for (let i = 0; i < 60; i++) {
    tick(2600);
    await work(n, E, res => ({ ...res, issues: [], digest: 'e'.repeat(64) }));                         // hides everything
    await work(n, Lr, (res, task) => ({ ...res, issues: [{ id: task.payload.atoms[0].id, kind: 'corrupted', detail: 'fake' }] })); // invents an issue
    await work(n, G);
  }
  const P = n.S.peers; assert.ok(P[evil.peerId].rejected >= 1 && P[evil.peerId].reputation < 0.3); assert.ok(P[liar.peerId].rejected >= 1);
  assert.ok(['revoked'].includes(P[liar.peerId].state) || P[liar.peerId].rejected > P[liar.peerId].accepted, 'invented issues never accepted');
  assert.ok(P[good.peerId].accepted >= 3 && P[good.peerId].rejected === 0);
  assert.deepEqual((n.S.findings['lex:en:bank'] || []).map(f => f.kind).sort(), ['broken-reference', 'corrupted'], 'the real problems are recorded despite the cheaters');
  for (const [id, f] of Object.entries(n.S.findings)) assert.ok(id === 'lex:en:bank' || !f.some(x => x.detail === 'fake'), 'no invented finding was recorded');
});

test('failures: expired leases are reassigned, a peer leaving releases work, repeated failure falls back to the core, no peers → the core does it itself', async () => {
  const { n, tick } = world({ replicate: 0, spotCheck: 0, maxAttempts: 2 });
  const a = reg(n, 'ip-1'), b = reg(n, 'ip-2'); const A = n.auth(a.peerId, a.token), B = n.auth(b.peerId, b.token);
  const l = n.lease(A).task; tick(60000); n.auth(b.peerId, b.token); const l2 = n.lease(B).task; assert.equal(l2.taskId, l.taskId, 'the expired task went to another peer'); assert.equal(n.S.metrics.expired, 1);
  assert.equal((await n.submit(A, { leaseId: l.leaseId, taskId: l.taskId, result: {} })).status, 'rejected', 'a late result on an expired lease is refused');
  n.leave(B); assert.equal(n.S.tasks[l2.taskId].state, 'queued', 'leaving releases the lease at once');
  tick(3000); n.auth(a.peerId, a.token); const l3 = n.lease(A).task; tick(60000); n.expire(); assert.equal(n.S.tasks[l3.taskId].state, 'fallback-core', 'after max attempts the core takes over');
  const out = await n.coreTick({ budgetMs: 10000 }); assert.ok(out.ran >= 1); assert.equal(n.S.tasks[l3.taskId]?.state ?? 'accepted', 'accepted');
  const lonely = world(); lonely.n.fill(); const o2 = await lonely.n.coreTick({ budgetMs: 10000 }); assert.ok(o2.ran >= 1, 'with no peers at all the core keeps auditing'); assert.ok(lonely.n.S.metrics.coreFallback >= 1);
});

test('the node only delegates while it measurably saves core CPU', () => {
  const { n } = world(); n.S.metrics.peerAtoms = 1000; n.S.metrics.coreTaskAtoms = 100;
  n.S.metrics.coreTaskCpuUs = 100 * 200; n.S.metrics.schedulerCpuUs = 1000 * 20; n.S.metrics.verifyCpuUs = 1000 * 30; assert.equal(n.offloadWorthwhile(), true);
  n.S.metrics.verifyCpuUs = 1000 * 400; assert.equal(n.offloadWorthwhile(), false); const a = reg(n); assert.match(n.lease(n.auth(a.peerId, a.token)).reason, /core is currently cheaper/);
});

test('HTTP: public /peer routes enforce consent, same-origin, auth; the owner sees the dashboard and can revoke; existing APIs unaffected', async () => {
  const admin = 'compute-test-admin-token-1234567890-ab', node = await createNode({ env: { HOST: '127.0.0.1', NODE_ID: 'compute-node', ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-cp-')) }, log: () => {} });
  const call = (u, body, h = {}) => webRequest(node, new Request('http://127.0.0.1' + u, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...h }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), '127.0.0.1').then(async r => ({ status: r.status, ...(await r.json()) }));
  assert.equal((await call('/peer/protocol')).protocol, 'KUNPP/2');
  assert.equal((await call('/peer/register', { capabilities: caps })).status, 403, 'no consent, no registration');
  assert.equal((await call('/peer/register', { consent: true, consentVersion: CONSENT_VERSION, capabilities: caps }, { Origin: 'https://evil.example' })).status, 403, 'cross-origin refused');
  assert.equal((await call('/peer/register', { consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, profile: 'balanced' })).status, 428, 'proof-of-work required');
  const ch = await call('/peer/challenge'); assert.ok(ch.bits >= 1);
  const r1 = await call('/peer/register', { consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, profile: 'balanced', pow: solvePow(ch) }); assert.equal(r1.status, 200, JSON.stringify(r1));
  assert.equal((await call('/peer/register', { consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, profile: 'balanced', pow: solvePow(ch) })).status, 428, 'a challenge cannot be replayed');
  assert.equal((await call('/peer/lease', {})).status, 401, 'leasing needs the peer token');
  const H = { 'x-kunpp-peer': r1.peerId, 'x-kunpp-token': r1.token }, l = await call('/peer/lease', {}, H); assert.ok(l.task, JSON.stringify(l));
  const res = await runTask(l.task.kind, l.task.payload), s = await call('/peer/result', { leaseId: l.task.leaseId, taskId: l.task.taskId, result: res }, H); assert.ok(['accepted', 'awaiting-replica'].includes(s.status), JSON.stringify(s));
  const owner = await call('/api/compute', undefined, { Authorization: 'Bearer ' + admin }); assert.equal(owner.peers.length, 1); assert.ok(owner.metrics.leased >= 1);
  assert.equal((await call('/api/compute', undefined)).status, 401, 'the dashboard is owner-only');
  await call('/api/compute/revoke', { peerId: r1.peerId }, { Authorization: 'Bearer ' + admin }); assert.equal((await call('/peer/lease', {}, H)).status, 401, 'revoked peers are refused');
  const js = await webRequest(node, new Request('http://127.0.0.1/peer-tasks.mjs'), '127.0.0.1'); assert.equal(js.status, 200); assert.match(await js.text(), /kunpp-tasks\/2/);
  assert.equal((await call('/api/status', undefined, { Authorization: 'Bearer ' + admin })).status, 200);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
test('multi-peer integration: one real server process, four independent peer clients (one malicious, one that disconnects mid-task)', { timeout: 120000 }, async () => {
  const p = await port(), origin = `http://127.0.0.1:${p}`, admin = 'compute-int-admin-token-1234567890-abc';
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', RENDER: '', PORT: String(p), NODE_ID: 'compute-int', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-cpi-')), ADMIN_TOKEN: admin, KENUXA_NETWORK: 'off', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', COMPUTE_REPLICATE: '1', COMPUTE_SPOT_CHECK: '1' } /* all peers share 127.0.0.1, so same-network replicas are (correctly) not used; spot-checks verify instead */ });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const post = async (u, body, h = {}) => { const r = await fetch(origin + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
    const peers = [];
    for (const [i, mode] of ['honest', 'honest', 'evil', 'dropout'].entries()) { const ch = await (await fetch(origin + '/peer/challenge')).json(); const r = await post('/peer/register', { consent: true, consentVersion: CONSENT_VERSION, capabilities: { ...caps, agent: 'node' }, profile: 'custom', custom: { minIntervalMs: 1000, batch: 80, maxTasksPerHour: 1200 }, pow: solvePow(ch) }, { 'x-forwarded-for': '10.0.' + i + '.1' }); assert.equal(r.status, 200, JSON.stringify(r)); peers.push({ ...r, mode, h: { 'x-kunpp-peer': r.peerId, 'x-kunpp-token': r.token } }); }
    const t0 = Date.now(), lat = [];
    while (Date.now() - t0 < 25000) {
      await Promise.all(peers.map(async pr => {
        if (pr.gone) return; const l = await post('/peer/lease', {}, pr.h); if (!l.task) return;
        if (pr.mode === 'dropout') { pr.gone = true; return; } // takes a task and vanishes
        const s0 = Date.now(); let res = await runTask(l.task.kind, l.task.payload); if (pr.mode === 'evil') res = { ...res, issues: [], digest: '0'.repeat(64) };
        const s = await post('/peer/result', { leaseId: l.task.leaseId, taskId: l.task.taskId, result: res }, pr.h); lat.push(Date.now() - s0); pr.last = s.status;
      }));
      await new Promise(r => setTimeout(r, 1050));
      const st = await (await fetch(origin + '/api/compute', { headers: { Authorization: 'Bearer ' + admin } })).json(); if (st.metrics.accepted >= 6) break;
    }
    const st = await (await fetch(origin + '/api/compute', { headers: { Authorization: 'Bearer ' + admin } })).json();
    assert.ok(st.metrics.accepted >= 4, JSON.stringify(st.metrics)); assert.ok(st.metrics.rejected >= 1, 'the malicious peer was caught');
    const evil = st.peers.find(x => x.peerId === peers[2].peerId), honest = st.peers.find(x => x.peerId === peers[0].peerId); assert.ok(evil.reputation < honest.reputation); assert.equal(honest.rejected, 0);
    assert.ok(st.peers.every(x => x.peerId !== peers[3].peerId || x.accepted === 0));
  } finally { const d = new Promise(r => child.once('exit', r)); child.kill(); await d; }
});

test('regression: shard-dependent issues (asymmetric relations) are re-checked against the whole shard, so honest peers are not rejected', async () => {
  const { n, tick } = world({ replicate: 0, spotCheck: 0, mix: { 'relation-check/1': 1 } });
  const a = reg(n), p = n.auth(a.peerId, a.token); let rejected = 0, accepted = 0;
  for (let i = 0; i < 12; i++) { tick(2500); const w = await work(n, p); if (w.out?.status === 'rejected') rejected++; if (w.out?.status === 'accepted') accepted++; }
  assert.equal(rejected, 0); assert.ok(accepted >= 3);
});
