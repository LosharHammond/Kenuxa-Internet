import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentalLearner } from '../lib/mind/developmental.mjs';

test('discovers opaque transition and persists state', () => {
  const state = {};
  const mind = new DevelopmentalLearner({ state });
  assert.equal(mind.predict({ before: 's:1', action: 'a:2' }).ok, false);
  mind.observe({ before: 's:1', action: 'a:2', after: 's:3' });
  assert.equal(mind.predict({ before: 's:1', action: 'a:2' }).ok, false);
  mind.observe({ before: 's:1', action: 'a:2', after: 's:3' });
  assert.equal(new DevelopmentalLearner({ state }).predict({ before: 's:1', action: 'a:2' }).predicted, 's:3');
});
test('rejects conflicting observations and validates only held-out tests', () => {
  const mind = new DevelopmentalLearner();
  for (let i=0;i<2;i++) mind.observe({ before: 'x', action: 'y', after: 'z' });
  assert.equal(mind.validate({ before:'x', action:'y', trials:[{ before:'x',action:'y',after:'z',source:'observation' },{ before:'x',action:'y',after:'z',source:'observation' }] }).ok, false);
  assert.equal(mind.validate({ before:'x', action:'y', trials:[{ before:'x',action:'y',after:'z',source:'verified-test' },{ before:'x',action:'y',after:'z',source:'verified-test' }] }).promoted, true);
  mind.observe({ before:'x', action:'y', after:'other' });
  assert.equal(mind.predict({ before:'x', action:'y' }).ok, false);
});
test('held-out contradiction blocks promotion', () => {
  const mind = new DevelopmentalLearner();
  for(let i=0;i<2;i++) mind.observe({ before:'a',action:'b',after:'c' });
  const result=mind.validate({before:'a',action:'b',trials:[{before:'a',action:'b',after:'c',source:'verified-test'},{before:'a',action:'b',after:'d',source:'verified-test'}]});
  assert.equal(result.promoted,false);
  assert.equal(mind.status().rejected,1);
});
