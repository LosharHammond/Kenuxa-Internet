// PART 4.3–4.5 / 15 — accounts, sessions, shared-device separation, private memory levels, consented location.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { Accounts, memoryCommand, approximateLocation } from '../lib/identity/accounts.mjs';

const env = { HOST: '0.0.0.0', RENDER: 'true', ADMIN_TOKEN: 'identity-test-admin-token-1234567890ab', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', PUBLIC_QUESTIONS_PER_MINUTE: '60', KENUXA_SESSION_SECRET: 'shared-secret-between-my-own-nodes-0123456789' };
const mk = (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-id-'))) => createNode({ env: { ...env, NODE_ID: 'id-node', DATA_DIR: dir }, log: () => {} });
function client(node, ip = '198.51.100.40') { let cookie = ''; const call = async (p, body) => { const r = await webRequest(node, new Request('https://kenuxa.example' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), ip); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0]; return { status: r.status, data: await r.json(), setCookie: sc }; }; return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } }; }

test('accounts: scrypt-hashed passphrases, signed revocable sessions, throttled logins', () => {
  const state = {}, a = new Accounts({ state });
  const s = a.create({ username: 'Ama', passphrase: 'correct horse battery' }); assert.equal(s.user.username, 'ama');
  const u = Object.values(state.users)[0]; assert.ok(!JSON.stringify(u).includes('correct horse'), 'no plaintext passphrase'); assert.ok(u.hash && u.salt);
  assert.equal(a.verify(s.token).user.id, u.id); assert.equal(a.verify(s.token.slice(0, -2) + 'xx'), null, 'tampered token rejected');
  assert.throws(() => a.login({ username: 'ama', passphrase: 'wrong passphrase!' }), /Wrong/);
  for (let i = 0; i < 6; i++) try { a.login({ username: 'ama', passphrase: 'nope-nope-nope' }, { ip: '1.2.3.4' }); } catch {}
  assert.throws(() => a.login({ username: 'ama', passphrase: 'correct horse battery' }, { ip: '1.2.3.4' }), /Too many/);
  a.logout(s.token); assert.equal(a.verify(s.token), null, 'signing out revokes the session');
  assert.throws(() => a.create({ username: 'ab', passphrase: 'x' }), /username/);
  assert.equal(memoryCommand('Remember that I live in Kumasi').fact, 'You live in Kumasi'); assert.equal(memoryCommand('Remember when we met?'), null);
  assert.equal(approximateLocation({ timeZone: 'Africa/Accra' }).country, 'Ghana'); assert.deepEqual(approximateLocation({ lat: 5.60372, lon: -0.18696, accuracy: 30 }).coords, { lat: 5.6, lon: -0.2 }, 'coordinates are coarsened');
});

test('signed-in memory persists across conversations and node restarts; anonymous visitors get no personal memory; a shared device is separated by sign-out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-id-')), node = await mk(dir), ama = client(node);
  const anon = await ama.call('/chat/ask', { question: 'Remember that I have no money to start with', history: [], conversation: 'c-anon' }); assert.match(anon.data.answer, /^Sign in/);
  const created = await ama.call('/chat/account', { action: 'create', username: 'ama', passphrase: 'correct horse battery' }); assert.equal(created.status, 200); assert.match(created.setCookie, /HttpOnly; SameSite=Strict/); assert.match(created.setCookie, /Secure/);
  const saved = await ama.call('/chat/ask', { question: 'Remember that I have no money to start with', history: [], conversation: 'c-1' }); assert.match(saved.data.answer, /I’ll remember that you have no money/); assert.match(saved.data.answer, /never becomes shared network knowledge/);
  assert.ok(!node.atomRegistry().manifests.has('concept:en:money') || !JSON.stringify(node.atomRegistry().get('concept:en:money')).includes('no money to start'), 'private memory is not written to the atom network');
  // A NEW conversation: the remembered situation shapes the solar answer (user memory level)
  const solar = await ama.call('/chat/ask', { question: 'How do I start a solar company in Ghana?', history: [], conversation: 'c-2' }); assert.match(solar.data.answer, /with no money/);
  // restart: same data dir, same shared secret → the session cookie still works
  await node.stop?.(); const again = await mk(dir), amaLater = client(again); amaLater.cookie = ama.cookie;
  assert.equal((await amaLater.call('/chat/me')).data.user.username, 'ama');
  assert.match((await amaLater.call('/chat/ask', { question: 'What do you remember about me?', history: [], conversation: 'c-3' })).data.answer, /no money to start with/);
  // shared device: after sign-out the next person sees nothing of Ama's memory
  await amaLater.call('/chat/account', { action: 'logout' }); assert.equal(amaLater.cookie, '');
  assert.equal((await amaLater.call('/chat/me')).data.user, null); assert.match((await amaLater.call('/chat/ask', { question: 'What do you remember about me?', history: [], conversation: 'c-4' })).data.answer, /^Sign in/);
  // export and deletion
  amaLater.cookie = ama.cookie; const relog = await amaLater.call('/chat/account', { action: 'login', username: 'ama', passphrase: 'correct horse battery' }); assert.equal(relog.status, 200);
  const exp = await amaLater.call('/chat/account', { action: 'export' }); assert.ok(exp.data.memory.facts.length === 1 && !('hash' in exp.data));
  assert.equal((await amaLater.call('/chat/account', { action: 'delete', passphrase: 'correct horse battery' })).status, 200); assert.equal(Object.keys(again.state.users).length, 0);
});

test('location: used only with consent, labelled as approximate, never as identity', async () => {
  const node = await mk(), c = client(node);
  const without = await c.call('/chat/ask', { question: 'How do I start a solar company?', history: [], conversation: 'loc-1' }); assert.doesNotMatch(without.data.answer, /assumed you’re in/);
  const withLoc = await c.call('/chat/ask', { question: 'How do I start a solar company?', history: [], conversation: 'loc-2', location: { timeZone: 'Africa/Accra' } });
  assert.match(withLoc.data.answer, /I’ve assumed you’re in Ghana \(country level, from the device time zone \(approximate\)\)/); assert.match(withLoc.data.answer, /Energy Commission/);
  const elsewhere = await c.call('/chat/ask', { question: 'How do I start a solar company?', history: [], conversation: 'loc-3', location: { timeZone: 'Europe/Berlin' } }); assert.doesNotMatch(elsewhere.data.answer, /Energy Commission/, 'Ghana rules are not applied to someone in Germany');
});
