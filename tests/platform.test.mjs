import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { SupabaseStore, uuidFrom } from '../lib/store.mjs';
import { seeds } from '../lib/seed.mjs';
import { hydrateAtom, rebuildOrganism, lifecycle } from '../lib/organism.mjs';
import { createNode, detectPlatform, detectPublicUrl } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = 'platform-test-admin-token-123456789012345', secret = 'platform-test-network-secret-12345678901234';
const ENTITY_TYPES = ['Knowledge', 'Capability', 'Agent', 'Organization', 'Person', 'Location', 'Document', 'Media', 'Goal', 'Action', 'Event', 'Concept', 'Custom'];
const REL_TYPES = ['LIVES_IN', 'REQUIRES', 'HANDLED_BY', 'USES', 'CAN_EXECUTE', 'BELONGS_TO', 'CREATED_BY', 'CONNECTED_TO', 'DEPENDS_ON', 'ENABLES', 'PART_OF', 'SIMILAR_TO', 'OPPOSES', 'PRODUCES', 'CONSUMES', 'GOVERNS', 'OWNED_BY', 'REFERENCES', 'LEADS_TO', 'CUSTOM'];
const baseEnv = { HOST: '127.0.0.1', RENDER: '', VERCEL: '', NETLIFY: '', RAILWAY_ENVIRONMENT: '', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' };

test('Supabase store mirrors the graph into the original v1.1 tables within their CHECK constraints', async () => {
  const calls = [], db = new Map();
  const fetcher = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const table = new URL(url).pathname.split('/').pop();
    if ((opts.method || 'GET') === 'POST') { db.set(table, [...(db.get(table) || []), ...JSON.parse(opts.body)]); return new Response('', { status: 201 }); }
    if (table === 'kenuxa_node_state') return new Response(JSON.stringify((db.get(table) || []).slice(-1).map(r => ({ state: r.state }))), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const store = new SupabaseStore({ url: 'https://abcdefghijklmnop.supabase.co', key: 'sb_secret_test_key_value_123456', nodeId: 'node-x', fetcher });
  const state = { atoms: seeds().map(hydrateAtom), outcomes: [{ id: 'o1', type: 'answer', detail: 'x', at: new Date().toISOString() }], memory: [{ id: 'm1', question: 'q', answer: 'a', at: new Date().toISOString() }], formations: { molecules: [], cells: [] } };
  state.atoms[0].dna.evidence.push({ id: 'evidence:1', url: 'https://en.wikipedia.org/wiki/Accra', quote: 'Accra is the capital.', retrievedAt: new Date().toISOString() });
  rebuildOrganism(state); await store.save(state);
  assert.equal(store.status().mirror.error, null, store.status().mirror.error);
  for (const e of db.get('entities')) { assert.ok(ENTITY_TYPES.includes(e.type), e.type); assert.ok(e.sge_uri); assert.equal(e.node_id, 'node-x'); }
  assert.equal(new Set(db.get('entities').map(e => e.sge_uri)).size, db.get('entities').length);
  for (const r of db.get('relationships') || []) { assert.ok(REL_TYPES.includes(r.type), r.type); assert.ok(r.weight >= 0 && r.weight <= 1); }
  assert.ok(db.get('attachments').every(a => a.category === 'Evidence'));
  assert.ok(db.get('agents').some(a => a.kind === 'expert') && db.get('agents').some(a => a.level === 'advanced'));
  assert.ok(calls.some(c => c.url.includes('relationships?on_conflict=source_id,target_id,type')));
  assert.ok(db.get('memory_logs').length && db.get('resolutions').length && db.get('outcomes').length);
  const before = calls.length; await store.save(state); // unchanged entities are not re-sent
  assert.ok(!calls.slice(before).some(c => c.url.includes('/entities')));
  assert.equal((await store.load()).atoms.length, state.atoms.length);
  assert.match(uuidFrom('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('4-stage life cycle: local → shared → verified → global', () => {
  const a = hydrateAtom({ ...seeds()[0], visibility: 'private', origin: 'n1' }); assert.equal(lifecycle(a), 'local');
  a.visibility = 'public'; assert.equal(lifecycle(a), 'shared');
  a.dna.evidence.push({ url: 'https://a.example/x' }, { url: 'https://b.example/y' }); assert.equal(lifecycle(a), 'verified');
  a.dna.network.confirmations = ['n2', 'n3']; assert.equal(lifecycle(a), 'global'); assert.ok(a.dna.trust.score > 0.5);
  a.dna.trust.contradictions.push({ reason: 'x' }); assert.equal(lifecycle(a), 'shared');
});

test('platform detection and public URL inference for Render, Railway, Vercel, Netlify', () => {
  assert.equal(detectPlatform({ RENDER: 'true' }), 'render'); assert.equal(detectPlatform({ RAILWAY_ENVIRONMENT: 'production' }), 'railway');
  assert.equal(detectPlatform({ VERCEL: '1' }), 'vercel'); assert.equal(detectPlatform({ NETLIFY: 'true' }), 'netlify');
  assert.equal(detectPublicUrl({ RAILWAY_PUBLIC_DOMAIN: 'kx.up.railway.app' }), 'https://kx.up.railway.app');
  assert.equal(detectPublicUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'kx.vercel.app' }), 'https://kx.vercel.app');
  assert.equal(detectPublicUrl({ URL: 'https://kx.netlify.app' }), 'https://kx.netlify.app');
});

test('serverless node (Netlify/Vercel style): 7-part answers, cron-driven evolution, durable flush', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-sls-'));
  const node = await createNode({ env: { ...baseEnv, NODE_ID: 'sls-node', ADMIN_TOKEN: admin, DATA_DIR: dir, CRON_SECRET: 'cron-secret-value-123456' }, serverless: true, log: () => {} });
  const call = (p, init = {}) => webRequest(node, new Request('https://sls.example' + p, init), '203.0.113.9');
  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/api/status')).status, 401);
  const res = await call('/api/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What is the capital of Ghana?' }) });
  const a = await res.json(); assert.equal(res.status, 200, JSON.stringify(a));
  assert.equal(a.format, 'kenuxa-response/7'); assert.deepEqual(Object.keys(a.sections), ['directAnswer', 'meaningGraph', 'outcomes', 'capabilities', 'actions', 'evidence', 'evolution']);
  assert.match(a.sections.directAnswer.text, /Accra/); assert.ok(a.sections.meaningGraph.entities.length >= 1); assert.ok(a.sections.capabilities.length >= 1);
  assert.equal(a.sections.directAnswer.transformerDraft.available, false); // untrained transformer never pretends
  assert.equal((await call('/cron/tick')).status, 401);
  const tick = await (await call('/cron/tick', { headers: { Authorization: 'Bearer cron-secret-value-123456' } })).json();
  assert.ok(tick.counts && tick.counts.approved > 0);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); assert.equal(saved.evolution.ticks, 1); assert.ok(saved.memory.length === 1);
  const t = await (await call('/api/transformer', { headers: { Authorization: 'Bearer ' + admin } })).json(); assert.equal(t.layers, 9); assert.equal(t.heads, 81);
});

async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(id, p, peers = '', overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-net-')), origin = `http://127.0.0.1:${p}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, ...baseEnv, PORT: String(p), NODE_ID: id, DATA_DIR: dir, ADMIN_TOKEN: admin, NETWORK_SECRET: secret, PEER_URLS: peers, ALLOW_LOCAL_PEERS: 'true', PUBLIC_URL: origin, EVOLUTION_INTERVAL_SECONDS: '3600', ...overrides } });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(out); try { if ((await fetch(origin + '/health')).ok) return { child, origin, output: () => out }; } catch {} await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('startup timeout ' + out);
}
const api = async (n, url, body) => (await fetch(n.origin + '/api/' + url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();

test('Render binds 0.0.0.0 on PORT despite a legacy loopback HOST, and requires admin access', async () => {
  const p = await port(); let n;
  try {
    n = await start('render-regression', p, '', { RENDER: 'true', HOST: '127.0.0.1' });
    assert.match(n.output(), new RegExp(`\\[render\\] at http://0\\.0\\.0\\.0:${p}`));
    assert.equal((await fetch(n.origin + '/health')).status, 200);
    assert.equal((await fetch(n.origin + '/api/status')).status, 401);
    assert.equal((await api(n, 'status')).nodeId, 'render-regression');
  } finally { if (n && n.child.exitCode === null) { const done = new Promise(r => n.child.once('exit', r)); n.child.kill(); await done; } }
});

test('three nodes on different "hosts" discover each other by hello + gossip and exchange atoms over MTP', { timeout: 60000 }, async () => {
  const [pa, pb, pc] = [await port(), await port(), await port()]; let A, B, C;
  try {
    A = await start('node-alpha', pa); B = await start('node-beta', pb, `http://127.0.0.1:${pa}`); C = await start('node-gamma', pc, `http://127.0.0.1:${pb}`);
    await api(A, 'lessons', { title: 'What is the Kenuxa lighthouse?', answer: 'A public teaching beacon.', questions: ['kenuxa lighthouse'], tags: ['beacon'], visibility: 'public' });
    await api(B, 'sync', {});                      // B says hello to A → A learns B
    const c = await api(C, 'sync', {});            // C says hello to B → learns A by gossip → pulls A directly
    assert.ok(c.peers.some(p => p.nodeId === 'node-alpha' && p.ok), JSON.stringify(c));
    const netA = await api(A, 'network'), netC = await api(C, 'network');
    assert.ok(netA.discovered.some(d => d.origin === B.origin)); assert.ok(netC.discovered.some(d => d.origin === A.origin));
    const k = await api(C, 'knowledge'), got = k.atoms.find(a => a.title === 'What is the Kenuxa lighthouse?');
    assert.equal(got.status, 'pending'); assert.equal(got.origin, 'node-alpha'); assert.deepEqual(got.dna.network.confirmations, ['node-alpha']);
  } finally { for (const n of [A, B, C]) if (n && n.child.exitCode === null) { const d = new Promise(r => n.child.once('exit', r)); n.child.kill(); await d; } }
});
