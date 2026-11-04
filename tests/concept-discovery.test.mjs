import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentalCurriculum } from '../lib/mind/developmental-curriculum.mjs';
import { ConceptDiscovery } from '../lib/mind/concept-discovery.mjs';

test('finds aligned relations across different domains',()=>{
 const c=new DevelopmentalCurriculum();
 for(const [s,o] of [['a','b'],['c','d'],['e','f']]){
  c.record({domain:'language-relation',subject:s,relation:'precedes',object:o});
  c.record({domain:'sequence',subject:s,relation:'next',object:o});
 }
 const d=new ConceptDiscovery({curriculum:c});
 assert.equal(d.discover().length,1);
 assert.equal(d.infer({domain:'sequence',subject:'a',relation:'next'}).object,'b');
});
test('does not invent alignment from one coincidental example',()=>{
 const c=new DevelopmentalCurriculum();
 c.record({domain:'social-relation',subject:'a',relation:'knows',object:'b'});
 c.record({domain:'spatial-relation',subject:'a',relation:'near',object:'b'});
 assert.equal(new ConceptDiscovery({curriculum:c}).discover().length,0);
});
test('withheld evidence cannot create an alignment',()=>{
 const c=new DevelopmentalCurriculum();
 for(const [s,o] of [['a','b'],['c','d'],['e','f']]){
  c.record({domain:'object-property',subject:s,relation:'attribute',object:o});
  c.record({domain:'language-relation',subject:s,relation:'means',object:o,split:'evaluation'});
 }
 assert.equal(new ConceptDiscovery({curriculum:c}).discover().length,0);
});

test('transfers to target-domain withheld subject without leaking evaluation',()=>{
 const c=new DevelopmentalCurriculum();
 for(const [s,o] of [['a','b'],['c','d'],['e','f']]){
  c.record({domain:'language-relation',subject:s,relation:'precedes',object:o});
  c.record({domain:'sequence',subject:s,relation:'next',object:o});
 }
 c.record({domain:'language-relation',subject:'new',relation:'precedes',object:'later'});
 c.record({domain:'sequence',subject:'new',relation:'next',object:'later',split:'evaluation'});
 const d=new ConceptDiscovery({curriculum:c});
 assert.equal(c.predict({domain:'sequence',subject:'new',relation:'next'}).ok,false);
 assert.equal(d.infer({domain:'sequence',subject:'new',relation:'next'}).object,'later');
 assert.equal(d.evaluate({domain:'sequence',relation:'next'}).passed,1);
});
test('rejects alignments with conflicting shared subject outcomes',()=>{
 const c=new DevelopmentalCurriculum();
 for(const [s,o] of [['a','b'],['c','d'],['e','f']]){
  c.record({domain:'language-relation',subject:s,relation:'precedes',object:o});
  c.record({domain:'sequence',subject:s,relation:'next',object:o});
 }
 c.record({domain:'sequence',subject:'a',relation:'next',object:'different'});
 assert.equal(new ConceptDiscovery({curriculum:c}).discover().length,0);
});
