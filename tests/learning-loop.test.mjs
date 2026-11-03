// PART 8–10 — teacher–student learning with atomic dissection, root causes, verification, controlled promotion,
// leased tasks (no duplicate learning across nodes), resource-aware scheduling and a privacy-safe dataset.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { dissect, claimsOf, verifyClaim } from '../lib/learning/dissect.mjs';
import { TaskRegistry, admit, findGaps, questionFor, recordError } from '../lib/learning/curriculum.mjs';
import { classify } from '../lib/atoms/reasoning.mjs';
import { InMemoryTransport, PreservationEngine } from '../lib/atoms/preservation.mjs';

const admin = 'learning-loop-admin-token-1234567890-abcd';
const env = { HOST: '127.0.0.1', ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
const nodeWith = () => createNode({ env: { ...env, NODE_ID: 'learner', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-learn-')) }, log: () => {} });
const api = (node, p, body) => webRequest(node, new Request('http://127.0.0.1' + p, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), '127.0.0.1');

test('dissection decomposes both answers into atom-level claims, finds contradictions, and blames the teacher when verified knowledge disagrees', () => {
  const r = new AtomRegistry();
  const rep = dissect({ question: 'Is a python an animal, and when was Python released?', registry: r,
    student: { answer: 'A python is a snake. Python was released in 1991.' },
    teacher: { answer: 'A python is a snake. Python was released in 1989. A snake is not an animal.', interpretation: 'classification and a date' } });
  assert.equal(rep.claims.teacher, 3); assert.ok(rep.agreements.some(a => /python is a snake/i.test(a.teacher)));
  assert.ok(rep.contradictions.some(c => c.type === 'number'), 'the release year conflict is found by structure, not string similarity');
  assert.ok(rep.teacherErrors.some(e => /snake is not an animal/i.test(e.claim) && e.method === 'atom-graph'), 'verified IS_A chain refutes the teacher');
  assert.ok(rep.rootCauses.some(c => c.cause === 'teacher-error'));
  assert.equal(verifyClaim(claimsOf('2 + 2 = 5', r)[0], { registry: r }).status, 'refuted');
  assert.equal(verifyClaim(claimsOf('3 * 4 = 12', r)[0], { registry: r }).status, 'verified');
  assert.equal(verifyClaim(claimsOf('I is happy today.', r)[0], { registry: r }).status, 'refuted', 'grammar rule check');
  assert.equal(verifyClaim(claimsOf('"I is" is incorrect English.', r)[0], { registry: r }).status, 'unverified', 'a sentence ABOUT the error is not itself an error');
});

test('student answers first, offline; teacher claims are promoted only as provisional knowledge; refuted claims are rejected; tasks are not repeated', async () => {
  const node = await nodeWith(), order = [];
  const orig = node.answerQuestion; node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }];
  node.teachers.generate = async (instr, input) => { order.push('teacher'); const q = JSON.parse(input).question || ''; if (/kente/.test(q)) return { provider: 'mock', model: 'teacher-1', data: { interpretation: 'definition of a word', answer: 'Kente is a cloth. A kente is a textile woven in Ghana. A snake is not an animal.', claims: [], assumptions: ['Ghanaian usage'], uncertainty: [], sources: ['https://en.wikipedia.org/wiki/Kente_cloth', 'not-a-url'] } }; return { provider: 'mock', model: 'teacher-1', data: {} }; };
  await api(node, '/api/ask', { question: 'What is kente?' });
  const gaps = findGaps({ registry: node.atomRegistry(), state: node.state }); assert.ok(gaps.some(g => g.type === 'unknown-word' && g.word === 'kente'));
  assert.match(questionFor(gaps.find(g => g.word === 'kente')), /What does the word "kente" mean/);
  const run = await node.learnTick({ budgetMs: 30000, limit: 1 }); assert.equal(run.attempted, 1, JSON.stringify(run.skipped));
  const rep = run.reports[0]; assert.ok(['student-incomplete', 'disputed', 'consistent', 'teacher-error'].includes(rep.verdict));
  assert.ok(rep.rootCauses.some(c => c.cause === 'missing-atom' || c.cause === 'incomplete-evidence'), JSON.stringify(rep.rootCauses));
  assert.ok(rep.teacherErrors.some(e => /snake is not an animal/i.test(e.claim)), 'teacher error detected');
  const reg = node.atomRegistry(); const c = classify(reg, 'kente', 'textile'); assert.equal(c.answer, 'yes'); assert.ok(c.readings[0].unverified, 'teacher knowledge is provisional, one source');
  assert.equal(classify(reg, 'snake', 'animal').answer, 'yes', 'the refuted teacher claim was not promoted');
  const L = node.state.learning; assert.equal(L.dataset.length, 1); const rec = L.dataset[0];
  for (const k of ['question', 'student', 'teacher', 'teacherModel', 'evidence', 'verdict', 'errors', 'correction', 'validation', 'datasetVersion', 'permissions']) assert.ok(k in rec, k);
  assert.deepEqual(rec.evidence, ['https://en.wikipedia.org/wiki/Kente_cloth'], 'only real-looking https sources are kept');
  assert.equal(L.regression.length, 1);
  const again = await node.learnTick({ budgetMs: 30000, limit: 3 }); assert.ok(!again.reports.some(r => r.question.includes('"kente"')), 'a learned gap is not learned again');
  const status = await (await api(node, '/api/learning')).json(); assert.ok(status.metrics.dissections >= 1 && status.metrics.teacherAnswers >= 1);
  void orig; void order;
});

test('the student run happens before the teacher call and uses no web, network or teacher', async () => {
  const node = await nodeWith(), order = [], answer = node.answerQuestion;
  node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }];
  node.teachers.generate = async () => { order.push('teacher'); return { provider: 'mock', model: 'm', data: { answer: 'A zorbit is a tool.', claims: [] } }; };
  await api(node, '/api/ask', { question: 'What is a zorbit?' }); order.length = 0;
  const off = await answer('What is a zorbit?', { memory: [], offline: true }); assert.equal(order.length, 0, 'offline run never calls the teacher'); assert.ok(!(off.result.evidence || []).some(e => e.url));
  await node.learnTick({ budgetMs: 30000, limit: 1 }); assert.deepEqual(order, ['teacher'], 'exactly one teacher call, after the student run');
});

test('no duplicate learning across nodes: leases are claimed in quorum metadata', async () => {
  let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < 4; i++) T.add('N' + i, 'd' + i);
  const E = id => new PreservationEngine({ self: id, transport: T, now: () => clock }), stA = {}, stB = {};
  const A = new TaskRegistry({ state: stA, self: 'N0', preservation: E('N0'), now: () => clock }), B = new TaskRegistry({ state: stB, self: 'N1', preservation: E('N1'), now: () => clock });
  await E('N0').heartbeat(); await E('N1').heartbeat();
  const gap = { id: 'a'.repeat(32), type: 'unknown-word', target: 'lex:en:kente' };
  assert.equal((await A.claim(gap)).ok, true); const b = await B.claim(gap); assert.equal(b.ok, false); assert.match(b.reason, /leased by N0/);
  await A.finish(gap.id, { status: 'done' }); const b2 = await B.claim(gap); assert.equal(b2.ok, false); assert.match(b2.reason, /learned elsewhere/);
  clock += 11 * 60000; const other = { id: 'b'.repeat(32), type: 'x', target: 'y' }; await A.claim(other); clock += 11 * 60000; assert.equal((await B.claim(other)).ok, true, 'an expired lease can be taken over (node went to sleep)');
});

test('scheduler: interactive requests and quotas take priority; private questions never leave via the dataset export', async () => {
  assert.equal(admit('local', { activeRequests: 1, cpuLoad: 0, heapUsed: 0.1, teacherQuotaLeft: 5 }).ok, false);
  assert.equal(admit('teacher', { activeRequests: 0, cpuLoad: 0, heapUsed: 0.1, teacherQuotaLeft: 0 }).ok, false);
  assert.equal(admit('local', { activeRequests: 0, cpuLoad: 0.95, heapUsed: 0.1, teacherQuotaLeft: 5 }).ok, false);
  assert.equal(admit('teacher', { activeRequests: 0, cpuLoad: 0.1, heapUsed: 0.1, teacherQuotaLeft: 3 }).ok, true);
  const node = await nodeWith(); node.teachers.list = () => [{ id: 'mock', primary: true, configured: true }];
  node.teachers.generate = async () => ({ provider: 'mock', model: 'm', data: { answer: 'Here is a careful answer about my private medical results.', claims: [] } });
  recordError(node.state, 'what do my private medical results mean', 'no grounded answer');
  await node.learnTick({ budgetMs: 30000, limit: 5 }); assert.ok(node.state.learning.dataset.some(r => r.containsUserText));
  const exp = await (await api(node, '/api/learning/dataset')).text(); assert.doesNotMatch(exp, /medical/, 'records containing user questions are excluded from export');
});
