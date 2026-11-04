// Cognitive DNA (v1.7): atoms that describe HOW KENUXA thinks, not only what it knows.
// One shared base (identity, category, semantics, relations, applicability, evidence, provenance, validation,
// uncertainty, history, tests, failure conditions) plus a type-specific `body`. Categories that have no use for a
// field simply omit it. Every revision is content-addressed with the same canonical codec as knowledge atoms
// (sha256 of sorted-key MessagePack), versions are kept, and nothing is overwritten in place.
import { contentHash } from '../atoms/codec.mjs';
import { checkProcedure, testProcedure } from '../peers/tasks.mjs';

export const COGNITIVE_CATEGORIES = {
  rule: 'conditional relationship / inference rule (if all premises hold, the conclusion holds)',
  procedure: 'executable problem-solving method (typed inputs, dimension-checked steps, outputs, tests)',
  experience: 'record of one reasoning episode and its verified outcome',
  goal: 'intended outcome with success conditions',
  constraint: 'requirement, restriction or dependency',
  hypothesis: 'possible explanation or solution that is NOT verified',
  simulation: 'hypothetical state, assumptions, transitions and predicted outcomes',
  perception: 'structured observation extracted from an image by an actual image-processing step',
  evaluation: 'measured performance of a method on a named test set',
  strategy: 'policy for selecting and combining reasoning methods',
  uncertainty: 'explicit record of incomplete, conflicting or unreliable knowledge',
  causal: 'cause → effect link with its conditions, used by abduction and simulation',
  action: 'action with preconditions, effects, duration and cost, used by the planner',
  self: 'what KENUXA knows about itself (origin, nature); origin facts carry owner provenance',
};
// Extension point (v1.9): new categories can be introduced at run time as DATA — a name, a description and the body
// fields an atom of that category must carry — through the universal evolution engine. Built-in categories cannot
// be redefined or removed.
const BUILTIN = new Set(Object.keys(COGNITIVE_CATEGORIES)), REQUIRES = {};
export function registerCategory({ name, description, requires = [] }) {
  if (!/^[a-z][a-z-]{2,30}$/.test(String(name || ''))) return { ok: false, issues: ['category name must be a lower-case slug'] };
  if (BUILTIN.has(name)) return { ok: false, issues: ['built-in categories cannot be redefined'] };
  if (!Array.isArray(requires) || requires.some(f => !/^[a-z][a-zA-Z0-9]{0,30}$/.test(f))) return { ok: false, issues: ['requires must be a list of field names'] };
  COGNITIVE_CATEGORIES[name] = String(description || name).slice(0, 200); REQUIRES[name] = requires.slice(0, 12); return { ok: true };
}
export function unregisterCategory(name) { if (BUILTIN.has(name)) return false; delete COGNITIVE_CATEGORIES[name]; delete REQUIRES[name]; return true; }
export const STATUSES = ['hypothetical', 'candidate', 'tested', 'supported', 'validated', 'promoted', 'refuted', 'retired', 'unresolved', 'adopted-from-peer'];
const NAME = /^[a-z][a-z0-9:._-]{2,120}$/;
const BAD = /(https?:\/\/[^\s]*\.(exe|sh)|<script|javascript:|require\(|import\(|process\.|eval\(|=>|`|\$\{)/i;

// Shared base + type-specific body. Returns { ok, issues, atom }.
export function makeAtom(x, { now = Date.now() } = {}) {
  const issues = [];
  if (!x || typeof x !== 'object') return { ok: false, issues: ['not an object'] };
  if (!COGNITIVE_CATEGORIES[x.category]) issues.push('unknown category ' + x.category);
  if (!NAME.test(String(x.id || ''))) issues.push('id must be a lower-case slug (e.g. proc:energy-consumption)');
  if (BAD.test(JSON.stringify(x))) issues.push('contains code or markup');
  if (x.status && !STATUSES.includes(x.status)) issues.push('unknown status ' + x.status);
  if (x.category === 'procedure') issues.push(...checkProcedure(x.body));
  if (x.category === 'rule' && (!Array.isArray(x.body?.if) || !x.body.if.length || !Array.isArray(x.body?.then))) issues.push('a rule needs if[] and then[]');
  if (x.category === 'causal' && (!x.body?.cause || !x.body?.effect)) issues.push('a causal atom needs cause and effect');
  if (x.category === 'action' && (!x.body?.name || !(x.body.loadFactor || x.body.addEnergyWh || x.body.chargeRateW || Array.isArray(x.body.add)))) issues.push('an action needs a name and at least one effect');
  if (x.category === 'hypothesis' && x.status && ['validated', 'promoted'].includes(x.status) && !(x.evidence || []).length) issues.push('a hypothesis cannot be validated without evidence');
  for (const f of REQUIRES[x.category] || []) if (x.body?.[f] === undefined) issues.push(`a ${x.category} atom needs body.${f}`);
  if (issues.length) return { ok: false, issues };
  const atom = {
    id: x.id, category: x.category, label: String(x.label || x.id).slice(0, 200),
    semantics: x.semantics || null,                       // what it means, in structured form (category-specific)
    relations: (x.relations || []).slice(0, 50),          // [{ type, target }]
    preconditions: x.preconditions || undefined, contexts: x.contexts || undefined, goals: x.goals || undefined,
    body: x.body || null,
    evidence: (x.evidence || []).slice(0, 50),            // [{ kind: test|source|observation|teacher|human, ref, detail }]
    provenance: { source: x.provenance?.source || 'core', node: x.provenance?.node || null, derivedFrom: x.provenance?.derivedFrom || [] },
    status: x.status || (x.category === 'hypothesis' || x.category === 'simulation' ? 'hypothetical' : 'candidate'),
    confidence: typeof x.confidence === 'number' ? Math.max(0, Math.min(1, x.confidence)) : null,
    uncertainty: x.uncertainty || undefined, tests: x.tests || undefined, failures: x.failures || undefined,
    experiences: x.experiences || undefined, visibility: x.visibility === 'private' ? 'private' : 'public',
    createdAt: x.createdAt || now, updatedAt: now,
  };
  return { ok: true, issues: [], atom };
}

// Versioned, content-addressed store for cognitive atoms. Persisted inside the node's state (and therefore in the
// same durable store and preservation path as the rest of the state); promoted public atoms are shared over ATP.
export class CognitiveStore {
  constructor({ state = {}, now = () => Date.now(), node = null } = {}) {
    this.S = state; this.S.atoms ||= {}; this.S.revisions ||= {}; this.S.log ||= []; this.now = now; this.node = node;
  }
  put(x, { reason = 'update' } = {}) {
    const prev = this.S.atoms[x.id], made = makeAtom({ ...(prev ? this.S.revisions[prev.head] : {}), ...x, createdAt: prev ? this.S.revisions[prev.head].createdAt : undefined }, { now: this.now() });
    if (!made.ok) return made;
    const head = contentHash({ ...made.atom, updatedAt: 0 });
    if (prev?.head === head) return { ok: true, unchanged: true, atom: this.get(x.id), head };
    this.S.revisions[head] = made.atom;
    this.S.atoms[x.id] = { head, history: [...(prev ? [prev.head, ...prev.history] : [])].slice(0, 20), version: (prev?.version || 0) + 1 };
    this.S.log.push({ at: this.now(), id: x.id, head, status: made.atom.status, reason: String(reason).slice(0, 160) }); if (this.S.log.length > 500) this.S.log.splice(0, this.S.log.length - 500);
    this.gc(); return { ok: true, atom: made.atom, head, version: this.S.atoms[x.id].version };
  }
  get(id) { const m = this.S.atoms[id]; return m ? this.S.revisions[m.head] : null; }
  meta(id) { return this.S.atoms[id] || null; }
  setStatus(id, status, { evidence = [], reason = status } = {}) { const a = this.get(id); if (!a) return { ok: false, issues: ['unknown atom'] }; return this.put({ ...a, status, evidence: [...a.evidence, ...evidence] }, { reason }); }
  // roll back to the previous revision (kept in history)
  rollback(id, { reason = 'rollback' } = {}) { const m = this.S.atoms[id]; if (!m?.history.length) return { ok: false, issues: ['no earlier revision'] }; const [prev, ...rest] = m.history; this.S.atoms[id] = { head: prev, history: rest, version: m.version + 1 }; this.S.log.push({ at: this.now(), id, head: prev, status: this.S.revisions[prev].status, reason }); return { ok: true, atom: this.S.revisions[prev] }; }
  list({ category = null, status = null } = {}) { return Object.keys(this.S.atoms).map(id => this.get(id)).filter(a => a && (!category || a.category === category) && (!status || (Array.isArray(status) ? status.includes(a.status) : a.status === status))); }
  usable(category) { return this.list({ category }).filter(a => ['validated', 'promoted', 'adopted-from-peer'].includes(a.status)); }
  gc() { const live = new Set(Object.values(this.S.atoms).flatMap(m => [m.head, ...m.history])); for (const h of Object.keys(this.S.revisions)) if (!live.has(h)) delete this.S.revisions[h]; }
  // Public, promoted atoms for other nodes. Private atoms never leave.
  exportPublic() { return this.list().filter(a => a.visibility === 'public' && ['promoted', 'validated'].includes(a.status) && ['procedure', 'rule', 'causal', 'action', 'strategy'].includes(a.category)).map(a => ({ atom: a, head: this.S.atoms[a.id].head, version: this.S.atoms[a.id].version })); }
  // Adopt atoms from a peer ONLY after re-validating them locally: schema, content hash, and (for procedures) the
  // atom's own tests must pass in this node's kernel. A peer's word is never enough.
  adoptFrom(peer, items) {
    const out = { adopted: [], rejected: [] };
    for (const it of (items || []).slice(0, 200)) {
      const a = it?.atom; if (!a || contentHash({ ...a, updatedAt: 0 }) !== it.head) { out.rejected.push({ id: a?.id, why: 'content does not match its hash' }); continue; }
      if (this.S.atoms[a.id] && ['promoted', 'validated'].includes(this.get(a.id).status) && this.get(a.id).provenance.source !== 'peer') { out.rejected.push({ id: a.id, why: 'a local validated version exists' }); continue; }
      if (a.category === 'procedure') { const t = testProcedure(a.body); if (!t.total || t.passed < t.total) { out.rejected.push({ id: a.id, why: `its own tests fail here (${t.passed}/${t.total})` }); continue; } }
      const r = this.put({ ...a, status: 'adopted-from-peer', provenance: { ...a.provenance, source: 'peer', node: peer }, evidence: [...(a.evidence || []), { kind: 'peer', ref: peer, detail: 're-validated locally before adoption' }] }, { reason: 'adopted from ' + peer });
      (r.ok ? out.adopted : out.rejected).push(r.ok ? a.id : { id: a.id, why: r.issues.join('; ') });
    }
    return out;
  }
  status() { const by = {}; for (const a of this.list()) { const k = a.category; by[k] ||= {}; by[k][a.status] = (by[k][a.status] || 0) + 1; } return { atoms: Object.keys(this.S.atoms).length, revisions: Object.keys(this.S.revisions).length, byCategory: by, recent: this.S.log.slice(-10) }; }
}
