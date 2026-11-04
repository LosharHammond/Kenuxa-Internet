import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverModularRule, applyModularRule, evaluateModularRule } from '../lib/mind/developmental-generalize.mjs';

test('induces a rule and transfers to withheld input combinations', () => {
  const modulus = 7, expected = (s,a) => (2*s+3*a+1)%modulus;
  const training = [];
  for(let s=0;s<7;s++) for(let a=0;a<3;a++) if ((s+a)%3!==0) training.push({state:s,action:a,next:expected(s,a)});
  const held = [];
  for(let s=0;s<7;s++) for(let a=0;a<3;a++) if ((s+a)%3===0) held.push({state:s,action:a,next:expected(s,a)});
  const learned = discoverModularRule({examples:training,modulus});
  assert.equal(learned.ok,true);
  assert.deepEqual(learned.rule,{a:2,b:3,c:1,modulus});
  assert.deepEqual(evaluateModularRule(learned.rule,held),{ok:true,total:held.length,passed:held.length});
});
test('does not promote ambiguous or contradictory patterns', () => {
  assert.equal(discoverModularRule({modulus:7,examples:[{state:0,action:0,next:1},{state:0,action:0,next:1},{state:0,action:0,next:1}]}).reason,'ambiguous hypotheses');
  assert.equal(discoverModularRule({modulus:7,examples:[{state:0,action:0,next:1},{state:0,action:0,next:2},{state:1,action:1,next:3}]}).reason,'contradictory observations');
});
test('honors search budgets', () => {
  const r=discoverModularRule({modulus:7,maxCandidates:1,examples:[{state:0,action:0,next:1},{state:1,action:0,next:3},{state:0,action:1,next:4}]});
  assert.equal(r.ok,false);
});
