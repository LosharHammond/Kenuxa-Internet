// Cognitive Strategy Controller with metareasoning.
// Classifies the problem from its features, proposes the methods in the strategy atom's route table, orders them by
// their measured record on this problem type (Laplace-smoothed success rate, then speed), drops methods that failed
// on structurally similar verified episodes, and decides after each attempt whether to stop, try the next method,
// or ask the person for the missing information. Every decision is written to the episode's trace.

export function features(text, { world = null, quantities = [], target = null, causalEffects = [], premiseMatch = null } = {}) {
  const t = String(text || '').toLowerCase(), f = {};
  f.hasQuantities = quantities.some(q => q.dim !== 'number');
  f.target = target?.dim || null;
  f.diagnosis = /\b(not|isn'?t|won'?t|doesn'?t|don'?t|fails? to|failed to|stopped|refuses to|no longer)\s+(be\s+)?(charg|work|turn|start|power|hold)|\bwhy (is|does|did|won'?t|isn'?t)\b.*\b(fail|stop|not|dead|drain)|\bdrains? (fast|quickly)|\b(dies|die|dying|drains?|runs? out)\b[^?]{0,15}\b(fast|quickly|so soon)\b|troubleshoot|diagnos/.test(t);
  f.diagnosisTarget = causalEffects.find(e => e.re.test(t))?.effect || null;
  f.counterfactual = /\bwhat (would|will|could|might) happen if\b|\bwhat happens (if|when)\b|\bwhat if\b.*\b(had|were|was|produced|could|disappeared|doubled)\b|\bimagine (if|that)\b|\bsuppose\b|\bhypothetically\b|\bif .* (would|had)\b/.test(t);
  f.premise = premiseMatch;
  f.situation = !!(world && world.events?.length && Object.keys(world.entities || {}).length) && /\b(what should i do|what can i do|what do i do|help|advice|should i|how (do|can) i|tips?)\b|\b(power bank|minutes before|don'?t have|no charger|before leaving)\b/.test(t);
  f.question = /\?\s*$/.test(t) || /^(how|what|why|which|when|can|should|is|are|do|does)\b/.test(t);
  f.type = f.counterfactual && f.premise ? 'counterfactual' : f.diagnosis && f.diagnosisTarget ? 'diagnosis' : f.situation ? 'situation' : f.target && f.hasQuantities ? 'calculation' : f.target && /\b(my|a|the)\b/.test(t) && /\b(how long|how much|how many)\b/.test(t) ? 'calculation' : null;
  return f;
}

export class StrategyController {
  constructor({ state = {}, routes }) { this.S = state; this.S.records ||= {}; this.routes = routes; }
  rate(type, method) { const r = this.S.records[`${type}|${method}`] || { tries: 0, ok: 0, ms: 0 }; return { ...r, rate: (r.ok + 1) / (r.tries + 2), avgMs: r.tries ? r.ms / r.tries : null }; }
  choose(type, { avoid = [] } = {}) {
    const route = this.routes[type] || []; const kept = route.filter(m => !avoid.includes(m)), dropped = route.filter(m => avoid.includes(m));
    // the route's first method leads unless its measured record is clearly worse than an alternative (≥ 0.2 lower)
    const ordered = [...kept].sort((a, b) => { const ra = this.rate(type, a), rb = this.rate(type, b); return Math.abs(ra.rate - rb.rate) >= 0.2 ? rb.rate - ra.rate : route.indexOf(a) - route.indexOf(b); });
    return { type, methods: ordered, dropped, why: ordered.map(m => { const r = this.rate(type, m); return `${m}: ${r.tries ? `${r.ok}/${r.tries} verified successes` : 'no record yet'}`; }) };
  }
  record(type, method, { ok, ms = 0 }) { const k = `${type}|${method}`, r = this.S.records[k] ||= { tries: 0, ok: 0, ms: 0 }; r.tries++; if (ok) r.ok++; r.ms += ms; }
  // metareasoning decision after one attempt
  decide(attempt, { remaining = [], budgetLeftMs = 1000 }) {
    if (attempt.ok && (attempt.confidence ?? 0.6) >= 0.5) return { next: 'stop', why: 'the method produced a result that passed its own checks' };
    if (attempt.missing?.length && attempt.critical) return { next: 'ask', why: `cannot compute without: ${attempt.missing.join(', ')}` };
    if (remaining.length && budgetLeftMs > 50) return { next: 'try-next', why: `${attempt.reason || 'no result'}; trying ${remaining[0]}` };
    if (attempt.missing?.length) return { next: 'ask', why: `missing: ${attempt.missing.join(', ')}` };
    return { next: 'give-up', why: attempt.reason || 'no method produced a reliable result' };
  }
  status() { return Object.entries(this.S.records).map(([k, r]) => ({ key: k, ...r, rate: +((r.ok + 1) / (r.tries + 2)).toFixed(3) })); }
}
