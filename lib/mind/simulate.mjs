// Bounded simulation: discrete time steps over numeric state with transition expressions evaluated by the procedure
// kernel (no code), clamps, and stop conditions. Used for battery timelines and other state-over-time questions.
// Also creative recombination: combining two concepts into a NEW hypothesis, never a fact.
import { parseExpr } from '../peers/tasks.mjs';

// spec: { state: { x: number }, rates: { x: 'expression per hour' }, clamp: { x: [lo, hi] }, durationH, dtH, stop: { x: '<=0' } }
export function simulate({ state, rates = {}, clamp = {}, durationH, dtH = 0.05, params = {}, stop = {} }) {
  const s = { ...state }, compiled = Object.fromEntries(Object.entries(rates).map(([k, e]) => [k, parseExpr(e)])), timeline = [{ t: 0, ...s }], events = [];
  const steps = Math.min(20000, Math.ceil(durationH / dtH));
  for (let i = 1; i <= steps; i++) {
    const scope = { ...params, ...s, t: (i - 1) * dtH }, d = {};
    for (const [k, f] of Object.entries(compiled)) d[k] = f.eval(scope) * dtH;
    for (const k in d) { s[k] += d[k]; if (clamp[k]) s[k] = Math.max(clamp[k][0], Math.min(clamp[k][1], s[k])); }
    const t = +(i * dtH).toFixed(6);
    for (const [k, cond] of Object.entries(stop)) { const m = String(cond).match(/^(<=|>=)\s*(-?[\d.]+)$/); if (m && !events.some(e => e.variable === k) && (m[1] === '<=' ? s[k] <= Number(m[2]) : s[k] >= Number(m[2]))) events.push({ variable: k, condition: cond, atH: t }); }
    if (i % Math.max(1, Math.round(steps / 24)) === 0 || i === steps) timeline.push({ t, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(4)])) });
    if (events.length && events.some(e => e.stopRun)) break;
  }
  return { final: s, timeline, events, steps, model: 'explicit rates per hour, Euler steps of ' + dtH + ' h' };
}

// Creative recombination of two concepts given their relational DNA (from the atom registry): properties and uses
// are pooled, conflicts (CONTRADICTS, or the same property with different values) are listed, and the result is a
// hypothesis with the checks it would need. It is labelled as imagined, never stored as knowledge.
export function recombine(a, b, { aLabel = a?.identity?.canonical || 'A', bLabel = b?.identity?.canonical || 'B' } = {}) {
  const rel = d => (d?.relational || []).map(e => ({ type: e.type, target: e.target }));
  const ra = rel(a), rb = rel(b), feats = x => x.filter(e => ['HAS_PROPERTY', 'USED_FOR', 'HAS_PART', 'CAPABLE_OF', 'PART_OF'].includes(e.type));
  const pooled = [...feats(ra).map(e => ({ ...e, from: aLabel })), ...feats(rb).map(e => ({ ...e, from: bLabel }))];
  const conflicts = [...ra.filter(e => e.type === 'CONTRADICTS' && rb.some(f => f.target === e.target && f.type !== 'CONTRADICTS')), ...rb.filter(e => e.type === 'CONTRADICTS' && ra.some(f => f.target === e.target && f.type !== 'CONTRADICTS'))].map(e => e.target);
  return { id: `hyp:combine:${aLabel}+${bLabel}`.toLowerCase().replace(/[^a-z0-9:+-]+/g, '-'), category: 'hypothesis', status: 'hypothetical', label: `a combination of ${aLabel} and ${bLabel}`, pooled, conflicts, needs: ['physical feasibility', 'whether the pooled uses are compatible', 'cost and safety'], note: 'imagined combination — a hypothesis to evaluate, not a fact' };
}
