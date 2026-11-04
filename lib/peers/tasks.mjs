// KUNPP task vocabulary v2 — the ONLY computations a volunteer peer ever runs.
// This file is shared verbatim by the core node (Node.js) and by browser workers (served as /peer-tasks.mjs):
// no imports, no network, no DOM, no eval, no dynamic code. Every task is deterministic, works only on PUBLIC atom
// data it is given, and returns a compact result with a digest so that the core can compare independent results.
export const TASK_VOCABULARY = 'kunpp-tasks/2';
// kind → { needs: capability a peer must hold (verified by the core), verify: how the core checks results }
export const TASK_SPECS = {
  'atom-validate/1': { needs: null, verify: 'flags+replica', about: 'A · structure, integrity (content hash), references, provenance' },
  'relation-check/1': { needs: null, verify: 'flags+replica', about: 'B · duplicate / self / asymmetric edges, invalid types, IS_A cycles in the shard' },
  'lexical-consistency/1': { needs: null, verify: 'flags+replica', about: 'C · grammar rules over word forms: lemma links, plural and past-tense morphology' },
  'claim-consistency/1': { needs: null, verify: 'flags+replica', about: 'D · deterministic checks over public claims and their evidence' },
  'graph-metrics/1': { needs: null, verify: 'replica', about: 'E · degree statistics, connected components and IS_A depth of a shard' },
  'isa-closure/1': { needs: 'symbolic-reasoning', verify: 'replica', about: 'specialised: transitive IS_A inference for a batch of queries' },
  'replicate/1': { needs: 'storage', verify: 'hash', about: 'store public atom revisions (content-addressed) on a dedicated volunteer node' },
  'storage-proof/1': { needs: 'storage', verify: 'expected', about: 'prove stored bytes: sha256(nonce ‖ canonical bytes)' },
  'restore/1': { needs: 'storage', verify: 'hash', about: 'return stored revisions so the core can recover lost ones' },
};
export const TASK_KINDS = Object.keys(TASK_SPECS);

// ---------- canonical encoding: byte-identical to lib/atoms/codec.mjs encode() (sorted keys, MessagePack subset) ----------
const te = new TextEncoder();
export function encodeCanonical(value) {
  const parts = []; let size = 0;
  const push = b => { parts.push(b); size += b.length; };
  const u8 = (...a) => push(Uint8Array.from(a));
  const be = (n, bytes, signed = false) => { const b = new Uint8Array(bytes), dv = new DataView(b.buffer); if (bytes === 2) dv.setUint16(0, n); else if (signed) dv.setInt32(0, n); else dv.setUint32(0, n); return b; };
  function w(v) {
    if (v === null || v === undefined) return u8(0xc0);
    if (v === false) return u8(0xc2); if (v === true) return u8(0xc3);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v < 128) return u8(v);
      if (Number.isInteger(v) && v < 0 && v >= -32) return u8(0x100 + v);
      if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) { u8(0xce); return push(be(v, 4)); }
      if (Number.isInteger(v) && v < 0 && v >= -0x80000000) { u8(0xd2); return push(be(v, 4, true)); }
      const b = new Uint8Array(9); b[0] = 0xcb; new DataView(b.buffer).setFloat64(1, v); return push(b);
    }
    if (typeof v === 'string') { const s = te.encode(v), n = s.length; if (n < 32) u8(0xa0 | n); else if (n < 256) u8(0xd9, n); else if (n < 65536) { u8(0xda); push(be(n, 2)); } else { u8(0xdb); push(be(n, 4)); } return push(s); }
    if (v instanceof Uint8Array) { u8(0xc6); push(be(v.length, 4)); return push(v); }
    if (Array.isArray(v)) { const n = v.length; if (n < 16) u8(0x90 | n); else { u8(0xdd); push(be(n, 4)); } for (const x of v) w(x); return; }
    if (typeof v === 'object') { const keys = Object.keys(v).filter(k => v[k] !== undefined).sort(), n = keys.length; if (n < 16) u8(0x80 | n); else { u8(0xdf); push(be(n, 4)); } for (const k of keys) { w(k); w(v[k]); } return; }
    throw new Error('unsupported type ' + typeof v);
  }
  w(value); const out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
export async function sha256hex(bytes) { const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)); let s = ''; for (const x of d) s += x.toString(16).padStart(2, '0'); return s; }

// ---------- atom-validate/1 ----------
// payload: { atoms: [{ id, head, dna }], rules: { schema, types[], validation[], relations: { TYPE: { from[], to[] } } },
//            targets: { id: type } }   (types of every referenced atom that exists; absent = missing)
// Checks exactly what can be decided from the batch: content hash vs manifest head (corruption), schema, identity,
// relation vocabulary and endpoint types, broken references, missing senses, IS_A + CONTRADICTS on the same target,
// duplicate edges and missing provenance. Cross-batch checks (duplicate identities, IS_A cycles) stay on the core.
export async function validateAtoms(payload, { deadline = Infinity } = {}) {
  const { atoms = [], rules = {}, targets = {} } = payload || {}, issues = [], verdicts = [];
  if (!Array.isArray(atoms) || atoms.length > 1000) throw new Error('bad batch');
  for (const a of atoms) {
    if (Date.now() > deadline) throw new Error('execution budget exceeded');
    const kinds = new Set(), add = (kind, detail) => { kinds.add(kind); issues.push({ id: a.id, kind, detail: String(detail).slice(0, 160) }); }, d = a.dna;
    if (!d || typeof d !== 'object') { add('missing-revision', 'no DNA'); verdicts.push([a.id, [...kinds].sort()]); continue; }
    if (a.head && (await sha256hex(encodeCanonical(d))) !== a.head) add('corrupted', 'revision content does not match its hash');
    const errs = [];
    if (d.schema !== rules.schema) errs.push('schema');
    if (!d.identity?.id || !(rules.types || []).includes(d.identity.type)) errs.push('identity');
    if (!(rules.validation || []).includes(d.identity?.validation)) errs.push('validation');
    if (!Array.isArray(d.relational)) errs.push('relational');
    for (const r of d.relational || []) if (!rules.relations?.[r.type]) errs.push('relation:' + r.type);
    if (!d.epistemic || typeof d.epistemic.confidence !== 'number' || d.epistemic.confidence < 0 || d.epistemic.confidence > 1) errs.push('epistemic');
    if (errs.length) add('invalid-schema', 'Invalid Atomic DNA: ' + errs.join(', '));
    if (d.identity?.id !== a.id) add('identity-mismatch', `DNA says ${d.identity?.id}`);
    const seen = new Set();
    for (const e of d.relational || []) {
      const key = e.type + '\u0000' + e.target; if (seen.has(key)) add('duplicate-edge', `${e.type} → ${e.target} appears twice`); seen.add(key);
      const rel = rules.relations?.[e.type], tt = targets[e.target];
      if (!rel) { add('unknown-relation', e.type); continue; }
      if (!tt) { add('broken-reference', `${e.type} → ${e.target}`); continue; }
      if (!rel.from.includes(d.identity?.type) || !rel.to.includes(tt)) add('invalid-relationship', `${e.type} cannot connect ${d.identity?.type} → ${tt}`);
    }
    for (const s of d.semantic?.senses || []) if (!targets[s]) add('broken-reference', `sense ${s} missing`);
    const isA = new Set((d.relational || []).filter(e => e.type === 'IS_A').map(e => e.target));
    for (const e of d.relational || []) if (e.type === 'CONTRADICTS' && isA.has(e.target)) add('contradiction', `both IS_A and CONTRADICTS ${e.target}`);
    if (d.identity?.originNode !== 'genesis' && !(d.identity?.provenance || []).length && !(d.epistemic?.evidence || []).length && d.identity?.type !== 'symbol') add('missing-provenance', 'no provenance and no evidence');
    verdicts.push([a.id, [...kinds].sort()]);
  }
  verdicts.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return { kind: 'atom-validate/1', checked: atoms.length, issues: issues.slice(0, 500), digest: await sha256hex(encodeCanonical(verdicts)) };
}
const sortIssues = issues => issues.sort((a, b) => (a.id + a.kind + a.detail < b.id + b.kind + b.detail ? -1 : 1));
async function finish(kind, atoms, issues, extra = {}) {
  sortIssues(issues); const verdicts = {}; for (const a of atoms) verdicts[a.id] = []; for (const i of issues) (verdicts[i.id] ||= []).push(i.kind);
  const v = Object.keys(verdicts).sort().map(id => [id, [...new Set(verdicts[id])].sort()]);
  return { kind, checked: atoms.length, issues: issues.slice(0, 500), digest: await sha256hex(encodeCanonical({ v, ...extra })), ...extra };
}
const budget = (deadline) => { if (Date.now() > deadline) throw new Error('execution budget exceeded'); };

// ---------- B · relation-check/1 ----------
// payload: { atoms, rules, targets, isa: { id: [IS_A targets] } }  (isa covers atoms and their referenced targets)
const SYMMETRIC = new Set(['SYNONYM_OF', 'ANTONYM_OF', 'RELATED_TO']);
export async function relationCheck(payload, { deadline = Infinity } = {}) {
  const { atoms = [], rules = {}, targets = {}, isa = {} } = payload || {}, issues = [], inShard = new Map(atoms.map(a => [a.id, a.dna]));
  for (const a of atoms) {
    budget(deadline); const d = a.dna || {}, seen = new Set();
    for (const e of d.relational || []) {
      const k = e.type + '\u0000' + e.target;
      if (seen.has(k)) issues.push({ id: a.id, kind: 'duplicate-edge', detail: `${e.type} → ${e.target}` }); seen.add(k);
      if (e.target === a.id) issues.push({ id: a.id, kind: 'self-reference', detail: e.type });
      if (!rules.relations?.[e.type]) issues.push({ id: a.id, kind: 'unknown-relation', detail: e.type });
      else if (targets[e.target] && !rules.relations[e.type].to.includes(targets[e.target])) issues.push({ id: a.id, kind: 'invalid-relationship', detail: `${e.type} → ${targets[e.target]}` });
      if (SYMMETRIC.has(e.type) && inShard.has(e.target) && !(inShard.get(e.target).relational || []).some(x => x.type === e.type && x.target === a.id)) issues.push({ id: a.id, kind: 'asymmetric-relation', detail: `${e.type} → ${e.target} has no reverse edge` });
      if (typeof e.confidence === 'number' && (e.confidence < 0 || e.confidence > 1)) issues.push({ id: a.id, kind: 'invalid-confidence', detail: String(e.confidence) });
    }
    // IS_A cycle reachable from this atom (bounded DFS over the supplied IS_A map)
    const stack = [[a.id, [a.id]]], visited = new Set(); let steps = 0;
    while (stack.length && steps++ < 5000) { const [n, path] = stack.pop(); for (const t of isa[n] || []) { if (t === a.id) { issues.push({ id: a.id, kind: 'isa-cycle', detail: [...path, t].slice(-6).join(' → ') }); stack.length = 0; break; } if (!visited.has(t)) { visited.add(t); stack.push([t, [...path, t]]); } } }
  }
  return finish('relation-check/1', atoms, issues);
}
// ---------- C · lexical-consistency/1 (bounded grammar rules) ----------
// payload: { atoms, canonical: { id: canonical form } , irregular: [forms] }
export async function lexicalConsistency(payload, { deadline = Infinity } = {}) {
  const { atoms = [], canonical = {}, irregular = [] } = payload || {}, irr = new Set(irregular), issues = [];
  for (const a of atoms) {
    budget(deadline); const d = a.dna || {}, l = d.linguistic || {}, form = String(d.identity?.canonical || '').toLowerCase();
    if (d.identity?.type !== 'lexical') continue;
    const formOf = (d.relational || []).filter(e => e.type === 'FORM_OF');
    for (const e of formOf) { const c = canonical[e.target]; if (c === undefined) issues.push({ id: a.id, kind: 'lemma-missing', detail: e.target }); else if (l.lemma && String(l.lemma).toLowerCase() !== String(c).toLowerCase()) issues.push({ id: a.id, kind: 'lemma-mismatch', detail: `lemma ${l.lemma} but FORM_OF ${c}` }); }
    if (l.morphology?.number === 'pl' && l.pos === 'noun' && !irr.has(form) && !/(s|i|a|ae|en|ren|eet|ice|eople|ata)$/.test(form)) issues.push({ id: a.id, kind: 'plural-morphology', detail: `"${form}" is marked plural but has no plural ending` });
    if (l.pos === 'verb' && /past/.test(String(l.morphology?.tense || '')) && !irr.has(form) && !/(ed|d|t|ew|ot|ought|aught|ung|ank|ang|ove|ode|ote|oke|ame|ent|ook|ept|eld|ood|ell)$/.test(form) && l.subtype !== 'auxiliary') issues.push({ id: a.id, kind: 'past-morphology', detail: `"${form}" is marked past tense but looks regular-incomplete` });
    if (l.lemma && !formOf.length && String(l.lemma).toLowerCase() !== form && d.identity?.originNode === 'genesis') issues.push({ id: a.id, kind: 'missing-form-link', detail: `lemma ${l.lemma} without FORM_OF` });
  }
  return finish('lexical-consistency/1', atoms, issues);
}
// ---------- D · claim-consistency/1 ----------
// payload: { claims: [{ id, subject, relation, object, evidence: [{ id, stance, publisher, passage, validUntil, kind }] }], now }
export async function claimConsistency(payload, { deadline = Infinity } = {}) {
  const { claims = [], now = 0 } = payload || {}, issues = [], items = claims.map(c => ({ id: c.id }));
  const words = s => String(s || '').toLowerCase().replace(/(ies|es|s)$/, '').slice(0, 6);
  for (const c of claims) {
    budget(deadline); const pubs = {};
    for (const e of c.evidence || []) {
      (pubs[e.publisher] ||= new Set()).add(e.stance);
      if (e.kind !== 'teacher' && e.passage && !(String(e.passage).toLowerCase().includes(words(c.subject)) || String(e.passage).toLowerCase().includes(words(c.object)))) issues.push({ id: c.id, kind: 'evidence-off-topic', detail: `${e.id}: passage mentions neither ${c.subject} nor ${c.object}` });
      if (e.validUntil && now && Date.parse(e.validUntil) < now && e.stance === 'supports') issues.push({ id: c.id, kind: 'expired-evidence', detail: `${e.id} expired ${e.validUntil}` });
    }
    for (const [p, st] of Object.entries(pubs)) if (st.size > 1) issues.push({ id: c.id, kind: 'self-contradicting-source', detail: `${p} both supports and contradicts` });
  }
  return finish('claim-consistency/1', items, issues);
}
// ---------- E · graph-metrics/1 ----------
export async function graphMetrics(payload, { deadline = Infinity } = {}) {
  const { atoms = [], isa = {} } = payload || {}, deg = {}, adj = new Map(); let edges = 0;
  const link = (a, b) => { (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a); };
  for (const a of atoms) { budget(deadline); const out = (a.dna?.relational || []).length; edges += out; deg[out] = (deg[out] || 0) + 1; adj.has(a.id) || adj.set(a.id, new Set()); for (const e of a.dna?.relational || []) if (atoms.some(x => x.id === e.target)) link(a.id, e.target); }
  const seen = new Set(); let components = 0, largest = 0;
  for (const n of adj.keys()) { if (seen.has(n)) continue; components++; let size = 0; const q = [n]; seen.add(n); while (q.length) { const x = q.pop(); size++; for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); q.push(y); } } largest = Math.max(largest, size); }
  const depth = id => { let d = 0, cur = id; const vis = new Set([id]); while ((isa[cur] || [])[0] && d < 30) { cur = isa[cur][0]; if (vis.has(cur)) break; vis.add(cur); d++; } return d; };
  const depths = atoms.map(a => depth(a.id)), metrics = { atoms: atoms.length, edges, degreeHistogram: Object.fromEntries(Object.entries(deg).sort((a, b) => a[0] - b[0])), components, largestComponent: largest, maxIsaDepth: Math.max(0, ...depths), meanIsaDepth: depths.length ? +(depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(3) : 0 };
  return finish('graph-metrics/1', atoms, [], { metrics });
}
// ---------- specialised · isa-closure/1 ----------
// payload: { isa: { id: [targets] }, queries: [[subject, category]] } → answers yes / no-path with the chain
export async function isaClosure(payload, { deadline = Infinity } = {}) {
  const { isa = {}, queries = [] } = payload || {}, answers = [];
  for (const [s, c] of queries.slice(0, 500)) {
    budget(deadline); const prev = new Map([[s, null]]), q = [s]; let found = false;
    while (q.length && !found) { const x = q.shift(); for (const t of isa[x] || []) if (!prev.has(t)) { prev.set(t, x); if (t === c) { found = true; break; } q.push(t); } }
    const chain = []; if (found) { let n = c; while (n !== null) { chain.unshift(n); n = prev.get(n); } }
    answers.push([s, c, found ? 'yes' : 'no-path', chain]);
  }
  return { kind: 'isa-closure/1', checked: answers.length, issues: [], answers, digest: await sha256hex(encodeCanonical(answers)) };
}
// ---------- storage proofs (dedicated volunteer nodes) ----------
export async function storageProof(dna, nonce) { const b = encodeCanonical(dna), n = new TextEncoder().encode(String(nonce)), all = new Uint8Array(n.length + b.length); all.set(n); all.set(b, n.length); return sha256hex(all); }

export async function runTask(kind, payload, opts) {
  if (kind === 'atom-validate/1') return validateAtoms(payload, opts);
  if (kind === 'relation-check/1') return relationCheck(payload, opts);
  if (kind === 'lexical-consistency/1') return lexicalConsistency(payload, opts);
  if (kind === 'claim-consistency/1') return claimConsistency(payload, opts);
  if (kind === 'graph-metrics/1') return graphMetrics(payload, opts);
  if (kind === 'isa-closure/1') return isaClosure(payload, opts);
  throw new Error('unknown task kind ' + kind + ' (storage tasks are handled by the dedicated agent)');
}
