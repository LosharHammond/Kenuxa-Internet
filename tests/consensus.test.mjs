// v1.4.2 — network agreement on live updates, across real server processes (signed ATP, local validation on each node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { tally } from '../lib/live/consensus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = 'consensus-test-admin-token-1234567890-abc';
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(name, p, seeds = '', extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-cons-')), origin = `http://127.0.0.1:${p}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', RENDER: '', PORT: String(p), NODE_ID: name, DATA_DIR: dir, ADMIN_TOKEN: admin, NETWORK_SECRET: '', PEER_URLS: '', ALLOW_LOCAL_PEERS: 'true', PUBLIC_URL: origin, KENUXA_NETWORK: 'on', KENUXA_BUNDLED_SEEDS: 'false', KENUXA_DIRECTORY: 'off', KENUXA_SEEDS: seeds, MESH_FIRST_CONTACT_MS: '600000', EVOLUTION_INTERVAL_SECONDS: '3600', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', ...extra } });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(out); try { if ((await fetch(origin + '/health')).ok) return { child, origin, out: () => out }; } catch {} await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('startup timeout ' + out);
}
const api = async (n, url, body) => (await fetch(n.origin + '/api/' + url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();
const senseOf = (o, w) => { for (const c of o.clauses || []) { if (c.semantics?.predicate === w && c.semantics.predicateSense) return c.semantics.predicateSense; for (const v of Object.values(c.semantics?.roles || {})) if (v?.head === w && v.sense?.sense) return v.sense.sense; } return null; };
const AIR = { word: 'bank', pos: 'verb', gloss: 'to tilt an aircraft to one side while turning', hypernym: 'tilt', domain: 'aviation', signals: ['pilot', 'plane', 'aircraft', 'wing', 'turn', 'runway'], evidence: [{ publisher: 'aviation glossary', passage: 'To bank is to tilt the aircraft; the pilot banks the plane to turn.' }] };

test('tally: quorum of independent local validations; conflicts and rejections are visible; unreachable stays pending', () => {
  assert.equal(tally([]).status, 'local-only');
  assert.equal(tally([{ vote: 'accept' }, { vote: 'accept' }]).status, 'agreed');
  assert.equal(tally([{ vote: 'accept' }, { vote: 'reject' }, { vote: 'reject' }]).status, 'pending', 'one accept + origin vs two rejects: no quorum either way');
  assert.equal(tally([{ vote: 'reject' }, { vote: 'reject' }, { vote: 'reject' }]).status, 'contested');
  assert.equal(tally([{ vote: 'accept' }, { vote: 'conflict' }]).status, 'contested');
  assert.equal(tally([{ vote: 'unreachable' }, { vote: 'unreachable' }]).status, 'pending');
});

test('three real nodes: a validated sense taught on one node is re-validated and activated by the others; a conflicting meaning is contested', { timeout: 120000 }, async () => {
  const ports = [await port(), await port(), await port()], nodes = [];
  try {
    const A = await start('alpha', ports[0]); nodes.push(A);
    const B = await start('beta', ports[1], A.origin); nodes.push(B);
    const C = await start('gamma', ports[2], B.origin, { LIVE_ADOPT: 'off' }); nodes.push(C);
    await api(B, 'sync', {}); await api(C, 'sync', {}); await api(C, 'sync', {}); await api(A, 'sync', {});
    const Q = 'The pilot will bank the plane over the runway.';
    assert.equal(senseOf(await api(B, 'interpret', { text: Q }), 'bank'), null, 'beta does not know the verb sense yet');
    const t = await api(A, 'live/sense', AIR); assert.equal(t.event.state, 'active');
    assert.equal(t.event.network.status, 'agreed', JSON.stringify(t.event.network)); assert.ok(t.event.network.accept >= 1);
    const votes = t.event.network.votes; assert.ok(votes.some(v => v.localState === 'active'), 'beta adopted it after its own validation'); assert.ok(votes.some(v => v.localState === 'not-adopted'), 'gamma validated but does not adopt (LIVE_ADOPT=off)');
    assert.equal(senseOf(await api(B, 'interpret', { text: Q }), 'bank'), 'sense:en:bank#aviation', 'beta now uses it — no restart');
    assert.equal(senseOf(await api(C, 'interpret', { text: Q }), 'bank'), null, 'gamma kept its local decision');
    const evB = (await api(B, 'live/events')).events.find(e => e.kind === 'new-sense'); assert.match(evB.source, /^peer:/); assert.deepEqual(evB.history.map(h => h.state).slice(-4), ['validated', 'committed', 'indexed', 'active']);
    // a different meaning under the same identity → conflict, recorded, not overwritten
    const other = await api(B, 'live/sense', { ...AIR, gloss: 'to store cash in a financial institution for later use', signals: ['money', 'cash', 'deposit', 'account'], evidence: [{ publisher: 'finance glossary', passage: 'To bank money is to deposit cash in an account.' }] });
    assert.notEqual(other.event.state, 'active', 'beta itself refuses: its own aviation sense already uses that id');
    const bad = await api(C, 'live/sense', { word: 'bank', pos: 'verb', gloss: 'to keep money safe in an account at a bank', hypernym: 'deposit', domain: 'aviation', signals: ['money', 'account', 'savings'], evidence: [{ publisher: 'money glossary', passage: 'People bank their wages in a savings account.' }] });
    assert.equal(bad.event.state, 'active', 'gamma (which never adopted) accepts its own validated meaning locally');
    assert.equal(bad.event.network.status, 'contested', JSON.stringify(bad.event.network)); assert.ok(bad.event.network.votes.some(v => v.vote === 'conflict' && /different meaning/.test(v.reasons.join(' '))));
    assert.equal(senseOf(await api(A, 'interpret', { text: Q }), 'bank'), 'sense:en:bank#aviation', 'the origin did not overwrite its meaning');
    const st = await api(A, 'live/status'); assert.ok(st.network.agreed >= 1);
  } finally { for (const n of nodes) if (n.child.exitCode === null) { const d = new Promise(r => n.child.once('exit', r)); n.child.kill(); await d; } }
});
