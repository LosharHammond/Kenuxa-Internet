// KENUXA Universal Evolution Engine (KUEE).
// Observe → Measure → Identify weakness → Propose → Simulate/Test → Verify → Approve → Deploy → Monitor → Refine or Roll back,
// for every evolvable part of the system. A change is a record; the risk tier of its target decides the validation:
//   low    — schema + invariants + evaluator must show it is not worse; auto-approved (if the evolution policy allows)
//   medium — as low, then a CANARY rollout (a deterministic fraction of decisions) with monitoring before full use
//   high   — as medium, plus explicit owner authorization; never auto-approved, never adopted from a peer automatically
// Invariants (lib/evolve/policies.mjs) are checked first and cannot be overridden by approval.
import { createHash } from 'node:crypto';
import { PolicyStore, SCHEMAS, validatePolicy } from './policies.mjs';

const h = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const frac = key => parseInt(h(String(key)).slice(0, 8), 16) / 0xffffffff;

export class EvolutionEngineUniversal {
  constructor({ state = {}, now = () => Date.now(), node = null, registry = null, audit = null } = {}) {
    this.audit = audit;
    this.S = state; this.S.records ||= []; this.S.monitors ||= {}; this.S.extensions ||= {}; this.now = now; this.node = node; this.registry = registry;
    this.policies = new PolicyStore({ state: (this.S.policyState ||= {}), now }); this.evaluators = {}; this.appliers = {}; this.extensions = {};
  }
  // evaluator(kind): (baselineValue, candidateValue) → { better: boolean, notWorse: boolean, baseline, candidate, detail }
  evaluator(kind, fn) { this.evaluators[kind] = fn; }
  // applier(kind): called when a version becomes active (wire the policy into the running subsystem)
  applier(kind, fn) { this.appliers[kind] = fn; }
  // extension point for non-policy evolvable things (e.g. new atom categories): { validate(value), apply(value) }
  extension(kind, ext) { this.extensions[kind] = ext; if (ext.replay !== false) for (const v of this.S.extensions[kind] || []) try { ext.apply(v); } catch {} } /* one-shot actions (key rotation) are not replayed on restart */
  componentOf(policy) { return [...(this.registry?.components.values() || [])].find(c => c.policy === policy)?.id || 'policy:' + policy; }
  record(id) { return this.S.records.find(r => r.id === id) || null; }
  log(r, step, detail) { const d = typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400); r.timeline.push({ at: this.now(), step, detail: d }); this.audit?.append('evolution:' + step, { change: r.id, kind: r.kind, target: r.target || null, risk: r.risk || null, status: r.status, detail: d.slice(0, 300) }); }

  propose({ kind, target, value, reason = '', source = 'owner', expected = '' }) {
    const id = 'chg_' + h([kind, target, value, this.now(), this.S.records.length]).slice(0, 16);
    const r = { id, kind, target, reason: String(reason).slice(0, 300), source, expected: String(expected).slice(0, 200), createdAt: this.now(), status: 'proposed', timeline: [], tests: [] };
    this.S.records.push(r); if (this.S.records.length > 500) this.S.records.splice(0, this.S.records.length - 500);
    if (kind === 'policy') {
      const schema = SCHEMAS[target]; if (!schema) return this.reject(r, 'unknown policy ' + target);
      r.risk = schema.risk; r.originalVersion = this.policies.version(target); r.component = 'policy:' + target;
      const val = validatePolicy(target, value); r.tests.push({ name: 'schema+invariants', passed: val.ok, issues: val.issues }); this.log(r, 'verify', val.ok ? 'schema and invariants hold' : val.issues);
      if (!val.ok) return this.reject(r, 'validation failed: ' + val.issues.join('; '));
      const st = this.policies.stage(target, value, { by: source }); r.proposedVersion = st.version;
      return this.test(r);
    }
    const ext = this.extensions[kind]; if (!ext) return this.reject(r, 'no extension point for ' + kind);
    r.risk = ext.risk || 'low'; r.component = kind; r.value = value; const v = ext.validate(value); r.tests.push({ name: 'extension validation', passed: v.ok, issues: v.issues || [] });
    if (!v.ok) return this.reject(r, (v.issues || []).join('; '));
    return this.approveIfAllowed(r);
  }
  // Simulate/Test: the target's evaluator compares the active version with the candidate
  test(r) {
    const ev = this.evaluators[r.target];
    if (ev) { const base = this.policies.valueOf(r.target, r.originalVersion), cand = this.policies.valueOf(r.target, r.proposedVersion); let res;
      try { res = ev(base, cand); } catch (e) { return this.reject(r, 'evaluation error: ' + e.message); }
      r.tests.push({ name: 'evaluation', passed: !!res.notWorse, ...res }); r.performanceImpact = res.detail || null; this.log(r, 'test', res);
      if (!res.notWorse) return this.reject(r, 'evaluation shows it is worse than the active version'); }
    else { r.tests.push({ name: 'evaluation', passed: true, note: 'no evaluator for this policy — validation only' }); this.log(r, 'test', 'no evaluator; validation only'); }
    r.securityImpact = r.target === 'security' || r.target === 'protocols' ? 'changes security-relevant behaviour; invariants checked' : 'none';
    return this.approveIfAllowed(r);
  }
  approveIfAllowed(r) {
    const evo = this.policies.get('evolution');
    if (r.risk === 'high') { r.status = 'awaiting-authorization'; this.log(r, 'approve', 'high risk: needs explicit owner authorization'); return r; }
    if (r.risk === 'low' && !evo.autoApproveLowRisk) { r.status = 'awaiting-authorization'; this.log(r, 'approve', 'auto-approval disabled by evolution policy'); return r; }
    return this.approve(r.id, { by: 'automatic (' + r.risk + ' risk, tests passed)' });
  }
  approve(id, { by, authorized = false } = {}) {
    const r = this.record(id); if (r?.status === 'canary' && authorized) { this.log(r, 'approve', `${by}: canary ended early, full deployment`); return this.activate(r); }
    if (!r || !['awaiting-authorization', 'proposed'].includes(r.status)) return r || null;
    if (r.risk === 'high' && !authorized) { this.log(r, 'approve', 'refused: high-risk approval requires an authenticated owner'); return r; }
    r.approval = { by, at: this.now() }; this.log(r, 'approve', by);
    return this.deploy(r);
  }
  // Deploy: medium risk → canary (a deterministic share of decisions uses the candidate); low/high → full after approval
  deploy(r) {
    if (r.kind !== 'policy') { const ext = this.extensions[r.kind]; ext.apply(r.value); (this.S.extensions[r.kind] ||= []).push(r.value); r.status = 'deployed'; r.deployment = { mode: 'full', at: this.now() }; this.log(r, 'deploy', 'extension applied'); return r; }
    const evo = this.policies.get('evolution');
    if (r.risk === 'medium') { this.S.monitors[r.target] = { record: r.id, candidate: r.proposedVersion, baseline: r.originalVersion, fraction: evo.canaryFraction, obs: { candidate: { n: 0, bad: 0 }, baseline: { n: 0, bad: 0 } }, window: evo.monitorWindow, maxRegression: evo.maxRegressionRate };
      r.status = 'canary'; r.deployment = { mode: 'canary', fraction: evo.canaryFraction, at: this.now() }; this.log(r, 'deploy', `canary for ${Math.round(evo.canaryFraction * 100)}% of decisions`); return r; }
    return this.activate(r);
  }
  activate(r) { this.policies.activate(r.target, r.proposedVersion); delete this.S.monitors[r.target]; r.status = 'deployed'; r.deployment = { ...(r.deployment || {}), mode: 'full', at: this.now() }; r.rollbackRef = { kind: r.target, version: r.originalVersion }; this.log(r, 'deploy', `version ${r.proposedVersion} active`); this.registry?.record(this.componentOf(r.target), { version: r.proposedVersion, event: 'deployed', change: r.id }); try { this.appliers[r.target]?.(this.policies.get(r.target)); } catch (e) { this.log(r, 'apply-error', e.message); } return r; }
  // the value a decision should use: during a canary, keys in the canary share get the candidate
  effective(kind, key = '') { const m = this.S.monitors[kind]; if (m && frac(key) < m.fraction) return { value: this.policies.valueOf(kind, m.candidate), arm: 'candidate' }; return { value: this.policies.get(kind), arm: 'baseline' }; }
  // Monitor: report the outcome of a decision made with effective(); decide when the window is complete
  observe(kind, arm, ok) {
    const m = this.S.monitors[kind]; if (!m) return null; const o = m.obs[arm]; if (!o) return null; o.n++; if (!ok) o.bad++;
    if (m.obs.candidate.n >= m.window && m.obs.baseline.n >= Math.min(m.window, 3)) { const r = this.record(m.record), rc = m.obs.candidate.bad / m.obs.candidate.n, rb = m.obs.baseline.bad / Math.max(1, m.obs.baseline.n);
      r.monitoring = { candidateFailureRate: +rc.toFixed(3), baselineFailureRate: +rb.toFixed(3), observations: { ...m.obs } };
      if (rc - rb > m.maxRegression) { this.log(r, 'monitor', `regression ${rc.toFixed(3)} vs ${rb.toFixed(3)} — rolling back`); delete this.S.monitors[kind]; r.status = 'rolled-back'; return r; }
      this.log(r, 'monitor', `no regression (${rc.toFixed(3)} vs ${rb.toFixed(3)}) — full deployment`); return this.activate(r); }
    return null;
  }
  rollback(id, { reason = 'owner rollback' } = {}) {
    const r = this.record(id); if (!r) return null;
    if (r.kind === 'policy') { if (this.S.monitors[r.target]?.record === id) delete this.S.monitors[r.target]; else if (r.status === 'deployed') { this.policies.activate(r.target, r.originalVersion); try { this.appliers[r.target]?.(this.policies.get(r.target)); } catch {} } }
    else { const ext = this.extensions[r.kind]; ext?.revert?.(r.value); this.S.extensions[r.kind] = (this.S.extensions[r.kind] || []).filter(v => JSON.stringify(v) !== JSON.stringify(r.value)); }
    r.status = 'rolled-back'; this.log(r, 'rollback', reason); this.registry?.record(r.kind === 'policy' ? this.componentOf(r.target) : r.component, { event: 'rolled-back', change: id }); return r;
  }
  reject(r, why) { r.status = 'rejected'; r.rejection = why; this.log(r, 'reject', why); return r; }
  // Propagation: deployed low/medium-risk policy changes, for other authorized nodes (who re-validate and re-test)
  exportRecords() { return this.S.records.filter(r => r.status === 'deployed' && r.kind === 'policy' && r.risk !== 'high').map(r => ({ id: r.id, target: r.target, value: this.policies.valueOf(r.target, r.proposedVersion), reason: r.reason, tests: r.tests.map(t => ({ name: t.name, passed: t.passed })) })); }
  adoptFrom(peer, items) { const out = []; for (const it of (items || []).slice(0, 50)) { if (!SCHEMAS[it.target] || SCHEMAS[it.target].risk === 'high') { out.push({ id: it.id, status: 'refused', why: 'high-risk or unknown changes are never adopted automatically' }); continue; } if (JSON.stringify(this.policies.get(it.target)) === JSON.stringify(it.value)) { out.push({ id: it.id, status: 'already-active' }); continue; } const r = this.propose({ kind: 'policy', target: it.target, value: it.value, reason: `from ${peer}: ${it.reason}`, source: 'peer:' + peer }); out.push({ id: it.id, status: r.status, local: r.id, why: r.rejection || null }); } return out; }
  status() { const by = {}; for (const r of this.S.records) by[r.status] = (by[r.status] || 0) + 1; return { records: this.S.records.length, byStatus: by, canaries: Object.fromEntries(Object.entries(this.S.monitors).map(([k, m]) => [k, { record: m.record, fraction: m.fraction, obs: m.obs }])), policies: this.policies.list(), recent: this.S.records.slice(-10).map(r => ({ id: r.id, target: r.target || r.kind, status: r.status, risk: r.risk, reason: r.reason, rejection: r.rejection || null })) }; }
}
