// v1.2 — ATP (Atom Transfer Protocol) on real nodes, event decomposition, causal multi-step reasoning,
// generic-only statement learning, private cross-device chat sync, metadata that survives as many losses as data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { decompose } from '../lib/cognition/decompose.mjs';
import { learnCausal, causalQuery, causesOf } from '../lib/atoms/reasoning.mjs';
import { ensureIdentity, signHeaders } from '../lib/mesh.mjs';
import { InMemoryTransport, PreservationEngine, bucketOf } from '../lib/atoms/preservation.mjs';

const admin = 'v12-test-admin-token-1234567890-abcdefgh';
const base = { ADMIN_TOKEN: admin, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '' };
const mk = extra => createNode({ env: { HOST: '127.0.0.1', NODE_ID: 'v12-node', KENUXA_NETWORK: 'off', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-v12-')), ...base, ...extra }, log: () => {} });
const ask = (node, q) => webRequest(node, new Request('http://127.0.0.1/api/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) }), '127.0.0.1').then(r => r.json());

test('ATP/1.0 on a real node: canonical /atp routes, legacy /mtp alias, signed info with capabilities and health', async () => {
  const node = await mk({ KENUXA_NETWORK: 'on', KENUXA_BUNDLED_SEEDS: 'false', KENUXA_DIRECTORY: 'off', PUBLIC_URL: 'http://127.0.0.1:9', ALLOW_LOCAL_PEERS: 'true' });
  const call = (p, headers = {}) => webRequest(node, new Request('http://127.0.0.1' + p, { headers }), '127.0.0.1');
  const info = await (await call('/atp/info')).json(); assert.equal(info.protocol, 'ATP/1.0'); assert.ok(info.accepts.includes('MTP/0.5-open'));
  assert.ok(info.capabilities.includes('atp-store') && info.capabilities.includes('isa-reasoning')); assert.ok(Number.isFinite(info.health.heapMB)); assert.ok(!JSON.stringify(info).includes(admin));
  const peer = ensureIdentity({});
  assert.equal((await call('/atp/ping', signHeaders(peer, 'GET', '/atp/ping', ''))).status, 200);
  const legacyOnly = Object.fromEntries(Object.entries(signHeaders(peer, 'GET', '/mtp/ping', '')).filter(([k]) => k.startsWith('x-mtp-')));
  const old = await call('/mtp/ping', legacyOnly); assert.equal(old.status, 200, 'an MTP/0.5 node can still talk to a v1.2 node');
  assert.equal((await call('/atp/ping')).status, 401); assert.match((await (await call('/atp/ping')).json()).error, /Sign ATP requests/);
  assert.equal((await (await webRequest(node, new Request('http://127.0.0.1/health'), '127.0.0.1')).json()).protocol, 'ATP/0.4');
});

test('decomposition: "The solar panel converts sunlight into electrical energy." → actor, action, input, output', () => {
  const [d] = decompose('The solar panel converts sunlight into electrical energy.', new AtomRegistry());
  assert.equal(d.action.predicate, 'convert'); assert.equal(d.actors[0].head, 'panel'); assert.match(d.actors[0].text, /solar panel/i);
  assert.equal(d.inputs[0].head, 'sunlight'); assert.equal(d.outputs[0].head, 'energy'); assert.match(d.outputs[0].text, /electrical energy/); assert.ok(d.rules.includes('rule:en:transformation-roles'));
  const [c] = decompose('Heat causes expansion.', new AtomRegistry()); assert.equal(c.causes[0].head, 'heat'); assert.equal(c.effects[0].head, 'expansion');
  const two = decompose('I am learning because I need to improve.', new AtomRegistry()); assert.equal(two[1].causeOf, 0);
});

test('causal knowledge: learned from statements, multi-step and defeasible, denials and disputes, reverse "what causes"', () => {
  const r = new AtomRegistry();
  learnCausal(r, 'heat', 'expansion', { source: 'a' }); learnCausal(r, 'expansion', 'crack', { source: 'a' });
  const q = causalQuery(r, 'heat', 'crack'); assert.equal(q.answer, 'yes-indirect'); assert.equal(q.steps, 2); assert.ok(q.confidence < causalQuery(r, 'heat', 'expansion').confidence, 'longer chains are weaker');
  assert.equal(causalQuery(r, 'crack', 'heat').answer, 'not-established', 'direction matters');
  learnCausal(r, 'heat', 'crack', { source: 'b', negative: true }); assert.equal(causalQuery(r, 'heat', 'crack').answer, 'disputed');
  const c = causesOf(r, 'crack'); assert.deepEqual(c.causes.map(x => [x.cause, x.direct]), [['expansion', true], ['heat', false]]);
});

test('a node learns causal statements and answers causal questions; personal statements are not learned as general facts', async () => {
  const node = await mk();
  assert.match((await ask(node, 'Heat causes expansion.')).answer, /^Noted: heat causes expansion/);
  assert.match((await ask(node, 'Expansion causes cracks.')).answer, /^Noted/);
  const q = await ask(node, 'Does heat cause cracks?'); assert.match(q.answer, /Possibly, indirectly/); assert.equal(q.plan.retrieval.answeredFrom, 'own-node reasoning');
  assert.match((await ask(node, 'What causes cracks?')).answer, /expansion[\s\S]*heat/);
  assert.match((await ask(node, 'Why do cracks happen?')).answer, /What I know can cause crack/);
  const mine = await ask(node, 'My sister is a nurse.'); assert.doesNotMatch(mine.answer, /^Noted/); assert.ok(!node.atomRegistry().has('concept:en:sister'));
  const plan = (await ask(node, 'The solar panel converts sunlight into electrical energy.')).plan; assert.equal(plan.semantics[0].outputs[0].head, 'energy');
});

test('signed-in chat history syncs privately across devices; other users and signed-out devices cannot see it', async () => {
  const node = await mk({ HOST: '0.0.0.0', RENDER: 'true', PUBLIC_QUESTIONS_PER_MINUTE: '60' });
  const client = ip => { let cookie = ''; return async (p, body) => { const r = await webRequest(node, new Request('https://k.example' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), ip); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; };
  const laptop = client('198.51.100.50'), phone = client('198.51.100.51'), other = client('198.51.100.52');
  await laptop('/chat/account', { action: 'create', username: 'kofi', passphrase: 'a long enough passphrase' });
  const chat = { id: 'chat-abc123', title: 'Solar plans', updatedAt: Date.now(), messages: [{ role: 'user', content: 'How do I start a solar company in Ghana?', at: 1 }, { role: 'ai', content: 'It depends…', at: 2, sources: [{ n: 1, title: 'EC', url: 'https://energycom.gov.gh/x' }, { n: 2, title: 'bad', url: 'javascript:alert(1)' }] }] };
  assert.equal((await laptop('/chat/account', { action: 'chats', chats: [chat, { id: 'x' }] })).status, 200);
  await phone('/chat/account', { action: 'login', username: 'kofi', passphrase: 'a long enough passphrase' });
  const pulled = (await phone('/chat/account', { action: 'chats', chats: [] })).data.chats; assert.equal(pulled.length, 1, 'invalid chat ids are dropped'); assert.equal(pulled[0].title, 'Solar plans');
  assert.deepEqual(pulled[0].messages[1].sources.map(s => s.url), ['https://energycom.gov.gh/x'], 'unsafe links are stripped');
  await phone('/chat/account', { action: 'chats', chats: [{ ...chat, title: 'Solar plans (edited on phone)', updatedAt: Date.now() + 1000 }] });
  assert.equal((await laptop('/chat/account', { action: 'chats', chats: [{ ...chat, title: 'stale laptop copy', updatedAt: Date.now() - 5000 }] })).data.chats[0].title, 'Solar plans (edited on phone)', 'newer edit wins');
  await other('/chat/account', { action: 'create', username: 'ama2', passphrase: 'another long passphrase' }); assert.equal((await other('/chat/account', { action: 'chats', chats: [] })).data.chats.length, 0, 'users are isolated');
  await phone('/chat/account', { action: 'logout' }); assert.equal((await phone('/chat/account', { action: 'chats', chats: [] })).status, 401);
});

test('metadata survives as many node losses as 8+4 data: 5 metadata replicas once the network has 12+ members', async () => {
  let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < 14; i++) T.add('N' + i, 'd' + i);
  const E = id => new PreservationEngine({ self: id, transport: T, now: () => clock }); const A = E('N0'); await A.heartbeat(); assert.equal(A.metaN(), 5);
  const r = new AtomRegistry(), recs = [...r.manifests.values()].slice(0, 300).map(m => ({ id: m.id, rev: m.head, dna: r.revisions.get(m.head) }));
  await A.commit(recs); const id = recs[42].id, home = A.place('meta:' + bucketOf(id), 5);
  for (const h of home.slice(0, 3).filter(h => h !== 'N13')) T.kill(h); clock += 120000;
  const B = E('N13'); await B.heartbeat(); assert.equal((await B.getAtom(id)).rev, recs[42].rev, 'index still readable with 3 of 5 home replicas gone');
});
