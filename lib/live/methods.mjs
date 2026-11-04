// Learned methods (v1.4): reusable procedures, not stored answers.
// A method is declarative data — purpose, applicability, inputs, preconditions, typed operations, evidence
// requirements, validation checks, known failure conditions, examples, counterexamples, outcome history, provenance.
// It runs in a small, inspectable interpreter with a fixed operation set; arithmetic uses a tiny parser over named
// fields (no eval, no JavaScript, no shell, no network). Teacher output can only ever become such data.
import { createHash } from 'node:crypto';

const h = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const OPS = new Set(['map-compute', 'rank', 'select', 'filter', 'sum', 'difference', 'ratio', 'threshold']);
const PRE = new Set(['min-count', 'all-positive', 'present', 'same-unit']);
const NAME = /^[a-z][a-zA-Z0-9]{0,30}$/;
const BAD = /(https?:|<\/?[a-z]|javascript:|require\(|import\(|process\.|eval|function|=>|;|`|\$\{)/i;

// ---------- arithmetic expressions: numbers, field names, + - * / and parentheses ----------
export function compileExpr(src) {
  const s = String(src || ''); if (s.length > 120 || BAD.test(s) || !/^[\w\s+\-*/().]+$/.test(s)) throw new Error('expression not allowed: ' + s);
  const toks = s.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[+\-*/()]/g) || []; let i = 0;
  const peek = () => toks[i], eat = t => { if (toks[i] !== t) throw new Error('bad expression: ' + s); i++; };
  const atom = () => { const t = toks[i++]; if (t === undefined) throw new Error('bad expression: ' + s); if (t === '(') { const v = sum(); eat(')'); return v; } if (t === '-') { const v = atom(); return r => -v(r); } if (/^\d/.test(t)) { const k = Number(t); return () => k; } if (!NAME.test(t)) throw new Error('bad field: ' + t); return r => { const v = r[t]; if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`field ${t} is not a number`); return v; }; };
  const prod = () => { let v = atom(); while (peek() === '*' || peek() === '/') { const op = toks[i++], a = v, b = atom(); v = op === '*' ? r => a(r) * b(r) : r => { const d = b(r); if (d === 0) throw new Error('division by zero'); return a(r) / d; }; } return v; };
  const sum = () => { let v = prod(); while (peek() === '+' || peek() === '-') { const op = toks[i++], a = v, b = prod(); v = op === '+' ? r => a(r) + b(r) : r => a(r) - b(r); } return v; };
  const f = sum(); if (i !== toks.length) throw new Error('bad expression: ' + s); return f;
}
const fmt = (v, d = 2) => typeof v === 'number' ? (Math.abs(v) < 1 ? v.toPrecision(3) : v.toFixed(d).replace(/\.?0+$/, '')) : String(v ?? '');
export function render(template, scope) { return String(template).replace(/\{([a-zA-Z][\w.]*)(?::(\d))?\}/g, (_, path, d) => fmt(path.split('.').reduce((o, k) => o?.[k], scope), d ? Number(d) : 2)); }

// ---------- validation of a method specification (teacher or owner supplied) ----------
export function validateMethodSpec(x) {
  const issues = [];
  if (!x || typeof x !== 'object') return { ok: false, issues: ['not an object'] };
  if (BAD.test(JSON.stringify(x))) issues.push('contains code, markup or links');
  for (const k of ['purpose', 'family']) if (typeof x[k] !== 'string' || !x[k].trim() || x[k].length > 200) issues.push(`missing ${k}`);
  if (x.family && !/^[a-z][a-z0-9-]{2,40}$/.test(x.family)) issues.push('family must be a slug');
  const inputs = Array.isArray(x.inputs) ? x.inputs : []; if (!inputs.length) issues.push('no inputs');
  for (const inp of inputs) if (!NAME.test(inp?.name || '') || !['list', 'number', 'string'].includes(inp.type)) issues.push('bad input ' + JSON.stringify(inp).slice(0, 60));
  for (const p of x.preconditions || []) if (!PRE.has(p?.op)) issues.push('unknown precondition ' + p?.op);
  const ops = Array.isArray(x.operations) ? x.operations : []; if (!ops.length || ops.length > 12) issues.push('1–12 operations required');
  for (const o of ops) { if (!OPS.has(o?.op)) issues.push('unknown operation ' + o?.op); if (o?.as && !NAME.test(o.as)) issues.push('bad name ' + o.as); if (o?.expr) try { compileExpr(o.expr); } catch (e) { issues.push(e.message); } }
  if (typeof x.output?.template !== 'string' || x.output.template.length > 400) issues.push('output.template required');
  return { ok: !issues.length, issues };
}

const getPath = (scope, path) => { const [head, ...rest] = String(path).replace('[]', '').split('.'); const base = scope[head]; return rest.length ? (Array.isArray(base) ? base.map(b => rest.reduce((o, k) => o?.[k], b)) : rest.reduce((o, k) => o?.[k], base)) : base; };

// ---------- the method registry ----------
export class MethodRegistry {
  constructor({ state, now = () => Date.now() } = {}) { this.S = state.methods ??= {}; this.S.methods ??= {}; this.S.needs ??= {}; this.S.runs ??= []; this.now = now; this.inflight = new Map(); }
  add(spec, { source = 'owner', model = null, examples = [] } = {}) {
    const v = validateMethodSpec(spec); if (!v.ok) return { ok: false, issues: v.issues };
    const body = { purpose: spec.purpose, family: spec.family, applicability: { intents: (spec.applicability?.intents || []).slice(0, 6), signals: (spec.applicability?.signals || []).map(String).slice(0, 12), domains: (spec.applicability?.domains || []).slice(0, 8) }, inputs: spec.inputs, preconditions: spec.preconditions || [], operations: spec.operations, evidence: spec.evidence || { requireSource: true }, validation: spec.validation || [], failures: (spec.failures || []).map(String).slice(0, 8), output: spec.output };
    const id = 'method:' + spec.family + ':' + h(body).slice(0, 10), prev = Object.values(this.S.methods).find(m => m.family === spec.family && m.status === 'active');
    if (this.S.methods[id]) return { ok: true, method: this.S.methods[id], duplicate: true };
    const m = { id, ...body, status: 'active', revision: prev ? prev.revision + 1 : 1, previous: prev?.id || null, provenance: { source, model, at: new Date(this.now()).toISOString() }, examples: examples.slice(0, 5), counterexamples: [], outcomes: { applied: 0, succeeded: 0, failed: 0, rejected: 0 } };
    if (prev) prev.status = 'superseded'; this.S.methods[id] = m; return { ok: true, method: m };
  }
  active(family = null) { return Object.values(this.S.methods).filter(m => m.status === 'active' && (!family || m.family === family)); }
  revoke(id, reason) { const m = this.S.methods[id]; if (!m) throw new Error('unknown method'); m.status = 'revoked'; m.revokedReason = reason; for (const k of Object.keys(this.S.needs)) if (this.S.needs[k].method === id) this.S.needs[k].status = 'revoked'; return m; }
  // Applicability before reuse: intent/signals, then the inputs and preconditions on THIS problem's data.
  applicable(m, { text = '', intent = null, inputs = {} } = {}) {
    const t = String(text).toLowerCase(), missing = [], failed = [];
    const signal = !m.applicability.signals.length || m.applicability.signals.some(s => t.includes(String(s).toLowerCase()));
    const intentOk = !m.applicability.intents.length || !intent || m.applicability.intents.includes(intent);
    for (const inp of m.inputs) { const v = inputs[inp.name]; if (v === undefined || v === null || (Array.isArray(v) && !v.length)) missing.push(inp.name); else if (inp.type === 'list' && inp.fields) for (const f of inp.fields) if (!v.every(x => x[f] !== undefined && x[f] !== null && x[f] !== '')) missing.push(`${inp.name}[].${f}`); }
    if (!missing.length) for (const p of m.preconditions) { const ok = this.pre(p, inputs); if (!ok.ok) failed.push(ok.detail); }
    const ok = signal && intentOk && !missing.length && !failed.length;
    return { ok, signal, intent: intentOk, missing, failed, reason: ok ? 'inputs and preconditions satisfied' : [!signal && 'the question does not ask for what this method does', !intentOk && 'different kind of request', missing.length && 'missing inputs: ' + missing.join(', '), failed.length && 'precondition failed: ' + failed.join('; ')].filter(Boolean).join('; ') };
  }
  pre(p, scope) {
    const v = getPath(scope, p.path);
    if (p.op === 'min-count') return { ok: Array.isArray(v) && v.length >= p.value, detail: `${p.path} needs at least ${p.value} items` };
    if (p.op === 'all-positive') return { ok: Array.isArray(v) ? v.every(x => typeof x === 'number' && x > 0) : typeof v === 'number' && v > 0, detail: `${p.path} must be positive numbers` };
    if (p.op === 'present') return { ok: v !== undefined && v !== null, detail: `${p.path} is required` };
    if (p.op === 'same-unit') { const u = (Array.isArray(v) ? v : [v]).map(x => String(x || '').toLowerCase()); return { ok: new Set(u).size <= 1, detail: `${p.path} use different units (${[...new Set(u)].join(', ')}) — not comparable` }; }
    return { ok: false, detail: 'unknown precondition' };
  }
  // Run in the restricted interpreter. Evidence: every input record must cite a source when the method requires it.
  execute(id, inputs, { evidence = [] } = {}) {
    const m = this.S.methods[id]; if (!m || m.status !== 'active') throw new Error('method not active');
    const scope = structuredClone(inputs), trace = [];
    try {
      if (m.evidence?.requireSource) { const list = getPath(scope, m.evidence.each || m.inputs[0].name); const unsourced = (Array.isArray(list) ? list : [list]).filter(x => !x?.source); if (unsourced.length) throw new Error(`evidence required: ${unsourced.length} input record(s) have no source`); }
      for (const o of m.operations) {
        if (o.op === 'map-compute') { const f = compileExpr(o.expr); scope[o.over] = scope[o.over].map(r => ({ ...r, [o.as]: f(r) })); trace.push(`${o.as} = ${o.expr} for each of ${scope[o.over].length} ${o.over}`); }
        else if (o.op === 'rank') { scope[o.as || o.over] = [...scope[o.over]].sort((a, b) => (o.order === 'desc' ? -1 : 1) * (a[o.by] - b[o.by])); trace.push(`ranked ${o.over} by ${o.by} ${o.order || 'asc'}`); }
        else if (o.op === 'select') { scope[o.as] = scope[o.from][o.index || 0]; trace.push(`selected item ${o.index || 0} of ${o.from}`); }
        else if (o.op === 'filter') { const f = compileExpr(o.expr); scope[o.as || o.over] = scope[o.over].filter(r => f(r) > 0); trace.push(`kept ${o.over} where ${o.expr} > 0`); }
        else if (o.op === 'sum') { const f = compileExpr(o.expr); scope[o.as] = scope[o.over].reduce((a, r) => a + f(r), 0); trace.push(`${o.as} = sum of ${o.expr}`); }
        else if (o.op === 'difference' || o.op === 'ratio') { const a = getPath(scope, o.a), b = getPath(scope, o.b); if (o.op === 'ratio' && b === 0) throw new Error('division by zero'); scope[o.as] = o.op === 'ratio' ? a / b : a - b; trace.push(`${o.as} = ${o.a} ${o.op === 'ratio' ? '/' : '-'} ${o.b}`); }
        else if (o.op === 'threshold') { scope[o.as] = getPath(scope, o.path) >= o.value; trace.push(`${o.as} = ${o.path} ≥ ${o.value}`); }
      }
      for (const v of m.validation) { const r = this.pre(v, scope); if (!r.ok) throw new Error('validation: ' + r.detail); }
      const output = render(m.output.template, scope);
      m.outcomes.applied++; m.outcomes.succeeded++;
      const run = { at: new Date(this.now()).toISOString(), method: id, ok: true, output, trace, sources: [...new Set(JSON.stringify(inputs).match(/https?:\/\/[^"\s]+/g) || [])].slice(0, 8), evidence: evidence.slice(0, 8) };
      this.S.runs.push({ ...run, evidence: undefined }); if (this.S.runs.length > 200) this.S.runs.shift();
      return run;
    } catch (e) { m.outcomes.applied++; m.outcomes.failed++; m.counterexamples.push({ at: new Date(this.now()).toISOString(), reason: e.message }); if (m.counterexamples.length > 10) m.counterexamples.shift(); return { ok: false, method: id, error: e.message, trace }; }
  }
  // Pick the best applicable method for a problem; report why the others were rejected.
  solve({ text, intent = null, inputs }) {
    const tried = [];
    for (const m of this.active()) { const a = this.applicable(m, { text, intent, inputs }); tried.push({ method: m.id, family: m.family, ...a }); if (a.ok) return { applied: true, run: this.execute(m.id, inputs), method: m, tried }; m.outcomes.rejected += a.signal ? 1 : 0; }
    return { applied: false, tried };
  }
  // Teacher-call discipline: one request per unchanged learning need; a new call needs a recorded reason.
  needKey({ family, domain = '', missing = [], evidenceVersion = '' }) { return 'need:' + h([family, domain, [...missing].sort(), evidenceVersion]).slice(0, 20); }
  shouldAsk(need, { retryReason = null } = {}) {
    const key = this.needKey(need), prev = this.S.needs[key];
    if (this.inflight.has(key)) return { ask: false, key, reason: 'an identical request is already in flight', wait: this.inflight.get(key) };
    if (!prev) return { ask: true, key, reason: 'new learning need' };
    if (prev.status === 'learned') { const m = this.S.methods[prev.method]; if (m?.status === 'active' && !retryReason) return { ask: false, key, reason: 'already learned; reuse ' + prev.method }; return { ask: true, key, reason: m?.status === 'revoked' ? 'the lesson was revoked' : retryReason || 'lesson no longer active' }; }
    if (prev.status === 'failed') return retryReason ? { ask: true, key, reason: 'explicit retry: ' + retryReason } : { ask: false, key, reason: 'the previous teacher request failed; it is not retried silently — an explicit retry is required' };
    if (prev.status === 'revoked') return { ask: true, key, reason: 'the lesson was revoked' };
    return retryReason ? { ask: true, key, reason: retryReason } : { ask: false, key, reason: `need is ${prev.status}` };
  }
  async learn(need, teach, { retryReason = null } = {}) {
    const d = this.shouldAsk(need, { retryReason }); if (!d.ask) return d.wait ? d.wait : { learned: false, called: false, ...d };
    const work = (async () => {
      const rec = this.S.needs[d.key] = { ...need, status: 'requested', at: new Date(this.now()).toISOString(), reasons: [...(this.S.needs[d.key]?.reasons || []), d.reason].slice(-10), calls: (this.S.needs[d.key]?.calls || 0) + 1 };
      try { const r = await teach(need); const added = this.add(r.data, { source: 'teacher:' + (r.provider || 'unknown'), model: r.model || null }); if (!added.ok) { rec.status = 'failed'; rec.error = 'teacher method rejected: ' + added.issues.join('; '); return { learned: false, called: true, key: d.key, reason: rec.error }; } rec.status = 'learned'; rec.method = added.method.id; return { learned: true, called: true, key: d.key, reason: d.reason, method: added.method }; }
      catch (e) { rec.status = 'failed'; rec.error = e.message; return { learned: false, called: true, key: d.key, reason: 'teacher request failed: ' + e.message }; }
    })();
    this.inflight.set(d.key, work); try { return await work; } finally { this.inflight.delete(d.key); }
  }
  status() { const all = Object.values(this.S.methods); return { methods: all.length, active: all.filter(m => m.status === 'active').length, needs: Object.keys(this.S.needs).length, runs: this.S.runs.length }; }
}

// Price/quantity options now come from the structured extractor (currencies before/after, per-unit prices, unit
// normalisation such as MB→GB and ml→l). Kept as a named export for compatibility.
import { extractQuantityOptions } from './extract.mjs';
export function extractPriceOptions(text) { return extractQuantityOptions(text); }
