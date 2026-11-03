import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

const env = { HOST: '0.0.0.0', RENDER: 'true', NODE_ID: 'chat-node', ADMIN_TOKEN: 'chat-test-admin-token-1234567890-abcdef', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', PUBLIC_QUESTIONS_PER_MINUTE: '4' };

test('hosted nodes serve a public chat; the research studio stays behind the admin token', async () => {
  const node = await createNode({ env: { ...env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-chat-')) }, log: () => {} });
  const call = (p, init = {}, ip = '198.51.100.7') => webRequest(node, new Request('https://kenuxa.example' + p, init), ip);
  const home = await (await call('/')).text(); assert.match(home, /chat\.js/); assert.doesNotMatch(home, /Atoms & DNA/);
  assert.match(await (await call('/studio')).text(), /Atoms &amp; DNA|Atoms & DNA/);
  assert.equal((await call('/api/status')).status, 401);
  const ask = (q, history = [], ip) => call('/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history }) }, ip);
  const r = await ask('Compare shoe and dress?'); const a = await r.json();
  assert.equal(r.status, 200); assert.ok(a.answer.length > 10); assert.ok(a.understanding.intent); assert.equal(a.sections, undefined); assert.equal(a.trace, undefined);
  const cap = await (await ask('What is the capital of Ghana?')).json(); assert.match(cap.answer, /Accra/);
  const more = await (await ask('Tell me more about it', [{ question: 'What is the capital of Ghana?', entityIds: cap.entityIds }])).json(); assert.match(more.answer, /Ghana|Accra/);
  await ask('Hello'); assert.equal((await ask('One too many')).status, 429); // per-visitor rate limit
  assert.equal((await ask('Different visitor', [], '198.51.100.8')).status, 200);
  assert.equal((await call('/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"question":"x"}' })).status, 403);
  const cfg = await (await call('/chat/config')).json(); assert.equal(cfg.mode, 'chat');
});
