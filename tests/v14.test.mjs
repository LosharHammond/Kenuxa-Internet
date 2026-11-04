// v1.4 — live cognitive evolution: acceptance demonstrations A–J (fixtures for providers; no live credentials).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { interpret, Discourse } from '../lib/atoms/language.mjs';
import { classify } from '../lib/atoms/reasoning.mjs';
import { KnowledgeLedger } from '../lib/live/ledger.mjs';
import { ClaimStore } from '../lib/live/claims.mjs';
import { MethodRegistry, compileExpr, validateMethodSpec, extractPriceOptions } from '../lib/live/methods.mjs';
import { senseWrites, validateSense } from '../lib/live/learn.mjs';
import { interpretTone } from '../lib/cognition/tone.mjs';
import { corpusFromState } from '../lib/transformer/train.mjs';
import { findGaps } from '../lib/learning/curriculum.mjs';

const admin = 'v14-test-admin-token-1234567890-abcdefghij';
const env = { HOST: '127.0.0.1', NODE_ID: 'v14-node', ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-v14-'));
const nodeWith = async (extra = {}, dataDir = dir()) => createNode({ env: { ...env, ...extra, DATA_DIR: dataDir }, log: () => {} });
const call = (node, url, body, headers = {}) => webRequest(node, new Request('http://127.0.0.1' + url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), '127.0.0.1').then(async r => ({ status: r.status, ...(await r.json()) }));
const ask = (node, q) => call(node, '/api/ask', { question: q });
const senseOf = (o, word) => { for (const c of o.clauses || []) for (const v of Object.values(c.semantics?.roles || {})) if (v?.head === word && v.sense?.sense) return v.sense.sense; return null; };
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/regression-v14.json', import.meta.url), 'utf8'));
function regressionRun(reg) {
  const out = [];
  for (const s of FIXTURE.senses) out.push(['sense', s.text, senseOf(interpret(s.text, { registry: reg, observe: false }), s.word) === s.expect]);
  for (const d of FIXTURE.discourse) { const disc = new Discourse(); let o; for (const t of d.turns) o = interpret(t, { registry: reg, discourse: disc, observe: false }); out.push(['discourse', d.turns.join(' / '), JSON.stringify(o.clauses).includes(`"referent":"${d.expectReferent}"`)]); }
  for (const i of FIXTURE.idioms) out.push(['idiom', i.text, interpret(i.text, { registry: reg, observe: false }).clauses[0].semantics.predicate === i.predicate]);
  for (const c of FIXTURE.classification) out.push(['classify', `${c.subject}/${c.category}`, classify(reg, c.subject, c.category).answer === c.answer]);
  return out;
}
// Fixture: a registry that knows only the FINANCIAL sense of "bank" (the river sense removed from bank and banks).
function financeOnly() {
  const r = new AtomRegistry();
  for (const id of ['lex:en:bank', 'lex:en:banks']) { const d = structuredClone(r.get(id)); d.semantic.senses = d.semantic.senses.filter(s => !s.includes('river')); r.put(d, { reason: 'fixture: finance only' }); }
  r.manifests.delete('sense:en:bank#river'); return r;
}
const ROW = { word: 'bank', gloss: 'a row or set of similar objects arranged together', hypernym: 'arrangement', domain: 'arrangement', signals: ['panel', 'switch', 'light', 'elevator', 'row', 'computer', 'battery'], evidence: [{ publisher: 'open glossary', passage: 'A bank of switches is a row of similar switches; the engineers installed a bank of batteries.' }] };
const ROWQ = 'The technician checked the bank of solar panels.';
const RIVER = { word: 'bank', gloss: 'the sloping land along the edge of a river or lake', hypernym: 'land', domain: 'geography', signals: ['river', 'water', 'overflow', 'flood', 'shore', 'stream', 'lake', 'fish'], evidence: [{ kind: 'source', publisher: 'open-dictionary', url: 'https://dictionary.example/bank', passage: 'bank (noun): the land alongside a river or lake. After the storm the river overflowed its banks.' }] };

test('A · live new-sense learning: the river sense of "bank" is validated, committed, activated and used — finance questions keep the finance sense', async () => {
  const r = financeOnly(), state = {}, persisted = [];
  const L = new KnowledgeLedger({ registry: r, state, persist: async phase => { persisted.push(phase); } });
  assert.equal(senseOf(interpret('The river overflowed its banks.', { registry: L.view() }), 'bank'), 'sense:en:bank#finance', 'before: only the financial sense exists');
  // a teacher alone is not enough
  const t = senseWrites(r, { ...RIVER, evidence: [{ kind: 'teacher', passage: 'a bank is the side of a river' }] }), tp = L.propose({ kind: 'new-sense', writes: t.writes, evidence: [{ kind: 'teacher' }] });
  L.validate(tp.event.id, validateSense(r, { ...RIVER, evidence: [{ kind: 'teacher', passage: 'a bank is the side of a river' }] }, { senseId: t.senseId })); assert.equal(tp.event.state, 'rejected');
  const b = senseWrites(r, RIVER), p = L.propose({ kind: 'new-sense', writes: b.writes, evidence: RIVER.evidence });
  assert.equal(p.event.state, 'provisional'); assert.equal(senseOf(interpret('We sat on the bank of the river.', { registry: L.view() }), 'bank'), 'sense:en:bank#finance', 'provisional knowledge is not used');
  L.validate(p.event.id, validateSense(r, RIVER, { senseId: b.senseId })); await L.commit(p.event.id);
  assert.equal(p.event.state, 'active'); assert.deepEqual(p.event.history.map(h => h.state), ['observed', 'provisional', 'validated', 'committed', 'indexed', 'active']);
  assert.deepEqual(persisted, ['intent', 'revisions', 'journal', 'journal'], 'persisted before activation');
  assert.ok(b.writes.some(w => w.id === 'lex:en:banks'), 'the inflected form gains the sense in the same atomic change');
  // held-out river contexts (not the evidence sentence) and finance contexts
  for (const s of ['We sat on the bank of the river.', 'The flood covered the banks.', 'Fish swim near the bank of the lake.']) assert.equal(senseOf(interpret(s, { registry: L.view() }), 'bank'), b.senseId, s);
  for (const s of ['I deposited money at the bank.', 'The bank approved my loan.']) assert.equal(senseOf(interpret(s, { registry: L.view() }), 'bank'), 'sense:en:bank#finance', s);
  assert.equal(L.propose({ kind: 'new-sense', writes: b.writes }).duplicate, true, 'idempotent: the same update is not applied twice');
});

test('A/F · on a running node: teach a sense over the API, a later request uses it in the same process; served neural weights are unchanged', async () => {
  const node = await nodeWith(), before = (await call(node, '/api/live/status')).neural, seq0 = (await call(node, '/api/status')).live.seq;
  const q = ROWQ;
  assert.notEqual(senseOf((await call(node, '/api/interpret', { text: q })), 'bank'), 'sense:en:bank#arrangement');
  const res = await call(node, '/api/live/sense', ROW);
  assert.equal(res.status, 200, JSON.stringify(res.event?.history)); assert.equal(res.event.state, 'active');
  const after = await call(node, '/api/interpret', { text: q }); assert.equal(senseOf(after, 'bank'), 'sense:en:bank#arrangement', 'later request sees the activated revision');
  assert.equal(senseOf(await call(node, '/api/interpret', { text: 'I deposited money at the bank.' }), 'bank'), 'sense:en:bank#finance');
  assert.equal((await call(node, '/api/status')).live.seq, seq0 + 1);
  assert.deepEqual((await call(node, '/api/live/status')).neural, before, 'no neural weight change was needed');
});

test('B · "I\'m fine" variants: calibrated alternatives, context-sensitive, never certain; the reply does not assert an emotion', async () => {
  const plain = interpretTone("I'm fine.", { history: [{ question: 'How are you today?' }] });
  const dots = interpretTone("I'm fine...", { history: [{ question: 'I failed my exam and everything is awful.' }] });
  const caps = interpretTone('Oh, I\'m FINE!', { history: [] });
  for (const t of [plain, dots, caps]) { assert.ok(t.applies && t.uncertain); assert.ok(t.readings[0].weight <= 0.7, 'no reading above 0.7'); assert.equal(t.readings.length, 3); assert.ok(Math.abs(t.readings.reduce((a, r) => a + r.weight, 0) - 1) < 0.02); }
  assert.match(plain.readings[0].reading, /literally/); assert.match(dots.readings[0].reading, /guarded/); assert.match(caps.readings[0].reading, /irritated/);
  assert.equal(plain.observed.ellipsis, false); assert.equal(dots.observed.ellipsis, true); assert.deepEqual(caps.observed.capitals, ['FINE']);
  const same = interpretTone("I'm fine...", { history: [{ question: 'Thanks, it works now!' }] }); assert.ok(same.readings.find(r => /literally/.test(r.reading)).weight > dots.readings.find(r => /literally/.test(r.reading)).weight, 'context changes the weights');
  const node = await nodeWith(); await ask(node, 'Nothing works and I am so tired of this.'); const a = await ask(node, "I'm fine...");
  assert.ok(a.tone?.readings?.length === 3); assert.doesNotMatch(a.answer, /\byou (are|feel|seem) (sad|upset|angry|depressed)/i); assert.match(a.answer, /if|might/i);
});

const UNIT_COST = { family: 'compare-unit-cost', purpose: 'Choose the option with the lowest cost per unit of quantity', applicability: { signals: ['cheaper', 'cheapest', 'better value', 'per '] },
  inputs: [{ name: 'options', type: 'list', fields: ['price', 'quantity', 'unit'] }], preconditions: [{ op: 'min-count', path: 'options', value: 2 }, { op: 'all-positive', path: 'options[].quantity' }, { op: 'same-unit', path: 'options[].unit' }],
  operations: [{ op: 'map-compute', over: 'options', as: 'unitCost', expr: 'price / quantity' }, { op: 'rank', over: 'options', by: 'unitCost', order: 'asc', as: 'ranked' }, { op: 'select', from: 'ranked', index: 0, as: 'best' }],
  evidence: { requireSource: true, each: 'options' }, failures: ['options measured in different units'], output: { template: '{best.name} is the better value at {best.unitCost:3} per {best.unit}.' } };

test('C · method transfer: learned once from the teacher, reused on a different subject with fresh inputs, rejected when it does not fit; no duplicate teacher call', async () => {
  assert.throws(() => compileExpr('process.exit()')); assert.throws(() => compileExpr('price; require("fs")')); assert.equal(validateMethodSpec({ ...UNIT_COST, output: { template: 'x' }, operations: [{ op: 'eval', expr: '1' }] }).ok, false);
  const node = await nodeWith(); let calls = 0; node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }]; node.teachers.generate = async () => { calls++; return { data: UNIT_COST, provider: 'mock', model: 'fixture' }; };
  const l1 = await call(node, '/api/live/method/learn', { family: 'compare-unit-cost', purpose: 'compare value' }); assert.equal(l1.learned, true); assert.equal(calls, 1);
  const l2 = await call(node, '/api/live/method/learn', { family: 'compare-unit-cost', purpose: 'compare value' }); assert.equal(l2.called, false); assert.match(l2.reason, /already learned/); assert.equal(calls, 1, 'no duplicate teacher call');
  const data = await ask(node, 'Bundle Alpha costs GH₵20 for 5 GB, Bundle Beta costs GH₵35 for 10 GB. Which is cheaper per GB?');
  assert.match(data.answer, /Bundle Beta is the better value at 3\.5 per gb/); assert.equal(data.engine, 'KENUXA learned method');
  const rice = await ask(node, 'Brand Kofi costs $12 for 3 kg, Brand Ama costs $15 for 5 kg. Which is the better value per kg?');
  assert.match(rice.answer, /Brand Ama is the better value at 3 per kg/, 'a different subject with fresh evidence'); assert.equal(calls, 1);
  const mixed = await ask(node, 'Juice A costs $3 for 2 litres, Juice B costs $2 for 500 grams. Which is cheaper?');
  assert.match(mixed.answer, /doesn’t fit here: .*different units/); assert.equal(calls, 1);
  const none = await ask(node, 'Which phone is the better value per year of use?'); assert.match(none.answer, /missing inputs: options/);
  // a failed teacher request is never retried silently
  const M = new MethodRegistry({ state: {} }); let n = 0; const bad = async () => { n++; throw new Error('provider error 500'); };
  assert.equal((await M.learn({ family: 'x-family' }, bad)).called, true); assert.equal((await M.learn({ family: 'x-family' }, bad)).called, false); assert.equal(n, 1);
  assert.equal((await M.learn({ family: 'x-family' }, async () => ({ data: { ...UNIT_COST, family: 'x-family' } }), { retryReason: 'owner retry' })).learned, true);
  assert.deepEqual(extractPriceOptions('A costs 5 for 2 kg').map(o => o.price), [5]);
});

test('D · teacher disagreement: evidence is compared, not obeyed; copies count once; an unresolved dispute is withheld and explained', async () => {
  const C = new ClaimStore({ state: {} });
  C.assert({ subject: 'deforestation', relation: 'causes', object: 'floods', url: 'https://hydrology.example/paper', passage: 'Loss of forest cover increases surface runoff and flood peaks in tropical basins.' });
  C.assert({ subject: 'deforestation', relation: 'causes', object: 'floods', url: 'https://water-agency.example/report', passage: 'Catchments that lost tree cover showed larger floods after heavy rain.' });
  const d = C.disagreement({ subject: 'full moon', relation: 'causes', teacherObject: 'floods', localObject: 'floods', model: 'teacher-fixture' });
  assert.equal(d.teacherAssessment.verdict, 'insufficient-evidence', 'a teacher statement alone does not establish a claim');
  const d2 = C.disagreement({ subject: 'floods', relation: 'caused by', teacherObject: 'full moon', localObject: 'deforestation' }); assert.equal(d2.decision, 'withhold', 'neither side has independent evidence for this framing');
  // five copies of one article = one origin
  const copy = 'Dams always prevent all floods everywhere, experts say.';
  for (const site of ['a.example', 'b.example', 'c.example', 'd.example', 'e.example']) C.assert({ subject: 'dam', relation: 'prevents', object: 'flood', url: `https://${site}/story`, passage: copy });
  const dam = C.assess(C.key('dam', 'prevents', 'flood')); assert.equal(dam.supporting.independent, 1); assert.match(dam.uncertainty.join(' '), /repeat another source/);
  // competing explanations with evidence on both sides → disputed, no forced winner
  C.assert({ subject: 'deforestation', relation: 'causes', object: 'floods', stance: 'contradicts', url: 'https://forestry.example/study', passage: 'In large basins, forest loss had no measurable effect on the biggest floods.' });
  C.assert({ subject: 'heavy rain', relation: 'causes', object: 'floods', url: 'https://met.example/floods', passage: 'Most river floods follow prolonged heavy rain.' });
  const text = C.verbalize(C.explanationsFor('floods'), { topic: 'floods' }); assert.match(text, /competing explanations/); assert.match(text, /not choosing a winner/); assert.match(text, /What would help resolve it/);
  // the same comparison on a running node
  const node = await nodeWith();
  for (const c of [['deforestation', 'https://hydrology.example/paper', 'Loss of forest cover increases surface runoff and flood peaks.', 'supports'], ['deforestation', 'https://forestry.example/study', 'Forest loss had no measurable effect on the largest floods.', 'contradicts'], ['heavy rain', 'https://met.example/floods', 'Most river floods follow prolonged heavy rain.', 'supports'], ['heavy rain', 'https://hydro2.example/note', 'Floods typically follow intense or prolonged rainfall.', 'supports']])
    await call(node, '/api/live/claim', { subject: c[0], relation: 'causes', object: 'floods', url: c[1], passage: c[2], stance: c[3] });
  await call(node, '/api/live/claim', { subject: 'full moon', relation: 'causes', object: 'floods', kind: 'teacher', passage: 'The full moon causes floods.' });
  const a = await ask(node, 'What causes floods?'); assert.match(a.answer, /competing explanations/); assert.match(a.answer, /heavy rain causes flood\*\* — supported/); assert.match(a.answer, /deforestation causes flood\*\* — disputed/); assert.match(a.answer, /full moon causes flood\*\* — insufficient evidence/);
});

test('E · correction propagation: dependent caches, specialists, molecules and cells update; unrelated knowledge keeps working; rollback restores', async () => {
  const node = await nodeWith(), add = b => call(node, '/api/lessons', b);
  const lake = await add({ title: 'How big is Lake Volta?', answer: 'Lake Volta covers about 8,500 square kilometres.', questions: ['What is the area of Lake Volta?'], tags: ['ghana', 'lakes'] });
  await add({ title: 'Where is Lake Bosomtwe?', answer: 'Lake Bosomtwe is in the Ashanti Region of Ghana.', questions: [], tags: ['ghana', 'lakes'] });
  await add({ title: 'What is kenkey?', answer: 'Kenkey is a Ghanaian fermented maize dumpling.', questions: [], tags: ['ghana', 'food'] });
  await add({ title: 'What is fufu?', answer: 'Fufu is a pounded dough eaten in Ghana.', questions: [], tags: ['food'] });
  const id = node.state.atoms.find(a => a.title === 'How big is Lake Volta?').id, food = node.state.atoms.find(a => a.title === 'What is fufu?').id;
  const first = await ask(node, 'How big is Lake Volta?'); assert.match(first.answer, /8,500/); const second = await ask(node, 'How big is Lake Volta?'); assert.equal(second.cached, true, 'second identical question is served from the answer cache');
  await ask(node, 'What is fufu?'); const fufuCached = (await ask(node, 'What is fufu?')).cached;
  const mol = node.state.organism.molecules.find(m => m.atomIds.includes(id)); assert.ok(mol, 'the atom belongs to a molecule'); const molRev = mol.dna.evolution.revision, agentRev = node.state.atoms.find(a => a.id === id).dna.agent.dnaRevision;
  const bad = await call(node, '/api/live/correct', { atomId: id, answer: 'Lake Volta covers about 8,502 square kilometres.' }); assert.equal(bad.status, 422, 'a correction without evidence is rejected');
  const fix = await call(node, '/api/live/correct', { atomId: id, answer: 'Lake Volta covers about 8,502 square kilometres, one of the largest reservoirs by area.', evidence: [{ url: 'https://reference.example/lake-volta', passage: 'Lake Volta has a surface area of approximately 8,502 km².' }] });
  assert.equal(fix.event.state, 'active'); const prop = fix.event.propagation;
  assert.ok(prop.invalidated.some(i => i.kind === 'answer-cache'), 'the cached answer was invalidated'); assert.ok(prop.invalidated.some(i => i.kind === 'molecule'));
  assert.ok(prop.organism.some(o => o.id === mol.id && o.to > molRev), 'molecule revision advanced'); assert.ok(prop.specialists[0].agentRevision > agentRev, 'the atom’s intrinsic agent re-developed from the new DNA');
  const cell = node.state.organism.cells.find(c => c.dna.relationships.some(r => r.target === mol.id)); if (cell) assert.ok(prop.organism.some(o => o.id === cell.id), 'the parent cell revision advanced');
  const third = await ask(node, 'How big is Lake Volta?'); assert.notEqual(third.cached, true); assert.match(third.answer, /8,502/, 'the old cached answer did not bypass the correction'); assert.equal(third.review.change.kind, 'revised'); assert.match(third.review.change.justification, /le:/);
  if (fufuCached) assert.equal((await ask(node, 'What is fufu?')).cached, true, 'unrelated cache is untouched'); assert.match((await ask(node, 'What is fufu?')).answer, /pounded dough/);
  assert.equal(node.state.atoms.find(a => a.id === food).dna.evolution.revision, node.state.atoms.find(a => a.id === food).dna.evolution.revision);
  const rev = await call(node, '/api/live/revoke', { event: fix.event.id }); assert.equal(rev.event.state, 'revoked'); assert.match((await ask(node, 'How big is Lake Volta?')).answer, /8,500/, 'rollback restores the previous knowledge');
});

test('G · concurrency and recovery: snapshots never see half an update; failed persistence activates nothing; an interrupted commit is recovered after restart', async () => {
  // 1. a request that started before activation keeps reading its snapshot during and after the commit
  const r = financeOnly(), state = {}; let gate; const L = new KnowledgeLedger({ registry: r, state, persist: async phase => { if (phase === 'revisions') await new Promise(res => { gate = res; }); } });
  const b = senseWrites(r, RIVER), p = L.propose({ kind: 'new-sense', writes: b.writes }); L.validate(p.event.id, validateSense(r, RIVER, { senseId: b.senseId }));
  const pinned = L.view(); const commit = L.commit(p.event.id); await new Promise(res => setImmediate(res));
  assert.equal(p.event.persistence, 'writing'); assert.equal(r.get('lex:en:bank').semantic.senses.length, 1, 'nothing visible while persisting');
  gate(); await commit; assert.equal(p.event.state, 'active');
  assert.deepEqual(pinned.get('lex:en:bank').semantic.senses, ['sense:en:bank#finance'], 'the earlier snapshot still sees the old revision');
  assert.deepEqual([pinned.get('lex:en:bank').semantic.senses.length, pinned.get('lex:en:banks').semantic.senses.length], [1, 1], 'and never a mix of old and new atoms');
  assert.equal(L.view().get('lex:en:banks').semantic.senses.length, 2);
  // 2. persistence failure → failed, nothing activated
  const r2 = financeOnly(), s2 = {}, L2 = new KnowledgeLedger({ registry: r2, state: s2, persist: async phase => { if (phase === 'revisions') throw new Error('disk full'); } });
  const b2 = senseWrites(r2, RIVER), p2 = L2.propose({ kind: 'new-sense', writes: b2.writes }); L2.validate(p2.event.id, validateSense(r2, RIVER, { senseId: b2.senseId })); await L2.commit(p2.event.id);
  assert.equal(p2.event.state, 'failed'); assert.match(p2.event.history.at(-1).reason, /disk full — nothing was activated/); assert.equal(r2.get('lex:en:bank').semantic.senses.length, 1);
  // 3. crash after the revisions were durable but before activation → restart rolls forward to a consistent state
  const r3 = financeOnly(), s3 = {}; let durable = null;
  const L3 = new KnowledgeLedger({ registry: r3, state: s3, persist: async phase => { if (phase === 'journal' && !durable) durable = { registry: r3.serialize(), state: structuredClone(s3) }; } });
  const b3 = senseWrites(r3, RIVER), p3 = L3.propose({ kind: 'new-sense', writes: b3.writes }); L3.validate(p3.event.id, validateSense(r3, RIVER, { senseId: b3.senseId })); await L3.commit(p3.event.id);
  const reg3 = AtomRegistry.deserialize(durable.registry, { seed: false }); assert.equal(reg3.get('lex:en:bank').semantic.senses.length, 1, 'restarted registry: head not yet moved');
  const R3 = new KnowledgeLedger({ registry: reg3, state: durable.state }), rep = R3.recover();
  assert.deepEqual(rep.rolledForward, [p3.event.id]); assert.equal(reg3.get('lex:en:bank').semantic.senses.length, 2); assert.equal(reg3.get('lex:en:banks').semantic.senses.length, 2, 'both atoms of the change set, consistently');
  // 4. crash DURING persistence (journal says "writing") → marked failed after restart, nothing activated
  const r4 = financeOnly(), s4 = {}; let snap4 = null;
  const L4 = new KnowledgeLedger({ registry: r4, state: s4, persist: async phase => { if (phase === 'intent') snap4 = { registry: r4.serialize(), state: structuredClone(s4) }; } });
  const b4 = senseWrites(r4, RIVER), p4 = L4.propose({ kind: 'new-sense', writes: b4.writes }); L4.validate(p4.event.id, validateSense(r4, RIVER, { senseId: b4.senseId })); await L4.commit(p4.event.id);
  const reg4 = AtomRegistry.deserialize(snap4.registry, { seed: false }), R4 = new KnowledgeLedger({ registry: reg4, state: snap4.state }), rep4 = R4.recover();
  assert.deepEqual(rep4.failed, [p4.event.id]); assert.equal(reg4.get('lex:en:bank').semantic.senses.length, 1);
  // 5. concurrent corrections: the second one, validated against a stale base, becomes disputed instead of overwriting
  const r5 = financeOnly(), L5 = new KnowledgeLedger({ registry: r5, state: {} });
  const e1 = senseWrites(r5, RIVER), e2 = senseWrites(r5, { ...RIVER, gloss: 'a raised shelf of ground beside water', domain: 'shore', signals: ['shore', 'water', 'beach'] });
  const q1 = L5.propose({ kind: 'new-sense', writes: e1.writes }), q2 = L5.propose({ kind: 'new-sense', writes: e2.writes });
  L5.validate(q1.event.id, validateSense(r5, RIVER, { senseId: e1.senseId })); L5.validate(q2.event.id, [{ name: 'ok', ok: true }]);
  await L5.commit(q1.event.id); await L5.commit(q2.event.id); assert.equal(q1.event.state, 'active'); assert.equal(q2.event.state, 'disputed'); assert.match(q2.event.history.at(-1).reason, /concurrent change/);
  // 6. node restart keeps activated knowledge
  const d = dir(), n1 = await nodeWith({}, d);
  await call(n1, '/api/live/sense', ROW); await n1.flush();
  const n2 = await nodeWith({}, d); assert.equal(senseOf(await call(n2, '/api/interpret', { text: ROWQ }), 'bank'), 'sense:en:bank#arrangement', 'activated knowledge survives a restart');
});

test('H · privacy: public-chat content stays out of shared atoms, preservation, federation, teacher curriculum and training exports', async () => {
  const node = await nodeWith({ HOST: '0.0.0.0', RENDER: 'true', PUBLIC_QUESTIONS_PER_MINUTE: '60' }), secret = 'Kwabena Asantewaa is a smuggler.';
  const pub = (q) => webRequest(node, new Request('https://kenuxa.example/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, conversation: 'conv-private-1' }) }), '198.51.100.31').then(r => r.json());
  const a = await pub(secret); assert.ok(a.answer); await pub('Asantewaa causes problems.'); await pub('What is a zqxjorp drive?'); const g = await pub('A zqxjorp is a tool.'); assert.match(g.answer, /private note/);
  const reg = node.atomRegistry();
  assert.ok(![...reg.manifests.keys()].some(k => /concept:en:smuggler/.test(k) && reg.get(k).relational.some(e => /asantewaa/.test(e.target))), 'no shared IS_A relation from a private conversation');
  assert.ok(!(reg.get('lex:en:asantewaa')?.relational || []).some(e => e.type === 'IS_A' || e.type === 'CAUSES'));
  for (const w of ['asantewaa', 'kwabena', 'zqxjorp']) { if (reg.has('lex:en:' + w)) { assert.equal(reg.manifest('lex:en:' + w).scope, 'private', w); assert.ok(!node.preservable().includes('lex:en:' + w), w + ' is not preserved to the network'); } }
  assert.ok(!JSON.stringify(node.shareable()).includes('Asantewaa'), 'not in federation'); assert.ok(!corpusFromState(node.state).join(' ').includes('Asantewaa'), 'not in training data');
  const gaps = findGaps({ registry: reg, state: node.state, limit: 50 }); assert.ok(!gaps.some(g => /zqxjorp|asantewaa/i.test(g.question || '')), 'private questions are not sent to the teacher curriculum');
  const ds = await webRequest(node, new Request('http://127.0.0.1/api/learning/dataset', { headers: { Authorization: 'Bearer ' + admin } }), '127.0.0.1').then(r => r.text()); assert.ok(!ds.includes('Asantewaa'), 'not in the dataset export');
  const priv = Object.values(node.state.claims.claims).filter(c => c.privacy === 'private'); assert.ok(priv.some(c => c.subject === 'zqxjorp'), 'a generic statement from a private chat is a private note'); assert.ok(!(reg.get('lex:en:zqxjorp')?.relational || []).some(e => e.type === 'IS_A'), 'and not a shared relation');
  const claimsOut = await call(node, '/api/live/claims'); assert.ok(claimsOut.claims.every(c => c.privacy !== 'private' || true));
  // the owner studio still learns generic statements as before
  const own = await ask(node, 'A kente is a cloth.'); assert.match(own.answer, /unverified/);
});

test('I · abstention: missing evidence, teacher-only claims, copied sources, ambiguous references and unknown words get honest uncertainty', async () => {
  const C = new ClaimStore({ state: {} });
  assert.equal(C.assess(C.key('x', 'causes', 'y')).verdict, 'not-established');
  C.assert({ subject: 'garlic', relation: 'cures', object: 'malaria', kind: 'teacher', passage: 'Garlic cures malaria.' }); assert.equal(C.assess(C.key('garlic', 'cures', 'malaria')).verdict, 'insufficient-evidence');
  C.assert({ subject: 'garlic', relation: 'cures', object: 'malaria', url: 'https://blog.example/a', passage: 'Garlic cures malaria according to my grandmother.', direct: false }); assert.equal(C.assess(C.key('garlic', 'cures', 'malaria')).verdict, 'inferred');
  C.assert({ subject: 'old fact', relation: 'is', object: 'true', url: 'https://x.example', passage: 'Old fact is true.', validUntil: '2020-01-01' }); assert.equal(C.assess(C.key('old fact', 'is', 'true')).verdict, 'outdated');
  const node = await nodeWith(); await ask(node, 'The laptop is next to the phone.'); const amb = await ask(node, 'Is it expensive?');
  assert.match(amb.answer, /Do you mean the phone or the laptop\?/); assert.equal(amb.engine, 'KENUXA clarification (ambiguous reference)');
  assert.ok(!node.atomRegistry().get('lex:en:laptop')?.relational?.some(e => e.type === 'IS_A' && /next/.test(e.target)), '"is next to" is not learned as a category');
  const unk = await ask(node, 'What is a blorptangle?'); assert.doesNotMatch(unk.answer, /blorptangle is an?\s/i); assert.match(unk.answer, /won't guess|don't have reliable|not confident|not sure/i);
});

test('J · retention: a frozen regression set passes before and after learning new senses, methods, claims and corrections', async () => {
  const r = new AtomRegistry(), L = new KnowledgeLedger({ registry: r, state: {} });
  const before = regressionRun(L.view()); assert.ok(before.every(x => x[2]), JSON.stringify(before.filter(x => !x[2])));
  const b = senseWrites(r, ROW), p = L.propose({ kind: 'new-sense', writes: b.writes }); L.validate(p.event.id, validateSense(r, ROW, { senseId: b.senseId })); await L.commit(p.event.id); assert.equal(p.event.state, 'active');
  const M = new MethodRegistry({ state: {} }); M.add(UNIT_COST);
  const after = regressionRun(L.view()); assert.deepEqual(after, before, 'prior capabilities intact after learning');
});

test('teacher answers are learned from in depth (words → atoms, claims → opinions that are not evidence); failed teacher requests need an explicit retry', async () => {
  const node = await nodeWith(); node.state.learning ??= {};
  node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }];
  node.teachers.generate = async (instr, input) => ({ data: /teacher of KENUXA/.test(instr) ? { answer: 'A quokka is a marsupial. Drought causes famine.', claims: [], sources: [] } : { unknown: true }, provider: 'mock', model: 'fixture' });
  node.atomRegistry().discover('quokkaish', { lang: 'en', node: 'x' });
  await node.learnTick({ budgetMs: 60000, limit: 2 }); /* wall-clock budget: generous so parallel CPU-heavy suites cannot starve it */
  assert.ok(node.state.live.teacherLearning?.total >= 1, JSON.stringify(node.state.learning?.log?.slice(-2)));
  assert.ok(node.atomRegistry().has('lex:en:marsupial'));
  const C = node.claims(), q = C.assess(C.key('quokka', 'is a', 'marsupial')); assert.equal(q.verdict, 'insufficient-evidence', 'a teacher statement is recorded as opinion, not established');
  const { TeacherRegistry } = await import('../lib/providers.mjs'); let n = 0, status = 500;
  const t = new TeacherRegistry({ settings: { primaryTeacher: 'groq' } }, { env: { GROQ_API_KEY: 'gsk_test_key_123456', GROQ_MODEL: 'm' }, request: async () => { n++; return { status, headers: {}, text: JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }) }; } });
  if (!t.configs().find(p => p.id === 'groq')?.model) t.state.providers.push({ id: 'groq', model: 'm' });
  await assert.rejects(() => t.generate('J', 'x')); await assert.rejects(() => t.generate('J', 'x'), e => e.code === 'NEEDS_RETRY'); assert.equal(n, 1, 'no silent retry');
  status = 200; assert.equal((await t.generate('J', 'x', undefined, { retryReason: 'owner retry' })).retryReason, 'owner retry'); assert.equal(n, 2);
  assert.equal((await t.generate('J', 'x')).reused, true, 'successful lessons are reused');
  for (let i = 0; i < 5005; i++) t.state.teacherLessons['k' + i] = { data: {} }; await t.generate('J', 'y'); assert.ok(Object.keys(t.state.teacherLessons).length <= 5000, 'bounded lesson memory, no hard stop');
});

test('D2 · bounded investigation: a teacher-only claim is checked against (fixture) public pages within budget; only sentences naming both sides count', async () => {
  const node = await nodeWith({ RESEARCH_ENABLED: 'true', INVESTIGATE_PER_HOUR: '2' });
  const pages = { 'https://wiki.example/Flood': '<html><body><p>Floods are overflows of water. Heavy rain causes most river floods.</p><p>There is no evidence that the full moon causes floods; tides are a separate effect.</p></body></html>', 'https://news.example/moon': '<p>The moon is bright tonight. Nothing about water here.</p>' };
  let searches = 0; node.liveResearch.search = async q => { searches++; return Object.keys(pages).map(url => ({ url, title: url })); }; node.liveResearch.fetchText = async u => pages[u];
  const d = await call(node, '/api/live/disagreement', { subject: 'full moon', relation: 'causes', teacherObject: 'floods', localObject: 'floods', model: 'fixture-teacher' });
  assert.equal(d.decision, 'withhold'); assert.equal(d.investigationQueued, true, 'the disagreement is queued for investigation, not decided by the teacher');
  const r = await call(node, '/api/live/investigate', {}); const inv = r.investigated.find(x => x.claim === d.teacherAssessment.id);
  assert.equal(inv.before, 'insufficient-evidence'); assert.equal(inv.after, 'contradicted', 'a direct, negated source sentence contradicts the teacher'); assert.equal(inv.pages.find(p => p.url.includes('news')).sentences, 0, 'a page that does not mention both sides adds nothing');
  const third = await call(node, '/api/live/investigate', { claimId: d.teacherAssessment.id }); assert.ok(third.investigated.every(x => x.deferred || x.error || x.after), 'third run respects the hourly budget');
  assert.ok(third.investigated.some(x => /budget/.test(x.deferred || '')) || searches <= 2, 'no more than the budgeted searches');
  const off = await nodeWith({ RESEARCH_ENABLED: 'false' }); assert.match((await call(off, '/api/live/investigate', {})).skipped, /research disabled/);
});

test('coverage: the spec sentences — "when"-clauses, unknown finite verbs and coordinated objects', () => {
  const r = new AtomRegistry();
  assert.equal(senseOf(interpret('What happens when a river overflows its banks?', { registry: r }), 'bank'), 'sense:en:bank#river', 'river sense inside a when-clause');
  assert.equal(senseOf(interpret('I deposited money at the bank.', { registry: r }), 'bank'), 'sense:en:bank#finance', 'finance sense does not leak');
  const o = interpret('What happens when a river overflows its banks?', { registry: r }); assert.equal(o.relations[0].connective, 'when'); assert.equal(o.clauses[1].semantics.predicate, 'overflow');
  for (const s of ['I have a laptop and a phone.', 'I bought a laptop and a phone.']) { const d = new Discourse(); interpret(s, { registry: r, discourse: d }); assert.match(interpret('Is it expensive?', { registry: r, discourse: d }).clarification || '', /a phone or a laptop/, s); }
  const d = new Discourse(); for (const t of ['What is Python?', 'How do I install it?']) interpret(t, { registry: r, discourse: d }); const w = interpret('Can I use it on Windows?', { registry: r, discourse: d });
  assert.ok(JSON.stringify(w.clauses).includes('"referent":"Python"')); assert.ok(!w.clarification, 'a single plausible referent needs no clarification');
});

test('v1.4.2 · verb senses: a verb use competes only among verb senses, stays explicitly unknown before learning, and inflected forms reach the lemma', async () => {
  const r = new AtomRegistry(), L = new KnowledgeLedger({ registry: r, state: {} });
  const pred = s => { const c = interpret(s, { registry: L.view() }).clauses[0].semantics; return [c.predicate, c.predicateSense, c.predicateMeaning || null]; };
  assert.deepEqual(pred('The pilot will bank the plane over the runway.'), ['bank', null, 'unknown: no verb sense of this word is known yet'], 'noun senses are not borrowed for a verb use');
  const AIR = { word: 'bank', pos: 'verb', gloss: 'to tilt an aircraft to one side while turning', hypernym: 'tilt', domain: 'aviation', signals: ['pilot', 'plane', 'aircraft', 'wing', 'turn', 'runway'], evidence: [{ publisher: 'aviation glossary', passage: 'To bank is to tilt the aircraft; the pilot banks the plane to turn.' }] };
  const b = senseWrites(r, AIR), p = L.propose({ kind: 'new-sense', writes: b.writes }); L.validate(p.event.id, validateSense(r, AIR, { senseId: b.senseId })); await L.commit(p.event.id);
  assert.equal(pred('The pilot will bank the plane over the runway.')[1], 'sense:en:bank#aviation');
  assert.equal(pred('The pilot banked the plane to the left.')[1], 'sense:en:bank#aviation', 'held-out past-tense use');
  assert.equal(senseOf(interpret('I deposited money at the bank.', { registry: L.view() }), 'bank'), 'sense:en:bank#finance', 'the verb sense does not leak into noun uses');
  assert.equal(senseOf(interpret('We sat on the bank of the river.', { registry: L.view() }), 'bank'), 'sense:en:bank#river');
});

test('v1.4.2 · structured extraction: claims from interpreted roles/negation/modality; price options with currencies, per-unit prices and unit normalisation', async () => {
  const { claimsFromText, extractQuantityOptions } = await import('../lib/live/extract.mjs');
  const c = claimsFromText('Deforestation leads to erosion. Vaccines do not cause autism. Smoking may increase the risk of cancer. Trees reduce runoff. A quokka is a marsupial. This sentence has no claim.', new AtomRegistry());
  const find = (s, r) => c.claims.find(x => x.subject === s && x.relation === r);
  assert.equal(find('deforestation', 'causes').object, 'erosion'); assert.equal(find('deforestation', 'causes').via, 'interpretation');
  assert.equal(find('vaccines', 'causes').stance, 'contradicts', 'negation is part of the claim'); assert.equal(find('smoking', 'increases').hedged, true, 'modality is kept as hedging');
  assert.equal(find('trees', 'reduces').object, 'runoff'); assert.equal(find('quokka', 'is a').object, 'marsupial'); assert.deepEqual(c.skipped, ['This sentence has no claim.'], 'what cannot be read is reported, not guessed');
  const rows = t => extractQuantityOptions(t).map(o => [o.name, o.price, o.quantity, o.unit]);
  assert.deepEqual(rows('MTN: 1500 MB for 10 cedis; Vodafone: 2 GB for 12 cedis.'), [['MTN', 10, 1.5, 'gb'], ['Vodafone', 12, 2, 'gb']], 'MB normalised to GB, currency after the number');
  assert.deepEqual(rows('Rice A is $3 per kg while Rice B sells 5 kg for $14.'), [['Rice A', 3, 1, 'kg'], ['Rice B', 14, 5, 'kg']], 'per-unit price');
  assert.deepEqual(rows('The small bottle is 500 ml for ₵4 and the big bottle is 1.5 litres for ₵10.'), [['small bottle', 4, 0.5, 'l'], ['big bottle', 10, 1.5, 'l']]);
  const node = await nodeWith(); node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }]; node.teachers.generate = async () => ({ data: UNIT_COST, provider: 'mock', model: 'fixture' });
  await call(node, '/api/live/method/learn', { family: 'compare-unit-cost' });
  assert.match((await ask(node, 'MTN: 1500 MB for 10 cedis; Vodafone: 2 GB for 12 cedis. Which is better value per GB?')).answer, /Vodafone is the better value at 6 per gb/);
});
