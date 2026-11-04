// Replaceable strategies with their own evaluators — the parts of KENUXA that are policies rather than code paths.
// retrieval: three interchangeable implementations measured by recall@k and latency on labelled queries.
// routing: a scored task-assignment policy and a deterministic simulator that measures completion time,
//          failed assignments and bandwidth for any routing policy before it is used.
// learning: evolution-engine search settings measured by corrections fixed, held-out transfer and time.
import { features } from '../model.mjs';
import { synthesize } from '../mind/procedures.mjs';

// ---------- retrieval ----------
const lexical = (q, a) => { const qt = new Set(features(q)), at = features(`${a.title} ${(a.questions || []).join(' ')} ${(a.tags || []).join(' ')}`); if (!qt.size) return 0; return at.filter(t => qt.has(t)).length / qt.size; };
export const RETRIEVAL = {
  lexical: (q, atoms) => atoms.map(a => ({ a, s: lexical(q, a) })),
  'concept-lexical': (q, atoms, { comprehend }) => { const u = comprehend(q, { atoms }); const ids = new Set(u.concepts.filter(c => c.score >= 0.6).map(c => c.atomId)); return atoms.map(a => ({ a, s: ids.has(a.id) ? 1 : lexical(u.searchQuery || q, a) })); },
  // graph: a strong hit lends part of its score to atoms that share tags or are linked by relationships
  'concept-lexical-graph': (q, atoms, ctx) => { const base = RETRIEVAL['concept-lexical'](q, atoms, ctx), by = new Map(base.map(x => [x.a.id, x])); const top = base.filter(x => x.s >= 0.8);
    for (const t of top) for (const x of base) { if (x === t) continue; const shared = (t.a.tags || []).filter(g => (x.a.tags || []).includes(g)).length, linked = (t.a.dna?.relationships || []).some(r => r.target === x.a.id); if (shared || linked) x.s = Math.max(x.s, Math.min(0.75, t.s * (linked ? 0.75 : 0.25 * shared))); }
    return [...by.values()]; },
};
// v1.10 inverted index: term → atoms containing it, rebuilt only when the atom set changes (signature = count +
// first/last ids + total question count). Queries score only atoms that share a term with the query, then run the
// concept-linking pass on that candidate set. Same ranking rules, far fewer atoms touched on large stores.
const INDEX = { sig: null, map: null, atoms: null, builtMs: 0, builds: 0 };
const sigOf = atoms => `${atoms.length}|${atoms[0]?.id}|${atoms.at(-1)?.id}|${atoms.reduce((n, a) => n + (a.questions?.length || 0), 0)}`;
export function indexFor(atoms) {
  const sig = sigOf(atoms); if (INDEX.sig === sig) return INDEX;
  const t0 = performance.now(), map = new Map();
  atoms.forEach((a, i) => { for (const t of new Set(features(`${a.title} ${(a.questions || []).join(' ')} ${(a.tags || []).join(' ')}`))) (map.get(t) || map.set(t, []).get(t)).push(i); });
  Object.assign(INDEX, { sig, map, atoms, builtMs: +(performance.now() - t0).toFixed(1), builds: INDEX.builds + 1 }); return INDEX;
}
RETRIEVAL['indexed-concept-lexical'] = (q, atoms, ctx) => { const idx = indexFor(atoms), hit = new Set(); for (const t of features(q)) for (const i of idx.map.get(t) || []) hit.add(i); const cands = [...hit].map(i => atoms[i]); return cands.length ? RETRIEVAL['concept-lexical'](q, cands, ctx) : []; };
export function retrieve(q, atoms, policy, ctx) { const f = RETRIEVAL[policy.strategy] || RETRIEVAL['concept-lexical']; return f(q, atoms, ctx).filter(x => x.s >= policy.threshold).sort((x, y) => y.s - x.s).slice(0, policy.maxResults).map(x => x.a); }
// labelled queries: every approved lesson's alternate questions must retrieve that lesson (recall@k)
export function evaluateRetrieval(atoms, policy, ctx, { k = 3 } = {}) {
  const cases = atoms.flatMap(a => (a.questions || []).slice(0, 3).map(q => ({ q, id: a.id }))).slice(0, 300); if (!cases.length) return { cases: 0 };
  const t0 = performance.now(); let hit1 = 0, hitk = 0;
  for (const c of cases) { const r = retrieve(c.q, atoms, { ...policy, maxResults: Math.max(k, policy.maxResults) }, ctx).map(a => a.id); if (r[0] === c.id) hit1++; if (r.slice(0, k).includes(c.id)) hitk++; }
  return { cases: cases.length, recallAt1: +(hit1 / cases.length).toFixed(3), recallAtK: +(hitk / cases.length).toFixed(3), k, msPerQuery: +((performance.now() - t0) / cases.length).toFixed(3) };
}

// ---------- routing ----------
// score a task for a peer: priority, waiting time, locality (the peer already holds the data), peer reliability,
// and bandwidth cost of the payload
export function routeScore(policy, { priority = 3, ageS = 0, local = false, reliability = 0.5, kb = 100 }) {
  return policy.priorityWeight * priority + policy.ageWeight * Math.log1p(ageS) + policy.localityWeight * (local ? 1 : 0) + policy.reliabilityWeight * reliability - policy.costWeight * (kb / 100);
}
// Deterministic simulation: peers with speeds and reliabilities pull tasks; unreliable peers sometimes vanish
// (the task returns to the queue after its lease). Returns makespan, failures and transferred KB.
export function simulateRouting(policy, { peers = 12, tasks = 300, seed = 7 } = {}) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const P = Array.from({ length: peers }, (_, i) => ({ id: i, speed: 0.5 + rnd() * 1.5, reliability: 0.6 + rnd() * 0.4, holds: new Set(), busyUntil: 0 }));
  const T = Array.from({ length: tasks }, (_, i) => ({ id: i, priority: 1 + Math.floor(rnd() * 9), kb: 20 + rnd() * 180, created: Math.floor(rnd() * 50), data: Math.floor(rnd() * 40) }));
  for (const p of P) for (let j = 0; j < 6; j++) p.holds.add(Math.floor(rnd() * 40));
  let t = 0, failures = 0, kb = 0, weightedWait = 0; const done = new Set();
  while (done.size < tasks && t < 100000) {
    for (const p of P) { if (p.busyUntil > t) continue; const open = T.filter(x => !done.has(x.id) && !x.leased && x.created <= t); if (!open.length) continue;
      const pick = open.map(x => ({ x, sc: routeScore(policy, { priority: x.priority, ageS: t - x.created, local: p.holds.has(x.data), reliability: p.reliability, kb: x.kb }) })).sort((a, b) => b.sc - a.sc)[0].x;
      pick.leased = true; const transfer = p.holds.has(pick.data) ? 0 : pick.kb; kb += transfer; const dur = Math.ceil((2 + transfer / 50) / p.speed); p.busyUntil = t + dur;
      if (rnd() > p.reliability) { failures++; pick.retryAt = t + 30; pick.fail = true; } else { pick.finish = t + dur; } }
    for (const x of T) { if (x.leased && x.fail && x.retryAt <= t) { x.leased = false; x.fail = false; } if (x.leased && x.finish !== undefined && x.finish <= t && !done.has(x.id)) { done.add(x.id); weightedWait += x.priority * (x.finish - x.created); } }
    t++;
  }
  return { makespan: t, failures, kbTransferred: Math.round(kb), priorityWeightedWait: Math.round(weightedWait / tasks), completed: done.size };
}

// ---------- learning (meta-evolution of the evolution engine's search settings) ----------
export function evaluateLearning(settings, cases) {
  const t0 = performance.now(); let fixed = 0, transfer = 0, tried = 0;
  for (const c of cases) { const r = synthesize({ ...c.problem, maxLeaves: settings.synthesisMaxLeaves, constants: settings.synthesisConstants }); tried += r.tried || 0; if (r.ok) { fixed++; if (r.heldOut && r.heldOut.passed === r.heldOut.total) transfer++; } }
  return { cases: cases.length, fixed, transfer, expressionsTried: tried, ms: +(performance.now() - t0).toFixed(1) };
}
