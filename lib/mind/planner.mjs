// Planning and Decision Engine.
// 1) A general forward planner over facts (STRIPS-style actions with preconditions, add/delete effects, cost and
//    duration; A* with an admissible unmet-goals heuristic; deadline and budget constraints).
// 2) A resource planner for "keep a device powered through an event", evaluated with interval arithmetic: every
//    assumption is a range, and a plan is only called sufficient when it works at the pessimistic end.
// Plans are recomputed from the world model on every turn and compared with the previous plan, so a change in the
// situation ("no power bank", "only ten minutes") visibly changes the plan, with the reason.
import { ACTIONS, PHONE_ASSUMPTIONS } from './knowledge.mjs';
import { simulate } from './simulate.mjs';
import { toBase } from '../peers/tasks.mjs';

// ---------- general planner ----------
// actions: [{ name, pre: [facts], add: [facts], del: [facts], cost, duration }]; goal: [facts]
export function plan(initial, goal, actions, { deadline = Infinity, budget = Infinity, maxNodes = 50000 } = {}) {
  const key = s => [...s].sort().join('|'), h = s => goal.filter(g => !s.has(g)).length;
  const open = [{ s: new Set(initial), g: 0, t: 0, money: 0, path: [] }], seen = new Map(); let nodes = 0;
  while (open.length && nodes < maxNodes) {
    open.sort((a, b) => (a.g + h(a.s)) - (b.g + h(b.s))); const cur = open.shift(); nodes++;
    if (!h(cur.s)) return { ok: true, steps: cur.path, cost: cur.g, duration: cur.t, money: cur.money, nodes };
    const k = key(cur.s); if (seen.has(k) && seen.get(k) <= cur.g) continue; seen.set(k, cur.g);
    for (const a of actions) { if (!(a.pre || []).every(p => cur.s.has(p))) continue; const t = cur.t + (a.duration || 0), money = cur.money + (a.money || 0); if (t > deadline || money > budget) continue;
      const s = new Set(cur.s); for (const d of a.del || []) s.delete(d); for (const x of a.add || []) s.add(x); if (key(s) === k) continue;
      open.push({ s, g: cur.g + (a.cost ?? 1), t, money, path: [...cur.path, a.name] }); }
  }
  // explain why: which goal facts no action can produce, or which constraint cut the search
  const producible = new Set(actions.flatMap(a => a.add || [])), unreachable = goal.filter(g => !initial.includes(g) && !producible.has(g));
  return { ok: false, nodes, reason: unreachable.length ? `nothing can achieve: ${unreachable.join(', ')}` : nodes >= maxNodes ? 'search limit reached' : 'no plan satisfies the time/budget constraints' };
}

// ---------- keep a device powered through an event ----------
const H = (v, unit) => toBase(v, unit || 'h', 'time');
export function powerPlan(world, { actions = ACTIONS } = {}) {
  const device = world.entities.phone ? 'phone' : Object.keys(world.entities).find(k => world.entities[k].states?.charge);
  const journey = world.events.find(e => e.kind === 'journey');
  if (!device || !journey) return { ok: false, reason: 'need a device with a battery level and an event with a duration' };
  const st = world.entities[device].states, assumptions = [];
  const capWh = st.capacity ? (() => { const u = String(st.capacity.unit).toLowerCase(); const wh = u === 'mah' ? st.capacity.value / 1000 * 3.85 : u === 'ah' ? st.capacity.value * 3.85 : toBase(st.capacity.value, u, 'energy'); if (u === 'mah' || u === 'ah') assumptions.push('battery voltage ≈3.85 V (typical lithium-ion phone cell) to convert mAh to Wh'); return [wh, wh]; })() : (assumptions.push(PHONE_ASSUMPTIONS.label.split(';')[0] + ' — you did not give the capacity'), PHONE_ASSUMPTIONS.capacityWh);
  const draw = st.draw ? [toBase(st.draw.value, st.draw.unit, 'power'), toBase(st.draw.value, st.draw.unit, 'power')] : (assumptions.push('average use ≈0.8–2.5 W (light to mixed use) — you did not say how you will use it'), PHONE_ASSUMPTIONS.averageDrawW);
  const soc = st.charge ? st.charge.value / 100 : null; if (soc === null) return { ok: false, reason: 'battery level unknown' };
  const needH = journey.durationH, minutes = world.constraints.timeBeforeDeparture ? world.constraints.timeBeforeDeparture.value : null;
  const energyNow = [capWh[0] * soc, capWh[1] * soc];
  // classify actions: feasible (all requirements observed available), conditional (requirement unknown), excluded (a requirement observed unavailable)
  const cls = actions.map(a => { const req = a.requires || []; const off = req.filter(r => world.resources[r]?.available === false), unk = req.filter(r => world.resources[r] === undefined);
    if (off.length) return { a, status: 'excluded', why: off.map(r => `${r} not available`).join(', ') };
    if (a.timeLimited && minutes === 0) return { a, status: 'excluded', why: 'no time before leaving' };
    return { a, status: unk.length ? 'conditional' : 'feasible', needs: unk }; });
  // evaluate a set of actions at both ends of every range; pessimistic = least energy, most draw, weakest effect
  const evalSet = set => { let eLo = energyNow[0], eHi = energyNow[1], fLo = 1, fHi = 1;
    for (const { a } of set) { if (a.loadFactor) { fLo *= a.loadFactor[0]; fHi *= a.loadFactor[1]; }
      if (a.addEnergyWh) { eLo += a.addEnergyWh[0]; eHi += a.addEnergyWh[1]; }
      if (a.chargeRateW) { const t = minutes ?? 0.5; eLo = Math.min(capWh[0], eLo + a.chargeRateW[0] * 0.85 * (minutes ?? 0)); eHi = Math.min(capWh[1], eHi + a.chargeRateW[1] * 0.85 * t); } }
    const pess = eLo / (draw[1] * fHi), opt = eHi / (draw[0] * fLo); return { pessimisticH: pess, optimisticH: opt }; };
  const usable = cls.filter(c => c.status !== 'excluded'), feasible = usable.filter(c => c.status === 'feasible'), conditional = usable.filter(c => c.status === 'conditional'), base = evalSet([]);
  const lex = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  // 1) the core plan uses only actions that are certainly possible: the least effort that works at the pessimistic
  //    end; if nothing works, every feasible action (maximum battery time)
  let best = null;
  for (let m = 0; m < 1 << feasible.length; m++) { const set = feasible.filter((_, i) => m & (1 << i)); const r = evalSet(set), effort = set.reduce((s, c) => s + c.a.effort, 0);
    const okP = r.pessimisticH >= needH, okO = r.optimisticH >= needH, rank = [okP ? 0 : okO ? 1 : 2, okP ? effort : -r.pessimisticH, effort];
    if (!best || lex(rank, best.rank) < 0) best = { set, r, rank, okP, okO }; }
  // 2) options that depend on something not yet known: what each adds on top of the core plan
  const extras = conditional.map(c => { const r = evalSet([...best.set, c]); return { id: c.a.id, name: c.a.name, needs: c.needs, gainPessimisticH: +(r.pessimisticH - best.r.pessimisticH).toFixed(3), result: r, makesItLast: r.pessimisticH >= needH ? 'yes' : r.optimisticH >= needH ? 'possibly' : 'no', note: c.a.chargeRateW ? (minutes != null ? `with ${Math.round(minutes * 60)} minutes of charging` : 'depends on how many minutes you can charge') : c.a.note || null }; }).sort((x, y) => y.gainPessimisticH - x.gainPessimisticH);
  // timeline of the chosen plan at the pessimistic end (simulation)
  const factor = best.set.reduce((f, c) => f * (c.a.loadFactor ? c.a.loadFactor[1] : 1), 1), added = best.set.reduce((s, c) => s + (c.a.addEnergyWh ? c.a.addEnergyWh[0] : 0), 0);
  const startWh = Math.min(capWh[0], energyNow[0] + (best.set.some(c => c.a.chargeRateW) ? best.set.find(c => c.a.chargeRateW).a.chargeRateW[0] * 0.85 * (minutes ?? 0) : 0)) + added;
  const sim = simulate({ state: { energyWh: startWh }, rates: { energyWh: '0 - draw * factor' }, params: { draw: draw[1], factor }, clamp: { energyWh: [0, capWh[0] + added] }, durationH: needH, dtH: needH / 120, stop: { energyWh: '<=0' } });
  return {
    ok: true, device, needH, minutes, energyNowWh: energyNow, capacityWh: capWh, drawW: draw, assumptions, baseline: base,
    chosen: best.set.map(c => ({ id: c.a.id, name: c.a.name, status: c.status, needs: c.needs, note: c.a.note || null })), extras, excluded: cls.filter(c => c.status === 'excluded').map(c => ({ id: c.a.id, name: c.a.name, why: c.why })),
    result: best.r, sufficient: best.okP ? 'yes, even at the pessimistic end' : best.okO ? 'only if your phone and usage are at the favourable end of the assumptions' : extras.some(e => e.makesItLast !== 'no') ? 'not with these steps alone — see the options that depend on what you have' : 'no — the battery will probably not last the whole journey with the options available',
    simulation: { runsOutAtH: sim.events.find(e => e.variable === 'energyWh')?.atH ?? null, timeline: sim.timeline.filter((_, i) => i % 4 === 0) },
  };
}
// what changed between two plans (adaptive planning)
export function planDiff(prev, next) {
  if (!prev?.chosen || !next?.chosen) return [];
  const a = new Set(prev.chosen.map(c => c.id)), b = new Set(next.chosen.map(c => c.id)), out = [];
  for (const c of next.chosen) if (!a.has(c.id)) out.push(`added: ${c.name}`);
  for (const c of prev.chosen) if (!b.has(c.id)) { const ex = next.excluded.find(e => e.id === c.id); out.push(`removed: ${c.name}${ex ? ` (${ex.why})` : ''}`); }
  return out;
}
