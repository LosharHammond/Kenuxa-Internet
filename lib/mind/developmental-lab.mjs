// Isolated developmental laboratory. Deterministic toy worlds, not the public internet.
// The learner is never told the transition mapping; it can only observe experiment results.
import { DevelopmentalLearner } from './developmental.mjs';

const allowed = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
export class ToyWorld {
  constructor({ states = 5, actions = 3, seed = 17 } = {}) {
    if (!Number.isInteger(states) || states < 2 || states > 32 || !Number.isInteger(actions) || actions < 1 || actions > 12 || !allowed(seed)) throw new RangeError('invalid bounded world');
    this.states = states; this.actions = actions; this.seed = seed;
  }
  // A reproducible hidden mapping. State/action symbols carry no human-language meaning.
  transition(s, a) {
    if (!Number.isInteger(s) || s < 0 || s >= this.states || !Number.isInteger(a) || a < 0 || a >= this.actions) throw new RangeError('invalid transition');
    return (s * (this.seed % this.states + 1) + a * (this.seed % 7 + 1) + this.seed) % this.states;
  }
  state(s) { return 'state:' + s; }
  action(a) { return 'action:' + a; }
}

export class DevelopmentalLab {
  constructor({ learner = new DevelopmentalLearner(), state = {} } = {}) {
    this.learner = learner;
    this.state = state;
    this.state.runs ||= [];
  }
  // Experiments are bounded, synchronous, and operate only on the toy world.
  run({ world = new ToyWorld(), repetitions = 2, maxExperiments = 384 } = {}) {
    if (!(world instanceof ToyWorld) || !Number.isInteger(repetitions) || repetitions < 2 || repetitions > 5 || !Number.isInteger(maxExperiments) || maxExperiments < 2 || maxExperiments > 384) throw new RangeError('invalid lab budget');
    const total = world.states * world.actions * repetitions;
    if (total > maxExperiments) return { ok: false, reason: 'experiment budget exceeded' };
    const runId = this.state.runs.length + 1;
    let observations = 0, promoted = 0, correct = 0, tested = 0;
    // Fixed order makes this reproducible and auditable. Test trials are not added to training.
    for (let s = 0; s < world.states; s++) for (let a = 0; a < world.actions; a++) {
      const before = world.state(s), action = world.action(a), after = world.state(world.transition(s,a));
      for (let n = 0; n < repetitions; n++) {
        this.learner.observe({ before, action, after, source: 'measurement' });
        observations++;
      }
      const prediction = this.learner.predict({ before, action });
      tested++;
      if (prediction.ok && prediction.predicted === after) correct++;
      const trials = [0,1].map(i => ({ before, action, after: world.state(world.transition(s,a)), source: 'verified-test', testId: 'lab:' + runId + ':' + s + ':' + a + ':' + i }));
      if (this.learner.validate({ before, action, trials }).promoted) promoted++;
    }
    const report = { ok: true, world: { states: world.states, actions: world.actions, seed: world.seed }, observations, tested, correct, promoted, note: 'Exact transition memorization in a deterministic toy world; not generalization to unseen states or language.' };
    this.state.runs.push(report);
    if (this.state.runs.length > 30) this.state.runs.shift();
    return report;
  }
}
