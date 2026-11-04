// Cognitive Self-Evaluation Engine. Runs the labelled evaluation sets (tests/fixtures/*.json) against a SANDBOX copy
// of the node's current procedures — so evaluating, including the learning-effectiveness test, never changes the live
// node — and records the result as an evaluation atom, keeping a history so that improvement (or regression) over
// time is measurable: accuracy per category, held-out before/after learning, repeated-error rate, time, CPU, memory.
import fs from 'node:fs';
import { solve } from './procedures.mjs';
import { goalOf, negations } from './comprehend.mjs';
import { canvas, perceive, identify, parseLegend, visualAnswer } from './vision.mjs';

const close = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 0.01 * Math.max(Math.abs(b), 1e-9);
const ratio = (a, b) => ({ passed: a, total: b, rate: b ? +(a / b).toFixed(3) : null });
export function loadFixtures(dir = new URL('../../tests/fixtures/', import.meta.url)) {
  try { return { mind: JSON.parse(fs.readFileSync(new URL('mind-eval.json', dir))), comprehension: JSON.parse(fs.readFileSync(new URL('comprehension-eval.json', dir))) }; } catch { return null; }
}

// MindClass is passed in to avoid a circular import; live = the running Mind (its usable procedures are copied)
export function runEvaluation(MindClass, { live = null, fixtures = loadFixtures() } = {}) {
  if (!fixtures) return { ok: false, reason: 'evaluation sets not found (tests/fixtures)' };
  const E = fixtures.mind, C = fixtures.comprehension, t0 = performance.now(), cpu0 = process.cpuUsage(), heap0 = process.memoryUsage().heapUsed, out = { at: new Date().toISOString() };
  const mind = new MindClass({ state: {} });
  if (live) for (const p of live.store.usable('procedure')) if (!mind.store.get(p.id) || mind.store.get(p.id).status !== p.status) mind.store.put({ ...p }, { reason: 'copied from live node for evaluation' });
  // comprehension
  out.comprehension = {}; for (const split of ['dev', 'heldOut']) { let g = 0, n = 0; for (const c of C[split]) { if (goalOf(c.text) === c.goal) g++; const neg = negations(c.text); if (c.negated.every(x => neg.some(y => y.includes(x) || x.includes(y))) && (c.negated.length || !neg.length)) n++; } out.comprehension[split] = { goal: ratio(g, C[split].length), negation: ratio(n, C[split].length) }; }
  // calculation and learning effectiveness (inside the sandbox)
  const score = cases => cases.filter(c => { const r = solve(c.problem, { procedures: mind.procedures() }); return r.ok && close(r.answer.value, c.value); }).length;
  out.calculation = { dev: ratio(score(E.calculation.dev), E.calculation.dev.length), heldOutInitial: ratio(score(E.calculation.heldOut), E.calculation.heldOut.length) };
  for (const c of E.calculation.heldOut) mind.evolution.addCase({ problem: c.problem, expected: { value: c.value, unit: '' }, split: 'held-out' });
  for (const c of E.calculation.dev) mind.evolution.addCase({ problem: c.problem, expected: { value: c.value, unit: '' }, split: 'dev' });
  const corr = E.calculation.correction, first = solve(corr.problem, { procedures: mind.procedures() });
  const learn = close(first.answer?.value, corr.value) ? { promoted: false, reason: 'already correct' } : mind.evolution.learn({ problem: corr.problem, expected: { value: corr.value, unit: corr.unit }, verifiedBy: 'test' });
  out.learning = { initialCorrect: close(first.answer?.value, corr.value), promoted: !!learn.promoted, regressions: learn.report?.regressions?.length ?? 0, heldOutAfter: ratio(score(E.calculation.heldOut), E.calculation.heldOut.length), repeatedError: !close(solve(corr.problem, { procedures: mind.procedures() }).answer?.value, corr.value) };
  // diagnosis
  let d = 0; for (const x of E.diagnosis) { const r = mind.think(x.text), c = r.cognition || {}, alive = c.alive || [], ruled = (c.ruledOut || []).map(y => y.cause); if (x.top ? (alive[0] || '').startsWith(x.top) : ruled.some(y => y.startsWith(x.ruledOut)) && alive.some(y => y.startsWith(x.alive))) d++; }
  out.diagnosis = ratio(d, E.diagnosis.length);
  // counterfactuals
  let cf = 0; for (const x of E.counterfactual) { const r = mind.think(x.text), ch = (r.cognition?.changed || []).map(v => v.variable); if (r.hypothetical && x.changes.every(v => ch.includes(v)) && !!(r.cognition?.laws || []).length === x.law) cf++; }
  out.counterfactual = ratio(cf, E.counterfactual.length);
  // planning adaptation
  { let w = null; const res = []; for (const tx of ['My phone battery is at 10%, and I need to travel for three hours. What should I do?', "I don't have a power bank.", 'I have only ten minutes before leaving.']) { const r = mind.think(tx, { world: w }); w = r.world; res.push(r.cognition || {}); }
    const ok = [(res[0].extras || []).some(e => e.id === 'act:power-bank'), (res[1].excluded || []).some(e => e.id === 'act:power-bank'), /10 minutes/.test((res[2].extras || []).find(e => e.id === 'act:charge-now')?.note || '')]; out.planning = ratio(ok.filter(Boolean).length, ok.length); }
  // vision on generated scenes (positions and colours vary)
  { let det = 0, detN = 0, qa = 0, qaN = 0; const shapes = [['rect', 'rectangle'], ['ellipse', 'circle'], ['triangle', 'triangle']], cols = { blue: [40, 80, 220], yellow: [240, 210, 40], red: [220, 40, 40], green: [40, 170, 60] };
    for (let k = 0; k < 12; k++) { const c = canvas(220, 140), placed = [], names = Object.keys(cols);
      for (let i = 0; i < 3; i++) { const [kind, shape] = shapes[(k + i) % 3], col = names[(k + i) % 4], x = 10 + i * 70, y = 20 + ((k * 13 + i * 29) % 60); if (kind === 'rect') c.rect(x, y, 34, 26, cols[col]); else if (kind === 'ellipse') c.ellipse(x + 17, y + 17, 15, 15, cols[col]); else c.triangle(x, y, 34, 30, cols[col]); placed.push({ shape, col, x, y }); }
      c.line(placed[0].x + 34, placed[0].y + 12, placed[1].x - 2, placed[1].y + 12, [0, 0, 0], 2);
      const p = perceive(c); for (const pl of placed) { detN++; if (p.objects.some(o => o.shape === pl.shape && o.colour === pl.col)) det++; }
      const a = visualAnswer('Which component appears connected to the inverter?', p, identify(p, { legend: parseLegend(`the ${placed[0].col} ${placed[0].shape} is the inverter, the ${placed[1].col} ${placed[1].shape} is the battery, the ${placed[2].col} ${placed[2].shape} is the meter`) })); qaN++; if (JSON.stringify(a.answer) === JSON.stringify(['battery'])) qa++; }
    out.vision = { detection: ratio(det, detN), connectionQA: ratio(qa, qaN) }; }
  // efficiency
  { const qs = ['How much energy does a 60 W bulb use in 5 hours?', 'My solar battery is not charging. The panel voltage is normal.', 'What would happen if a solar panel produced electricity at night?', 'My phone battery is at 10%, and I need to travel for three hours. What should I do?'], times = {};
    for (const q of qs) { const ts = []; for (let i = 0; i < 15; i++) { const a = performance.now(); mind.think(q); ts.push(performance.now() - a); } ts.sort((x, y) => x - y); times[mind.think(q).type] = { medianMs: +ts[7].toFixed(3), p90Ms: +ts[13].toFixed(3) }; }
    const cpu = process.cpuUsage(cpu0); out.efficiency = { perEpisode: times, totalMs: +(performance.now() - t0).toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), heapDeltaMB: +((process.memoryUsage().heapUsed - heap0) / 1e6).toFixed(2) }; }
  // verification reliability: share of promoted learned procedures whose own tests still pass on the sandbox kernel
  const learned = mind.store.usable('procedure').filter(p => String(p.id).startsWith('proc:learned')); out.verificationReliability = learned.length ? ratio(learned.filter(p => mind.store.get(p.id).status !== 'retired').length, learned.length) : null;
  out.ok = true; return out;
}
