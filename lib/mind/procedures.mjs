// Procedure Atom Library: executable, dimension-checked methods, composition by backward chaining over physical
// dimensions, and synthesis of new procedures from verified examples (a bounded search over expressions that is
// pruned by dimensional analysis and accepted only if it also passes held-out cases).
import { runProcedure, testProcedure, checkProcedure, parseExpr, DIMS, dimKey, UNITS } from '../peers/tasks.mjs';
import { parseQuantities } from './quantities.mjs';

import {loadCore} from '../foundation/data.mjs';
export const LIBRARY=loadCore('procedures.json');
// ---------- what the question asks for ----------
export function targetOf(text) {
  const t = String(text || '').toLowerCase();
  if (/\bhow many\b[^?.]{0,24}\bpanels\b/.test(t)) return { dim: 'number', name: 'panels', label: 'number of panels' };
  if (/\b(how much (will|would|does|do) (it|this|that|i) (cost|pay)|how much money|cost|bill|pay)\b/.test(t) && /\b(kwh|tariff|per kwh|electricity|cost)\b/.test(t)) return { dim: 'money', label: 'cost' };
  if (/\b(how long (will|would|does|can|to)|how many (hours|minutes)|runtime|last(s)?\b|until (it|the battery) (dies|is empty))/.test(t)) return /charg/.test(t) && /(take|to|time) (to )?(fully )?(re)?charg/.test(t) ? { dim: 'time', name: 'charging-time', label: 'charging time' } : { dim: 'time', name: /\b(last|lasts|runtime|run|runs|running|power|keep .* (on|going|running)|until)\b/.test(t) ? 'runtime' : null, label: 'time' };
  if (/\b(how much (energy|electricity|power does)|energy (use|consumption)|consum|kwh (does|will|would)|how many (kwh|wh|kilowatt))/.test(t)) return { dim: 'energy', label: 'energy' };
  return null;
}

// Bind text quantities to procedure inputs by dimension, then by role cues near the number, then by order.
function bind(proc, qs, text) {
  const t = String(text).toLowerCase(), used = new Set(), out = {}, why = {};
  for (const inp of proc.body.inputs) {
    const cands = qs.map((q, i) => ({ q, i })).filter(({ q, i }) => !used.has(i) && UNITS[q.unit] && dimKey(DIMS[UNITS[q.unit][0]]) === dimKey(DIMS[inp.dim]));
    if (!cands.length) continue;
    const cue = new RegExp(`\\b(${inp.cues})`, 'i');
    const scored = cands.map(c => { const win = t.slice(Math.max(0, c.q.index - 40), c.q.index + c.q.raw.length + 25); return { ...c, s: cue.test(win) ? 1 : 0 }; }).sort((a, b) => b.s - a.s || a.q.index - b.q.index);
    const pick = scored[0]; used.add(pick.i); out[inp.name] = { value: pick.q.value, unit: pick.q.unit }; why[inp.name] = `${pick.q.raw}${pick.s ? ' (matched by role words)' : ' (only quantity of this kind)'}`;
  }
  const hits = Object.values(why).filter(w => /role words/.test(w)).length;
  return { inputs: out, why, used, hits };
}

// Backward chaining over dimensions: find a chain of procedures whose final output has the target dimension and
// whose inputs are all given in the text, have defaults, or are produced by an earlier procedure in the chain.
export function solve(text, { procedures = LIBRARY, target = targetOf(text), quantities = parseQuantities(text), maxDepth = 4 } = {}) {
  if (!target) return { ok: false, reason: 'no computable target recognised' };
  const usable = procedures.filter(p => p.body && !checkProcedure(p.body).length);
  const outDim = p => { const o = p.body.outputs[0], st = p.body.steps.find(s => s.as === o.name); return st?.dim || (o.unit !== undefined && UNITS[String(o.unit).toLowerCase()]?.[0]); };
  const sameDim = (p, dim) => outDim(p) === dim || (dimKey(DIMS[outDim(p)] || {}) === dimKey(DIMS[dim] || {}) && dim !== 'number');
  // at the top level a named target ("runtime", "charging time", "panels") selects procedures with that goal
  const provides = (p, dim, depth = 1) => depth === 0 && target.name ? p.body.goal === target.name || (!usable.some(q => q.body.goal === target.name) && sameDim(p, dim)) : sameDim(p, dim) && (depth > 0 || !p.body.goal || !target.name || p.body.goal === target.name);
  let best = null;
  // depth-first over chains, each procedure at most once; quantities are consumed as they are bound. All complete
  // chains are collected; the one that uses the MOST of the stated quantities wins (then the shortest), so that a
  // detail the person gave ("at 10%") is never silently ignored when a chain exists that uses it.
  const search = (dim, depth, chain, consumed) => {
    if (depth > maxDepth) return [];
    const options = [];
    for (const p of usable.filter(p => provides(p, dim, depth) && !chain.some(c => c.p.id === p.id))) {
      const idx = quantities.map((q, i) => i).filter(i => !consumed.has(i)), avail = idx.map(i => quantities[i]);
      const b = bind(p, avail, text), used0 = new Set([...consumed, ...[...b.used].map(i => idx[i])]);
      // applicability: a procedure whose bound inputs match NONE of its role words is about something else (a 60 W bulb is not a solar panel)
      if (Object.keys(b.inputs).length && !b.hits && p.body.inputs.some(i => i.cues)) continue;
      const missing = p.body.inputs.filter(inp => !b.inputs[inp.name] && inp.default === undefined);
      if (!missing.length) { options.push({ steps: [{ p, bound: b }], used: used0 }); continue; }
      if (missing.length > 1) { if (!best || missing.length < best.missing.length) best = { p, missing }; continue; }
      const subs = search(missing[0].dim, depth + 1, [...chain, { p }], used0);
      if (!subs.length && (!best || missing.length <= best.missing.length)) best = { p, missing };
      for (const sub of subs) options.push({ steps: [...sub.steps, { p, bound: b }], used: sub.used });
      if (options.length > 40) break;
    }
    return options;
  };
  const hitsOf = pl => pl.steps.reduce((n, st) => n + (st.bound.hits || 0), 0), defaultsOf = pl => pl.steps.reduce((n, st) => n + st.p.body.inputs.filter(i => i.default !== undefined && !st.bound.inputs[i.name]).length, 0);
  const plans = search(target.dim, 0, [], new Set()).sort((x, y) => y.used.size - x.used.size || hitsOf(y) - hitsOf(x) || defaultsOf(x) - defaultsOf(y) || x.steps.length - y.steps.length);
  const plan = plans[0];
  if (!plan) return { ok: false, reason: 'missing information', target, missing: best ? best.missing.map(m => ({ name: m.name, dim: m.dim, procedure: best.p.id, label: best.p.label })) : [], quantities };
  // execute the chain, feeding outputs forward
  const values = {}, steps = [];
  try {
    for (const st of plan.steps) {
      const inputs = { ...st.bound.inputs };
      for (const inp of st.p.body.inputs) if (!inputs[inp.name] && values[inp.dim]) inputs[inp.name] = values[inp.dim];
      const r = runProcedure(st.p.body, inputs), o = st.p.body.outputs[0], out = r.outputs[o.name];
      values[outDim(st.p)] = { value: out.value, unit: o.unit ?? '' };
      steps.push({ procedure: st.p.id, label: st.p.label, inputs, why: st.bound.why, trace: r.trace, output: { name: o.name, ...out } });
    }
  } catch (e) { return { ok: false, reason: 'execution failed: ' + e.message, target }; }
  const final = steps[steps.length - 1].output;
  return { ok: true, target, answer: final, steps, unusedQuantities: quantities.filter((_, i) => !plan.used.has(i)) };
}

// ---------- synthesis from verified examples ----------
// examples: [{ inputs: { name: { value, unit } }, output: { value, unit } }]; dims: { name: dimension }, outDim.
// Enumerates expressions (≤ 3 operands, + - * /, optional constants) that are dimensionally valid for the output,
// keeps those that reproduce every TRAINING example, prefers the shortest, and reports held-out accuracy.
export function synthesize({ names, dims, outDim, outUnit, train, heldOut = [], constants = [1, 2, 100, 1000], maxLeaves = 3 }) {
  const dimEnv = Object.fromEntries(names.map(n => [n, DIMS[dims[n]]])); const want = dimKey(DIMS[outDim]);
  let level = names.map(n => ({ e: n, leaves: 1 })).concat(constants.map(c => ({ e: String(c), leaves: 1, c: true })));
  const all = [...level], seen = new Set(all.map(x => x.e));
  for (let L = 2; L <= maxLeaves; L++) {
    const next = [];
    for (const a of all) for (const b of all) { if (a.leaves + b.leaves !== L || (a.c && b.c)) continue;
      for (const op of ['*', '/', '+', '-']) { if ((op === '*' || op === '+') && a.e > b.e) continue; const e = `(${a.e} ${op} ${b.e})`; if (seen.has(e)) continue; seen.add(e); next.push({ e, leaves: L }); } }
    all.push(...next); if (all.length > 60000) break;
  }
  const spec = e => ({ inputs: names.map(n => ({ name: n, dim: dims[n], unit: Object.keys(UNITS).find(u => UNITS[u][0] === dims[n] && UNITS[u][1] === 1) ?? Object.keys(UNITS).find(u => UNITS[u][0] === dims[n]) ?? '' /* some dimensions (e.g. price per kWh) have no factor-1 unit */ })), steps: [{ as: 'result', expr: e, dim: outDim }], outputs: [{ name: 'result', unit: outUnit }] });
  const toCases = xs => xs.map(x => ({ inputs: x.inputs, expect: { result: x.output.value } }));
  const found = [];
  for (const cand of all) {
    let d; try { d = parseExpr(cand.e).dim(dimEnv); } catch { continue; } if (dimKey(d) !== want) continue;
    if (!cand.e.match(/[a-z]/i)) continue;
    const s = spec(cand.e); if (checkProcedure(s).length) continue;
    const t = testProcedure(s, toCases(train)); if (t.passed === t.total) { found.push({ expr: cand.e, leaves: cand.leaves, spec: s, uses: new Set((cand.e.match(/[a-z][a-zA-Z0-9]*/g) || []).filter(x => names.includes(x))).size }); if (found.length >= 200) break; }
  }
  // v1.10: several formulas may fit the examples. Compare them on probe inputs near the examples: formulas that agree
  // everywhere are the same rule written differently; formulas that disagree are competing hypotheses. Prefer the ones
  // that use every stated quantity (ignoring a given quantity was the classic error), then the simplest. If competing
  // hypotheses remain tied, the examples do not determine the rule — report that instead of guessing.
  if (found.length) {
    const probes = []; let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const ex of train) for (let k = 0; k < 6; k++) probes.push({ inputs: Object.fromEntries(Object.entries(ex.inputs).map(([n, v]) => { const q = typeof v === 'number' ? { value: v } : v; return [n, { ...q, value: q.value * (0.3 + 2.4 * rnd()) }]; })) });
    for (const f of found) f.signature = probes.map(pr => { try { const o = testProcedure(f.spec, [{ inputs: pr.inputs, expect: {} }]).results[0].got?.result; return o === undefined ? 'x' : +o.toPrecision(8); } catch { return 'x'; } }).join('|');
    const maxUses = Math.max(...found.map(f => f.uses)), top = found.filter(f => f.uses === maxUses), groups = new Map();
    for (const f of top) if (!groups.has(f.signature)) groups.set(f.signature, f);
    const distinct = [...groups.values()].sort((a, b) => a.leaves - b.leaves || a.expr.length - b.expr.length);
    if (distinct.length > 1 && distinct[1].leaves <= distinct[0].leaves + 1) return { ok: false, ambiguous: true, tried: all.length, reason: `the verified examples fit ${distinct.length} different rules (e.g. ${distinct.slice(0, 3).map(d => d.expr).join(' vs ')}); one more verified example is needed`, candidates: distinct.slice(0, 5).map(d => d.expr) };
    found.splice(0, found.length, ...distinct, ...found.filter(f => !distinct.includes(f)));
  }
  if (!found.length) return { ok: false, tried: all.length, reason: 'no dimensionally valid expression reproduces the training examples' };
  const best = found[0], held = heldOut.length ? testProcedure(best.spec, toCases(heldOut)) : null;
  return { ok: true, expr: best.expr, spec: best.spec, tried: all.length, alternatives: found.slice(1).map(f => f.expr), heldOut: held ? { passed: held.passed, total: held.total } : null };
}

export function explainSolution(sol) {
  const f = v => +Number(v).toPrecision(4);
  const lines = sol.steps.map((s, i) => `${i + 1}. **${s.label}** — ${s.trace.map(([as, expr, v]) => `${as} = ${expr}`).join('; ')} → **${f(s.output.value)} ${s.output.unit || ''}**`.trim());
  return lines.join('\n');
}
