// End-to-end inside a running node: interpretation → reasoning → structured response plan → answer,
// and per-conversation discourse that survives across public chat turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

const admin = 'reasoning-test-admin-token-1234567890-abcd';
const env = { HOST: '127.0.0.1', NODE_ID: 'reason-node', ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };

test('a node answers "Is a python an animal?" by explicit inference and exposes its response plan', async () => {
  const node = await createNode({ env: { ...env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-reason-')) }, log: () => {} });
  const ask = q => webRequest(node, new Request('http://127.0.0.1/api/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) }), '127.0.0.1').then(r => r.json());
  const a = await ask('Is a python an animal?');
  assert.match(a.answer, /depends on the sense/i); assert.match(a.answer, /a python is a snake, a snake is a reptile, a reptile is an animal/);
  assert.equal(a.plan.retrieval.answeredFrom, 'own-node reasoning'); assert.equal(a.plan.reasoning.answer, 'depends-on-sense'); assert.ok(a.plan.reasoning.assumptions.length);
  assert.ok(a.plan.entities.some(e => e.text === 'a python')); assert.equal(a.plan.validation.nonEmpty, true); assert.equal(a.plan.structure, 'reasoning-chain');
  const b = await ask('Is a snake an animal?'); assert.match(b.answer, /^\*\*Yes\.\*\*/); assert.ok(b.confidence > 50);
  // A non-classification question still goes through the normal cascade but carries a plan with uncertainty.
  const c = await ask('What is a glorbix?'); assert.ok(c.plan); assert.ok(c.plan.uncertainty.some(u => /unknown word: glorbix/.test(u)), JSON.stringify(c.plan.uncertainty));
  const st = await (await webRequest(node, new Request('http://127.0.0.1/api/lexicon', { headers: { Authorization: 'Bearer ' + admin } }), '127.0.0.1')).json();
  assert.ok(st.summary?.byType?.relationship >= 1 || st.byType?.relationship >= 1, 'the proven inference was materialised as a derived relationship atom');
  await node.stop?.();
});

test('public chat keeps per-conversation discourse server-side (in memory), keyed by conversation and address', async () => {
  const node = await createNode({ env: { ...env, RENDER: 'true', HOST: '0.0.0.0', PUBLIC_QUESTIONS_PER_MINUTE: '20', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-conv-')) }, log: () => {} });
  const chat = (q, history, conversation, ip = '198.51.100.9') => webRequest(node, new Request('https://kenuxa.example/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history, conversation }) }), ip).then(r => r.json());
  const first = await chat('I am building a network.', [], 'conv-abc123'); assert.ok(first.answer);
  const second = await chat('How can I protect it?', [{ question: 'I am building a network.' }], 'conv-abc123'); assert.ok(second.answer);
  assert.match(second.understanding.summary + ' ' + second.answer, /network/i, 'the follow-up was understood as being about the network');
  await node.stop?.();
});
