// Versioned policies: the live-evolvable behaviour of KENUXA's subsystems, separated from their code.
// Each policy kind has a schema (types, ranges) and the whole system has INVARIANTS that no policy version may
// violate, whoever proposes it — security, privacy, consent, audit and the evolution safeguards themselves.

const num = (min, max) => ({ type: 'number', min, max }), bool = { type: 'boolean' }, oneOf = (...v) => ({ type: 'enum', values: v }), str = n => ({ type: 'string', max: n });
export const SCHEMAS = {
  routing: { risk: 'medium', fields: { priorityWeight: num(0, 10), ageWeight: num(0, 10), localityWeight: num(0, 10), reliabilityWeight: num(0, 10), costWeight: num(0, 10) } },
  retrieval: { risk: 'low', fields: { strategy: oneOf('lexical', 'concept-lexical', 'concept-lexical-graph', 'indexed-concept-lexical'), threshold: num(0.1, 1), maxResults: num(1, 50) } },
  replication: { risk: 'medium', fields: { replicaTarget: num(1, 10), proofEveryHours: num(1, 168) } },
  memory: { risk: 'medium', fields: { workingMemoryItems: num(8, 512), experienceEpisodes: num(100, 20000), capsuleHistoryTurns: num(2, 20) } },
  ui: { risk: 'medium', fields: { maxFollowups: num(0, 6), showEngine: bool, showSources: bool, answerLabel: str(40) } },
  learning: { risk: 'medium', fields: { synthesisMaxLeaves: num(2, 4), synthesisConstants: { type: 'array', of: 'number', max: 8 }, minExamples: num(1, 10) } },
  security: { risk: 'high', fields: { powBitsMin: num(8, 24), registrationsPerNetHour: num(1, 200), peerRequestsPerNetMinute: num(60, 5000), tokenHash: oneOf('sha256', 'sha512'), auditLog: bool, authRequiredForOwnerRoutes: bool } },
  protocols: { risk: 'high', fields: { atp: { type: 'array', of: 'string', max: 6 }, kunpp: { type: 'array', of: 'string', max: 6 }, mind: { type: 'array', of: 'string', max: 6 }, deprecated: { type: 'array', of: 'string', max: 12 } } },
  evolution: { risk: 'high', fields: { canaryFraction: num(0.01, 1), monitorWindow: num(3, 1000), maxRegressionRate: num(0, 0.2), autoApproveLowRisk: bool, retrievalRecallTolerance: num(0, 0.05) } },
};
export const DEFAULTS = {
  routing: { priorityWeight: 1, ageWeight: 0, localityWeight: 0, reliabilityWeight: 0, costWeight: 0 },
  retrieval: { strategy: 'concept-lexical', threshold: 0.5, maxResults: 5 },
  replication: { replicaTarget: 2, proofEveryHours: 24 },
  memory: { workingMemoryItems: 64, experienceEpisodes: 2000, capsuleHistoryTurns: 10 },
  ui: { maxFollowups: 3, showEngine: false, showSources: true, answerLabel: 'KENUXA' },
  learning: { synthesisMaxLeaves: 3, synthesisConstants: [1, 2, 100, 1000], minExamples: 1 },
  security: { powBitsMin: 14, registrationsPerNetHour: 20, peerRequestsPerNetMinute: 600, tokenHash: 'sha256', auditLog: true, authRequiredForOwnerRoutes: true },
  protocols: { atp: ['ATP/1.0'], kunpp: ['kunpp/2'], mind: ['kenuxa-mind/1'], deprecated: ['MTP/0.5-open'] },
  evolution: { canaryFraction: 0.2, monitorWindow: 20, maxRegressionRate: 0.02, autoApproveLowRisk: true, retrievalRecallTolerance: 0 },
};
// Invariants: guarantees that survive every evolution. Checked on every proposal, before tests or approval.
export const INVARIANTS = [
  { id: 'auth-required', kind: 'security', check: v => v.authRequiredForOwnerRoutes === true, why: 'owner routes must always require authentication' },
  { id: 'audit-on', kind: 'security', check: v => v.auditLog === true, why: 'the audit log cannot be switched off' },
  { id: 'pow-floor', kind: 'security', check: v => v.powBitsMin >= 8, why: 'registration proof-of-work cannot go below 8 bits' },
  { id: 'strong-hash', kind: 'security', check: v => ['sha256', 'sha512'].includes(v.tokenHash), why: 'tokens must be stored with a SHA-2 hash' },
  { id: 'durable-replicas', kind: 'replication', check: v => v.replicaTarget >= 1, why: 'public knowledge needs at least one proven replica target' },
  { id: 'current-protocol', kind: 'protocols', check: v => v.atp.includes('ATP/1.0') || v.atp.some(x => /^ATP\/[2-9]/.test(x)), why: 'a node must keep a supported ATP version (no silent lock-out)' },
  { id: 'no-deprecated-active', kind: 'protocols', check: v => !v.atp.some(x => (v.deprecated || []).includes(x)), why: 'a deprecated protocol cannot be both active and deprecated' },
  { id: 'monitoring-on', kind: 'evolution', check: v => v.monitorWindow >= 3 && v.maxRegressionRate <= 0.2, why: 'monitoring and automatic rollback cannot be disabled' },
  { id: 'no-auto-high-risk', kind: 'evolution', check: v => !('autoApproveHighRisk' in v), why: 'high-risk changes always need explicit authorization' },
  { id: 'validation-kept', kind: 'learning', check: v => !Object.keys(v).some(k => /skip|disable|bypass|noregression|noheldout/i.test(k)), why: 'held-out and regression validation cannot be removed from learning' },
];
// v1.10: new policy kinds can be defined at run time as DATA — field types and ranges, defaults, risk tier and
// declarative invariants ({ field, op, value }). Built-in kinds and their invariants cannot be redefined.
const BUILTIN_KINDS = new Set(Object.keys(SCHEMAS)), OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
export function registerPolicyKind({ name, risk = 'medium', fields, defaults, invariants = [] }) {
  const issues = [];
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(String(name || ''))) issues.push('name must be a lower-case slug');
  if (BUILTIN_KINDS.has(name)) issues.push('built-in policy kinds cannot be redefined');
  if (!['low', 'medium', 'high'].includes(risk)) issues.push('risk must be low, medium or high');
  const F = {}; for (const [k, f] of Object.entries(fields || {})) { if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(k)) { issues.push('bad field ' + k); continue; }
    if (f?.type === 'number' && Number.isFinite(f.min) && Number.isFinite(f.max) && f.min <= f.max) F[k] = num(f.min, f.max); else if (f?.type === 'boolean') F[k] = bool; else if (f?.type === 'enum' && Array.isArray(f.values) && f.values.length && f.values.every(v => typeof v === 'string')) F[k] = oneOf(...f.values.slice(0, 20)); else if (f?.type === 'string' && f.max > 0 && f.max <= 200) F[k] = str(f.max); else issues.push('unsupported field spec for ' + k); }
  if (!Object.keys(F).length) issues.push('at least one field is required');
  for (const inv of invariants) if (!F[inv?.field] || !OPS[inv?.op]) issues.push('invalid invariant ' + JSON.stringify(inv).slice(0, 80));
  if (issues.length) return { ok: false, issues };
  SCHEMAS[name] = { risk, fields: F, custom: true };
  for (const [i, inv] of invariants.entries()) INVARIANTS.push({ id: `${name}-inv-${i}`, kind: name, check: v => OPS[inv.op](v[inv.field], inv.value), why: `${name}.${inv.field} ${inv.op} ${JSON.stringify(inv.value)}`, custom: true });
  const d = validatePolicy(name, defaults); if (!d.ok) { unregisterPolicyKind(name); return { ok: false, issues: ['defaults: ' + d.issues.join('; ')] }; }
  DEFAULTS[name] = defaults; return { ok: true };
}
export function unregisterPolicyKind(name) { if (BUILTIN_KINDS.has(name)) return false; delete SCHEMAS[name]; delete DEFAULTS[name]; for (let i = INVARIANTS.length - 1; i >= 0; i--) if (INVARIANTS[i].kind === name && INVARIANTS[i].custom) INVARIANTS.splice(i, 1); return true; }
const BAD = /<script|javascript:|on[a-z]+\s*=|<iframe|data:text\/html|\$\{|`|=>|eval\(/i;

export function validatePolicy(kind, value) {
  const s = SCHEMAS[kind], issues = []; if (!s) return { ok: false, issues: ['unknown policy kind ' + kind] };
  if (!value || typeof value !== 'object') return { ok: false, issues: ['policy value must be an object'] };
  if (BAD.test(JSON.stringify(value))) issues.push('contains executable content');
  for (const k of Object.keys(value)) if (!s.fields[k]) issues.push(`unknown field ${kind}.${k}`);
  for (const [k, f] of Object.entries(s.fields)) { const v = value[k]; if (v === undefined) { issues.push(`missing ${kind}.${k}`); continue; }
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max)) issues.push(`${kind}.${k} must be a number in [${f.min}, ${f.max}]`);
    if (f.type === 'boolean' && typeof v !== 'boolean') issues.push(`${kind}.${k} must be true or false`);
    if (f.type === 'enum' && !f.values.includes(v)) issues.push(`${kind}.${k} must be one of ${f.values.join(', ')}`);
    if (f.type === 'string' && (typeof v !== 'string' || v.length > f.max)) issues.push(`${kind}.${k} must be text ≤ ${f.max}`);
    if (f.type === 'array' && (!Array.isArray(v) || v.length > f.max || v.some(x => typeof x !== f.of))) issues.push(`${kind}.${k} must be a list of ≤ ${f.max} ${f.of}s`); }
  for (const inv of INVARIANTS.filter(i => i.kind === kind)) { let ok = false; try { ok = inv.check(value); } catch {} if (!ok) issues.push(`invariant ${inv.id}: ${inv.why}`); }
  return { ok: !issues.length, issues };
}

export class PolicyStore {
  constructor({ state = {}, now = () => Date.now() } = {}) { this.S = state; this.S.policies ||= {}; this.now = now;
    for (const [k, v] of Object.entries(DEFAULTS)) if (!this.S.policies[k]) this.S.policies[k] = { active: 1, versions: [{ v: 1, value: v, at: now(), by: 'default' }] }; }
  ensure(kind) { if (!this.S.policies[kind] && DEFAULTS[kind]) this.S.policies[kind] = { active: 1, versions: [{ v: 1, value: DEFAULTS[kind], at: this.now(), by: 'default' }] }; return this.S.policies[kind]; }
  get(kind) { const p = this.ensure(kind); return p ? p.versions.find(x => x.v === p.active).value : null; }
  version(kind) { return this.ensure(kind)?.active || null; }
  // stage a new version (not active) — activation is the evolution engine's job
  stage(kind, value, { by = 'proposal' } = {}) { const val = validatePolicy(kind, value); if (!val.ok) return val; const p = this.ensure(kind), v = Math.max(...p.versions.map(x => x.v)) + 1; p.versions.push({ v, value, at: this.now(), by }); if (p.versions.length > 30) p.versions.splice(0, p.versions.length - 30); return { ok: true, version: v }; }
  activate(kind, v) { const p = this.S.policies[kind]; const x = p?.versions.find(y => y.v === v); if (!x) return false; const val = validatePolicy(kind, x.value); if (!val.ok) return false; p.previous = p.active; p.active = v; return true; }
  valueOf(kind, v) { return this.S.policies[kind]?.versions.find(x => x.v === v)?.value || null; }
  list() { return Object.fromEntries(Object.entries(this.S.policies).map(([k, p]) => [k, { active: p.active, versions: p.versions.length, value: this.get(k), risk: SCHEMAS[k]?.risk }])); }
}
