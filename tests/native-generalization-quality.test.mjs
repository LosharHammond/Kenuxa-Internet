import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNativeCurriculum,nativeTrainingDocuments,evaluateNativeGeneralization} from '../lib/transformer/native-curriculum.mjs';
test('native training vocabulary and held-out assessment vocabulary remain disjoint',()=>{
 const train=nativeTrainingDocuments({seed:17011,perKind:12}).join(' ');
 const cases=buildNativeCurriculum({seed:825617,perKind:6});
 assert.equal(cases.length,18);
 for(const c of cases){
  const ids=[...c.question.matchAll(/\bN[a-z]{7}\b/g)].map(x=>x[0]);
  assert.ok(ids.length>0);
  assert.ok(ids.every(id=>!train.includes(id)),'held-out lexical item leaked into training');
 }
});
test('an abstaining native checkpoint cannot pass by merely returning unknown',async()=>{
 const result=await evaluateNativeGeneralization({perKind:2,draft:async()=>JSON.stringify({kind:'unknown'})});
 assert.equal(result.passed,false);
 assert.equal(result.stats.arithmetic.correct,0);
 assert.equal(result.stats.inherit.correct,0);
});
test('independently correct native frames pass the gate and fabricated frames are rejected',async()=>{
 const cases=buildNativeCurriculum({seed:825617,perKind:3});
 let index=0;
 const pass=await evaluateNativeGeneralization({perKind:3,draft:async()=>JSON.stringify(cases[index++].frame)});
 assert.equal(pass.passed,true,JSON.stringify(pass));
 let wrong=0;
 const fail=await evaluateNativeGeneralization({perKind:3,draft:async()=>{
  const original=cases[wrong++].frame;return JSON.stringify(original.kind==='arithmetic'?{...original,left:9999}:original);
 }});
 assert.equal(fail.passed,false);
});
