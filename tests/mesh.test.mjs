import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ensureIdentity, signHeaders, verifySigned, fingerprintOf } from '../lib/mesh.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = 'mesh-test-admin-token-1234567890-abcdefgh';
test('node identity signatures: bound to one key, tamper- and replay-proof', () => {
  const a = ensureIdentity({}), b = ensureIdentity({}), seen = new Map();
  assert.notEqual(a.fingerprint, b.fingerprint); assert.equal(fingerprintOf(a.publicKey), a.fingerprint);
  const h = signHeaders(a, 'GET', '/atp/snapshot', '');
  assert.equal(verifySigned(h, 'GET', '/atp/snapshot', '', seen).fingerprint, a.fingerprint);
  assert.equal(verifySigned(h, 'GET', '/atp/snapshot', '', seen), null, 'replay rejected');
  assert.equal(verifySigned(signHeaders(a, 'GET', '/x', ''), 'GET', '/y', ''), null, 'path bound');
  assert.equal(verifySigned({ ...signHeaders(a, 'GET', '/x', ''), 'x-atp-key': b.publicKey }, 'GET', '/x', ''), null, 'key swap rejected');
});

async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(name, p, seeds = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-mesh-')), origin = `http://127.0.0.1:${p}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', RENDER: '', PORT: String(p), NODE_ID: name, DATA_DIR: dir, ADMIN_TOKEN: admin, NETWORK_SECRET: '', PEER_URLS: '', ALLOW_LOCAL_PEERS: 'true', PUBLIC_URL: origin, KENUXA_NETWORK: 'on', KENUXA_BUNDLED_SEEDS: 'false', KENUXA_DIRECTORY: 'off', KENUXA_SEEDS: seeds, MESH_FIRST_CONTACT_MS: '600000', EVOLUTION_INTERVAL_SECONDS: '3600', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '' } });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(out); try { if ((await fetch(origin + '/health')).ok) return { child, origin }; } catch {} await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('startup timeout ' + out);
}
const api = async (n, url, body) => (await fetch(n.origin + '/api/' + url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();

test('online nodes join the network with no secret or peer list, find each other by gossip, share and confirm knowledge', { timeout: 90000 }, async () => {
  const ports = [await port(), await port(), await port(), await port()]; const nodes = [];
  try {
    const A = await start('alpha', ports[0]); nodes.push(A);
    const B = await start('beta', ports[1], A.origin); nodes.push(B);
    const C = await start('gamma', ports[2], B.origin); nodes.push(C);
    const lesson = { title: 'What is the Kenuxa lighthouse?', answer: 'The Kenuxa lighthouse is a public teaching beacon for the network.', questions: ['kenuxa lighthouse'], tags: ['beacon'], visibility: 'public' };
    await api(A, 'lessons', lesson); await api(B, 'lessons', lesson);
    assert.equal((await (await fetch(A.origin + '/atp/snapshot')).json()).error, 'Sign ATP requests with your node key');
    await api(B, 'sync', {});                        // B bootstraps from A and says hello
    await api(C, 'sync', {});                        // C bootstraps from B, learns A by gossip
    await api(C, 'sync', {});                        // C now exchanges with A and B
    const netA = await api(A, 'network'), netC = await api(C, 'network');
    assert.ok(netA.mesh.peers.some(p => p.url === B.origin), 'A learned B from its hello');
    assert.ok(netC.mesh.peers.some(p => p.url === A.origin), 'C learned A by gossip');
    const got = (await api(C, 'knowledge')).atoms.find(a => a.title === lesson.title);
    assert.ok(got, 'knowledge spread to C'); assert.equal(got.status, 'approved', 'two independent nodes → network consensus'); assert.equal(got.dna.trust.status, 'network-consensus');
    // A brand-new node asks a question it has never learned: the network answers.
    const D = await start('delta', ports[3], A.origin); nodes.push(D); await api(D, 'sync', {});
    const r = await (await fetch(D.origin + '/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What is the Kenuxa lighthouse?' }) })).json();
    assert.match(r.answer, /teaching beacon/);
  } finally { for (const n of nodes) if (n.child.exitCode === null) { const d = new Promise(r => n.child.once('exit', r)); n.child.kill(); await d; } }
});

test('hosted nodes are on the network by default; a node on your own machine stays private', async () => {
  const { createNode } = await import('../lib/node.mjs');
  const base = { CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', SUPABASE_URL: '', KENUXA_BUNDLED_SEEDS: 'true' };
  const hosted = await createNode({ env: { ...base, RENDER: 'true', HOST: '0.0.0.0', ADMIN_TOKEN: admin, RENDER_EXTERNAL_URL: 'https://example-node.onrender.com', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-h-')) }, log: () => {} });
  assert.equal(hosted.mesh.enabled, true); assert.ok(hosted.mesh.seeds.includes('https://kenuxa-internet.onrender.com')); assert.equal(hosted.mesh.publicUrl, 'https://example-node.onrender.com');
  const local = await createNode({ env: { ...base, HOST: '127.0.0.1', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-l-')) }, log: () => {} });
  assert.equal(local.mesh.enabled, false);
});

test('ATP/1.0 migration: legacy MTP/0.5 nodes still interoperate in both directions', async () => {
  const { Mesh, MESH_PROTOCOL } = await import('../lib/mesh.mjs'); assert.equal(MESH_PROTOCOL, 'ATP/1.0');
  const me = ensureIdentity({}), old = ensureIdentity({});
  // 1 · a legacy node signs only x-mtp-* headers over a /mtp/ path — a v1 verifier still accepts it
  const legacy = Object.fromEntries(Object.entries(signHeaders(old, 'GET', '/mtp/ping', '')).filter(([k]) => k.startsWith('x-mtp-')));
  assert.equal(verifySigned(legacy, 'GET', '/mtp/ping', '').fingerprint, old.fingerprint);
  // 2 · ATP headers win when present, so a swapped legacy key cannot bypass the check
  assert.equal(verifySigned({ ...signHeaders(me, 'GET', '/atp/ping', ''), 'x-mtp-key': old.publicKey }, 'GET', '/atp/ping', '').fingerprint, me.fingerprint);
  // 3 · calling an old node: /atp/ returns 404, the client retries the legacy /mtp/ path and verifies its signed reply
  const seenPaths = []; const request = async (url, { method, headers }) => { const p = new URL(url).pathname; seenPaths.push(p); if (p.startsWith('/atp/')) return { status: 404, headers: {}, text: '{"error":"Route not found"}' };
    assert.ok(headers['x-mtp-sig'], 'legacy mirror headers are sent'); const body = JSON.stringify({ ok: true }); return { status: 200, headers: signHeaders(old, 'RESPONSE', p, body), text: body }; };
  const mesh = new Mesh({ state: {}, identity: me, name: 'n', publicUrl: 'https://me.example', platform: 'test', enabled: true, request, shareable: () => [], findForQuery: () => [], importAtom: () => {} });
  const res = await mesh.call('https://old.example', 'GET', '/atp/ping'); assert.deepEqual(seenPaths, ['/atp/ping', '/mtp/ping']);
  assert.equal(mesh.verifyResponse(res, '/atp/ping', old.fingerprint).who.fingerprint, old.fingerprint);
});
