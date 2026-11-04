import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentalLab, ToyWorld } from '../lib/mind/developmental-lab.mjs';
import { DevelopmentalLearner } from '../lib/mind/developmental.mjs';

test('isolated lab discovers transitions without a model or teacher', () => {
  const learner = new DevelopmentalLearner();
  const lab = new DevelopmentalLab({ learner });
  const world = new ToyWorld({ states: 5, actions: 3, seed: 19 });
  const result = lab.run({ world });
  assert.equal(result.ok, true);
  assert.equal(result.correct, 15);
  assert.equal(result.promoted, 15);
  assert.equal(learner.status().validated, 15);
});
test('lab rejects excessive experiment budgets', () => {
  const lab = new DevelopmentalLab();
  assert.equal(lab.run({ world: new ToyWorld({ states: 32, actions: 12 }), maxExperiments: 384 }).ok, false);
});
test('lab never changes public world or executes untrusted programs', () => {
  assert.throws(() => new ToyWorld({ states: 1000 }), RangeError);
  assert.throws(() => new ToyWorld({ seed: -1 }), RangeError);
});
