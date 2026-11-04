// Domain-agnostic curriculum for structured experiences, CPU-only.
// Task adapters are declarative data. No generated code, network calls, or LLM dependencies.
const valid = x => typeof x === 'string' && x.length > 0 && x.length <= 120;
const key = (...xs) => JSON.stringify(xs);
const TYPES = new Set(['language-relation','object-property','causal-transition','action-outcome','social-relation','sequence','spatial-relation','numeric-relation']);
const SPLITS = new Set(['train','evaluation']);
export class DevelopmentalCurriculum {
  constructor({ state = {}, maxExamples = 5000 } = {}) {
    this.S = state; this.S.examples ||= []; this.S.evaluations ||= []; this.S.lessons ||= {};
    this.maxExamples = Math.max(10, Math.min(5000, maxExamples));
  }
  // Structured experience: subject --relation--> object. Type is metadata, not a hard-coded solver.
  record({ domain, subject, relation, object, split = 'train', evidence = 'observation' }) {
    if (!TYPES.has(domain) || ![subject,relation,object].every(valid) || !SPLITS.has(split) || !['observation','measurement','verified-test'].includes(evidence)) return { ok:false, reason:'invalid bounded experience' };
    const x = { domain, subject, relation, object, split, evidence };
    if (this.S.examples.length >= this.maxExamples) return { ok:false, reason:'experience budget reached' };
    // Prevent exact held-out examples from leaking into training, in either insertion order.
    if (this.S.examples.some(e => e.domain===domain && e.subject===subject && e.relation===relation && e.object===object && e.split!==split)) return { ok:false, reason:'split leakage' };
    this.S.examples.push(x); return { ok:true };
  }
  // Learn from training only. Conflicting outcomes make the answer unknown.
  predict({ domain, subject, relation }) {
    if (!TYPES.has(domain) || ![subject,relation].every(valid)) return { ok:false, reason:'invalid query' };
    const matches = this.S.examples.filter(e => e.split==='train' && e.domain===domain && e.subject===subject && e.relation===relation);
    const answers = [...new Set(matches.map(e => e.object))];
    return answers.length===1 ? { ok:true, object:answers[0], support:matches.length, kind:'retrieved-relation' } : { ok:false, reason:answers.length?'conflicting evidence':'unknown relation' };
  }
  // Withheld tests are evaluated, never used for learning.
  evaluate(domain) {
    if (!TYPES.has(domain)) return { ok:false, reason:'unknown domain' };
    const held = this.S.examples.filter(e => e.split==='evaluation' && e.domain===domain);
    if (!held.length) return { ok:false, reason:'no withheld examples' };
    const results = held.map(e => this.predict(e));
    const passed = results.filter((r,i) => r.ok && r.object===held[i].object).length;
    const report = { domain, passed, total:held.length, accuracy:passed/held.length, measuredAt:this.S.evaluations.length+1 };
    this.S.evaluations.push(report);
    if (this.S.evaluations.length>200) this.S.evaluations.shift();
    return { ok:true, ...report };
  }
  // Prioritize domains with no evaluation, then lowest held-out performance.
  nextLesson() {
    const candidates = [...TYPES].map(domain => {
      const latest = [...this.S.evaluations].reverse().find(e => e.domain===domain);
      const train = this.S.examples.filter(e => e.domain===domain && e.split==='train').length;
      const held = this.S.examples.filter(e => e.domain===domain && e.split==='evaluation').length;
      return { domain, train, held, accuracy:latest?.accuracy ?? null, priority:held===0?3:latest?1-latest.accuracy:2 };
    }).sort((a,b) => b.priority-a.priority || a.train-b.train || a.domain.localeCompare(b.domain));
    return { ok:true, next:candidates[0], domains:candidates };
  }
  status() { return { examples:this.S.examples.length, evaluations:this.S.evaluations.length, next:this.nextLesson().next }; }
}
export const CURRICULUM_DOMAINS = Object.freeze([...TYPES]);
