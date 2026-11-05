import test from 'node:test';
import assert from 'node:assert/strict';
import {withinAnswerBudget} from '../lib/chat/answer-budget.mjs';
test('a fast answer is returned immediately without invoking the slow-path deadline',async()=>{
 const r=await withinAnswerBudget(async()=>({answer:'verified answer'}),{timeoutMs:100});
 assert.equal(r.timedOut,false);assert.equal(r.value.answer,'verified answer');
});
test('a permanently pending provider cannot strand the response indefinitely',async()=>{
 const started=Date.now();
 const r=await withinAnswerBudget(()=>new Promise(()=>{}),{timeoutMs:35});
 assert.equal(r.timedOut,true);assert.equal(r.value,null);
 assert.ok(Date.now()-started<300,'budget exceeded unexpectedly');
});
test('a late rejected provider is handled after the reply budget expires',async()=>{
 const r=await withinAnswerBudget(()=>new Promise((_,reject)=>setTimeout(()=>reject(Error('late provider error')),75)),{timeoutMs:15});
 assert.equal(r.timedOut,true);
 await new Promise(resolve=>setTimeout(resolve,90));
});
