// Mandatory scenarios A–O for the universal atomic architecture (in-process; Test G also runs on real
// node processes in atoms-network.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { interpret, Discourse, tokenize } from '../lib/atoms/language.mjs';
import { InMemoryTransport, PreservationEngine } from '../lib/atoms/preservation.mjs';
import * as RS from '../lib/atoms/erasure.mjs';
import { pack, encode, contentHash } from '../lib/atoms/codec.mjs';
import { checkDNA, RELATIONS } from '../lib/atoms/schema.mjs';

const sem = (o, i = 0) => o.clauses[i].semantics;

test('A · every word, punctuation and number resolves to a stable atom; canonical atoms are reused; unknown words enter discovery', () => {
  const r = new AtomRegistry(), o = interpret('I am learning.', { registry: r });
  assert.deepEqual(o.tokens.map(t => t.atomId), ['lex:en:i', 'lex:en:am', 'lex:en:learning', 'sym:2e']);
  const again = interpret('I am learning.', { registry: r }); assert.equal(again.atoms.created, 0); assert.equal(again.atoms.reused, 4);
  for (const id of ['lex:en:i', 'lex:en:am', 'lex:en:learning', 'sym:2e']) checkDNA(r.get(id));
  const n = interpret('The zorblat flimmered 42 times!', { registry: r });
  assert.ok(n.atoms.discovered.includes('lex:en:zorblat')); const z = r.get('lex:en:zorblat');
  assert.equal(z.identity.validation, 'provisional'); assert.equal(z.semantic.meaningStatus, 'unknown'); assert.deepEqual(z.semantic.senses, []); // never fabricated
  assert.equal(n.tokens.find(t => t.text === '42').atomId, 'num:42'); assert.equal(r.get('lex:en:flimmered').linguistic.pos, 'verb'); // guessed from morphology, flagged
  assert.equal(r.get('lex:en:flimmered').linguistic.posSource, 'morphological-guess');
  // The "I", "am" reference atoms carry the required DNA.
  const I = r.get('lex:en:i'), am = r.get('lex:en:am');
  assert.equal(I.linguistic.morphology.person, 1); assert.equal(I.linguistic.morphology.number, 'sg'); assert.ok(I.linguistic.syntacticFunctions.includes('subject')); assert.equal(I.semantic.referential, 'deictic-context-dependent');
  assert.equal(am.linguistic.lemma, 'be'); assert.equal(am.linguistic.morphology.tense, 'present'); assert.ok(am.relational.some(x => x.type === 'FORM_OF' && x.target === 'lex:en:be'));
  assert.ok(am.functional.constraints.includes('rule:en:subject-verb-agreement')); assert.ok(r.get('rule:en:subject-verb-agreement')); // shared rule referenced, not copied
  assert.ok(Object.keys(RELATIONS).length >= 15);
});

test('B · grammar: first-person singular subject, auxiliary agreement, progressive construction, semantic frame', () => {
  const r = new AtomRegistry(), s = sem(interpret('I am learning.', { registry: r }));
  assert.equal(s.type, 'event'); assert.equal(s.predicate, 'learn'); assert.equal(s.aspect, 'progressive'); assert.equal(s.tense, 'present');
  assert.equal(s.roles.agent.kind, 'speaker'); assert.equal(s.agreement.ok, true); assert.deepEqual(s.agreement.subject, { person: '1', number: 'sg' });
  assert.ok(s.rulesUsed.includes('rule:en:progressive-aspect'));
  const bad = sem(interpret('He am learning.', { registry: r })); assert.equal(bad.agreement.ok, false); // agreement is checked, not assumed
  const variants = ['I am not learning.', 'Am I learning?', 'I was learning.'].map(t => sem(interpret(t, { registry: r })));
  assert.equal(variants[0].polarity, 'negative'); assert.equal(variants[1].mood, 'interrogative-yn'); assert.equal(variants[2].tense, 'past');
  const because = interpret('I am learning because I need to improve.', { registry: r });
  assert.equal(because.clauses.length, 2); assert.equal(because.relations[0].type, 'cause'); assert.equal(sem(because, 1).predicate, 'need');
  const bare = sem(interpret('I am', { registry: r })); assert.equal(bare.construction, 'copular-incomplete'); assert.match(bare.incomplete, /depends on what follows/);
});

test('C · context: "it" resolves to the network from the previous turn', () => {
  const r = new AtomRegistry(), d = new Discourse();
  interpret('I am building a network.', { registry: r, discourse: d });
  const o = interpret('How can I protect it?', { registry: r, discourse: d });
  assert.equal(o.coreference[0].antecedent, 'a network'); assert.equal(sem(o).roles.theme.referent, 'a network'); assert.equal(sem(o).predicate, 'protect');
  const d2 = new Discourse(); interpret('What is Python?', { registry: r, discourse: d2 }); const inst = interpret('How do I install it?', { registry: r, discourse: d2 }), win = interpret('Can I use it on Windows?', { registry: r, discourse: d2 });
  assert.equal(inst.coreference[0].antecedent, 'Python'); assert.equal(inst.coreference[0].sense, 'sense:en:python#language');
  assert.equal(sem(win).roles.location.sense.sense, 'sense:en:windows#os');
});

test('D · same surface "I am", different semantic structures', () => {
  const r = new AtomRegistry(), happy = sem(interpret('I am happy.', { registry: r })), learning = sem(interpret('I am learning.', { registry: r })), dev = sem(interpret('I am a developer.', { registry: r }));
  assert.equal(happy.type, 'state'); assert.equal(happy.construction, 'copular-attributive'); assert.equal(happy.roles.attribute.quality, 'happy');
  assert.equal(learning.type, 'event'); assert.equal(dev.type, 'classification'); assert.equal(dev.predicate, 'developer');
  assert.notDeepEqual(happy, learning);
});

test('E · word sense disambiguation from context', () => {
  const r = new AtomRegistry();
  const money = sem(interpret('I deposited money in the bank.', { registry: r })), river = sem(interpret('I sat beside the river bank.', { registry: r }));
  assert.equal(money.roles.location.sense.sense, 'sense:en:bank#finance'); assert.equal(river.roles.location.sense.sense, 'sense:en:bank#river');
  assert.equal(money.tense, 'past'); assert.ok(interpret('The bank.', { registry: r }).ambiguities.some(a => a.word === 'bank')); // no context → reported, not guessed
});

test('F · atom reuse over 10,000 sentences', () => {
  const r = new AtomRegistry(), before = r.manifests.size;
  for (let i = 0; i < 10000; i++) interpret(i % 2 ? 'I am learning.' : 'I am learning quickly.', { registry: r });
  assert.equal(r.lookup('learning').length, 1); assert.ok(r.manifests.size - before <= 6, `grew by ${r.manifests.size - before}`);
  assert.ok(r.stats.reused > 30000);
  const phrase = [...r.manifests.values()].filter(m => m.type === 'phrase' && !m.id.startsWith('phr:idiom:')); // genesis idioms excluded assert.ok(phrase.length >= 1 && phrase.length <= 6); // frequent compositions materialized once
});

async function cluster(n = 8) { let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < n; i++) T.add('N' + i, 'domain-' + i); const now = () => clock; const E = id => new PreservationEngine({ self: id, transport: T, now }); return { T, E, tick: ms => { clock += ms; } }; }
const records = (r, from = 0, count = 300) => [...r.manifests.values()].slice(from, from + count).map(m => ({ id: m.id, rev: m.head, dna: r.revisions.get(m.head) }));

test('G · node failure: atoms committed by node A stay retrievable after A dies', async () => {
  const { T, E, tick } = await cluster(8), A = E('N0'), B = E('N5'); await A.heartbeat();
  const r = new AtomRegistry(), recs = records(r, 0, 300);
  const c = await A.commit(recs); assert.equal(c.durability, 'COMMITTED'); assert.equal(c.scheme, 'rs');
  const small = await A.commit(recs.slice(0, 3)); assert.equal(small.scheme, 'replica'); assert.equal(small.durability, 'COMMITTED');
  T.kill('N0'); tick(120000); await B.heartbeat();
  for (const x of [recs[0], recs[150], recs[299]]) { const got = await B.getAtom(x.id); assert.equal(got.rev, x.rev); assert.equal(contentHash(got.dna), x.rev); assert.equal(got.createdBy, 'N0'); }
});

test('H · erasure-coded fragment loss, reconstruction with checksum, and redundancy repair', async () => {
  const data = randomBytes(50000), enc = RS.encode(data, 4, 2);
  const out = RS.decode(enc.shards.map((d, index) => ({ index, data: d })).filter(s => ![1, 4].includes(s.index)), enc); assert.ok(out.equals(data));
  assert.throws(() => RS.decode(enc.shards.slice(0, 3).map((d, index) => ({ index, data: d })), enc), /Need 4 shards/);
  const { T, E, tick } = await cluster(8), A = E('N1'); await A.heartbeat();
  const c = await A.commit(records(new AtomRegistry(), 0, 300));
  const seg = (await A.metaRead('seg:' + c.segment)).value, victims = seg.fragments.slice(0, 2).map(f => f.nodes[0]);
  for (const v of victims) T.kill(v); tick(120000);
  const R = E(seg.fragments[3].nodes[0] === 'N1' ? 'N2' : 'N1'); const rep = await R.repair();
  const res = rep.results.find(x => x.segment === c.segment); assert.equal(res.before, 4); assert.equal(res.after, 6); assert.equal(res.outcome, 'restored');
  assert.equal(await R.durability(seg.sampleAtom), 'COMMITTED'); assert.ok(R.audit.some(a => a.op === 'repair' && a.after === 6));
  assert.equal((await R.repair()).degraded, 0, 'repair is idempotent');
});

test('I · storage efficiency vs full replication (measured)', async () => {
  const r = new AtomRegistry(), recs = records(r, 0, r.manifests.size), n = 8;
  const jsonBytes = Buffer.byteLength(JSON.stringify(recs.map(x => x.dna))), msgBytes = encode(recs.map(x => x.dna)).length, packed = pack({ v: 1, records: recs }).length;
  const { T, E } = await cluster(n), A = E('N0'); await A.heartbeat(); await A.commit(recs); await A.commit(recs); // second commit deduplicates
  let physical = 0, meta = 0; for (const node of T.nodes.values()) { physical += node.store.bytes(); meta += node.store.metaBytes(); }
  const full = jsonBytes * n, overhead = physical / packed;
  console.log(`  logical JSON ${jsonBytes} B · MessagePack ${msgBytes} B · packed segment ${packed} B · physical stored ${physical} B (×${overhead.toFixed(2)} of packed) · metadata ${meta} B · full replication of JSON on ${n} nodes ${full} B · saving ${(100 - 100 * (physical + meta) / full).toFixed(1)}%`);
  assert.ok(overhead > 1.45 && overhead < 1.6, 'RS(4,2) ≈ 1.5× payload'); assert.ok(physical + meta < full / 10); assert.ok(msgBytes < jsonBytes);
});

test('J · registry instance failure: metadata stays readable and writable by quorum', async () => {
  const { T, E, tick } = await cluster(6), A = E('N0'); await A.heartbeat();
  const c = await A.commit(records(new AtomRegistry(), 0, 20)), holders = A.place('meta:seg:' + c.segment, 3);
  T.kill(holders[0]); tick(120000); const B = E(holders[0] === 'N3' ? 'N4' : 'N3'); await B.heartbeat();
  assert.ok(await B.metaRead('seg:' + c.segment)); await B.metaWrite('seg:probe', { ok: true }); assert.equal((await B.metaRead('seg:probe')).value.ok, true);
  await B.metaRepair(); const now = B.place('meta:seg:' + c.segment, 3); let copies = 0; for (const t of now) if (T.nodes.get(t).store.metaGet('seg:' + c.segment)) copies++; assert.equal(copies, 3, 'metadata re-replicated');
});

test('K · concurrent discovery of the same unknown word reconciles to one canonical atom', () => {
  const a = new AtomRegistry({ node: 'A' }), b = new AtomRegistry({ node: 'B' });
  interpret('My kwamenzu works.', { registry: a }); interpret('Their kwamenzu broke.', { registry: b });
  a.merge(b.exportAtoms(['lex:en:kwamenzu']), { from: 'B' }); b.merge(a.exportAtoms(['lex:en:kwamenzu']), { from: 'A' });
  assert.equal(a.lookup('kwamenzu').length, 1); assert.equal(a.manifest('lex:en:kwamenzu').head, b.manifest('lex:en:kwamenzu').head, 'both nodes converge to the same head');
});

test('L · node dies before the durability threshold: status is reported truthfully', async () => {
  const { T, E } = await cluster(6), A = E('N0'); await A.heartbeat();
  T.partition(['N0', 'N1'], ['N2', 'N3', 'N4', 'N5']); // only one other node reachable
  const c = await A.commit(records(new AtomRegistry(), 0, 200)); assert.equal(c.durability, 'PENDING_DURABILITY'); assert.match(c.reason, /loss is possible|quorum/);
  assert.equal(await A.durability(records(new AtomRegistry(), 0, 1)[0].id), 'PENDING_DURABILITY');
  T.kill('N0'); T.heal(); const B = E('N3'); await B.heartbeat();
  assert.equal(await B.getAtom(records(new AtomRegistry(), 0, 1)[0].id).catch(() => null), null, 'never claimed, never committed');
});

test('M · knowledge poisoning: a false meaning for a curated atom is quarantined', () => {
  const r = new AtomRegistry(), before = r.manifest('lex:en:bank').head;
  const res = r.propose('lex:en:bank', { semantic: { senses: ['sense:en:bank#volcano'] } }, { node: 'evil', trust: 'provisional', source: 'malicious-node' });
  assert.equal(res.status, 'quarantined'); assert.equal(r.manifest('lex:en:bank').head, before); assert.equal(r.manifest('lex:en:bank').quarantined.length, 1);
  const enrich = r.propose('lex:en:bank', { functional: { examples: ['She went to the bank.'] } }, { node: 'friend', trust: 'provisional', source: 'peer' }); assert.equal(enrich.status, 'accepted'); // enrichment allowed, history kept
  assert.equal(r.history('lex:en:bank').length, 2); r.rollback('lex:en:bank', before); assert.equal(r.manifest('lex:en:bank').head, before);
  const peer = new AtomRegistry({ node: 'P' }); peer.manifests.get('lex:en:happy').head; const forged = structuredClone(peer.get('lex:en:happy')); forged.semantic.senses = ['sense:en:happy#poison']; forged.identity.knowledgeVersion = 99; const fr = peer.put(forged, { node: 'P' });
  const m = r.merge(peer.exportAtoms(['lex:en:happy']), { from: 'P', trust: 'provisional' }); assert.equal(m.quarantined, 1); assert.notEqual(r.manifest('lex:en:happy').head, fr.rev);
});

test('N · network partition: provisional writes, failed reads, reconciliation after healing', async () => {
  const { T, E, tick } = await cluster(8), A = E('N0'), Z = E('N7'); await A.heartbeat(); await Z.heartbeat();
  T.partition(['N0', 'N1'], ['N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
  const recs = records(new AtomRegistry(), 0, 150), c = await A.commit(recs); assert.equal(c.durability, 'PENDING_DURABILITY');
  assert.equal(await Z.getAtom(recs[0].id).catch(() => null), null);
  T.heal(); tick(1000); await A.heartbeat(); assert.equal((await A.retryPending()).length, 0, 'retry backoff is respected');
  tick(30000); await A.heartbeat(); const retried = await A.retryPending(); assert.equal(retried[0].durability, 'COMMITTED');
  assert.equal((await Z.getAtom(recs[0].id)).rev, recs[0].rev);
  const ra = new AtomRegistry({ node: 'A' }), rz = new AtomRegistry({ node: 'Z' }); interpret('The glorbix shines.', { registry: ra }); interpret('A glorbix appeared.', { registry: rz });
  ra.merge(rz.exportAtoms(['lex:en:glorbix'])); rz.merge(ra.exportAtoms(['lex:en:glorbix'])); assert.equal(ra.manifest('lex:en:glorbix').head, rz.manifest('lex:en:glorbix').head);
});

test('O · multilingual, language-aware segmentation', () => {
  const r = new AtomRegistry();
  const zh = interpret('我正在学习中文。', { registry: r }); assert.equal(zh.language, 'zh'); assert.deepEqual(zh.tokens.filter(t => t.kind === 'word').map(t => t.text), ['我', '正在', '学习', '中文']); assert.ok(zh.tokens.every(t => t.atomId));
  const th = tokenize('ฉันกำลังเรียน', 'th').map(t => t.text); assert.ok(th.length >= 3, 'Thai has no spaces but is segmented');
  const en = tokenize("I'm learning.", 'en').map(t => t.norm); assert.deepEqual(en, ['i', 'am', 'learning', '.']);
  assert.equal(interpret('我正在学习中文。', { registry: r }).atoms.created, 0, 'non-English atoms are reused too');
});
