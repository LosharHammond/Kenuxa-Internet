import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentalCurriculum, CURRICULUM_DOMAINS } from '../lib/mind/developmental-curriculum.mjs';

test('curriculum supports non-mathematical domains', () => {
  const c=new DevelopmentalCurriculum();
  for(const domain of ['language-relation','object-property','causal-transition','spatial-relation','social-relation']) {
    assert.equal(c.record({domain,subject:'entity-a',relation:'relates-to',object:'entity-b'}).ok,true);
    assert.equal(c.predict({domain,subject:'entity-a',relation:'relates-to'}).object,'entity-b');
  }
  assert.ok(CURRICULUM_DOMAINS.length>=7);
});
test('withheld examples are not used to learn', () => {
  const c=new DevelopmentalCurriculum();
  c.record({domain:'object-property',subject:'unseen',relation:'color',object:'blue',split:'evaluation'});
  assert.equal(c.predict({domain:'object-property',subject:'unseen',relation:'color'}).ok,false);
  assert.equal(c.evaluate('object-property').passed,0);
  assert.equal(c.record({domain:'object-property',subject:'unseen',relation:'color',object:'blue',split:'train'}).ok,false);
});
test('contradictory relations trigger uncertainty', () => {
  const c=new DevelopmentalCurriculum();
  c.record({domain:'causal-transition',subject:'x',relation:'causes',object:'y'});
  c.record({domain:'causal-transition',subject:'x',relation:'causes',object:'z'});
  assert.equal(c.predict({domain:'causal-transition',subject:'x',relation:'causes'}).reason,'conflicting evidence');
});
test('curriculum prioritizes missing evaluation coverage', () => {
  const c=new DevelopmentalCurriculum();
  c.record({domain:'sequence',subject:'a',relation:'next',object:'b',split:'evaluation'});
  c.evaluate('sequence');
  assert.notEqual(c.nextLesson().next.domain,'sequence');
});
