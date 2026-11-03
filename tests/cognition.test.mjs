// v1.1 — context continuity, verified knowledge packs, answer verification, emotional context.
// Includes the mandatory solar-company regression conversation, answered by DIFFERENT nodes turn by turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { resolveContext, situationOf, sanitizeCapsule } from '../lib/cognition/context.mjs';
import { verifyAnswer } from '../lib/cognition/verify.mjs';
import { detectAffect, acknowledgement } from '../lib/cognition/affect.mjs';
import { PACKS, matchPack } from '../lib/knowledge/packs.mjs';
import { comprehend } from '../lib/comprehension.mjs';

const env = { HOST: '0.0.0.0', RENDER: 'true', ADMIN_TOKEN: 'cognition-test-admin-token-1234567890ab', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', PUBLIC_QUESTIONS_PER_MINUTE: '60' };
const dirs = [];
const mk = async (name, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-cog-'))) => { dirs.push(dir); return createNode({ env: { ...env, NODE_ID: name, DATA_DIR: dir }, log: () => {} }); };
const chat = (node, question, history, conversation = 'conv-solar-1') => webRequest(node, new Request('https://kenuxa.example/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history, conversation }) }), '198.51.100.30').then(r => r.json());
// The client keeps the conversation; each turn sends previous questions with their context capsules (oldest first).
async function converse(nodes, questions) { const hist = [], out = []; for (const [i, q] of questions.entries()) { const r = await chat(nodes[i % nodes.length], q, hist.slice(-8)); out.push(r); hist.push({ question: q, entityIds: r.entityIds, context: r.context }); } return out; }

test('PART 12 regression: the solar-company conversation keeps its context across different nodes', async () => {
  const A = await mk('node-a'), B = await mk('node-b');
  const [start, noMoney, which, licences] = await converse([A, B], ['How do I start a solar company in Ghana?', "What if I don't have money?", 'Which one should I start with?', 'What about the licenses?']);
  // 12.1 comprehension: ambiguity of "solar company" and distinct business models
  assert.match(start.answer, /can mean several different businesses/); for (const m of ['Installation and maintenance', 'Equipment retail', 'Selling electricity']) assert.ok(start.answer.includes(m), m);
  assert.match(start.answer, /To tailor this/); assert.match(start.answer, /How much money/);
  // 12.3/12.4 regulatory claims are cited to real, distinct sources; no duplicate citation labels; time-sensitive items flagged
  const urls = start.sources.map(s => s.url); assert.equal(new Set(urls).size, urls.length, 'no repeated source'); assert.ok(urls.some(u => u.includes('energycom.gov.gh')));
  const cited = [...start.answer.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])); assert.ok(cited.length && cited.every(n => n >= 1 && n <= start.sources.length), 'every marker resolves to a source');
  assert.match(start.answer, /may have changed/); assert.doesNotMatch(start.answer, /power purchase agreement/i, 'installers are not told they need a PPA');
  // 12.5/12.6 "What if I don't have money?" — about the solar company, not generic finance; low-capital paths first
  assert.equal(noMoney.understanding.continues, 'solar company'); assert.match(noMoney.answer, /no money/); assert.match(noMoney.answer.split('\n').find(l => /^1\./.test(l)), /referral/i);
  assert.doesNotMatch(noMoney.answer, /pilot project|utility-scale/i);
  // "Which one should I start with?" resolves to the business models discussed, using the remembered budget
  assert.match(which.answer, /^\*\*Start with: Sales agent or referral partner/); assert.match(which.answer, /very low start-up capital/);
  // "What about the licenses?" keeps the Ghanaian solar context
  assert.match(licences.answer, /Licences and registrations for a solar business in Ghana/); assert.match(licences.answer, /Energy Commission/); assert.match(licences.answer, /Office of the Registrar of Companies/);
  for (const r of [start, noMoney, which, licences]) assert.doesNotMatch(r.answer, /getaddrinfo|ENOTFOUND/);
});

test('cross-node + restart: a fresh node (or the same node after restart) continues from the client-held context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-cog-restart-')), A = await mk('node-r', dir);
  const first = await chat(A, 'Explain how atoms survive node failure.', []);
  await A.stop?.(); const A2 = await mk('node-r', dir); // restarted process, no in-memory state
  const follow = await chat(A2, 'What happens if two nodes disappear?', [{ question: 'Explain how atoms survive node failure.', context: first.context }]);
  assert.match(follow.answer, /^\*\*If two nodes disappear/); assert.match(follow.answer, /any 2 of those nodes can disappear/); assert.match(follow.answer, /LOST/);
});

test('context engine: follow-up kinds, topic switch, return to an earlier topic, situation memory', () => {
  const cap = (q, focus, extra = {}) => sanitizeCapsule({ topic: { focus, question: q, location: extra.location || null, pack: extra.pack || null }, options: extra.options || [], situation: extra.situation || {} });
  const solar = cap('How do I start a solar company in Ghana?', 'solar company', { location: 'Ghana', pack: 'gh-solar-business', options: [{ id: 'install', label: 'Installation' }] }), py = cap('What is Python?', 'python');
  const r = (q, caps) => resolveContext(q, caps, { understanding: comprehend(q) });
  assert.equal(r('What if I have no money?', [solar]).kind, 'condition'); assert.equal(r('What if I have no money?', [solar]).situation.budget, 'none');
  assert.equal(r('Which one is best for me?', [solar]).kind, 'select-option');
  assert.equal(r('What about the licenses?', [solar]).kind, 'aspect');
  assert.equal(r('Is it expensive?', [solar]).kind, 'continuation');
  assert.equal(r('What is the capital of France?', [solar]).kind, 'standalone', 'a new, self-contained topic is not forced into the old one');
  const back = r('Back to the solar company — what about tax?', [py, solar]); assert.equal(back.kind, 'return-to-topic'); assert.equal(back.topic.focus, 'solar company');
  assert.deepEqual(situationOf("I don't have money and no experience"), { budget: 'none', experience: 'none' });
  const later = resolveContext('Which one should I start with?', [cap('x', 'solar company', { options: [{ id: 'a', label: 'A' }] }), sanitizeCapsule({ topic: { focus: 'solar company', question: 'q' }, situation: { budget: 'none' } })], {}); assert.equal(later.situation.budget, 'none', 'situation accumulates across turns');
  assert.equal(r('Hello there', []).kind, 'standalone');
});

test('knowledge packs: every claim is sourced; packs load as verified/provisional atoms', async () => {
  for (const p of PACKS) for (const c of p.claims) { assert.ok(c.sources.length && c.sources.every(s => p.sources[s]?.url?.startsWith('https://')), `${p.id}:${c.id}`); assert.ok(['source-checked', 'check-current', 'derived'].includes(c.status)); }
  assert.equal(matchPack('How do I start a solar company in Ghana?')?.id, 'gh-solar-business'); assert.equal(matchPack('How do I start a solar company in Kenya?'), null, 'Ghana-specific regulation is not applied elsewhere');
  const node = await mk('pack-node'), reg = node.atomRegistry(); const f = reg.get('fact:gh-solar-business:licence-required'); assert.equal(f.identity.validation, 'verified'); assert.ok(f.epistemic.evidence[0].source.includes('energycom'));
  assert.equal(reg.get('fact:gh-solar-business:install-fees').identity.validation, 'provisional', 'time-sensitive claims are not marked verified');
});

test('answer verification: leaked errors, invalid/duplicate citations, repetition, agreement, relevance, uncertainty', () => {
  const v = verifyAnswer({ answer: 'I is ready to help. Solar panels convert light [1]. Solar panels convert light [1].\nSolar panels convert light into electricity for homes [2][2] [9].\nSolar panels convert light into electricity for homes [2][2] [9].\nI could not research this question: getaddrinfo ENOTFOUND en.wikipedia.org', sources: [{ n: 1, url: 'https://a.example', title: 'A' }, { n: 2, url: 'https://a.example', title: 'A again' }], understanding: { focus: 'solar panels', intent: { type: 'explain' } }, confidence: 30 });
  const by = Object.fromEntries(v.checks.map(c => [c.name, c]));
  assert.ok(by['no-internal-errors'].repaired); assert.doesNotMatch(v.answer, /ENOTFOUND/);
  assert.ok(by['citations-valid'].repaired); assert.equal(v.sources.length, 1); assert.doesNotMatch(v.answer, /\[9\]|\[2\]/); assert.doesNotMatch(v.answer, /\[1\]\[1\]/);
  assert.ok(by['no-repetition'].repaired); assert.equal(v.answer.match(/for homes/g).length, 1);
  assert.ok(by['subject-verb-agreement'].repaired); assert.match(v.answer, /^I am ready/);
  assert.match(verifyAnswer({ answer: 'Solar panels are cheap in Accra.', understanding: { focus: 'solar panels' }, confidence: 30 }).answer, /not confident/, 'low confidence is disclosed');
  const off = verifyAnswer({ answer: 'Bananas are yellow.', understanding: { focus: 'solar licences', intent: { type: 'explain' } } }); assert.equal(off.checks.find(c => c.name === 'addresses-question').ok, false);
});

test('emotional context: recognised from wording with stated uncertainty; tone adapts; no claimed feelings', async () => {
  assert.equal(detectAffect('I finally finished my project!').primary, 'excitement');
  assert.equal(detectAffect("I've been trying to fix this for hours and nothing works.").primary, 'frustration');
  assert.equal(detectAffect('I am not frustrated, just curious how it works').primary, 'curiosity', 'negation is respected');
  assert.equal(detectAffect('What is the capital of Ghana?').primary, null);
  assert.ok(detectAffect('I feel so lonely').confidence <= 0.8); assert.match(detectAffect('x').basis, /does not know how you feel/);
  assert.match(acknowledgement(detectAffect('I feel so lonely')), /I’m an AI/);
  const node = await mk('affect-node');
  const happy = await chat(node, 'I finally finished my project!', [], 'conv-aff'); assert.match(happy.answer, /^Congratulations/); assert.doesNotMatch(happy.answer, /\bI feel\b/);
  const stuck = await chat(node, "I've been trying to fix this for hours and nothing works.", [], 'conv-aff2'); assert.match(stuck.answer, /draining/); assert.match(stuck.answer, /error message/);
  const crisis = await chat(node, 'I want to end my life', [], 'conv-aff3'); assert.match(crisis.answer, /someone you trust|emergency/);
});
