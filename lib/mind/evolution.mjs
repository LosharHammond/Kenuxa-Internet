// Cognitive Evolution Engine.
// Cycle: attempt → verify against an independent correction → diagnose → generate candidates → test (training cases,
// structurally similar held-out cases, full regression over the case bank) → promote or refute → version → monitor →
// roll back on a verified regression. Only DECLARATIVE atoms evolve live (procedures, rules, strategy records);
// executable code never changes at run time. A correction must come from a verifiable source (a human, a
// deterministic test, a cited reference) — the engine never trains on its own outputs or on teacher agreement alone.
import { solve, synthesize, LIBRARY } from './procedures.mjs';
import { parseQuantities } from './quantities.mjs';
import { testProcedure, UNITS, DIMS, dimKey } from '../peers/tasks.mjs';
import { contentHash } from '../atoms/codec.mjs';

const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9);
const VERIFIERS = new Set(['human', 'test', 'reference', 'measurement']);
const NAMES = { energy: 'energy', power: 'load', fraction: 'efficiency', time: 'duration', charge: 'capacity', voltage: 'voltage', money: 'amount', 'price-per-energy': 'tariff', number: 'count', current: 'current' };

export class EvolutionEngine {
  constructor({ store, state = {}, now = () => Date.now(), procedures = () => [...LIBRARY, ...store.usable('procedure')] }) {
    this.store = store; this.S = state; this.S.corrections ||= []; this.S.cases ||= []; this.S.trainedOn ||= []; this.S.events ||= []; this.now = now; this.procedures = procedures;
  }
  log(e) { this.S.events.push({ at: this.now(), ...e }); if (this.S.events.length > 300) this.S.events.splice(0, this.S.events.length - 300); }
  // The case bank: verified problems with expected answers, split into 'dev' (may be learned from) and 'held-out'.
  addCase(c) { const id = contentHash([c.problem, c.expected]).slice(0, 16); if (this.S.cases.some(x => x.id === id)) return id; this.S.cases.push({ id, split: c.split === 'held-out' ? 'held-out' : 'dev', problem: c.problem, expected: c.expected, family: c.family || null }); return id; }
  score(procs, cases = this.S.cases) { const res = cases.map(c => { const r = solve(c.problem, { procedures: procs }); return { id: c.id, split: c.split, ok: !!(r.ok && close(r.answer.value, c.expected.value)), got: r.ok ? r.answer.value : null }; }); return { passed: res.filter(r => r.ok).length, total: res.length, results: res }; }

  // One learning opportunity from a verified correction.
  learn({ problem, expected, verifiedBy = 'human', ref = null }) {
    if (!VERIFIERS.has(verifiedBy)) return { ok: false, stage: 'verify', reason: `corrections must be independently verified (${[...VERIFIERS].join(', ')}); got "${verifiedBy}"` };
    const caseId = this.addCase({ problem, expected, split: 'dev' }); this.S.trainedOn.push(caseId);
    const before = solve(problem, { procedures: this.procedures() }), wasRight = before.ok && close(before.answer.value, expected.value);
    this.S.corrections.push({ at: this.now(), problem, expected, verifiedBy, ref, before: before.ok ? before.answer.value : null, wasRight });
    if (wasRight) { this.log({ kind: 'confirmed', problem }); return { ok: true, stage: 'attempt', status: 'already-correct', answer: before.answer }; }
    // ---- diagnose
    const qs = parseQuantities(problem).filter(q => q.dim !== 'number' && UNITS[q.unit]);
    const used = before.ok ? new Set(before.steps.flatMap(s => Object.values(s.inputs).map(v => `${v.value}${v.unit}`))) : new Set();
    const unused = qs.filter(q => !used.has(`${q.value}${q.unit}`));
    const diagnosis = !before.ok ? { cause: before.reason === 'missing information' ? 'missing procedure for this combination of inputs' : 'no applicable procedure', detail: before.reason }
      : unused.length ? { cause: 'invalid assumption — a stated quantity was ignored', detail: `ignored: ${unused.map(q => q.raw).join(', ')}; the procedure used (${before.steps.map(s => s.procedure).join(' → ')}) has no input for it` }
      : { cause: 'faulty procedure — all quantities were used but the result is wrong', detail: `got ${before.answer.value}, expected ${expected.value}` };
    // ---- generate candidates: synthesize from all verified DEV cases with the same input dimensions and target
    const target = before.target || { dim: Object.entries(UNITS).find(([u]) => u === String(expected.unit).toLowerCase())?.[1][0] || 'number' };
    const dimsOf = p => parseQuantities(p).filter(q => q.dim !== 'number' && UNITS[q.unit]).map(q => q.dim);
    const sigOf = p => dimsOf(p).sort().join(',');
    const train = this.S.cases.filter(c => c.split === 'dev' && sigOf(c.problem) === sigOf(problem));
    const names = [], dims = {}; for (const q of qs) { let n = NAMES[q.dim] || q.dim.replace(/[^a-z]/g, ''); while (names.includes(n)) n += '2'; names.push(n); dims[n] = q.dim; }
    const toEx = c => { const cq = parseQuantities(c.problem).filter(q => q.dim !== 'number' && UNITS[q.unit]); const inputs = {}; const pool = [...cq]; for (const n of names) { const i = pool.findIndex(q => q.dim === dims[n]); if (i < 0) return null; inputs[n] = { value: pool[i].value, unit: pool[i].unit }; pool.splice(i, 1); } return { inputs, output: { value: c.expected.value } }; };
    const examples = train.map(toEx).filter(Boolean);
    const outUnit = String(expected.unit || '').toLowerCase() in UNITS ? expected.unit : '';
    if (examples.length < (this.settings?.minExamples || 1)) return { ok: false, stage: 'generate', diagnosis, reason: `needs at least ${this.settings.minExamples} verified examples with this structure (has ${examples.length})` };
    const syn = synthesize({ names, dims, outDim: UNITS[String(outUnit).toLowerCase()]?.[0] || target.dim, outUnit, train: examples, ...(this.settings ? { maxLeaves: this.settings.synthesisMaxLeaves, constants: this.settings.synthesisConstants } : {}) });
    if (!syn.ok) { this.log({ kind: 'no-candidate', problem, diagnosis }); return { ok: false, stage: 'generate', diagnosis, reason: syn.reason }; }
    // cues: words next to each quantity in the problem text (used later to bind roles)
    const cues = Object.fromEntries(names.map((n, i) => { const q = qs[i], win = problem.slice(Math.max(0, q.index - 30), q.index + q.raw.length + 20).toLowerCase().match(/[a-z]{4,}/g) || []; return [n, [...new Set(win)].slice(0, 4).join('|') || n]; }));
    const id = `proc:learned:${target.name || target.dim}:${contentHash(syn.expr).slice(0, 8)}`;
    const candidate = { id, category: 'procedure', label: `Learned: ${target.label || target.dim} = ${syn.expr} (from ${examples.length} verified correction${examples.length > 1 ? 's' : ''})`, status: 'candidate',
      body: { inputs: syn.spec.inputs.map(inp => ({ ...inp, cues: cues[inp.name] })), steps: syn.spec.steps, outputs: syn.spec.outputs, tests: examples.map(e => ({ inputs: e.inputs, expect: { result: e.output.value } })), goal: target.name || undefined },
      evidence: [{ kind: verifiedBy, ref: ref || 'correction', detail: `${examples.length} verified example(s)` }], provenance: { source: 'evolution engine', derivedFrom: train.map(c => c.id) }, failures: [diagnosis] };
    const put = this.store.put(candidate, { reason: 'candidate from correction' }); if (!put.ok) return { ok: false, stage: 'generate', diagnosis, reason: put.issues.join('; ') };
    return { ok: true, stage: 'candidate', diagnosis, candidate: id, expr: syn.expr, alternatives: syn.alternatives, ...this.evaluate(id) };
  }

  // Compare the procedure set with and without the candidate: the failing case must be fixed, held-out cases with the
  // same structure must pass, and nothing that passed before may fail (regression protection).
  evaluate(id) {
    const cand = this.store.get(id); if (!cand) return { promoted: false, reason: 'unknown candidate' };
    const base = this.procedures().filter(p => p.id !== id), withC = [...base, cand];
    const own = testProcedure(cand.body);
    const b = this.score(base), a = this.score(withC);
    const regressions = b.results.filter((r, i) => r.ok && !a.results[i].ok).map(r => r.id);
    const fixed = b.results.filter((r, i) => !r.ok && a.results[i].ok).map(r => r.id);
    const heldOut = a.results.filter(r => r.split === 'held-out'), heldBase = b.results.filter(r => r.split === 'held-out');
    const contaminated = this.S.trainedOn.filter(x => heldOut.some(r => r.id === x));
    const report = { ownTests: `${own.passed}/${own.total}`, before: `${b.passed}/${b.total}`, after: `${a.passed}/${a.total}`, fixed, regressions, heldOut: { before: heldBase.filter(r => r.ok).length, after: heldOut.filter(r => r.ok).length, total: heldOut.length }, contaminated };
    const promote = own.passed === own.total && fixed.length > 0 && !regressions.length && !contaminated.length && report.heldOut.after >= report.heldOut.before;
    this.store.setStatus(id, promote ? 'promoted' : 'refuted', { evidence: [{ kind: 'evaluation', ref: 'case bank', detail: JSON.stringify(report).slice(0, 400) }], reason: promote ? 'validated: fixes the case, no regressions, held-out not worse' : 'rejected by evaluation' });
    this.log({ kind: promote ? 'promoted' : 'refuted', id, report });
    return { promoted: promote, report, reason: promote ? 'fixes the failing case with no regressions' : !fixed.length ? 'does not fix any failing case' : regressions.length ? `breaks ${regressions.length} case(s) that passed before` : contaminated.length ? 'held-out cases were used for training' : own.passed < own.total ? 'fails its own tests' : 'held-out performance dropped' };
  }
  // Monitoring: a verified failure of a promoted atom retires it (rollback to the library behaviour) and records why.
  reportFailure(id, { problem, expected, verifiedBy = 'human' }) {
    const a = this.store.get(id); if (!a || !VERIFIERS.has(verifiedBy)) return { ok: false };
    this.addCase({ problem, expected, split: 'dev' });
    const r = solve(problem, { procedures: [...LIBRARY, a] }); if (r.ok && close(r.answer.value, expected.value)) return { ok: true, rolledBack: false, reason: 'the atom answers this case correctly' };
    this.store.setStatus(id, 'retired', { evidence: [{ kind: verifiedBy, ref: 'regression', detail: problem.slice(0, 160) }], reason: 'verified failure after promotion' }); this.log({ kind: 'rolled-back', id, problem });
    return { ok: true, rolledBack: true };
  }
  // candidates for distributed regression testing on volunteer peers (public, deterministic)
  pendingForPeers() { return this.store.list({ category: 'procedure', status: ['candidate', 'promoted'] }).filter(a => a.visibility === 'public').map(a => ({ id: a.id, spec: a.body, cases: a.body.tests })); }
  status() { return { corrections: this.S.corrections.length, cases: { dev: this.S.cases.filter(c => c.split === 'dev').length, heldOut: this.S.cases.filter(c => c.split === 'held-out').length }, recent: this.S.events.slice(-8) }; }
}
