// Atomic World Model: a structured picture of the person's current situation — entities with observed states,
// events with durations, goals with success conditions, constraints, available resources, unknowns and the
// assumptions KENUXA had to make. Every item records whether it was OBSERVED (said by the person), INFERRED (derived
// by a rule) or ASSUMED (a stated default). The model is small and serialisable, so it travels in the conversation
// capsule and any node can continue it; each new message is applied as an update (add, change, remove).
import { parseQuantities } from './quantities.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const ENTITY_WORDS = { phone: /\b(phone|smartphone|mobile|iphone|android)\b/i, laptop: /\blaptop\b/i, 'power bank': /\bpower ?banks?\b/i, battery: /\bbatter(y|ies)\b/i, 'solar panel': /\bsolar panels?\b|\bpanels?\b/i, inverter: /\binverter\b/i, 'charge controller': /\b(charge )?controller\b/i, charger: /\bcharger\b/i, generator: /\bgenerator\b/i, car: /\bcar\b/i };
const RESOURCES = { powerBank: /\bpower ?banks?\b/i, chargerAvailable: /\b(charger|socket|outlet|plug|electricity)\b/i, chargingEnroute: /\b(charg\w+ (on the way|in the (car|bus|train)|en ?route|during the (trip|journey))|car charger|usb (in|on) the (car|bus|train))\b/i, money: /\b(money|capital|budget|funds?|cash)\b/i };
const NEG = /\b(don'?t|do not|doesn'?t|does not|haven'?t|have no|has no|no|without|lack|lost|forgot|left (my|the)|can'?t|cannot|isn'?t|is not|there'?s no|there is no)\b/i;
const POS = /\b(i have|i've got|i got|there is|there'?s|i can use|i'll have|i will have|bring(ing)?|with (a|my))\b/i;
const JOURNEY = /\b(travel(l?ing)?|trip|journey|flight|fly(ing)?|drive|driving|ride|bus|train|commute|road trip)\b/i;
const DEPART = /\b(before (i |we )?(leave|leaving|go|going|depart|departure|set off)|until (i |we )?(leave|go))\b/i;

export function emptyWorld() { return { v: 1, entities: {}, events: [], goals: [], constraints: {}, resources: {}, unknowns: [], assumptions: [], history: [] }; }

// sanitize a world model received from a client capsule (bounded, plain data only)
export function sanitizeWorld(w) {
  if (!w || typeof w !== 'object') return emptyWorld();
  const o = emptyWorld(), str = (x, n = 80) => typeof x === 'string' ? x.slice(0, n) : null, num = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
  for (const [k, v] of Object.entries(w.entities || {}).slice(0, 12)) if (v && typeof v === 'object') o.entities[str(k, 40)] = { states: Object.fromEntries(Object.entries(v.states || {}).slice(0, 12).map(([s, x]) => [str(s, 40), { value: num(x?.value) ?? str(x?.value, 60), unit: str(x?.unit, 12) || '', source: ['observed', 'inferred', 'assumed'].includes(x?.source) ? x.source : 'observed' }])) };
  o.events = (Array.isArray(w.events) ? w.events : []).slice(0, 6).map(e => ({ kind: str(e?.kind, 30), durationH: num(e?.durationH), text: str(e?.text, 120), source: 'observed' })).filter(e => e.kind);
  o.goals = (Array.isArray(w.goals) ? w.goals : []).slice(0, 4).map(g => ({ id: str(g?.id, 60), statement: str(g?.statement, 160), success: str(g?.success, 160), source: ['observed', 'inferred'].includes(g?.source) ? g.source : 'inferred' })).filter(g => g.id);
  for (const [k, v] of Object.entries(w.constraints || {}).slice(0, 12)) if (num(v?.value) !== null || typeof v?.value === 'string') o.constraints[str(k, 40)] = { value: num(v.value) ?? str(v.value, 40), unit: str(v?.unit, 12) || '', source: 'observed', text: str(v?.text, 120) };
  for (const [k, v] of Object.entries(w.resources || {}).slice(0, 12)) if (typeof v?.available === 'boolean') o.resources[str(k, 40)] = { available: v.available, source: 'observed', text: str(v?.text, 120) };
  o.history = (Array.isArray(w.history) ? w.history : []).slice(-8).map(h => str(h, 160)).filter(Boolean);
  if (Array.isArray(w.plan)) o.plan = w.plan.slice(0, 12).map(x => str(x, 60)).filter(x => x && /^act:[a-z0-9-]+$/.test(x));
  return o;
}

// Apply one message to the world model. Returns { world, changes } where changes lists exactly what was updated.
export function updateWorld(prev, text, { interpretation = null } = {}) {
  const w = sanitizeWorld(prev), t = clean(text), changes = [], qs = parseQuantities(t);
  const sentences = t.split(/(?<=[.!?;])\s+|,\s+(?=(and |but )?(i|my|we)\b)/i).filter(Boolean);
  // entities named in the message
  for (const [name, re] of Object.entries(ENTITY_WORDS)) if (re.test(t) && !w.entities[name] && name !== 'power bank' && !(name === 'battery' && (w.entities.phone || ENTITY_WORDS.phone.test(t)))) { w.entities[name] = { states: {} }; changes.push(`entity: ${name}`); }
  const main = w.entities.phone ? 'phone' : Object.keys(w.entities)[0];
  for (const s of sentences) {
    const q = parseQuantities(s), lower = s.toLowerCase();
    // observed battery state: "battery is at 10%", "10% battery", "battery at 10 percent"
    const pct = q.find(x => x.dim === 'fraction'); if (pct && /\b(batter|charge|at|left|remaining|percent|%)/i.test(s)) { const ent = main || 'battery'; (w.entities[ent] ||= { states: {} }).states.charge = { value: pct.value, unit: '%', source: 'observed' }; changes.push(`${ent}.charge = ${pct.value}% (observed)`); }
    const cap = q.find(x => x.dim === 'charge' || (x.dim === 'energy' && /\b(battery|capacity)\b/i.test(s))); if (cap && main) { w.entities[main].states.capacity = { value: cap.value, unit: cap.unit, source: 'observed' }; changes.push(`${main}.capacity = ${cap.value} ${cap.unit} (observed)`); }
    const pw = q.find(x => x.dim === 'power'); if (pw && main && /\b(uses|draws|consum|use)\b/i.test(s)) { w.entities[main].states.draw = { value: pw.value, unit: pw.unit, source: 'observed' }; changes.push(`${main}.draw = ${pw.value} ${pw.unit} (observed)`); }
    // events: a journey with a duration
    const dur = q.find(x => x.dim === 'time');
    if (JOURNEY.test(s) && dur && !DEPART.test(s)) { const durationH = dur.value * ({ minutes: 1 / 60, minute: 1 / 60, min: 1 / 60, mins: 1 / 60, days: 24, day: 24 }[dur.unit] ?? 1); w.events = w.events.filter(e => e.kind !== 'journey'); w.events.push({ kind: 'journey', durationH, text: s.slice(0, 120), source: 'observed' }); changes.push(`event: journey of ${+durationH.toFixed(2)} h (observed)`); }
    // time before departure (a constraint)
    if (dur && DEPART.test(s)) { const h = dur.value * ({ minutes: 1 / 60, minute: 1 / 60, min: 1 / 60, mins: 1 / 60, seconds: 1 / 3600 }[dur.unit] ?? 1); w.constraints.timeBeforeDeparture = { value: h, unit: 'h', source: 'observed', text: s.slice(0, 120) }; changes.push(`constraint: ${+(h * 60).toFixed(0)} minutes before departure (observed)`); }
    // resources: present or absent ("I don't have a power bank", "I have a car charger")
    for (const [r, re] of Object.entries(RESOURCES)) if (re.test(s)) {
      const negated = NEG.test(s.slice(0, s.search(re) + 1)) || new RegExp(`\\bno\\s+${re.source}`, 'i').test(s);
      if (negated) { if (w.resources[r]?.available !== false) { w.resources[r] = { available: false, source: 'observed', text: s.slice(0, 120) }; changes.push(`resource: ${r} unavailable (observed)`); } }
      else if (POS.test(s) || /\b(will|can) (bring|use)\b/i.test(lower)) { w.resources[r] = { available: true, source: 'observed', text: s.slice(0, 120) }; changes.push(`resource: ${r} available (observed)`); }
    }
  }
  // goals (inferred): a journey with a device in the picture → keep the device usable for the whole journey
  const journey = w.events.find(e => e.kind === 'journey');
  if (journey && main && !w.goals.some(g => g.id === 'keep-usable')) { w.goals.push({ id: 'keep-usable', statement: `keep the ${main} usable during the ${+journey.durationH.toFixed(2)}-hour journey`, success: `${main} energy lasts ≥ ${+journey.durationH.toFixed(2)} h of use`, source: /\b(need|want|keep|must|have to)\b/i.test(t) ? 'observed' : 'inferred' }); changes.push('goal: keep the device usable for the journey (inferred from the journey and the device)'); }
  // unknowns: what the planning model needs but nobody said
  const st = main ? w.entities[main].states : {};
  w.unknowns = [
    !st.capacity && main && 'battery capacity (mAh or Wh)', !st.draw && main && 'how heavily you will use it (average power draw)',
    w.resources.chargerAvailable === undefined && journey && 'whether a charger and socket are available before you leave',
    w.resources.powerBank === undefined && journey && 'whether you have a power bank', w.resources.chargingEnroute === undefined && journey && 'whether you can charge on the way',
    journey && !w.constraints.timeBeforeDeparture && 'how much time you have before leaving',
  ].filter(Boolean);
  w.history = [...w.history, ...changes].slice(-8);
  return { world: w, changes };
}
export function describeWorld(w) {
  const lines = [];
  for (const [n, e] of Object.entries(w.entities)) { const s = Object.entries(e.states).map(([k, v]) => `${k} ${v.value}${v.unit === '%' ? '%' : v.unit ? ' ' + v.unit : ''} (${v.source})`); lines.push(`${n}${s.length ? ': ' + s.join(', ') : ''}`); }
  for (const e of w.events) lines.push(`event: ${e.kind}, ${+e.durationH.toFixed(2)} h (observed)`);
  for (const g of w.goals) lines.push(`goal: ${g.statement} (${g.source})`);
  for (const [k, c] of Object.entries(w.constraints)) lines.push(`constraint: ${k} = ${c.unit === 'h' ? Math.round(c.value * 60) + ' min' : c.value + ' ' + c.unit} (observed)`);
  for (const [k, r] of Object.entries(w.resources)) lines.push(`${k}: ${r.available ? 'available' : 'not available'} (observed)`);
  return lines;
}
