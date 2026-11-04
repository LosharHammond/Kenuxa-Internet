// Causal reasoning: abduction over causal atoms (explanations ranked by agreement with the evidence, never declared
// proven), discriminating tests chosen by how well they split the remaining explanations, structural causal models
// (SCM) with interventions do(X = v), counterfactual comparison against the factual run, and necessary / sufficient
// checks by enumerating the model's background conditions.
import { parseExpr } from '../peers/tasks.mjs';
import { bayes } from './logic.mjs';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- abduction ----------
// causes: causal atom bodies { cause, effect, signs: { observable: expected (true/false/string) }, test: { name: safe step } , prior?, likelihood? }
// observation: effect name; evidence: { observable: value } that is KNOWN. Unknown observables are missing evidence.
export function abduce(observation, causes, evidence = {}, { maxDepth = 2 } = {}) {
  const obs = norm(observation), hyps = [];
  const direct = causes.filter(c => norm(c.effect) === obs);
  // one level of chaining: X causes Y, Y causes the observation
  const chained = maxDepth > 1 ? causes.filter(c => direct.some(d => norm(d.cause) === norm(c.effect))) : [];
  for (const c of [...direct, ...chained.map(c => ({ ...c, via: direct.find(d => norm(d.cause) === norm(c.effect)).cause }))]) {
    const signs = Object.entries(c.signs || {}), agree = [], disagree = [], unknown = [];
    for (const [s, expect] of signs) { if (!(s in evidence)) unknown.push(s); else if (evidence[s] === expect) agree.push(s); else disagree.push(s); }
    hyps.push({ cause: c.cause, via: c.via || null, mechanism: c.mechanism || null, agree, disagree, unknown, score: agree.length - 2 * disagree.length, status: disagree.length ? 'contradicted by evidence' : agree.length && !unknown.length ? 'consistent with all evidence checked' : agree.length ? 'partly supported' : 'possible (no evidence yet)', safety: c.safety || null, signs: c.signs || {}, tests: c.tests || {}, prior: c.prior, likelihood: c.likelihood });
  }
  hyps.sort((a, b) => b.score - a.score || a.disagree.length - b.disagree.length);
  const alive = hyps.filter(h => !h.disagree.length);
  // value of a test: an observable whose expected values differ across the surviving hypotheses (balanced split best)
  const observables = [...new Set(alive.flatMap(h => h.unknown))].map(o => { const groups = {}; for (const h of alive) { const v = o in h.signs ? JSON.stringify(h.signs[o]) : 'no-prediction'; (groups[v] ||= []).push(h.cause); }
    const sizes = Object.values(groups).map(g => g.length), predicted = alive.filter(h => o in h.signs).length;
    const split = Object.keys(groups).length > 1 ? 1 - Math.max(...sizes) / alive.length : 0; return { observable: o, splits: split, predictedBy: predicted, groups, how: alive.map(h => h.tests[o]).find(Boolean) || null }; })
    .filter(x => x.splits > 0 || x.predictedBy === alive.length).sort((a, b) => b.splits - a.splits || b.predictedBy - a.predictedBy);
  // Bayesian ranking only when EVERY surviving hypothesis carries an explicit prior and likelihoods
  let probabilistic = null;
  if (alive.length && alive.every(h => typeof h.prior === 'number' && h.likelihood)) probabilistic = bayes(Object.fromEntries(alive.map(h => [h.cause, h.prior])), Object.fromEntries(alive.map(h => [h.cause, h.likelihood])), evidence);
  return { observation, hypotheses: hyps, alive: alive.map(h => h.cause), ruledOut: hyps.filter(h => h.disagree.length).map(h => ({ cause: h.cause, because: h.disagree })), nextTests: observables.slice(0, 4), probabilistic, conclusion: alive.length === 1 && alive[0].agree.length ? 'one explanation remains consistent with the evidence (not proven)' : alive.length ? `${alive.length} explanations remain possible` : 'no known explanation fits the evidence — knowledge gap' };
}

// ---------- structural causal models ----------
// model: { vars: { name: { exo?: true, value?, eq?: 'bool or numeric expression' } } }
// Boolean expressions: names, true/false, AND OR NOT, parentheses, comparisons (x > 0, x <= 3, a == b) whose sides
// are numeric expressions. Numeric equations use the procedure kernel's parser.
function compileBool(src) {
  const toks = String(src).match(/AND|OR|NOT|true|false|[<>]=?|==|!=|\(|\)|[^\s()<>=!]+(?:\s*[+\-*/]\s*[^\s()<>=!]+)*/g) || []; let i = 0;
  const peek = () => toks[i];
  const prim = () => { const t = toks[i++]; if (t === 'NOT') { const a = prim(); return e => !a(e); } if (t === '(') { const a = or(); i++; return a; } if (t === 'true') return () => true; if (t === 'false') return () => false;
    if (['<', '>', '<=', '>=', '==', '!='].includes(peek())) { const op = toks[i++], r = toks[i++], L = parseExpr(t), R = parseExpr(r); return e => { const a = L.eval(e), b = R.eval(e); return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : a !== b; }; }
    return e => { const v = e[t]; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; throw new Error('unknown variable ' + t); }; };
  const and = () => { let a = prim(); while (peek() === 'AND') { i++; const l = a, r = prim(); a = e => l(e) && r(e); } return a; };
  const or = () => { let a = and(); while (peek() === 'OR') { i++; const l = a, r = and(); a = e => l(e) || r(e); } return a; };
  return or();
}
const isBoolExpr = s => /\b(AND|OR|NOT|true|false)\b|[<>]=?|==|!=/.test(s); /* otherwise numeric; equations may also declare type: 'bool' | 'num' */
export function evaluateModel(model, { interventions = {}, exogenous = {} } = {}) {
  const v = {}, order = [], pending = new Set(Object.keys(model.vars)), done = new Set();
  for (const [n, d] of Object.entries(model.vars)) if (d.exo || n in interventions) { v[n] = n in interventions ? interventions[n] : n in exogenous ? exogenous[n] : d.value; done.add(n); pending.delete(n); order.push(n); }
  for (let guard = 0; pending.size && guard < 100; guard++) for (const n of [...pending]) { const d = model.vars[n];
    try { const scope = { ...v }; const val = (d.type || (isBoolExpr(d.eq) ? 'bool' : 'num')) === 'bool' ? compileBool(d.eq)(scope) : parseExpr(d.eq).eval(scope); v[n] = val; pending.delete(n); done.add(n); order.push(n); } catch (e) { if (!/unknown variable|missing or not a number/.test(e.message)) throw e; } }
  if (pending.size) throw new Error('model has a cycle or missing parents: ' + [...pending].join(', '));
  return { values: v, order };
}
// counterfactual: same background conditions, with the intervention; reports every variable that changed
export function counterfactual(model, interventions, { exogenous = {} } = {}) {
  const factual = evaluateModel(model, { exogenous }), cf = evaluateModel(model, { interventions, exogenous });
  const changed = Object.keys(cf.values).filter(k => JSON.stringify(cf.values[k]) !== JSON.stringify(factual.values[k])).map(k => ({ variable: k, factual: factual.values[k], counterfactual: cf.values[k], intervened: k in interventions }));
  return { premise: interventions, hypothetical: true, factual: factual.values, counterfactual: cf.values, changed };
}
// necessity / sufficiency of X for Y over all combinations of boolean exogenous variables (bounded)
export function necessarySufficient(model, x, y) {
  const exo = Object.entries(model.vars).filter(([n, d]) => d.exo && typeof d.value === 'boolean' && n !== x).map(([n]) => n).slice(0, 12), out = { necessary: true, sufficient: true, contexts: 0, counterexamples: [] };
  for (let m = 0; m < 1 << exo.length; m++) { const ctx = Object.fromEntries(exo.map((n, i) => [n, !!(m & (1 << i))])); out.contexts++;
    const y1 = !!evaluateModel(model, { exogenous: ctx, interventions: { [x]: true } }).values[y], y0 = !!evaluateModel(model, { exogenous: ctx, interventions: { [x]: false } }).values[y];
    if (y0) { out.necessary = false; if (out.counterexamples.length < 3) out.counterexamples.push({ kind: 'not necessary', context: ctx }); }
    if (!y1) { out.sufficient = false; if (out.counterexamples.length < 3) out.counterexamples.push({ kind: 'not sufficient', context: ctx }); } }
  out.contributing = !out.necessary && !out.sufficient && out.counterexamples.length > 0;
  return out;
}
