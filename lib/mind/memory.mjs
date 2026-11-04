// Cognitive Working Memory (per reasoning episode, bounded) and Cognitive Experience Memory (persistent, structural).
// Working memory is NOT user memory: it lives for one episode, holds goals, retrieved atoms, assumptions,
// intermediate conclusions, hypotheses, constraints, procedures, evidence and open questions, and evicts the least
// relevant items when full. Experience memory stores structured episodes — features of the problem, methods used,
// operations, outcome, verified mistakes and corrections — and retrieves them by STRUCTURAL similarity (problem type,
// target dimension, input dimensions, entities), not by matching the question's words.

export class WorkingMemory {
  constructor({ capacity = 64 } = {}) { this.capacity = capacity; this.items = []; this.seq = 0; this.evicted = 0; }
  add(kind, content, { relevance = 0.5, source = null } = {}) {
    const it = { id: ++this.seq, kind, content, relevance, source, at: this.seq }; this.items.push(it);
    if (this.items.length > this.capacity) { this.items.sort((a, b) => (b.relevance + b.at / 1e4) - (a.relevance + a.at / 1e4)); this.evicted += this.items.length - this.capacity; this.items.length = this.capacity; }
    return it.id;
  }
  of(kind) { return this.items.filter(i => i.kind === kind).sort((a, b) => a.at - b.at).map(i => i.content); }
  boost(id, by = 0.2) { const it = this.items.find(i => i.id === id); if (it) it.relevance = Math.min(1, it.relevance + by); }
  snapshot() { const by = {}; for (const i of this.items) (by[i.kind] ||= []).push(i.content); return { size: this.items.length, capacity: this.capacity, evicted: this.evicted, ...by }; }
}

// structural features of a problem
export function signature({ type, target = null, inputDims = [], entities = [], strategy = null }) {
  return { type, target, inputDims: [...new Set(inputDims)].sort(), entities: [...new Set(entities)].sort(), strategy };
}
const jacc = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 1; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
export function similarity(a, b) { return (a.type === b.type ? 0.35 : 0) + (a.target === b.target ? 0.25 : 0) + 0.3 * jacc(a.inputDims, b.inputDims) + 0.1 * jacc(a.entities, b.entities); }

export class ExperienceMemory {
  constructor({ state = {}, now = () => Date.now(), max = 2000 } = {}) { this.S = state; this.S.episodes ||= []; this.now = now; this.max = max; }
  record(ep) {
    const e = { id: 'exp:' + this.now().toString(36) + ':' + (this.S.episodes.length % 1e6).toString(36), at: this.now(), signature: ep.signature, problem: String(ep.problem || '').slice(0, 300), methods: ep.methods || [], operations: (ep.operations || []).slice(0, 30), answer: ep.answer ?? null, outcome: ep.outcome || 'unverified', mistakes: ep.mistakes || [], correction: ep.correction || null, lesson: ep.lesson || null, ms: ep.ms ?? null, visibility: ep.visibility || 'private' };
    this.S.episodes.push(e); if (this.S.episodes.length > this.max) this.S.episodes.splice(0, this.S.episodes.length - this.max); return e;
  }
  verify(id, { outcome, mistakes = [], correction = null, lesson = null }) { const e = this.S.episodes.find(x => x.id === id); if (!e) return null; Object.assign(e, { outcome, mistakes, correction, lesson, verifiedAt: this.now() }); return e; }
  similar(sig, { k = 5, min = 0.5 } = {}) { return this.S.episodes.map(e => ({ e, s: similarity(sig, e.signature) })).filter(x => x.s >= min).sort((a, b) => b.s - a.s).slice(0, k); }
  // methods that FAILED (verified) on structurally similar problems — the controller avoids them
  avoid(sig) { return [...new Set(this.similar(sig, { k: 20, min: 0.7 }).filter(x => x.e.outcome === 'wrong').flatMap(x => x.e.mistakes.map(m => m.method).filter(Boolean)))]; }
  stats() { const by = {}; for (const e of this.S.episodes) by[e.outcome] = (by[e.outcome] || 0) + 1; return { episodes: this.S.episodes.length, byOutcome: by }; }
}
