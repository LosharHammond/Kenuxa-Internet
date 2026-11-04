// KUNPP benchmark: does delegating public-atom validation to volunteer peers reduce core-node CPU?
// Scenario A: the core validates everything itself. Scenario B: honest peers do it (default verification policy).
// Scenario C: mixed — peers that drop 20% of their tasks plus one malicious peer.
// Peers run in this same process; only the CORE's work (task creation, payload building and serialisation, result
// verification, arbitration, fallback) is counted, by measuring process CPU around the core's own calls.
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { RELATIONS, DNA_SCHEMA, ATOM_TYPES, VALIDATION } from '../lib/atoms/schema.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { runTask, TASK_KINDS } from '../lib/peers/tasks.mjs';
import { gzipSync } from 'node:zlib';

const rules = { schema: DNA_SCHEMA, types: ATOM_TYPES, validation: VALIDATION, relations: Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, { from: v.from, to: v.to }])) };
const cpu = () => { const u = process.cpuUsage(); return u.user + u.system; };
function registry(extra = 3000) { const r = new AtomRegistry(); for (let i = 0; i < extra; i++) r.discover('benchword' + i.toString(36), { lang: 'en', node: 'bench', context: 'benchmark corpus' }); return r; }

async function scenarioA(r) {
  const n = new ComputeNetwork({ state: {}, registry: r, rules, options: { maxQueue: 1e6, batch: 120 } }); n.fill();
  const t0 = cpu(), w0 = performance.now(); const out = await n.coreTick({ budgetMs: 1e9 }); const us = cpu() - t0;
  return { name: 'A · core does everything', atoms: n.S.metrics.coreAtoms, coreCpuMs: +(us / 1000).toFixed(1), coreUsPerAtom: +(us / n.S.metrics.coreAtoms).toFixed(1), wallMs: Math.round(performance.now() - w0), tasks: out.ran };
}
async function scenarioPeers(r, { name, peers = 8, dropRate = 0, evil = 0, replicate = 0.25, spotCheck = 0.1, p2p = false, mix }) {
  let t = 1e9; const n = new ComputeNetwork({ state: {}, registry: r, rules, now: () => t, options: { maxQueue: 1e6, batch: 120, replicate, spotCheck, registrationsPerIpHour: 1e6, powBits: 0, p2p, ...(mix ? { mix } : {}) } });
  let wire = 0, gz = 0; const kinds = {};
  const c0 = cpu(); n.fill(); let coreUs = cpu() - c0;
  const ps = Array.from({ length: peers }, (_, i) => ({ ...n.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: true, subtleCrypto: true, cores: 4 }, profile: 'balanced', ipKey: 'net' + i }), evil: i < evil }));
  let rounds = 0;
  while (rounds++ < 100000) {
    t += 2100; let leased = 0;
    for (const pr of ps) {
      if (pr.revoked) continue; const a = cpu(); let p; try { p = n.auth(pr.peerId, pr.token); } catch { pr.revoked = true; coreUs += cpu() - a; continue; } const l = n.lease(p); coreUs += cpu() - a; if (!l.task) continue; leased++;
      const raw = JSON.stringify(l.task); wire += raw.length; gz += gzipSync(raw).length; kinds[l.task.kind] = (kinds[l.task.kind] || 0) + 1; /* what the lease costs on the wire, before and after gzip */
      const payload = JSON.parse(JSON.stringify(l.task.payload)); /* P2P is off here (in-process peers have no DataChannel); it is measured in real browsers by tests/browser/p2p-failover.e2e.cjs */
      if (Math.random() < dropRate) continue; // took the task and disappeared
      let res = await runTask(l.task.kind, payload); if (pr.evil) res = { ...res, issues: [], digest: '0'.repeat(64) };
      const b = cpu(); await n.submit(p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: JSON.parse(JSON.stringify(res)) }); coreUs += cpu() - b;
    }
    if (!leased) { t += 61000; const c = cpu(); n.expire(); await n.coreTick({ budgetMs: 1e9 }); coreUs += cpu() - c; if (!n.S.queue.some(id => ['queued', 'awaiting-replica', 'leased'].includes(n.S.tasks[id]?.state))) break; }
  }
  const m = n.S.metrics, atoms = r.manifests.size;
  return { name, peers, atoms, coreCpuMs: +(coreUs / 1000).toFixed(1), coreUsPerAtom: +(coreUs / atoms).toFixed(1), accepted: m.accepted, rejected: m.rejected, replicated: m.replicated, spotChecks: m.spotChecks, arbitrations: m.arbitrations, expired: m.expired, coreFallbackTasks: m.coreFallback, mbSent: +(m.bytesOut / 1e6).toFixed(2), kbReceived: Math.round(m.bytesIn / 1024), offloadWorthwhile: n.offloadWorthwhile(), leaseMB: +(wire / 1e6).toFixed(2), leaseMBgzip: +(gz / 1e6).toFixed(2), byKind: kinds };
}
const r = registry();
const A = await scenarioA(r);
const B = await scenarioPeers(r, { name: 'B · 8 honest peers (default: 25% replicas, 10% spot-checks, new peers replicated)' });
const B2 = await scenarioPeers(r, { name: 'B2 · 8 honest peers, trusted steady state (5% spot-checks, no replicas)', replicate: 0, spotCheck: 0.05 });
const C = await scenarioPeers(r, { name: 'C · mixed: 8 peers, 20% drop their task, 1 malicious', dropRate: 0.2, evil: 1 });
const D = await scenarioPeers(r, { name: 'D · 8 honest peers, v1 workload only (atom-validate), for comparison with v1', mix: { 'atom-validate/1': 1 } });
const rows = [A, B, B2, C, D];
for (const x of rows) x.coreReductionVsA = x === A ? '—' : `${Math.round(100 * (1 - x.coreCpuMs / A.coreCpuMs))}%`;
console.log(JSON.stringify(rows, null, 2));
// Extrapolation (labelled): core CPU needed per day to audit the whole registry once per hour, by scenario.
const atomsPerDay = r.manifests.size * 24;
console.log('\nExtrapolation from the measured per-atom costs (one full audit per hour):');
for (const x of rows) console.log(`  ${x.name.split(' · ')[0]}: ${((x.coreUsPerAtom * atomsPerDay) / 1e6).toFixed(1)} core-CPU seconds/day for ${atomsPerDay.toLocaleString()} atom checks`);
