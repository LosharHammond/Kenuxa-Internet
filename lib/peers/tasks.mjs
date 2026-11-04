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
  'procedure-test/1': { needs: null, verify: 'replica', about: 'cognitive · run the test cases of public candidate procedures in the declarative procedure kernel' },
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


// ---------- cognitive procedure kernel (shared with lib/mind/procedures.mjs) ----------
// A procedure atom is DATA: typed inputs with physical dimensions, arithmetic steps over named values, outputs and
// test cases. This interpreter is the only thing that executes it: a tiny expression parser (numbers, names,
// + - * / ^, parentheses, min/max/abs/round/ceil/floor), dimensional analysis, unit conversion. No eval, no code.
export const BASE_DIMS = ['E', 'T', 'Q', 'M', 'L', 'N'];
export const DIMS = {
  energy: { E: 1 }, time: { T: 1 }, power: { E: 1, T: -1 }, charge: { Q: 1 }, voltage: { E: 1, Q: -1 }, current: { Q: 1, T: -1 },
  money: { M: 1 }, fraction: {}, number: {}, length: { L: 1 }, area: { L: 2 }, irradiance: { E: 1, T: -1, L: -2 },
  'price-per-energy': { M: 1, E: -1 }, 'money-per-time': { M: 1, T: -1 }, count: { N: 1 }, 'energy-per-count': { E: 1, N: -1 }, 'energy-per-time-per-count': { E: 1, T: -1, N: -1 },
};
// unit → [dimension name, factor to the base unit of that dimension (Wh, h, Ah, money, m)]
export const UNITS = {
  wh: ['energy', 1], kwh: ['energy', 1000], mwh: ['energy', 1e6], j: ['energy', 1 / 3600], kj: ['energy', 1000 / 3600],
  h: ['time', 1], hr: ['time', 1], hrs: ['time', 1], hour: ['time', 1], hours: ['time', 1], min: ['time', 1 / 60], mins: ['time', 1 / 60], minute: ['time', 1 / 60], minutes: ['time', 1 / 60], s: ['time', 1 / 3600], sec: ['time', 1 / 3600], seconds: ['time', 1 / 3600], day: ['time', 24], days: ['time', 24], week: ['time', 168], weeks: ['time', 168], month: ['time', 730], months: ['time', 730], year: ['time', 8760], years: ['time', 8760],
  w: ['power', 1], watt: ['power', 1], watts: ['power', 1], kw: ['power', 1000], mw: ['power', 1e6],
  ah: ['charge', 1], mah: ['charge', 0.001], v: ['voltage', 1], volt: ['voltage', 1], volts: ['voltage', 1], a: ['current', 1], amp: ['current', 1], amps: ['current', 1], ma: ['current', 0.001],
  '%': ['fraction', 0.01], percent: ['fraction', 0.01], fraction: ['fraction', 1], x: ['number', 1], '': ['number', 1],
  m: ['length', 1], km: ['length', 1000], cm: ['length', 0.01], m2: ['area', 1], 'w/m2': ['irradiance', 1],
  money: ['money', 1], ghs: ['money', 1], 'gh₵': ['money', 1], cedi: ['money', 1], cedis: ['money', 1], usd: ['money', 1], $: ['money', 1], ngn: ['money', 1], naira: ['money', 1], eur: ['money', 1],
  'money/kwh': ['price-per-energy', 1 / 1000], 'ghs/kwh': ['price-per-energy', 1 / 1000], 'usd/kwh': ['price-per-energy', 1 / 1000], 'money/month': ['money-per-time', 1 / 730],
  device: ['count', 1], devices: ['count', 1], panel: ['count', 1], panels: ['count', 1], item: ['count', 1], items: ['count', 1], 'wh/panel': ['energy-per-count', 1], 'w/panel': ['energy-per-time-per-count', 1],
};
export const dimKey = d => BASE_DIMS.map(k => d[k] ? k + d[k] : '').join('');
const dimOf = name => { const d = DIMS[name]; if (!d) throw new Error('unknown dimension ' + name); return d; };
const dmul = (a, b, s = 1) => { const o = {}; for (const k of BASE_DIMS) { const v = (a[k] || 0) + s * (b[k] || 0); if (v) o[k] = v; } return o; };
export function toBase(value, unit, dim) {
  const u = UNITS[String(unit ?? '').toLowerCase()]; if (!u) throw new Error('unknown unit ' + unit);
  if (dim && dimKey(dimOf(u[0])) !== dimKey(dimOf(dim))) throw new Error(`unit ${unit} is ${u[0]}, expected ${dim}`);
  return value * u[1];
}
export function fromBase(value, unit) { const u = UNITS[String(unit ?? '').toLowerCase()]; if (!u) throw new Error('unknown unit ' + unit); return value / u[1]; }
const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, ceil: Math.ceil, floor: Math.floor };
// returns { ast, eval(scope), dim(dimScope), names }
export function parseExpr(src) {
  const s = String(src || ''); if (s.length > 200 || !/^[\w\s+\-*/^().,]+$/.test(s)) throw new Error('expression not allowed: ' + s);
  const toks = s.match(/\d+(?:\.\d+)?(?:e-?\d+)?|[A-Za-z_]\w*|[+\-*/^(),]/g) || []; let i = 0; const names = new Set();
  const peek = () => toks[i], eat = t => { if (toks[i] !== t) throw new Error('bad expression: ' + s); i++; };
  const atom = () => { const t = toks[i++]; if (t === undefined) throw new Error('bad expression: ' + s);
    if (t === '(') { const v = sum(); eat(')'); return v; } if (t === '-') return { op: 'neg', a: atom() };
    if (/^\d/.test(t)) return { op: 'num', v: Number(t) };
    if (!/^[a-zA-Z]\w{0,30}$/.test(t)) throw new Error('bad name ' + t);
    if (peek() === '(' && FUNCS[t]) { i++; const args = [sum()]; while (peek() === ',') { i++; args.push(sum()); } eat(')'); return { op: 'fn', f: t, args }; }
    names.add(t); return { op: 'var', name: t }; };
  const pow = () => { const a = atom(); if (peek() === '^') { i++; const b = atom(); if (b.op !== 'num') throw new Error('exponent must be a number'); return { op: '^', a, b }; } return a; };
  const prod = () => { let v = pow(); while (peek() === '*' || peek() === '/') { const op = toks[i++]; v = { op, a: v, b: pow() }; } return v; };
  const sum = () => { let v = prod(); while (peek() === '+' || peek() === '-') { const op = toks[i++]; v = { op, a: v, b: prod() }; } return v; };
  const ast = sum(); if (i !== toks.length) throw new Error('bad expression: ' + s);
  const ev = (n, r) => { switch (n.op) { case 'num': return n.v; case 'neg': return -ev(n.a, r); case 'var': { const v = r[n.name]; if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`value ${n.name} is missing or not a number`); return v; }
    case 'fn': return FUNCS[n.f](...n.args.map(x => ev(x, r))); case '+': return ev(n.a, r) + ev(n.b, r); case '-': return ev(n.a, r) - ev(n.b, r); case '*': return ev(n.a, r) * ev(n.b, r);
    case '/': { const d = ev(n.b, r); if (d === 0) throw new Error('division by zero'); return ev(n.a, r) / d; } case '^': return Math.pow(ev(n.a, r), n.b.v); } };
  // dimensional analysis: + and - need equal dimensions; numbers are dimensionless; min/max need equal dimensions
  const dm = (n, d) => { switch (n.op) { case 'num': return {}; case 'neg': return dm(n.a, d); case 'var': { if (!d[n.name]) throw new Error('no dimension for ' + n.name); return d[n.name]; }
    case 'fn': { const ds = n.args.map(x => dm(x, d)); if (ds.some(x => dimKey(x) !== dimKey(ds[0]))) throw new Error(`${n.f}() mixes dimensions`); return ds[0]; }
    case '+': case '-': { const a = dm(n.a, d), b = dm(n.b, d); if (dimKey(a) !== dimKey(b)) throw new Error(`cannot add ${dimKey(a) || 'number'} and ${dimKey(b) || 'number'}`); return a; }
    case '*': return dmul(dm(n.a, d), dm(n.b, d)); case '/': return dmul(dm(n.a, d), dm(n.b, d), -1); case '^': { const a = dm(n.a, d), o = {}; for (const k in a) o[k] = a[k] * n.b.v; return o; } } };
  return { ast, names: [...names], eval: r => ev(ast, r), dim: d => dm(ast, d) };
}
// Static check: every step and output is dimensionally consistent. Returns a list of problems (empty = consistent).
export function checkProcedure(spec) {
  const issues = [], dims = {};
  if (!spec || typeof spec !== 'object') return ['not an object'];
  for (const inp of spec.inputs || []) { if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(inp.name || '')) issues.push('bad input name'); try { dims[inp.name] = dimOf(inp.dim); } catch (e) { issues.push(e.message); } }
  if (!(spec.steps || []).length || spec.steps.length > 20) issues.push('1–20 steps required');
  for (const st of spec.steps || []) { try { const p = parseExpr(st.expr), d = p.dim(dims); if (st.dim && dimKey(d) !== dimKey(dimOf(st.dim))) issues.push(`step ${st.as}: expression is ${dimKey(d) || 'dimensionless'}, declared ${st.dim}`); dims[st.as] = st.dim ? dimOf(st.dim) : d; } catch (e) { issues.push(`step ${st.as}: ${e.message}`); } }
  for (const o of spec.outputs || []) { if (!dims[o.name]) issues.push('output ' + o.name + ' is never computed'); else if (o.unit !== undefined) { const u = UNITS[String(o.unit).toLowerCase()]; if (!u) issues.push('unknown unit ' + o.unit); else if (dimKey(dimOf(u[0])) !== dimKey(dims[o.name])) issues.push(`output ${o.name} is ${dimKey(dims[o.name]) || 'dimensionless'} but unit ${o.unit} is ${u[0]}`); } }
  if (!(spec.outputs || []).length) issues.push('no outputs');
  return issues;
}
// inputs: { name: number (already in the declared input unit) | { value, unit } }
export function runProcedure(spec, inputs = {}) {
  const scope = {}, trace = [];
  for (const inp of spec.inputs || []) {
    let raw = inputs[inp.name]; if (raw === undefined && inp.default !== undefined) raw = inp.default;
    if (raw === undefined || raw === null) throw new Error('missing input ' + inp.name);
    const q = typeof raw === 'number' ? { value: raw, unit: inp.unit ?? '' } : raw;
    if (typeof q.value !== 'number' || !Number.isFinite(q.value)) throw new Error(`input ${inp.name} is not a number`);
    scope[inp.name] = toBase(q.value, q.unit ?? inp.unit ?? '', inp.dim);
    if (inp.min !== undefined && scope[inp.name] < toBase(inp.min, inp.unit ?? '', inp.dim)) throw new Error(`input ${inp.name} must be at least ${inp.min} ${inp.unit || ''}`.trim());
    if (inp.max !== undefined && scope[inp.name] > toBase(inp.max, inp.unit ?? '', inp.dim)) throw new Error(`input ${inp.name} must be at most ${inp.max} ${inp.unit || ''}`.trim());
  }
  for (const st of spec.steps) { const v = parseExpr(st.expr).eval(scope); scope[st.as] = v; trace.push([st.as, st.expr, v]); }
  const outputs = {}; for (const o of spec.outputs) outputs[o.name] = { value: o.unit !== undefined ? fromBase(scope[o.name], o.unit) : scope[o.name], unit: o.unit ?? '' };
  return { outputs, trace };
}
const close = (a, b, tol = 0.005) => Math.abs(a - b) <= Math.max(1e-9, tol * Math.max(Math.abs(a), Math.abs(b)));
export function testProcedure(spec, cases = spec.tests || []) {
  const results = [];
  for (const c of cases.slice(0, 200)) { try { const r = runProcedure(spec, c.inputs); const bad = Object.entries(c.expect || {}).filter(([k, v]) => !r.outputs[k] || !close(r.outputs[k].value, v, c.tol ?? 0.005)); results.push({ pass: !bad.length, got: Object.fromEntries(Object.entries(r.outputs).map(([k, v]) => [k, +v.value.toPrecision(10)])) }); }
    catch (e) { results.push({ pass: !!c.expectError && String(e.message).includes(c.expectError), error: String(e.message).slice(0, 120) }); } }
  return { passed: results.filter(r => r.pass).length, total: results.length, results };
}
// ---------- cognitive · procedure-test/1 ----------
// payload: { procedures: [{ id, spec, cases }] } → per procedure: static issues, passed/total, outputs per case
export async function procedureTests(payload, { deadline = Infinity } = {}) {
  const out = [];
  for (const p of (payload?.procedures || []).slice(0, 50)) { budget(deadline); const issues = checkProcedure(p.spec); out.push([p.id, issues, issues.length ? { passed: 0, total: (p.cases || []).length, results: [] } : testProcedure(p.spec, p.cases || p.spec.tests || [])]); }
  return { kind: 'procedure-test/1', checked: out.length, issues: out.filter(x => x[1].length || x[2].passed < x[2].total).map(x => ({ id: x[0], kind: x[1].length ? 'inconsistent-procedure' : 'failed-cases', detail: x[1].length ? x[1][0] : `${x[2].passed}/${x[2].total}` })), results: out, digest: await sha256hex(encodeCanonical(out)) };
}

export async function runTask(kind, payload, opts) {
  if (kind === 'procedure-test/1') return procedureTests(payload, opts);
  if (kind === 'atom-validate/1') return validateAtoms(payload, opts);
  if (kind === 'relation-check/1') return relationCheck(payload, opts);
  if (kind === 'lexical-consistency/1') return lexicalConsistency(payload, opts);
  if (kind === 'claim-consistency/1') return claimConsistency(payload, opts);
  if (kind === 'graph-metrics/1') return graphMetrics(payload, opts);
  if (kind === 'isa-closure/1') return isaClosure(payload, opts);
  throw new Error('unknown task kind ' + kind + ' (storage tasks are handled by the dedicated agent)');
}
