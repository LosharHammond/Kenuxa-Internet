// Bounded program induction: infer a reusable modular affine transition from examples.
// This is narrow symbolic generalization, not language comprehension or arbitrary program synthesis.
const integer = x => Number.isSafeInteger(x);
const mod = (x, n) => ((x % n) + n) % n;
export function discoverModularRule({ examples, modulus, maxCandidates = 4096 } = {}) {
  if (!integer(modulus) || modulus < 3 || modulus > 32 || !Array.isArray(examples) || examples.length < 3 || examples.length > 100 || !integer(maxCandidates) || maxCandidates < 1 || maxCandidates > 4096) return { ok: false, reason: 'invalid bounded search' };
  if (examples.some(e => !e || !['state','action','next'].every(k => integer(e[k]) && e[k] >= 0 && e[k] < modulus))) return { ok: false, reason: 'invalid example' };
  const seen = new Map();
  for (const e of examples) {
    const k = JSON.stringify([e.state,e.action]);
    if (seen.has(k) && seen.get(k) !== e.next) return { ok: false, reason: 'contradictory observations' };
    seen.set(k,e.next);
  }
  let count = 0, winner = null, searched = 0;
  outer: for (let a=0;a<modulus;a++) for (let b=0;b<modulus;b++) for (let c=0;c<modulus;c++) {
    if (++searched > maxCandidates) return { ok: false, reason: 'search budget exceeded', searched };
    if (examples.every(e => mod(a*e.state+b*e.action+c,modulus) === e.next)) {
      count++; winner = { a,b,c,modulus };
      if (count > 1) break outer;
    }
  }
  if (count !== 1) return { ok: false, reason: count ? 'ambiguous hypotheses' : 'no consistent hypothesis', candidates: count };
  return { ok: true, rule: winner, searched, trainingExamples: seen.size };
}
export function applyModularRule(rule, state, action) {
  if (!rule || ![rule.a,rule.b,rule.c,rule.modulus,state,action].every(integer) || rule.modulus < 3 || rule.modulus > 32 || [state,action].some(x => x < 0 || x >= rule.modulus)) return { ok: false, reason: 'invalid inputs' };
  return { ok: true, next: mod(rule.a*state+rule.b*action+rule.c,rule.modulus) };
}
// Deterministic blind evaluation: no test outcome is used to fit the rule.
export function evaluateModularRule(rule, cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 100 || cases.some(e => !e || !integer(e.next))) return { ok: false, reason: 'invalid evaluation cases' };
  const results = cases.map(e => ({ state:e.state, action:e.action, expected:e.next, got:applyModularRule(rule,e.state,e.action) }));
  return { ok: true, total:results.length, passed:results.filter(r => r.got.ok && r.got.next === r.expected).length };
}
