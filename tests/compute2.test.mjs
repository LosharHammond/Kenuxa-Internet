// KUNPP v2: task kinds A–E + specialised, proof-of-work, capability probes (Type D), storage peers with proofs and
// recovery (Type C), P2P pairing and signalling, the installed agent, and coordinator failover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { RELATIONS, DNA_SCHEMA, ATOM_TYPES, VALIDATION } from '../lib/atoms/schema.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { runTask, storageProof } from '../lib/peers/tasks.mjs';
import { Agent, solvePow } from '../agent/kenuxa-agent.mjs';

const rules = { schema: DNA_SCHEMA, types: ATOM_TYPES, validation: VALIDATION, relations: Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, { from: v.from, to: v.to }])) };
const caps = { workers: true, subtleCrypto: true, cores: 4, webrtc: true };
function world(options = {}, extra = {}) { const r = new AtomRegistry(); let t = 2e9; const restored = []; const n = new ComputeNetwork({ state: {}, registry: r, rules, isPublic: id => r.manifest(id)?.scope !== 'private', now: () => t, random: () => 0.99, onRestore: (h, d) => { if (r.revisions.has(h)) return false; r.revisions.set(h, d); restored.push(h); return true; }, ...extra, options: { replicate: 0, spotCheck: 0, ...options } }); return { r, n, restored, tick: ms => { t += ms; } }; }
const join = (n, opts = {}) => { const reg = n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { ...caps, ...(opts.caps || {}) }, profile: opts.profile || 'balanced', ipKey: opts.ip || 'net-' + Math.random(), pow: opts.pow }); return { ...reg, p: n.auth(reg.peerId, reg.token) }; };

test('task kinds B–E and the specialised kind find seeded problems deterministically', async () => {
  const r = new AtomRegistry(), n = new ComputeNetwork({ state: {}, registry: r, rules });
  const bank = r.get('lex:en:bank'), money = r.get('lex:en:money');
  bank.relational.push({ type: 'SYNONYM_OF', target: 'lex:en:money', confidence: 0.5 }, { type: 'SYNONYM_OF', target: 'lex:en:money', confidence: 0.5 }); // duplicate + asymmetric (money has no reverse)
  const rel = await runTask('relation-check/1', n.payloadFor({ kind: 'relation-check/1', atomIds: ['lex:en:bank', 'lex:en:money'] }));
  const kinds = rel.issues.filter(i => i.id === 'lex:en:bank').map(i => i.kind); assert.ok(kinds.includes('duplicate-edge') && kinds.includes('asymmetric-relation'), JSON.stringify(rel.issues));
  // IS_A cycle
  const c1 = r.get('concept:en:animal') ? 'concept:en:animal' : null; if (c1) { const d = r.get(c1); const up = d.relational.find(e => e.type === 'IS_A'); if (up) { const t = r.get(up.target); t.relational.push({ type: 'IS_A', target: c1, confidence: 1 }); const cy = await runTask('relation-check/1', n.payloadFor({ kind: 'relation-check/1', atomIds: [c1] })); assert.ok(cy.issues.some(i => i.kind === 'isa-cycle')); } }
  // grammar rule: a plural noun form without a plural ending
  const plural = [...r.manifests.keys()].map(id => r.get(id)).find(d => d.linguistic?.morphology?.number === 'pl' && d.linguistic?.pos === 'noun'); plural.identity.canonical = 'zzq';
  const lex = await runTask('lexical-consistency/1', n.payloadFor({ kind: 'lexical-consistency/1', atomIds: [plural.identity.id] })); assert.ok(lex.issues.some(i => i.kind === 'plural-morphology'), JSON.stringify(lex));
  // claims
  const claims = [{ id: 'c1', subject: 'rain', relation: 'causes', object: 'flood', evidence: [{ id: 'e1', stance: 'supports', publisher: 'a.example', passage: 'Heavy rain causes floods.' }, { id: 'e2', stance: 'contradicts', publisher: 'a.example', passage: 'Rain does not cause floods.' }, { id: 'e3', stance: 'supports', publisher: 'b.example', passage: 'The stock market rose today.' }] }];
  const cc = await runTask('claim-consistency/1', { claims, now: Date.now() }); assert.deepEqual(cc.issues.map(i => i.kind).sort(), ['evidence-off-topic', 'self-contradicting-source']);
  // metrics and closure are deterministic (same digest twice) and correct
  const pl = n.payloadFor({ kind: 'graph-metrics/1', atomIds: [...r.manifests.keys()].slice(0, 200) }), g1 = await runTask('graph-metrics/1', pl), g2 = await runTask('graph-metrics/1', JSON.parse(JSON.stringify(pl)));
  assert.equal(g1.digest, g2.digest); assert.equal(g1.metrics.atoms, 200);
  const cl = await runTask('isa-closure/1', { isa: { a: ['b'], b: ['c'], c: [] }, queries: [['a', 'c'], ['c', 'a']] }); assert.deepEqual(cl.answers, [['a', 'c', 'yes', ['a', 'b', 'c']], ['c', 'a', 'no-path', []]]);
});

test('proof-of-work: required when enabled, bound to a fresh signed challenge, not replayable; difficulty rises with registration volume', () => {
  const { n } = world({ powBits: 8 });
  assert.throws(() => n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: caps }), /proof-of-work/);
  const ch = n.challenge(); assert.equal(ch.bits, 8);
  assert.throws(() => n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, pow: { challenge: ch.challenge.replace(/.$/, '0'), nonce: '1' } }), /proof-of-work/, 'tampered challenge');
  const pow = solvePow(ch); assert.ok(n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, pow, ipKey: 'x' }).peerId);
  assert.throws(() => n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: caps, pow, ipKey: 'y' }), /proof-of-work/, 'replay refused');
  for (let i = 0; i < 250; i++) n.S.registrations.push({ at: n.now(), ip: 'z' + i }); assert.ok(n.powBits() > 8, 'adaptive difficulty');
});

test('Type D: a claimed specialised capability is used only after the peer passes a probe with a known answer', async () => {
  const { n, tick } = world();
  const honest = join(n, { caps: { agent: 'node', specialized: ['symbolic-reasoning'] }, profile: 'dedicated' }), liar = join(n, { caps: { agent: 'node', specialized: ['symbolic-reasoning'] }, profile: 'dedicated' });
  assert.deepEqual(honest.p.verified, []);
  const l1 = n.lease(honest.p); assert.equal(l1.task.kind, 'isa-closure/1'); assert.equal(l1.task.probe, true);
  assert.equal((await n.submit(honest.p, { leaseId: l1.task.leaseId, taskId: l1.task.taskId, result: await runTask(l1.task.kind, l1.task.payload) })).status, 'accepted'); assert.deepEqual(honest.p.verified, ['symbolic-reasoning']);
  const l2 = n.lease(liar.p); const fake = await runTask(l2.task.kind, l2.task.payload); fake.answers = fake.answers.map(a => [a[0], a[1], 'yes', a[3]]); fake.digest = createHash('sha256').update('x').digest('hex');
  await n.submit(liar.p, { leaseId: l2.task.leaseId, taskId: l2.task.taskId, result: fake }); assert.deepEqual(liar.p.verified, []); assert.equal(liar.p.probes['symbolic-reasoning'].state, 'failed');
  tick(1000); n.fill(); const kinds = Object.values(n.S.tasks).filter(t => t.kind === 'isa-closure/1' && !t.probe).length; assert.ok(kinds >= 1, 'specialised work appears once a verified peer exists');
  tick(1000); let got = null; for (let i = 0; i < 30 && !got; i++) { tick(600); const l = n.lease(honest.p); if (l.task?.kind === 'isa-closure/1') got = l.task; else if (l.task) await n.submit(honest.p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: await runTask(l.task.kind, l.task.payload) }); }
  assert.ok(got, 'the verified peer receives specialised tasks');
  for (let i = 0; i < 10; i++) { tick(600); const l = n.lease(liar.p); assert.ok(!l.task || l.task.kind !== 'isa-closure/1' || l.task.probe, 'the unverified peer never gets specialised work'); if (l.task) n.cancel(liar.p, l.task.leaseId); }
});

test('Type C storage: replicate → proven by fresh storage proofs → a lost core revision is restored after hash verification; cheating holders are caught', async () => {
  const { r, n, restored, tick } = world({ replicaTarget: 1 });
  const store = new Map(), holder = join(n, { caps: { agent: 'node', storageMB: 100 }, profile: 'dedicated' }), cheat = join(n, { caps: { agent: 'node', storageMB: 100 }, profile: 'dedicated' });
  const serve = async (who, honest = true) => { const l = n.lease(who.p); if (!l.task) return null; const t = l.task; let result;
    if (t.kind === 'replicate/1') { for (const a of t.payload.atoms) if (honest) store.set(a.head, a.dna); result = { kind: t.kind, stored: t.payload.atoms.map(a => a.head) }; }
    else if (t.kind === 'storage-proof/1') { const proofs = {}; for (const c of t.payload.challenges) proofs[c.head] = honest && store.has(c.head) ? await storageProof(store.get(c.head), c.nonce) : 'f'.repeat(64); result = { kind: t.kind, proofs }; }
    else if (t.kind === 'restore/1') result = { kind: t.kind, atoms: t.payload.heads.filter(h => store.has(h)).map(h => ({ head: h, dna: honest ? store.get(h) : { ...store.get(h), tampered: true } })) };
    else result = await runTask(t.kind, t.payload);
    return { kind: t.kind, out: await n.submit(who.p, { leaseId: t.leaseId, taskId: t.taskId, result }) }; };
  n.fill(); const kinds = new Set();
  for (let i = 0; i < 60; i++) { tick(600); const a = await serve(holder); if (a) kinds.add(a.kind); const b = await serve(cheat, false); if (b) kinds.add(b.kind); if (i % 10 === 0) n.fill(); }
  assert.ok(kinds.has('replicate/1') && kinds.has('storage-proof/1'), [...kinds].join());
  const st = n.storageStatus(); assert.match(st.tiers.replicatedPublic, /storage proof/);
  assert.ok(holder.p.verified.includes('storage'), 'honest holder verified by proofs'); assert.ok(!cheat.p.verified.includes('storage') && cheat.p.rejected >= 1, 'the cheater failed its proofs');
  // lose a revision on the core, then recover it from the proven replica
  const head = Object.entries(n.S.replicas).find(([, rs]) => rs.some(x => x.peer === holder.peerId && x.proven))[0], dna = r.revisions.get(head);
  r.revisions.delete(head); const task = n.requestRestore([head]); assert.ok(task);
  let rest = null; for (let i = 0; i < 10 && !rest; i++) { tick(600); const a = await serve(holder); if (a?.kind === 'restore/1') rest = a; }
  assert.deepEqual(rest.out.restored, [head]); assert.deepEqual(restored, [head]); assert.deepEqual(r.revisions.get(head), dna, 'byte-identical revision restored');
});

test('P2P: a replica lease carries references and a pairing; signalling is relayed only inside the pair; the HTTPS fallback is counted', async () => {
  const { n, tick } = world({ replicate: 1, mix: { 'atom-validate/1': 1 } });
  const a = join(n, { ip: 'net-a' }), b = join(n, { ip: 'net-b' }), c = join(n, { ip: 'net-c' });
  const l1 = n.lease(a.p); assert.ok(l1.task.payload.atoms[0].dna, 'first lease is inline');
  assert.equal((await n.submit(a.p, { leaseId: l1.task.leaseId, taskId: l1.task.taskId, result: await runTask(l1.task.kind, l1.task.payload) })).status, 'awaiting-replica');
  tick(2100); const l2 = n.lease(b.p); assert.equal(l2.task.taskId, l1.task.taskId); assert.equal(l2.task.payload.dnaVia, 'p2p'); assert.ok(!l2.task.payload.atoms[0].dna, 'references only'); assert.equal(l2.task.p2p.source, a.peerId);
  assert.ok(n.poll(a.p).messages.some(m => m.type === 'pair'), 'the source is told to expect a connection');
  assert.equal(n.signal(b.p, { pairId: l2.task.p2p.pairId, data: { sdp: { type: 'offer', sdp: 'x' } } }).ok, true);
  assert.equal(n.signal(c.p, { pairId: l2.task.p2p.pairId, data: {} }).ok, false, 'outsiders cannot inject signals');
  assert.equal(n.poll(a.p).messages[0].data.sdp.type, 'offer');
  const before = n.S.metrics.p2pBytesAvoided; assert.ok(before > 0); const full = n.fullPayload(b.p, l2.task.leaseId); assert.ok(full.atoms[0].dna, 'fallback returns the full payload');
  assert.equal(n.S.metrics.p2pFallbacks, 1); assert.equal(n.S.metrics.p2pBytesAvoided, 0, 'a fallback cancels the counted saving');
  assert.equal((await n.submit(b.p, { leaseId: l2.task.leaseId, taskId: l2.task.taskId, result: await runTask(l2.task.kind, full) })).status, 'accepted');
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function server(name, extra = {}) {
  const p = await port(), origin = `http://127.0.0.1:${p}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', RENDER: '', PORT: String(p), NODE_ID: name, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-ag-')), ADMIN_TOKEN: 'agent-test-admin-token-1234567890-abcd', KENUXA_NETWORK: 'off', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', COMPUTE_POW_BITS: '12', COMPUTE_REG_PER_NET_HOUR: '100', COMPUTE_DISTINCT_NETWORKS: 'off', COMPUTE_REPLICAS: '1', ...extra } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  return { child, origin, api: async u => (await fetch(origin + '/api/' + u, { headers: { Authorization: 'Bearer agent-test-admin-token-1234567890-abcd' } })).json(), kill: () => new Promise(r => { if (child.exitCode !== null || child.signalCode !== null) return r(); child.once('exit', r); child.kill('SIGKILL'); }) };
}
test('installed agent (Type C + D) against real servers: PoW, probe, replication with proofs, then failover when its coordinator dies', { timeout: 120000 }, async () => {
  const B = await server('agent-b'), A = await server('agent-a', { COMPUTE_COORDINATORS: '' });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-store-')), steps = [];
    const agent = new Agent({ coordinators: [A.origin, B.origin], consent: true, storageDir: dir, storageMB: 50, specialized: ['symbolic-reasoning'], log: () => {} });
    assert.throws(() => new Agent({ coordinators: [A.origin] }), /explicit consent/);
    await agent.run({ durationMs: 14000, onStep: s => steps.push(s) });
    const st = await A.api('compute'); const me = st.peers.find(p => p.type === 'specialized');
    assert.ok(me, JSON.stringify(st.peers)); assert.ok(me.verified.includes('symbolic-reasoning'), 'probe passed'); assert.ok(agent.stats.stored > 0, 'stored public revisions on disk'); assert.ok(fs.readdirSync(dir).length > 0);
    assert.ok(steps.some(s => s.kind === 'storage-proof/1' && s.status === 'accepted') || me.verified.includes('storage'), JSON.stringify(steps.filter(s => !s.idle).map(s => s.kind + ':' + s.status)));
    // the coordinator dies; the agent fails over to B and keeps working
    await A.kill(); const before = agent.stats.tasks; agent.stop = false;
    await agent.run({ durationMs: 12000 }); assert.ok(agent.stats.failovers >= 1); assert.ok(agent.stats.tasks > before, 'work continued on the second coordinator');
    assert.ok((await B.api('compute')).peers.length >= 1);
  } finally { await A.kill(); await B.kill(); }
});
