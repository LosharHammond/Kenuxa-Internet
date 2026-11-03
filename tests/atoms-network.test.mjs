// Test G on real node processes: node A creates atoms, commits them across the open mesh, then is
// killed; another node retrieves them over signed MTP without A.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), admin = 'atoms-net-admin-token-1234567890-abcdefgh';
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(name, p, seeds = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenuxa-atomnet-')), origin = `http://127.0.0.1:${p}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', RENDER: '', PORT: String(p), NODE_ID: name, DATA_DIR: dir, ADMIN_TOKEN: admin, NETWORK_SECRET: '', PEER_URLS: '', ALLOW_LOCAL_PEERS: 'true', PUBLIC_URL: origin, KENUXA_NETWORK: 'on', KENUXA_BUNDLED_SEEDS: 'false', KENUXA_DIRECTORY: 'off', KENUXA_SEEDS: seeds, MESH_FIRST_CONTACT_MS: '600000', EVOLUTION_INTERVAL_SECONDS: '3600', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '' } });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(out); try { if ((await fetch(origin + '/health')).ok) return { child, origin, name }; } catch {} await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('startup timeout ' + out);
}
const api = async (n, url, body) => (await fetch(n.origin + '/api/' + url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();

test('G (real processes) · atoms committed by node A survive A being killed', { timeout: 120000 }, async () => {
  const nodes = [];
  try {
    const A = await start('alpha', await port()); nodes.push(A);
    for (const name of ['beta', 'gamma', 'delta', 'epsilon', 'zeta']) nodes.push(await start(name, await port(), A.origin));
    for (const n of nodes.slice(1)) await api(n, 'sync', {});   // everyone introduces themselves to A
    for (const n of nodes) await api(n, 'sync', {});            // …and learns the rest by gossip
    const o = await api(A, 'interpret', { text: 'The zibberfloop quorbled near the vantoozle.' });
    assert.ok(o.atoms.discovered.includes('lex:en:zibberfloop'));
    const p = await api(A, 'preserve', {}); assert.ok(p.members >= 5, JSON.stringify(p)); assert.ok(p.commits.some(c => c.durability === 'COMMITTED'), JSON.stringify(p));
    const local = await api(A, 'lexicon/atom?id=' + encodeURIComponent('lex:en:zibberfloop')); assert.equal(local.manifest.durability, 'COMMITTED');
    const D = nodes[3]; assert.equal((await api(D, 'lexicon/atom?id=' + encodeURIComponent('lex:en:zibberfloop'))).error, 'Atom not found'); // D never saw the word
    await new Promise(r => { A.child.once('exit', r); A.child.kill('SIGKILL'); }); // sudden failure, no shutdown
    const got = await api(D, 'atoms/fetch', { id: 'lex:en:zibberfloop', network: true });
    assert.equal(got.source, 'network'); assert.equal(got.dna.identity.canonical, 'zibberfloop'); assert.equal(got.dna.semantic.meaningStatus, 'unknown');
    const got2 = await api(nodes[5], 'atoms/fetch', { id: 'lex:en:vantoozle', network: true }); assert.equal(got2.source, 'network', JSON.stringify({ got2, p }).slice(0, 1500));
  } finally { for (const n of nodes) if (n.child.exitCode === null && n.child.signalCode === null) { const d = new Promise(r => n.child.once('exit', r)); n.child.kill(); await d; } }
});
