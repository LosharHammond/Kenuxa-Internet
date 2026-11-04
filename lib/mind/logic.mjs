// Reasoning methods that are not domain-specific: deduction (forward chaining with variable binding and proofs),
// contradiction detection, induction (candidate rules with support, confidence and counterexamples), analogy
// (structure mapping with projected — unverified — inferences), temporal reasoning (Allen relations and simple
// temporal networks), constraint satisfaction with optimisation, and Bayesian updating with an explicit model.
// Every function returns the operations it actually performed so the trace shown to people is the real one.

const isVar = t => typeof t === 'string' && t.startsWith('?');
const key = f => JSON.stringify(f);
function unify(pattern, fact, b) {
  if (pattern.length !== fact.length) return null; const out = { ...b };
  for (let i = 0; i < pattern.length; i++) { const p = pattern[i], f = fact[i];
    if (isVar(p)) { if (out[p] === undefined) out[p] = f; else if (out[p] !== f) return null; } else if (p !== f) return null; }
  return out;
}
const subst = (pattern, b) => pattern.map(t => isVar(t) ? (b[t] ?? t) : t);

// ---------- deduction ----------
// facts: [[rel, ...args]]; rules: [{ id, if: [patterns], unless?: [patterns], then: [patterns] }]
// `unless` is negation-as-failure over the CURRENT closure (stratified by running rules without `unless` first).
export function deduce(facts, rules, { maxRounds = 30, maxFacts = 5000 } = {}) {
  const known = new Map(facts.map(f => [key(f), { fact: f, given: true }])), steps = [];
  const ordered = [...rules.filter(r => !r.unless?.length), ...rules.filter(r => r.unless?.length)];
  for (let round = 0; round < maxRounds; round++) {
    let added = 0;
    for (const r of ordered) {
      let bindings = [{}];
      for (const pat of r.if) { const next = []; for (const b of bindings) for (const { fact } of known.values()) { const u = unify(subst(pat, b), fact, b); if (u) next.push(u); } bindings = next; if (!bindings.length) break; }
      for (const b of bindings) {
        if ((r.unless || []).some(pat => [...known.values()].some(({ fact }) => unify(subst(pat, b), fact, b)))) continue;
        for (const c of r.then) { const f = subst(c, b); if (f.some(isVar)) continue; const k = key(f); if (known.has(k)) continue;
          known.set(k, { fact: f, rule: r.id, bindings: b, premises: r.if.map(p => subst(p, b)) }); steps.push({ round, rule: r.id, derived: f, from: r.if.map(p => subst(p, b)) }); added++;
          if (known.size > maxFacts) return { facts: [...known.values()], steps, truncated: true, contradictions: contradictions([...known.values()].map(x => x.fact)) }; }
      }
    }
    if (!added) break;
  }
  const all = [...known.values()];
  return { facts: all, steps, contradictions: contradictions(all.map(x => x.fact)) };
}
// proof tree for one fact (null when not derivable)
export function prove(goal, result) {
  const m = new Map(result.facts.map(x => [key(x.fact), x])), seen = new Set();
  const tree = f => { const x = m.get(key(f)); if (!x || seen.has(key(f))) return null; seen.add(key(f)); return x.given ? { fact: f, given: true } : { fact: f, rule: x.rule, from: x.premises.map(tree) }; };
  for (const x of result.facts) if (unify(goal, x.fact, {})) return tree(x.fact);
  return null;
}
// ['not', rel, ...] contradicts [rel, ...]; ['exclusive', relA, relB] declares two relations incompatible for the same args
export function contradictions(facts) {
  const set = new Set(facts.map(key)), out = [], excl = facts.filter(f => f[0] === 'exclusive');
  for (const f of facts) { if (f[0] === 'not' && set.has(key(f.slice(1)))) out.push({ a: f.slice(1), b: f, kind: 'negation' }); }
  for (const [, ra, rb] of excl) for (const f of facts) if (f[0] === ra) { const g = [rb, ...f.slice(1)]; if (set.has(key(g))) out.push({ a: f, b: g, kind: 'exclusive relations' }); }
  return out;
}

// ---------- induction ----------
// records: [{ attr: value, ... }], target: attribute to explain. Proposes single- and two-condition rules.
// A rule is reported as a CORRELATION with support (how many records match), confidence (share of matches with the
// target value) and its counterexamples. minSupport and minConfidence decide whether it is a candidate at all.
export function induce(records, target, { minSupport = 3, minConfidence = 0.8, maxRules = 10 } = {}) {
  const attrs = [...new Set(records.flatMap(r => Object.keys(r)))].filter(a => a !== target), values = {};
  for (const a of attrs) values[a] = [...new Set(records.map(r => r[a]).filter(v => v !== undefined))];
  const conds = attrs.flatMap(a => values[a].map(v => [[a, v]]));
  for (let i = 0; i < conds.length; i++) for (let j = i + 1; j < conds.length; j++) if (conds[i][0][0] !== conds[j][0][0]) conds.push([...conds[i], ...conds[j]]);
  const targets = [...new Set(records.map(r => r[target]).filter(v => v !== undefined))], rules = [];
  for (const c of conds) { const match = records.filter(r => c.every(([a, v]) => r[a] === v)); if (match.length < minSupport) continue;
    for (const tv of targets) { const hit = match.filter(r => r[target] === tv), conf = hit.length / match.length; if (conf < minConfidence) continue;
      rules.push({ if: c, then: [target, tv], support: match.length, confidence: +conf.toFixed(3), counterexamples: match.filter(r => r[target] !== tv), status: 'candidate', note: 'correlation in the observed records; not evidence of causation' }); } }
  // drop two-condition rules that add nothing over a one-condition rule with the same conclusion and confidence
  const pruned = rules.filter(r => r.if.length === 1 || !rules.some(s => s.if.length === 1 && s.then[1] === r.then[1] && r.if.some(([a, v]) => s.if[0][0] === a && s.if[0][1] === v) && s.confidence >= r.confidence));
  return pruned.sort((a, b) => b.confidence - a.confidence || b.support - a.support).slice(0, maxRules);
}
// test a candidate rule on records it was NOT induced from
export function testRule(rule, records, target) { const m = records.filter(r => rule.if.every(([a, v]) => r[a] === v)); const ok = m.filter(r => r[target] === rule.then[1]); return { matched: m.length, correct: ok.length, accuracy: m.length ? ok.length / m.length : null }; }

// ---------- analogy (structure mapping) ----------
// base/target: [[rel, a, b]]. Finds the entity mapping that preserves the most relations (relations must match by
// name — structure, not surface similarity), then projects base relations that have no counterpart in the target.
// Projections are hypotheses: the caller must verify that the analogy applies before using them.
export function analogy(base, target, { maxEntities = 12 } = {}) {
  const ents = g => [...new Set(g.flatMap(f => f.slice(1)))]; const be = ents(base).slice(0, maxEntities), te = ents(target);
  const tset = new Set(target.map(key)); let best = { map: {}, score: -1 }, explored = 0;
  const score = map => base.filter(([r, a, b]) => map[a] !== undefined && map[b] !== undefined && tset.has(key([r, map[a], map[b]]))).length;
  const rec = (i, map, usedT) => { explored++; if (explored > 200000) return; if (i === be.length) { const s = score(map); if (s > best.score) best = { map: { ...map }, score: s }; return; }
    // bound: current score + remaining base relations involving unmapped entities
    const remaining = base.filter(([, a, b]) => be.indexOf(a) >= i || be.indexOf(b) >= i).length; if (score(map) + remaining <= best.score) return;
    for (const t of te) if (!usedT.has(t)) { map[be[i]] = t; usedT.add(t); rec(i + 1, map, usedT); usedT.delete(t); delete map[be[i]]; }
    rec(i + 1, map, usedT); };
  rec(0, {}, new Set());
  const matched = base.filter(([r, a, b]) => tset.has(key([r, best.map[a], best.map[b]])));
  const projected = base.filter(([r, a, b]) => best.map[a] !== undefined && best.map[b] !== undefined && !tset.has(key([r, best.map[a], best.map[b]]))).map(([r, a, b]) => ({ relation: [r, best.map[a], best.map[b]], from: [r, a, b], status: 'hypothesis' }));
  return { mapping: best.map, matched, projected, coverage: base.length ? +(matched.length / base.length).toFixed(3) : 0, explored, applicable: matched.length >= 2 && matched.length / base.length >= 0.5 };
}

// ---------- temporal ----------
export function allen(a, b) { // intervals { start, end }
  if (a.end < b.start) return 'before'; if (b.end < a.start) return 'after'; if (a.end === b.start) return 'meets'; if (b.end === a.start) return 'met-by';
  if (a.start === b.start && a.end === b.end) return 'equals'; if (a.start === b.start) return a.end < b.end ? 'starts' : 'started-by';
  if (a.end === b.end) return a.start > b.start ? 'finishes' : 'finished-by'; if (a.start > b.start && a.end < b.end) return 'during'; if (a.start < b.start && a.end > b.end) return 'contains';
  return a.start < b.start ? 'overlaps' : 'overlapped-by';
}
// Simple temporal network: points and constraints lo ≤ t[b] − t[a] ≤ hi. Floyd–Warshall; a negative cycle means
// the constraints cannot all hold. Returns earliest/latest times relative to the first point.
export function stn(points, constraints) {
  const n = points.length, ix = Object.fromEntries(points.map((p, i) => [p, i])), INF = 1e15, d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : INF));
  for (const { a, b, lo = -INF, hi = INF } of constraints) { const i = ix[a], j = ix[b]; d[i][j] = Math.min(d[i][j], hi); d[j][i] = Math.min(d[j][i], -lo); }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  for (let i = 0; i < n; i++) if (d[i][i] < 0) { const conflict = constraints.filter(c => d[ix[c.a]][ix[c.a]] < 0 || d[ix[c.b]][ix[c.b]] < 0); return { consistent: false, conflict }; }
  return { consistent: true, earliest: Object.fromEntries(points.map((p, i) => [p, -d[i][0] >= INF / 2 ? null : -d[i][0]])), latest: Object.fromEntries(points.map((p, i) => [p, d[0][i] >= INF / 2 ? null : d[0][i]])) };
}

// ---------- constraint satisfaction and optimisation ----------
// vars: { name: [values] }; constraints (declarative): { type: 'sum<=', vars, weights: {var:{value:w}}, limit } |
// { type: 'sum>=', ... } | { type: 'requires', if: [var, val], then: [var, val] } | { type: 'excludes', a: [var,val], b: [var,val] } |
// { type: 'neq', vars } | { type: 'eq', var, value }. objective: { weights: {var:{value:w}}, sense: 'max'|'min' }
export function solveCSP(vars, constraints, { objective = null, maxNodes = 200000 } = {}) {
  const names = Object.keys(vars).sort((a, b) => vars[a].length - vars[b].length); let nodes = 0, best = null, bestVal = objective?.sense === 'min' ? Infinity : -Infinity, first = null;
  const w = (W, a) => Object.entries(a).reduce((s, [k, v]) => s + (W?.[k]?.[v] ?? 0), 0);
  const ok = a => constraints.every(c => {
    if (c.type === 'sum<=' || c.type === 'sum>=') { const assigned = c.vars.filter(v => a[v] !== undefined), s = assigned.reduce((t, v) => t + (c.weights[v]?.[a[v]] ?? 0), 0);
      if (c.type === 'sum<=') { const minRest = c.vars.filter(v => a[v] === undefined).reduce((t, v) => t + Math.min(...vars[v].map(x => c.weights[v]?.[x] ?? 0)), 0); return s + minRest <= c.limit + 1e-9; }
      const maxRest = c.vars.filter(v => a[v] === undefined).reduce((t, v) => t + Math.max(...vars[v].map(x => c.weights[v]?.[x] ?? 0)), 0); return s + maxRest >= c.limit - 1e-9; }
    if (c.type === 'requires') return a[c.if[0]] !== c.if[1] || a[c.then[0]] === undefined || a[c.then[0]] === c.then[1];
    if (c.type === 'excludes') return !(a[c.a[0]] === c.a[1] && a[c.b[0]] === c.b[1]);
    if (c.type === 'neq') { const v = c.vars.map(x => a[x]).filter(x => x !== undefined); return new Set(v).size === v.length; }
    if (c.type === 'eq') return a[c.var] === undefined || a[c.var] === c.value;
    return true; });
  const rec = (i, a) => { if (++nodes > maxNodes) return; if (!ok(a)) return;
    if (i === names.length) { if (!first) first = { ...a }; if (!objective) return true; const v = w(objective.weights, a); if (objective.sense === 'min' ? v < bestVal : v > bestVal) { bestVal = v; best = { ...a }; } return; }
    for (const val of vars[names[i]]) { a[names[i]] = val; if (rec(i + 1, a) === true && !objective) return true; delete a[names[i]]; } };
  rec(0, {});
  const sol = objective ? best : first;
  return { satisfiable: !!sol, solution: sol, value: objective && sol ? bestVal : null, nodes, exhausted: nodes > maxNodes };
}

// ---------- probability (only with an explicit model) ----------
// priors: { h: p }, likelihoods: { h: { evidence: P(e|h) } }, observed: { evidence: true|false }
export function bayes(priors, likelihoods, observed) {
  const post = {}; let z = 0;
  for (const [h, p] of Object.entries(priors)) { let l = p; for (const [e, v] of Object.entries(observed)) { const pe = likelihoods[h]?.[e]; if (pe === undefined) continue; l *= v ? pe : 1 - pe; } post[h] = l; z += l; }
  if (!z) return { posterior: null, reason: 'the evidence is impossible under every hypothesis in the model' };
  for (const h in post) post[h] = +(post[h] / z).toFixed(4);
  return { posterior: post, model: 'explicit priors and likelihoods supplied with the causal atoms' };
}
