// v1.9 Universal Evolution Engine — the 15 system-wide evolution requirements, each against real functionality.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvolution } from '../lib/evolve/index.mjs';
import { negotiate, negotiateAll, selectTransport } from '../lib/evolve/protocols.mjs';
import { validatePolicy, DEFAULTS } from '../lib/evolve/policies.mjs';
import { simulateRouting } from '../lib/evolve/strategies.mjs';
import { Mind } from '../lib/mind/index.mjs';
import { LIBRARY, solve } from '../lib/mind/procedures.mjs';
import { comprehend } from '../lib/comprehension.mjs';
import { seeds } from '../lib/seed.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { runTask } from '../lib/peers/tasks.mjs';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

const lessons = seeds();
function world({ meshPeers = [], env = { COMPUTE_POW_BITS: '0', COMPUTE_REG_PER_NET_HOUR: '1000' } } = {}) {
  let t = 2e9; const mind = new Mind({ state: {} });
  const compute = new ComputeNetwork({ state: {}, registry: new AtomRegistry(), rules: {}, now: () => t, random: () => 0.99, options: { distinctNetworks: false, spotCheck: 1, mix: { 'atom-validate/1': 1 } } });
  const mesh = { enabled: true, goodPeers: () => meshPeers };
  const ev = createEvolution({ state: {}, node: 'test-node', mind, compute, mesh, comprehend, shareable: () => lessons, env, Mind, version: 'test' });
  const join = (caps = {}, profile = 'balanced') => { const r = compute.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: true, subtleCrypto: true, cores: 4, ...caps }, profile, ipKey: 'n' + Math.random() }); return { ...r, p: compute.auth(r.peerId, r.token) }; };
  return { ev, mind, compute, join, tick: ms => { t += ms; } };
}

test('1 · a new atom category is introduced as data, used, and removed by rollback', () => {
  const { ev, mind } = world();
  assert.equal(mind.store.put({ id: 'meas:v1', category: 'measurement', body: { quantity: 3 } }).ok, false, 'unknown before');
  const r = ev.kuee.propose({ kind: 'atom-category', value: { name: 'measurement', description: 'a sensor reading with its unit', requires: ['quantity', 'unit'] }, reason: 'sensor observations' });
  assert.equal(r.status, 'deployed');
  assert.match(mind.store.put({ id: 'meas:v1', category: 'measurement', body: { quantity: 3 } }).issues[0], /body.unit/);
  assert.ok(mind.store.put({ id: 'meas:v1', category: 'measurement', body: { quantity: 3, unit: 'V' } }).ok);
  assert.equal(ev.kuee.propose({ kind: 'atom-category', value: { name: 'procedure' } }).status, 'rejected', 'built-ins cannot be redefined');
  ev.kuee.rollback(r.id); assert.equal(mind.store.put({ id: 'meas:v2', category: 'measurement', body: { quantity: 1, unit: 'V' } }).ok, false);
});

test('2 · a reasoning procedure is improved by a verified correction (with held-out transfer and no regressions)', () => {
  const { mind } = world(); mind.evolution.addCase({ problem: 'How long will a 2400 Wh battery run a 300 W fridge through an inverter that is 85% efficient?', expected: { value: 6.8, unit: 'h' }, split: 'held-out' });
  const r = mind.evolution.learn({ problem: 'How long will a 1000 Wh battery run a 100 W load through an inverter that is 90% efficient?', expected: { value: 9, unit: 'h' }, verifiedBy: 'human' });
  assert.ok(r.promoted); assert.equal(r.report.regressions.length, 0); assert.equal(r.report.heldOut.after, 1);
});

test('3 · the retrieval strategy is replaced after measurement; a worse candidate is refused', async () => {
  const { ev } = world();
  const worse = ev.kuee.propose({ kind: 'policy', target: 'retrieval', value: { strategy: 'lexical', threshold: 0.5, maxResults: 5 }, reason: 'plain term overlap (better top-1, worse top-3 on the seed lessons)' });
  assert.equal(worse.status, 'rejected'); assert.match(worse.tests.find(t => t.name === 'evaluation').detail, /recall@3/);
  const better = ev.kuee.propose({ kind: 'policy', target: 'retrieval', value: { strategy: 'concept-lexical-graph', threshold: 0.5, maxResults: 5 }, reason: 'use tag/relationship neighbours' });
  assert.equal(better.status, 'deployed', JSON.stringify(better.tests)); assert.equal(ev.kuee.policies.get('retrieval').strategy, 'concept-lexical-graph');
  const hits = ev.retrieve('Explain photosynthesis', lessons); assert.equal(hits[0].id, 'seed:photosynthesis');
});

test('4 · nodes join and advertise capabilities; roles follow verified capabilities', () => {
  const meshPeers = [{ fingerprint: 'kxremote', url: 'https://remote.example', capabilities: ['knowledge-retrieval', 'atp-mind'], protocols: { atp: ['ATP/1.0'] } }];
  const { ev, join } = world({ meshPeers });
  join(); join({ agent: 'node', storageMB: 100 }, 'dedicated'); ev.refresh();
  const exec = ev.registry.discover('task-execution'); assert.ok(exec.some(p => p.kind === 'local-component')); assert.equal(exec.filter(p => p.kind.startsWith('volunteer')).length, 2);
  assert.equal(ev.registry.discover('storage-replica').length, 1, 'only the dedicated node offers storage');
  assert.ok(ev.registry.discover('knowledge-retrieval').some(p => p.id === 'node:kxremote'));
  assert.ok(ev.registry.capabilities().includes('reasoning'));
});

test('5 · a node disconnects mid-task without corrupting committed work', async () => {
  const { compute, join, tick, ev } = world(); const a = join(); compute.fill();
  tick(2100); const l1 = compute.lease(a.p); const res = await runTask(l1.task.kind, l1.task.payload);
  assert.equal((await compute.submit(a.p, { leaseId: l1.task.leaseId, taskId: l1.task.taskId, result: res })).status, 'accepted');
  ev.refresh(); assert.equal(ev.registry.discover('task-execution').filter(p => p.kind.startsWith('volunteer')).length, 1);
  tick(2100); const l2 = compute.lease(a.p); compute.leave(a.p);
  assert.equal(compute.S.tasks[l1.task.taskId].state, 'accepted', 'committed result kept'); assert.equal(compute.S.tasks[l2.task.taskId].state, 'queued', 'interrupted work returns to the queue');
  assert.equal((await compute.submit(a.p, { leaseId: l2.task.leaseId, taskId: l2.task.taskId, result: res })).status, 'rejected', 'late results from a departed peer are refused');
  ev.refresh(); assert.equal(ev.registry.discover('task-execution').filter(p => p.kind.startsWith('volunteer')).length, 0, 'a departed peer stops being advertised');
});

test('6 · the routing policy is updated: simulated first, canary next, full deployment after monitoring', () => {
  const base = DEFAULTS.routing, cand = { ...base, localityWeight: 5, costWeight: 1 };
  const s0 = simulateRouting(base), s1 = simulateRouting(cand); assert.ok(s1.priorityWeightedWait < s0.priorityWeightedWait && s1.kbTransferred < s0.kbTransferred);
  const { ev, compute } = world(); const r = ev.kuee.propose({ kind: 'policy', target: 'routing', value: cand, reason: 'prefer local data and cheap payloads' });
  assert.equal(r.status, 'canary'); assert.ok(r.tests.find(t => t.name === 'evaluation').better);
  const arms = new Set([...Array(200)].map((_, i) => compute.o.routing('peer-' + i).arm)); assert.deepEqual([...arms].sort(), ['baseline', 'candidate']);
  for (let i = 0; i < 25; i++) { ev.kuee.observe('routing', 'candidate', true); ev.kuee.observe('routing', 'baseline', true); }
  assert.equal(ev.kuee.record(r.id).status, 'deployed'); assert.equal(compute.o.routing('anyone').value.localityWeight, 5);
  assert.equal(ev.kuee.propose({ kind: 'policy', target: 'routing', value: { ...base, ageWeight: 2 } }).status, 'rejected', 'a measurably worse policy is refused');
});

test('7 · a storage replica is reassigned when its holder leaves', async () => {
  const { compute, join, tick } = world(); compute.o.replicaTarget = 1;
  const A = join({ agent: 'node', storageMB: 100 }, 'dedicated'), B = join({ agent: 'node', storageMB: 100 }, 'dedicated');
  const store = (peer, l) => ({ kind: 'replicate/1', stored: l.task.payload.atoms.map(x => x.head) });
  let leased = null; for (let i = 0; i < 20 && !leased; i++) { tick(600); const l = compute.lease(A.p); if (l.task?.kind === 'replicate/1') leased = l; else if (l.task) compute.cancel(A.p, l.task.leaseId); }
  assert.ok(leased); await compute.submit(A.p, { leaseId: leased.task.leaseId, taskId: leased.task.taskId, result: store(A, leased) });
  const heads = leased.task.payload.atoms.map(x => x.head); assert.ok(heads.every(h => compute.S.replicas[h].some(r => r.peer === A.peerId)));
  compute.leave(A.p); tick(4000); let toB = null;
  for (let i = 0; i < 40 && !toB; i++) { tick(600); const l = compute.lease(B.p); if (!l.task) continue; if (l.task.kind === 'replicate/1' && l.task.payload.atoms.some(x => heads.includes(x.head))) toB = l; if (l.task.kind === 'replicate/1') await compute.submit(B.p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: store(B, l) }); else compute.cancel(B.p, l.task.leaseId); }
  assert.ok(toB, 'the revisions A held are planned onto B');
  assert.ok(heads.every(h => compute.S.replicas[h].some(r => r.peer === B.peerId)), 'B now holds them');
});

test('8 · protocol versions are negotiated; deprecated versions warn; transports are chosen by requirement', () => {
  assert.deepEqual(negotiate(['ATP/2.0', 'ATP/1.0'], ['ATP/1.0', 'ATP/2.0']).version, 'ATP/2.0');
  assert.equal(negotiate(['ATP/2.0', 'ATP/1.0'], ['ATP/1.0']).version, 'ATP/1.0');
  const d = negotiate(['ATP/1.0', 'MTP/0.5'], ['MTP/0.5'], { deprecated: ['MTP/0.5'] }); assert.ok(d.ok && d.deprecated && /upgrade/.test(d.warning));
  const all = negotiateAll({ atp: ['ATP/1.0'], mind: ['kenuxa-mind/1'] }, { atp: ['ATP/1.0'], mind: ['kenuxa-mind/2'] }); assert.ok(all.atp.ok); assert.equal(all.mind.ok, false);
  assert.equal(selectTransport(['peer-to-peer', 'browser-to-browser']).transport, 'webrtc'); assert.equal(selectTransport(['push']).transport, null, 'WebSocket is an extension point, not silently assumed');
});

test('9 · the memory policy changes without changing answers or leaking private data', () => {
  const { ev, mind } = world();
  assert.equal(ev.kuee.propose({ kind: 'policy', target: 'memory', value: { ...DEFAULTS.memory, shareConversations: true } }).status, 'rejected', 'a policy cannot even express sharing private data');
  const r = ev.kuee.propose({ kind: 'policy', target: 'memory', value: { workingMemoryItems: 32, experienceEpisodes: 1000, capsuleHistoryTurns: 10 }, reason: 'smaller footprint' });
  assert.equal(r.status, 'canary'); assert.match(r.tests.find(t => t.name === 'evaluation').detail, /identical/);
  ev.kuee.approve(r.id, { by: 'owner', authorized: true }); assert.equal(mind.experience.max, 1000);
  mind.think('My solar battery is not charging.'); assert.ok(!mind.store.exportPublic().some(x => x.atom.visibility === 'private'));
});

test('10 · a security component is upgraded only through authorized deployment; invariants cannot be broken', () => {
  const { ev, compute, join } = world();
  const old = join(); assert.ok(!compute.S.peers[old.peerId].tokenHash.includes(':'), 'legacy sha256 hash');
  assert.equal(ev.kuee.propose({ kind: 'policy', target: 'security', value: { ...DEFAULTS.security, authRequiredForOwnerRoutes: false } }).status, 'rejected');
  assert.equal(ev.kuee.propose({ kind: 'policy', target: 'security', value: { ...DEFAULTS.security, auditLog: false } }).status, 'rejected');
  const r = ev.kuee.propose({ kind: 'policy', target: 'security', value: { ...DEFAULTS.security, tokenHash: 'sha512' }, reason: 'stronger credential hashing' });
  assert.equal(r.status, 'awaiting-authorization'); ev.kuee.approve(r.id, { by: 'automatic' }); assert.equal(ev.kuee.record(r.id).status, 'awaiting-authorization', 'not without authorization');
  ev.kuee.approve(r.id, { by: 'owner', authorized: true }); assert.equal(ev.kuee.record(r.id).status, 'deployed'); assert.equal(compute.o.tokenHash, 'sha512');
  compute.auth(old.peerId, old.token); assert.ok(compute.S.peers[old.peerId].tokenHash.startsWith('sha512:'), 'existing credential migrated on use');
  const fresh = join(); assert.ok(compute.S.peers[fresh.peerId].tokenHash.startsWith('sha512:')); assert.throws(() => compute.auth(fresh.peerId, 'f'.repeat(64)), /invalid peer token/);
});

test('11 · a user-interface component is updated safely (declarative, no executable content, consent untouched)', async () => {
  assert.equal(validatePolicy('ui', { ...DEFAULTS.ui, answerLabel: '<script>alert(1)</script>' }).ok, false);
  assert.equal(validatePolicy('ui', { ...DEFAULTS.ui, answerLabel: 'x', onclick: 'steal()' }).ok, false);
  const env = { HOST: '127.0.0.1', ADMIN_TOKEN: 'evo-test-admin-token-1234567890-abcdef', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
  const node = await createNode({ env: { ...env, NODE_ID: 'evo-node', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-evo-')) }, log: () => {} });
  const api = (u, b, auth = true) => webRequest(node, new Request('http://127.0.0.1/api/' + u, { method: b ? 'POST' : 'GET', headers: { ...(auth ? { Authorization: 'Bearer ' + env.ADMIN_TOKEN } : {}), 'Content-Type': 'application/json' }, ...(b ? { body: JSON.stringify(b) } : {}) }), '127.0.0.1');
  assert.equal((await api('evolution/propose', { target: 'ui', value: { ...DEFAULTS.ui, maxFollowups: 1 } }, false)).status, 401, 'owner authentication required');
  const r = await (await api('evolution/propose', { target: 'ui', value: { ...DEFAULTS.ui, maxFollowups: 1, showEngine: true }, reason: 'less clutter' })).json(); assert.equal(r.status, 'canary');
  await api('evolution/approve', { id: r.id });
  const cfg = await webRequest(node, new Request('http://127.0.0.1/chat/config'), '127.0.0.1').then(x => x.json()); assert.equal(cfg.ui.maxFollowups, 1); assert.equal(cfg.ui.showEngine, true);
  const st = await (await api('evolution')).json(); assert.ok(st.components.some(c => c.id === 'ui' && c.history.some(h => h.event === 'deployed')));
});

test('12 · a learning strategy is evaluated: a weaker one is refused, a more efficient one is adopted', () => {
  const { ev, mind } = world();
  const weaker = ev.kuee.propose({ kind: 'policy', target: 'learning', value: { ...DEFAULTS.learning, synthesisMaxLeaves: 2 } });
  assert.equal(weaker.status, 'rejected'); assert.match(weaker.rejection, /worse/);
  const leaner = ev.kuee.propose({ kind: 'policy', target: 'learning', value: { ...DEFAULTS.learning, synthesisConstants: [1, 2] }, reason: 'search fewer constants' });
  assert.equal(leaner.status, 'canary', JSON.stringify(leaner.tests)); const e = leaner.tests.find(t => t.name === 'evaluation'); assert.ok(e.candidate.expressionsTried < e.baseline.expressionsTried && e.candidate.fixed === e.baseline.fixed);
  ev.kuee.approve(leaner.id, { by: 'owner', authorized: true }); assert.deepEqual(mind.evolution.settings.synthesisConstants, [1, 2]);
  assert.equal(ev.kuee.propose({ kind: 'policy', target: 'learning', value: { ...DEFAULTS.learning, skipRegression: true } }).status, 'rejected', 'validation cannot be removed');
});

test('13 · a failed evolution is rolled back automatically; a deployed one can be rolled back manually', () => {
  const { ev } = world(); const before = ev.kuee.policies.version('routing');
  const r = ev.kuee.propose({ kind: 'policy', target: 'routing', value: { ...DEFAULTS.routing, localityWeight: 5, costWeight: 1 } }); assert.equal(r.status, 'canary');
  for (let i = 0; i < 25; i++) { ev.kuee.observe('routing', 'candidate', i % 2 === 0); ev.kuee.observe('routing', 'baseline', true); }
  assert.equal(ev.kuee.record(r.id).status, 'rolled-back'); assert.equal(ev.kuee.policies.version('routing'), before); assert.ok(ev.kuee.record(r.id).monitoring.candidateFailureRate > 0.4);
  const ok = ev.kuee.propose({ kind: 'policy', target: 'retrieval', value: { strategy: 'concept-lexical-graph', threshold: 0.5, maxResults: 5 } }); assert.equal(ok.status, 'deployed');
  ev.kuee.rollback(ok.id); assert.equal(ev.kuee.policies.get('retrieval').strategy, 'concept-lexical');
});

test('14 · an outdated node stays compatible or fails safely', () => {
  const old = { fingerprint: 'kxold', url: 'https://old.example', protocols: { atp: ['ATP/1.0'] } }, ancient = { fingerprint: 'kxancient', protocols: { atp: ['ATP/0.9'] } };
  assert.ok(negotiate(DEFAULTS.protocols.atp, old.protocols.atp).ok);
  const n = negotiate(DEFAULTS.protocols.atp, ancient.protocols.atp); assert.equal(n.ok, false); assert.equal(n.action, 'refuse-safely');
  const { ev } = world({ meshPeers: [old] });
  const drop = ev.kuee.propose({ kind: 'policy', target: 'protocols', value: { ...DEFAULTS.protocols, atp: ['ATP/2.0'] }, reason: 'move to ATP/2' });
  assert.equal(drop.status, 'rejected', 'dropping ATP/1.0 would cut off a known peer'); assert.match(drop.rejection, /worse|invariant/);
  const add = ev.kuee.propose({ kind: 'policy', target: 'protocols', value: { ...DEFAULTS.protocols, atp: ['ATP/2.0', 'ATP/1.0'] }, reason: 'offer ATP/2 alongside ATP/1' });
  assert.equal(add.status, 'awaiting-authorization', 'protocol changes are high risk');
});

test('15 · a validated improvement propagates to another node, which re-validates and re-tests it; high-risk changes do not', () => {
  const A = world(), B = world();
  A.ev.kuee.propose({ kind: 'policy', target: 'retrieval', value: { strategy: 'concept-lexical-graph', threshold: 0.5, maxResults: 5 }, reason: 'graph neighbours' });
  const sec = A.ev.kuee.propose({ kind: 'policy', target: 'security', value: { ...DEFAULTS.security, tokenHash: 'sha512' } }); A.ev.kuee.approve(sec.id, { by: 'owner', authorized: true });
  const exported = A.ev.kuee.exportRecords(); assert.equal(exported.length, 1); assert.equal(exported[0].target, 'retrieval');
  const res = B.ev.kuee.adoptFrom('node-a', exported); assert.equal(res[0].status, 'deployed'); assert.equal(B.ev.kuee.policies.get('retrieval').strategy, 'concept-lexical-graph');
  const local = B.ev.kuee.record(res[0].local); assert.ok(local.tests.some(t => t.name === 'evaluation' && t.baseline)); assert.match(local.source, /^peer:/);
  assert.equal(B.ev.kuee.adoptFrom('node-a', [{ id: 'x', target: 'security', value: { ...DEFAULTS.security, tokenHash: 'sha512' } }])[0].status, 'refused');
  assert.equal(B.ev.kuee.adoptFrom('node-a', [{ id: 'y', target: 'retrieval', value: { strategy: 'lexical', threshold: 0.5, maxResults: 5 } }])[0].status, 'rejected', 'a worse change from a peer fails local evaluation');
});
