import test from 'node:test';
import assert from 'node:assert/strict';
import {induceProgram,runInducedProgram,evaluateInducedProgram} from '../lib/mind/program-induction.mjs';
import {DevelopmentalLearning} from '../lib/mind/developmental-learning-core.mjs';

const cases=(f)=>[[3,2],[7,4],[12,6],[21,5],[30,9],[42,7],[73,12],[104,17],[121,19]]
  .map(([a,b])=>({input:{a,b},output:{answer:f(a,b)}}));
test('general declarative synthesis induces unseen numeric transformations without task-specific code',()=>{
 const examples=cases((a,b)=>a*b+2);
 const fit=induceProgram(examples);
 assert.equal(fit.ok,true,JSON.stringify(fit));
 const result=runInducedProgram(fit.program.expr,{a:13,b:5});
 assert.equal(result,67);
 assert.ok(fit.heldout>=2);
});
test('induced string templates generalize to novel names and actions',()=>{
 const subjects=['Meka','Zorin','Cloud','River','Safi','Asha','Bim','Fen','Aqua'];
 const examples=subjects.map((subject,i)=>({input:{subject,action:['jump','swim','walk','fly','think','sing','draw','build','learn'][i]},output:{answer:subject+' can '+['jump','swim','walk','fly','think','sing','draw','build','learn'][i]+'.'}}));
 const fit=induceProgram(examples);
 assert.equal(fit.ok,true,JSON.stringify(fit));
 assert.equal(runInducedProgram(fit.program.expr,{subject:'Tava',action:'navigate'}),'Tava can navigate.');
});
test('induction requires independent heldout cases and rejects conflicting observations',()=>{
 assert.equal(induceProgram(cases((a,b)=>a+b).slice(0,3)).ok,false);
 const examples=cases((a,b)=>a+b);
 examples.push({input:examples[0].input,output:{answer:-100}});
 assert.equal(induceProgram(examples).ok,false);
});
test('learned synthesized skills survive serialized restart and rollback',()=>{
 const state={};
 const l=new DevelopmentalLearning({state});
 for(const sample of cases((a,b)=>a*b+2)){
   const r=l.observe({...sample,consent:true});
   assert.equal(r.ok,true);
   assert.equal(l.verifyExample(r.id,{expected:sample.output,authority:true}).ok,true);
 }
 const learned=l.discover();
 assert.ok(learned.candidates>0);
 const pred=l.predict({a:13,b:5});
 assert.equal(pred.ok,true,JSON.stringify(pred));
 assert.equal(pred.output.answer,67);
 const reloaded=new DevelopmentalLearning({state:JSON.parse(JSON.stringify(state))});
 assert.equal(reloaded.predict({a:13,b:5}).output.answer,67);
 for(const r of reloaded.state.rules.filter(x=>x.status==='validated'))reloaded.rollback(r.id);
 assert.equal(reloaded.predict({a:13,b:5}).ok,false);
 reloaded.evaluate();
 assert.equal(reloaded.predict({a:13,b:5}).ok,false,'rollback must not be automatically undone');
});
test('untrusted public examples cannot promote synthesized skills',()=>{
 const l=new DevelopmentalLearning();
 for(const x of cases((a,b)=>a*b+2))l.observe({...x,scope:'public',consent:true,source:'visitor'});
 assert.equal(l.discover().candidates,0);
 assert.equal(l.predict({a:5,b:9},{scope:'public'}).ok,false);
});
