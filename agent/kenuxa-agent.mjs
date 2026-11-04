#!/usr/bin/env node
// KENUXA volunteer agent (KUNPP Type C dedicated node / Type D specialised node).
// An installed, long-running participant: larger batches, longer leases, optional durable storage of PUBLIC atom
// revisions (content-addressed, proven by fresh challenges) and optional specialised capabilities that the
// coordinator verifies with probe tasks before using them. It runs only the shared task vocabulary
// (lib/peers/tasks.mjs) plus three storage operations defined here. It never receives private data.
//
//   node agent/kenuxa-agent.mjs --coordinator https://your-node.onrender.com --consent \
//        [--storage-dir ./kenuxa-store --storage-mb 512] [--specialized symbolic-reasoning] [--duration 600]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runTask, storageProof, sha256hex, encodeCanonical } from '../lib/peers/tasks.mjs';

export function solvePow({ challenge, bits }) { for (let n = 0; ; n++) { const h = createHash('sha256').update(`${challenge}:${n}`).digest('hex'); let z = 0; for (const ch of h) { const v = parseInt(ch, 16); if (v === 0) { z += 4; continue; } z += Math.clz32(v) - 28; break; } if (z >= bits) return { challenge, nonce: String(n) }; } }

export class Agent {
  constructor({ coordinators, consent = false, storageDir = null, storageMB = 0, specialized = [], log = console.log, fetchImpl = fetch, cores = 4 }) {
    if (consent !== true) throw new Error('the agent only runs with explicit consent (--consent)');
    Object.assign(this, { coordinators: [...new Set(coordinators)], storageDir, storageMB: storageDir ? storageMB : 0, specialized, log, fetch: fetchImpl, cores });
    this.at = 0; this.peer = null; this.stop = false; this.failures = 0; this.stats = { tasks: 0, accepted: 0, rejected: 0, stored: 0, proofs: 0, restored: 0, failovers: 0 };
    if (storageDir) fs.mkdirSync(storageDir, { recursive: true });
  }
  get origin() { return this.coordinators[this.at % this.coordinators.length]; }
  async call(p, body, method = 'POST') {
    const headers = { 'Content-Type': 'application/json' }; if (this.peer) { headers['x-kunpp-peer'] = this.peer.peerId; headers['x-kunpp-token'] = this.peer.token; }
    const r = await this.fetch(this.origin + p, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}), signal: AbortSignal.timeout(20000) });
    const data = await r.json(); if (!r.ok) throw Object.assign(new Error(data.error || 'HTTP ' + r.status), { status: r.status }); return data;
  }
  async register() {
    const proto = await this.call('/peer/protocol', null, 'GET'); for (const c of proto.coordinators || []) if (!this.coordinators.includes(c)) this.coordinators.push(c); // discovery of fallback coordinators
    const pow = proto.powBits ? solvePow(await this.call('/peer/challenge', null, 'GET')) : null;
    this.peer = await this.call('/peer/register', { consent: true, consentVersion: 'compute-consent/1', profile: 'dedicated', pow, capabilities: { workers: true, subtleCrypto: true, wasm: true, cores: this.cores, agent: 'node', storageMB: this.storageMB, specialized: this.specialized } });
    this.log(`registered at ${this.origin} as ${this.peer.peerId} (${this.peer.profile})`); return this.peer;
  }
  usedMB() { if (!this.storageDir) return 0; let b = 0; for (const f of fs.readdirSync(this.storageDir)) b += fs.statSync(path.join(this.storageDir, f)).size; return b / 1e6; }
  file(head) { if (!/^[0-9a-f]{64}$/.test(head)) throw new Error('bad head'); return path.join(this.storageDir, head + '.json'); }
  async storage(task) {
    const pl = task.payload;
    if (task.kind === 'replicate/1') { const stored = []; for (const a of pl.atoms) { if (this.usedMB() > this.storageMB) break; if ((await sha256hex(encodeCanonical(a.dna))) !== a.head) continue; fs.writeFileSync(this.file(a.head), JSON.stringify(a.dna)); stored.push(a.head); } this.stats.stored += stored.length; return { kind: task.kind, stored }; }
    if (task.kind === 'storage-proof/1') { const proofs = {}; for (const c of pl.challenges) { try { proofs[c.head] = await storageProof(JSON.parse(fs.readFileSync(this.file(c.head), 'utf8')), c.nonce); } catch { /* not held */ } } this.stats.proofs++; return { kind: task.kind, proofs }; }
    if (task.kind === 'restore/1') { const atoms = []; for (const h of pl.heads) { try { atoms.push({ head: h, dna: JSON.parse(fs.readFileSync(this.file(h), 'utf8')) }); } catch { /* not held */ } } this.stats.restored += atoms.length; return { kind: task.kind, atoms }; }
    throw new Error('unknown storage task');
  }
  async step() {
    if (!this.peer) await this.register();
    const l = await this.call('/peer/lease', {}); if (!l.task) return { idle: true, wait: Math.min(l.retryAfterMs || 5000, 30000), reason: l.reason };
    const t = l.task, result = ['replicate/1', 'storage-proof/1', 'restore/1'].includes(t.kind) ? await this.storage(t) : await runTask(t.kind, t.payload, { deadline: Date.now() + (t.budgetMs || 60000) });
    const r = await this.call('/peer/result', { leaseId: t.leaseId, taskId: t.taskId, result }); this.stats.tasks++; if (r.status === 'accepted') this.stats.accepted++; if (r.status === 'rejected') this.stats.rejected++;
    return { idle: false, wait: this.peer.limits?.minIntervalMs || 500, kind: t.kind, status: r.status, why: r.why || r.reason };
  }
  async run({ durationMs = Infinity, onStep = () => {} } = {}) {
    const end = Date.now() + durationMs;
    while (!this.stop && Date.now() < end) {
      try { const s = await this.step(); this.failures = 0; onStep(s); await new Promise(r => setTimeout(r, Math.max(0, Math.min(s.wait, end - Date.now())))); }
      catch (e) {
        if (e.status === 401) this.peer = null; // revoked or coordinator forgot us: register again
        else if (++this.failures >= 2 && this.coordinators.length > 1) { this.at++; this.peer = null; this.failures = 0; this.stats.failovers++; this.log(`coordinator unreachable (${e.message}); failing over to ${this.origin}`); }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (this.peer) try { await this.call('/peer/leave', {}); } catch { /* offline */ }
    return this.stats;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
  const a = new Agent({ coordinators: String(arg('coordinator', '')).split(',').filter(Boolean), consent: arg('consent') === true, storageDir: arg('storage-dir'), storageMB: Number(arg('storage-mb', 256)), specialized: arg('specialized') ? String(arg('specialized')).split(',') : [] });
  process.on('SIGINT', () => { a.stop = true; });
  a.run({ durationMs: arg('duration') ? Number(arg('duration')) * 1000 : Infinity, onStep: s => { if (!s.idle) console.log(`${s.kind}: ${s.status}${s.why ? ' — ' + s.why : ''}`); } }).then(st => console.log('stopped', JSON.stringify(st)));
}
