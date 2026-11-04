// KENUXA developmental learning: bounded, CPU-only discovery from observed transitions.
// No teacher, pretrained model, remote service, or executable generated code.
// Symbols are opaque machine identifiers; they need not represent words.
const key = x => JSON.stringify(x);
const valid = x => typeof x === 'string' && x.length > 0 && x.length <= 120;
const pair = (state, action) => key([state, action]);
export class DevelopmentalLearner {
  constructor({ state = {}, minObservations = 2, maxObservations = 10000 } = {}) {
    this.state = state;
    this.state.observations ||= [];
    this.state.rules ||= {};
    this.state.rejected ||= [];
    this.minObservations = Math.max(2, minObservations);
    this.maxObservations = Math.max(10, maxObservations);
  }
  observe({ before, action, after, source = 'observation' }) {
    if (![before, action, after].every(valid)) return { ok: false, reason: 'invalid opaque symbol' };
    if (!['observation', 'measurement', 'verified-test'].includes(source)) return { ok: false, reason: 'unverified source' };
    const item = { before, action, after, source };
    // New observations revoke earlier validation until re-evaluated against fresh trials.
    this.state.observations.push(item);
    if (this.state.observations.length > this.maxObservations) this.state.observations.shift();
    const id = pair(before, action);
    const previous = this.state.rules[id];
    const group = this.state.observations.filter(o => pair(o.before, o.action) === id);
    const counts = {};
    for (const o of group) counts[o.after] = (counts[o.after] || 0) + 1;
    const ranked = Object.entries(counts).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [candidate, count] = ranked[0];
    // Hold conflicting evidence rather than silently promoting a majority guess.
    if (group.length >= this.minObservations && count === group.length) {
      this.state.rules[id] = { before, action, after: candidate, support: count, status: previous?.status === 'validated' && previous.after === candidate ? 'validated' : 'candidate', ...(previous?.status === 'validated' && previous.after === candidate ? { heldOut: previous.heldOut } : {}) };
    } else {
      delete this.state.rules[id];
    }
    return { ok: true, observations: group.length, candidate: this.state.rules[id] || null, conflict: ranked.length > 1 };
  }
  predict({ before, action }) {
    if (![before, action].every(valid)) return { ok: false, reason: 'invalid opaque symbol' };
    const rule = this.state.rules[pair(before, action)];
    return rule ? { ok: true, predicted: rule.after, support: rule.support, status: rule.status } : { ok: false, reason: 'insufficient or conflicting evidence' };
  }
  // Independent held-out trials, not training examples, are required for validation.
  validate({ before, action, trials }) {
    const id = pair(before, action), rule = this.state.rules[id];
    if (!rule) return { ok: false, reason: 'no candidate' };
    if (!Array.isArray(trials) || trials.length < 2 || trials.length > 100) return { ok: false, reason: 'at least two independent trials required' };
    if (trials.some(t => !t || t.before !== before || t.action !== action || !valid(t.after) || t.source !== 'verified-test')) return { ok: false, reason: 'trials must be independently verified and match the context' };
    // Distinct test IDs prevent one trial being counted twice. Caller must authenticate evidence.
    if (trials.some(t => !valid(t.testId)) || new Set(trials.map(t => t.testId)).size !== trials.length) return { ok: false, reason: 'distinct verified test IDs required' };
    const passed = trials.every(t => t.after === rule.after);
    if (!passed) {
      this.state.rejected.push({ ...rule, reason: 'held-out contradiction' });
      delete this.state.rules[id];
      return { ok: true, promoted: false, reason: 'held-out contradiction' };
    }
    rule.status = 'validated';
    rule.heldOut = trials.length;
    return { ok: true, promoted: true, rule: { ...rule } };
  }
  status() {
    return { observations: this.state.observations.length, candidates: Object.values(this.state.rules).filter(r => r.status === 'candidate').length, validated: Object.values(this.state.rules).filter(r => r.status === 'validated').length, rejected: this.state.rejected.length };
  }
}
