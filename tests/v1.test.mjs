// v1.0 — what was still missing after v0.9: learning from statements, multi-source corroboration,
// the teacher path (with a stand-in provider), teacher-assisted non-English understanding,
// encrypted private domains and adaptive stripe widths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { classify, learnClassification, verbalizeClassification } from '../lib/atoms/reasoning.mjs';
import { InMemoryTransport, PreservationEngine, privateId, bucketOf } from '../lib/atoms/preservation.mjs';
import { randomBytes } from 'node:crypto';
import { ByteWindow } from '../lib/atoms/limits.mjs';

const admin = 'v1-test-admin-token-1234567890-abcdefghij';
const env = { HOST: '127.0.0.1', NODE_ID: 'v1-node', ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
const nodeWith = async () => createNode({ env: { ...env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-v1-')) }, log: () => {} });
const askOf = node => q => webRequest(node, new Request('http://127.0.0.1/api/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) }), '127.0.0.1').then(r => r.json());
// A stand-in teacher: deterministic answers by instruction type (no network, no keys).
function mockTeacher(node, answers) { const calls = []; node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }]; node.teachers.generate = async (instr, input) => { calls.push({ instr, input: JSON.parse(input) }); const k = /non-English/.test(instr) ? 'analysis' : /atomizes every word/.test(instr) ? 'lexicon' : 'other'; return { data: answers[k]?.(JSON.parse(input)) ?? {}, provider: 'mock', model: 'stand-in' }; }; return calls; }

test('level 10: statements become sourced, unverified knowledge; independent sources strengthen it; curated knowledge is protected; contradictions are kept', () => {
  const r = new AtomRegistry();
  const a = learnClassification(r, 'kente', 'cloth', { source: 'conv-1' }); assert.equal(a.status, 'learned'); assert.equal(a.confidence, 0.25);
  learnClassification(r, 'cloth', 'textile', { source: 'conv-1' });
  const c = classify(r, 'kente', 'textile'); assert.equal(c.answer, 'yes'); assert.ok(c.readings[0].unverified.length === 2, 'both links are flagged unverified'); assert.match(verbalizeClassification(c), /not verified/);
  assert.equal(learnClassification(r, 'kente', 'cloth', { source: 'conv-1' }).status, 'repeated', 'the same source cannot inflate confidence');
  const b = learnClassification(r, 'kente', 'cloth', { source: 'conv-2' }); assert.equal(b.status, 'reinforced'); assert.equal(b.sources, 2); assert.ok(b.confidence > a.confidence);
  assert.equal(learnClassification(r, 'snake', 'fish', { source: 'troll' }).status, 'held-for-review'); assert.equal(classify(r, 'snake', 'fish').answer, 'not-established', 'curated concept unchanged');
  assert.equal(learnClassification(r, 'snake', 'animal', { source: 'x' }).status, 'already-known');
  learnClassification(r, 'whale', 'fish', { source: 'a' }); const neg = learnClassification(r, 'whale', 'fish', { source: 'b', negative: true }); assert.equal(neg.conflict, true);
  assert.equal(classify(r, 'whale', 'fish').answer, 'disputed');
  assert.ok(r.history('concept:en:kente').length >= 3, 'every change is a new revision; history kept');
});

test('a running node learns "A kente is a cloth." and then reasons with it, disclosing that it is unverified', async () => {
  const node = await nodeWith(), ask = askOf(node);
  const s = await ask('A kente is a cloth.'); assert.match(s.answer, /^Noted: a kente is a kind of cloth/); assert.equal(s.plan.retrieval.answeredFrom, 'own-node learning');
  const q = await ask('Is a kente a cloth?'); assert.match(q.answer, /^\*\*Yes\.\*\*/); assert.match(q.answer, /not verified/);
  const mine = await ask('I am a developer.'); assert.doesNotMatch(mine.answer, /^Noted/, 'statements about the speaker are not learned as general knowledge');
});

test('corroboration: a provisional meaning becomes CORROBORATED only when independent nodes agree; disagreement makes it DISPUTED', () => {
  const r = new AtomRegistry({ node: 'me' }); const { dna } = r.discover('kente', { lang: 'en', node: 'nodeA' });
  r.propose('lex:en:kente', { linguistic: { pos: 'noun', lemma: 'kente' }, semantic: { senses: [], hypernyms: ['cloth'], definition: 'a woven cloth', meaningStatus: 'teacher-proposed' } }, { node: 'nodeA', trust: 'provisional' });
  const summary = r.meaningSummary(r.get('lex:en:kente')); assert.deepEqual(summary.hypernyms, ['cloth']);
  assert.equal(AtomRegistry.agree(summary, { pos: 'noun', lemma: 'kente', hypernyms: ['cloth', 'textile'], known: true }), true);
  assert.equal(AtomRegistry.agree(summary, { pos: 'verb', lemma: 'kente', hypernyms: ['cloth'], known: true }), false);
  assert.equal(r.endorse('lex:en:kente', { from: 'nodeA', agrees: true }).status, 'recorded', 'the proposer alone is not enough');
  const ok = r.endorse('lex:en:kente', { from: 'nodeB', agrees: true }); assert.equal(ok.status, 'corroborated'); assert.equal(r.get('lex:en:kente').identity.validation, 'corroborated'); assert.deepEqual(r.get('lex:en:kente').epistemic.corroboratedBy, ['nodeA', 'nodeB']);
  const r2 = new AtomRegistry({ node: 'me' }); r2.discover('zorp', { lang: 'en', node: 'nodeA' }); r2.propose('lex:en:zorp', { semantic: { senses: [], definition: 'x', hypernyms: ['tool'], meaningStatus: 'teacher-proposed' } }, { node: 'nodeA' });
  r2.endorse('lex:en:zorp', { from: 'nodeB', agrees: false }); const d = r2.endorse('lex:en:zorp', { from: 'nodeC', agrees: false }); assert.equal(d.status, 'disputed'); assert.equal(r2.get('lex:en:zorp').identity.validation, 'disputed');
  void dna;
});

test('teacher path (stand-in provider): unknown words get provisional teacher senses; a network-learned meaning is independently verified by this node\'s teacher', async () => {
  const node = await nodeWith(), ask = askOf(node);
  const calls = mockTeacher(node, { lexicon: x => x.word === 'kente' ? { language: 'en', pos: 'noun', lemma: 'kente', senses: [{ gloss: 'a colourful Ghanaian woven cloth', hypernym: 'cloth', domain: 'textile' }] } : { unknown: true }, other: () => ({}) });
  await ask('What is kente?'); assert.ok(node.state.lexicon.queue.includes('lex:en:kente'));
  const out = await node.lexiconTick({ max: 3 }); assert.ok(out.guided >= 1, JSON.stringify(out));
  const d = node.atomRegistry().get('lex:en:kente'); assert.equal(d.semantic.meaningStatus, 'teacher-proposed'); assert.equal(d.identity.validation, 'provisional', 'teacher knowledge is not authoritative');
  const sense = node.atomRegistry().get(d.semantic.senses[0]); assert.match(sense.semantic.definition, /woven cloth/);
  assert.ok(calls.filter(c => /atomizes every word/.test(c.instr)).every(c => typeof c.input.word === 'string'), 'the word is passed as data');
  // An atom that came from another node: this node's own teacher agrees → second independent source → corroborated.
  const reg = node.atomRegistry(); reg.discover('adinkra', { lang: 'en', node: 'remote-node' }); reg.propose('lex:en:adinkra', { linguistic: { pos: 'noun', lemma: 'adinkra' }, semantic: { senses: [], definition: 'visual symbols', hypernyms: ['symbol'], meaningStatus: 'network' } }, { node: 'remote-node' });
  mockTeacher(node, { lexicon: () => ({ language: 'en', pos: 'noun', lemma: 'adinkra', senses: [{ gloss: 'Akan visual symbols', hypernym: 'symbol' }] }) });
  node.state.lexicon.verify.push('lex:en:adinkra'); const v = await node.lexiconTick({ max: 3 }); assert.equal(v.corroboration, 'corroborated'); assert.equal(reg.get('lex:en:adinkra').identity.validation, 'corroborated');
});

test('non-English questions: native atomization plus a labelled teacher analysis, then KENUXA\'s own reasoning', async () => {
  const node = await nodeWith(), ask = askOf(node);
  mockTeacher(node, { analysis: x => ({ language: 'fr', translation: 'Is a snake an animal?', clauses: [{ predicate: 'be', tense: 'present', polarity: 'positive', mood: 'interrogative', subject: 'le serpent', object: 'un animal' }], echo: x.text }) });
  const a = await ask('Le serpent est-il un animal ?');
  assert.match(a.answer, /^\*\*Yes\.\*\* A snake is a reptile, a reptile is an animal/);
  assert.equal(a.plan.retrieval.answeredFrom, 'own-node reasoning'); assert.ok(a.trace.some(t => /Teacher-assisted analysis \(fr → en\)/.test(t)));
  assert.ok(node.atomRegistry().has('lex:und:serpent') || node.atomRegistry().has('lex:fr:serpent'), 'the French word itself became an atom');
});

async function cluster(n, opts = {}) { let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < n; i++) T.add('N' + i, 'd' + i); const E = (id, policy) => new PreservationEngine({ self: id, transport: T, now: () => clock, policy: { ...opts, ...policy } }); return { T, E, tick: ms => { clock += ms; } }; }
const recs = (r, n = 150) => [...r.manifests.values()].slice(0, n).map(m => ({ id: m.id, rev: m.head, dna: r.revisions.get(m.head) }));

test('private domains are encrypted: peers hold only ciphertext, cannot see atom ids, and cannot read without the key', async () => {
  const key = randomBytes(32), r = new AtomRegistry(), data = recs(r), { T, E } = await cluster(8);
  const A = E('N0', { dedupDomain: 'clinic', domainKeys: { clinic: key } }); await A.heartbeat();
  const c = await A.commit(data); assert.equal(c.durability, 'COMMITTED');
  for (const n of T.nodes.values()) { for (const b of n.store.chunks.values()) assert.ok(!b.includes(Buffer.from('lex:en:learning')), 'no plaintext in stored fragments'); for (const [k, v] of n.store.meta) if (k.startsWith('idx:')) assert.ok(!JSON.stringify(v).includes('lex:en:'), 'no atom ids in the index'); }
  const seg = (await A.metaRead('seg:' + c.segment)).value; assert.equal(seg.encrypted, 'aes-256-gcm'); assert.equal(seg.sampleAtom, null);
  const B = E('N5', { dedupDomain: 'clinic', domainKeys: { clinic: key } }); assert.equal((await B.getAtom(data[4].id)).rev, data[4].rev);
  assert.equal(await E('N6').getAtom(data[4].id), null, 'a public reader does not even find it');
  const wrong = E('N6', { dedupDomain: 'clinic', domainKeys: { clinic: randomBytes(32) } }); assert.equal(await wrong.getAtom(data[4].id), null, 'a wrong key derives different index ids');
  assert.ok(bucketOf(privateId(key, data[4].id)).startsWith('idx:'));
  assert.equal((await A.commit(data)).deduplicated, true, 'deduplication still works inside the domain');
});

test('adaptive stripes: 8+4 on large networks (tolerates 4 losses), one extra parity for critical data', async () => {
  const r = new AtomRegistry(), data = recs(r, 300), { T, E, tick } = await cluster(16), A = E('N0'); await A.heartbeat();
  const c = await A.commit(data); const m = (await A.metaRead('seg:' + c.segment)).value; assert.equal(m.k, 8); assert.equal(m.m, 4); assert.equal(c.needed, 10);
  const crit = await A.commit(recs(r, 120).reverse(), { importance: 'critical' }); assert.equal((await A.metaRead('seg:' + crit.segment)).value.m, 5, 'critical: one more parity fragment');
  const holders = m.fragments.map(f => f.nodes[0]).filter(n => n !== 'N0' && n !== 'N15').slice(0, 4); for (const h of holders) T.kill(h); tick(120000);
  const B = E('N15'); await B.heartbeat(); assert.equal((await B.getAtom(data[10].id)).rev, data[10].rev, 'reconstructed from 8 of 12');
  const rep = await B.repair(); assert.ok(rep.results.find(x => x.segment === c.segment).outcome === 'restored', JSON.stringify(rep.results));
  const small = await (await cluster(6)).E('N0'); await small.heartbeat(); assert.deepEqual(small.stripe(6), { k: 4, m: 2 });
  assert.deepEqual(new PreservationEngine({ self: 'x', transport: new InMemoryTransport(), policy: { k: 2, m: 1 } }).stripe(6), { k: 2, m: 1 }, 'explicit k/m stays fixed');
});

test('per-peer storage budget: one peer cannot exhaust a node; budgets are per peer and reset per window', () => {
  let t = 0; const w = new ByteWindow(1000, 60000, () => t);
  assert.ok(w.allow('peerA', 600).ok); assert.equal(w.allow('peerA', 600).ok, false); assert.ok(w.allow('peerB', 900).ok, 'other peers unaffected');
  t = 61000; assert.ok(w.allow('peerA', 600).ok, 'window resets');
});
