// v0.9 — beyond A–O: Python/Windows context, ellipsis, idioms, conceptual reasoning, genesis migration,
// tenant-scoped deduplication, backpressure/retry, rebalancing, garbage collection, alerts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { interpret, Discourse } from '../lib/atoms/language.mjs';
import { classify, explain, verbalizeClassification } from '../lib/atoms/reasoning.mjs';
import { InMemoryTransport, PreservationEngine, LocalStore } from '../lib/atoms/preservation.mjs';

const sem = (o, i = 0) => o.clauses[i].semantics;
const records = (r, from = 0, count = 300) => [...r.manifests.values()].slice(from, from + count).map(m => ({ id: m.id, rev: m.head, dna: r.revisions.get(m.head) }));

test('6.1 context: "What is Python?" → "How do I install it?" → "Can I use it on Windows?"', () => {
  const r = new AtomRegistry(), d = new Discourse();
  const q1 = sem(interpret('What is Python?', { registry: r, discourse: d })); assert.equal(q1.type, 'identity-question');
  const q2 = sem(interpret('How do I install it?', { registry: r, discourse: d })); assert.equal(q2.predicate, 'install'); assert.equal(q2.roles.theme.referent, 'Python'); assert.equal(q2.roles.theme.sense, 'sense:en:python#language', '"install" selects the programming-language sense');
  const q3 = sem(interpret('Can I use it on Windows?', { registry: r, discourse: d })); assert.equal(q3.roles.theme.referent, 'Python'); assert.equal(q3.roles.location.sense.sense, 'sense:en:windows#os'); assert.ok(q3.modality);
});

test('ellipsis: verb-phrase ellipsis and additive inversion recover the predicate from discourse', () => {
  const r = new AtomRegistry(), d = new Discourse();
  interpret('I am learning.', { registry: r, discourse: d });
  const a = sem(interpret('Are you?', { registry: r, discourse: d })); assert.equal(a.predicate, 'learn'); assert.equal(a.roles.agent.kind, 'addressee'); assert.equal(a.mood, 'interrogative-yn'); assert.equal(a.ellipsis.kind, 'verb-phrase'); assert.equal(a.aspect, 'progressive');
  const b = sem(interpret('So am I.', { registry: r, discourse: d })); assert.equal(b.ellipsis.kind, 'additive-inversion'); assert.equal(b.polarity, 'positive'); assert.equal(b.roles.agent.kind, 'speaker');
  const c = sem(interpret('Neither can she.', { registry: r, discourse: d })); assert.equal(c.polarity, 'negative'); assert.equal(c.predicate, 'learn');
  interpret('She likes Python.', { registry: r, discourse: d }); const e = sem(interpret('I do too.', { registry: r, discourse: d })); assert.equal(e.predicate, 'like'); assert.equal(e.roles.theme.text, 'Python');
  const bare = sem(interpret('I am', { registry: new AtomRegistry() })); assert.equal(bare.construction, 'copular-incomplete', 'without discourse nothing is invented');
});

test('idioms: non-compositional meaning, literal reading kept as an alternative, idiom words are not referents', () => {
  const r = new AtomRegistry(), d = new Discourse();
  const k = interpret('He kicked the bucket.', { registry: r, discourse: d }), s = sem(k);
  assert.equal(s.predicate, 'die'); assert.equal(s.idiom.used, true); assert.equal(s.idiom.literal.predicate, 'kick'); assert.ok(!s.roles.theme, 'the bucket is part of the idiom');
  assert.ok(k.ambiguities.some(a => a.kind === 'idiomatic-vs-literal'));
  const lit = sem(interpret('He kicked the bucket of water across the yard.', { registry: r })); assert.equal(lit.predicate, 'kick'); assert.equal(lit.idiom.used, false);
  const w = sem(interpret('I am under the weather.', { registry: r, discourse: d })); assert.equal(w.type, 'state'); assert.equal(w.predicate, 'ill');
  const it = sem(interpret('It was a piece of cake.', { registry: r, discourse: d })); assert.equal(it.predicate, 'easy'); assert.notEqual(it.roles.theme?.referent, 'the weather', '"it" must not refer to words inside an idiom');
  assert.equal(sem(interpret('That laptop costs an arm and a leg.', { registry: r })).roles.theme.text, 'That laptop');
});

test('level 8–9 reasoning: IS_A chains over shared concepts, sense-sensitive, open-world, materialised as derived atoms', () => {
  const r = new AtomRegistry();
  const snake = classify(r, 'snake', 'animal'); assert.equal(snake.answer, 'yes'); assert.deepEqual(snake.readings.find(x => x.sense.startsWith('sense:')).chainLabels, ['snake (reptile)', 'reptile', 'animal']);
  const py = classify(r, 'python', 'animal', { materialize: true }); assert.equal(py.answer, 'depends-on-sense');
  const snakeReading = py.readings.find(x => x.sense === 'sense:en:python#snake'); assert.equal(snakeReading.holds, true); assert.ok(snakeReading.confidence > 0.5 && snakeReading.confidence < 1);
  assert.equal(py.readings.find(x => x.sense === 'sense:en:python#language').holds, null, 'not established ≠ false');
  const derived = r.get(snakeReading.materialized); assert.equal(derived.identity.type, 'relationship'); assert.equal(derived.identity.validation, 'provisional'); assert.ok(derived.relational.every(e => e.type === 'SUPPORTED_BY'));
  assert.equal(classify(r, 'python', 'animal', { preferSense: 'sense:en:python#snake' }).answer, 'yes-in-context');
  assert.equal(classify(r, 'bank', 'animal').answer, 'not-established'); assert.equal(classify(r, 'zorblax', 'animal').answer, 'unknown-terms');
  assert.match(verbalizeClassification(classify(r, 'snake', 'animal')), /^\*\*Yes\.\*\* A snake is a reptile, a reptile is an animal/);
  assert.ok(explain(r, 'bank').some(e => e.path.includes('organization')));
  // the interpretation of the question feeds the reasoner
  const q = sem(interpret('Is a python an animal?', { registry: r })); assert.equal(q.type, 'classification'); assert.equal(q.roles.category.head, 'animal');
});

test('genesis migration: an old registry gains concepts/idioms without rewriting history; unknown words get curated meaning', () => {
  const old = new AtomRegistry({ seed: false }); old.discover('animal', { lang: 'en', node: 'nodeA' }); old.genesisVersion = 1;
  const before = old.manifest('lex:en:animal').head; old.seedEnglish();
  assert.equal(old.get('lex:en:animal').semantic.senses[0], 'sense:en:animal#organism'); assert.ok(old.manifest('lex:en:animal').history.includes(before), 'discovery revision kept');
  const fresh = new AtomRegistry(); assert.equal(fresh.manifest('sense:en:bank#finance').head, old.manifest('sense:en:bank#finance').head, 'upgraded and fresh nodes converge on identical heads');
  const again = AtomRegistry.deserialize(fresh.serialize()); assert.equal(again.genesisVersion, 4); assert.equal(again.manifests.size, fresh.manifests.size); assert.equal(again.idioms.length, fresh.idioms.length);
});

async function cluster(n, domains = i => 'd' + i) { let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < n; i++) T.add('N' + i, domains(i)); const E = (id, policy) => new PreservationEngine({ self: id, transport: T, now: () => clock, policy, local: T.nodes.get(id)?.store }); return { T, E, tick: ms => { clock += ms; } }; }

test('deduplication is scoped to a domain (tenant boundary) and index metadata is compressed', async () => {
  const r = new AtomRegistry(), recs = records(r, 0, 120), { T, E } = await cluster(8), A = E('N0'); await A.heartbeat();
  const pub = await A.commit(recs), pub2 = await A.commit(recs), priv = await A.commit(recs, { domain: 'tenant-ghana-health' });
  assert.equal(pub2.deduplicated, true); assert.equal(pub2.segment, pub.segment); assert.notEqual(priv.segment, pub.segment, 'no cross-domain dedup');
  const raw = [...T.nodes.values()].flatMap(n => [...n.store.meta.entries()]).find(([k]) => k.startsWith('idx:'))[1]; assert.ok(typeof raw.value.z === 'string', 'index buckets rest compressed');
  assert.equal((await E('N5').getAtom(recs[3].id)).rev, recs[3].rev);
});

test('backpressure and exponential retry backoff', async () => {
  const r = new AtomRegistry(), { T, E, tick } = await cluster(3), A = E('N0', { maxPending: 2 }); await A.heartbeat(); T.kill('N1'); T.kill('N2'); tick(120000); await A.heartbeat();
  for (let i = 0; i < 2; i++) assert.equal((await A.commit(records(r, i * 10, 10))).durability, 'PENDING_DURABILITY');
  const bp = await A.commit(records(r, 40, 10)); assert.equal(bp.backpressure, true); assert.match(bp.reason, /Backpressure/);
  assert.equal((await A.retryPending()).length, 0); tick(31000); const first = await A.retryPending(); assert.equal(first.length, 2); assert.ok(A.pending.every(p => p.attempts === 1 && p.nextAt > 31000 + 120000 + 30000), 'backoff doubles');
  T.revive('N1'); T.revive('N2'); tick(120000); await A.heartbeat(); const ok = await A.retryPending(); assert.ok(ok.every(x => x.durability === 'COMMITTED'));
});

test('rebalancing onto new failure domains, orphan GC by the holder after a grace period, degraded alerts, REPAIRING state', async () => {
  // 6 nodes in only 4 domains (two pairs share a host), then two new hosts join.
  const { T, E, tick } = await cluster(6, i => ['a', 'b', 'c', 'd', 'a', 'b'][i]), r = new AtomRegistry(), recs = records(r, 0, 200), A = E('N0'); await A.heartbeat();
  const c = await A.commit(recs); assert.equal(c.scheme, 'rs');
  T.add('N6', 'e'); T.add('N7', 'f');
  const B = E('N0', { gcGraceMs: 1000 }); const reb = await B.rebalance(); assert.ok(reb.moved.length >= 1, JSON.stringify(reb)); assert.ok(reb.moved.every(m => ['e', 'f'].includes(m.toDomain)));
  assert.equal((await E('N7').getAtom(recs[7].id)).rev, recs[7].rev, 'data still readable after the move');
  const from = reb.moved[0].from, holder = E(from, { gcGraceMs: 1000 }); await holder.heartbeat();
  const g1 = await holder.gc(); assert.equal(g1.dropped, 0, 'grace period first'); tick(2000); const g2 = await holder.gc(); assert.ok(g2.dropped >= 1, JSON.stringify({ g1, g2, from, keys: holder.local.chunkKeys().length }));
  assert.equal((await E('N3').getAtom(recs[50].id)).rev, recs[50].rev);
  const victim = (await A.metaRead('seg:' + c.segment)).value.fragments.map(f => f.nodes[0]).find(n => n !== 'N2'); T.kill(victim); tick(120000); const N2 = E('N2'); const rep = await N2.repair(); assert.ok(rep.degraded >= 1); assert.ok(N2.alerts.some(a => a.level === 'high' || a.level === 'warning')); assert.equal(N2.report().counters.repairs, rep.results.length);
  const R = E('N2'); R.locks.add(c.segment); assert.equal(await R.durability(recs[0].id), 'REPAIRING');
});
