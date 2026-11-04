import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentalLearning} from '../lib/mind/developmental-learning-core.mjs';
test('unverified demonstrations never become executable knowledge',()=>{
 const state={},m=new DevelopmentalLearning({state});
 for(let i=0;i<5;i++)m.observe({input:{a:i+3,b:2},output:{answer:i+1},consent:true,source:'user'});
 m.discover();assert.equal(m.status().validated,0);assert.equal(m.predict({a:10,b:2}).ok,false);
});
test('inducts and transfers verified arithmetic procedure to unseen values',()=>{
 const state={},m=new DevelopmentalLearning({state});
 for(const [a,b] of [[7,2],[9,3],[14,4],[18,5]])m.observe({input:{a,b},output:{answer:a-b},consent:true,source:'trusted-evaluator',verified:true});
 m.discover();assert.equal(m.predict({a:23,b:8}).output.answer,15);
 const restored=new DevelopmentalLearning({state:JSON.parse(JSON.stringify(state))});
 assert.equal(restored.predict({a:45,b:12}).output.answer,33);
});
test('contradictory verified evidence blocks incorrect rule',()=>{
 const m=new DevelopmentalLearning();
 for(const [a,b] of [[7,2],[9,3],[14,4]])m.observe({input:{a,b},output:{answer:a-b},consent:true,source:'trusted-evaluator',verified:true});
 m.discover();m.observe({input:{a:21,b:8},output:{answer:999},consent:true,source:'trusted-evaluator',verified:true});
 m.evaluate();assert.equal(m.predict({a:23,b:8}).ok,false);
});
test('rules can be retired and are scoped',()=>{
 const m=new DevelopmentalLearning();
 for(const [a,b] of [[7,2],[9,3],[14,4]])m.observe({input:{a,b},output:{answer:a-b},consent:true,source:'trusted-evaluator',verified:true});
 m.discover();const hit=m.predict({a:23,b:8});assert.equal(hit.ok,true);
 assert.equal(m.predict({a:23,b:8},{scope:'public'}).ok,false);
 assert.equal(m.rollback(hit.proof[0].ruleId).ok,true);
 assert.equal(m.predict({a:23,b:8}).ok,false);
});
