import test from 'node:test';
import assert from 'node:assert/strict';
import {CognitiveFabric} from '../lib/mind/cognitive-fabric.mjs';
import {FabricJournal} from '../lib/mind/fabric-journal.mjs';
import {FabricInterpreter,executeSemanticFrame} from '../lib/mind/fabric-model.mjs';

const fakeUnified=(answer=null)=>({answer:()=>answer,status:()=>({connected:true})});
const fib=(opts={})=>new CognitiveFabric({state:{},unified:fakeUnified(),...opts});
test('model-proposed new names and quantities are checked against premises, not hard-coded answers',async()=>{
 let seed=351;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<30;i++){
  const name='X'+Array.from({length:9},()=>String.fromCharCode(97+Math.floor(26*random()))).join('');
  const total=20+Math.floor(random()*200),change=1+Math.floor(random()*10);
  const question='A fictional '+name+' has '+total+' sensors. '+name+' loses '+change+' sensors. How many remain?';
  const interpreter={available:true,status:()=>({backend:'fixture'}),interpret:async()=>({
   kind:'arithmetic',operation:'subtract',left:total,right:change,subject:name,unit:'sensors',
   support:['has '+total+' sensors', 'loses '+change+' sensors']})};
  const engine=fib({interpreter});
  const result=await engine.answer(question);
  assert.equal(result.operation.result,total-change);
  assert.equal(result.route,'model-grounded');
  assert.equal(result.verified,false);
  assert.match(result.answer,new RegExp(String(total-change)));
 }
});
test('hallucinated operands, invalid evidence and division by zero are refused',()=>{
 const context={question:'A gizora has 9 wheels. Miko loses 2 wheels. How many remain?',history:[]};
 const source=['has 9 wheels','loses 2 wheels'];
 const frame={kind:'arithmetic',operation:'subtract',left:9,right:2,subject:'Miko',unit:'wheels',support:source};
 assert.equal(executeSemanticFrame(frame,context)?.operation.result,7);
 assert.equal(executeSemanticFrame({...frame,left:99},context),null);
 assert.equal(executeSemanticFrame({...frame,support:['a fabricated quote']},context),null);
 assert.equal(executeSemanticFrame({...frame,operation:'divide',right:0},context),null);
});
test('model outage still allows healthy atomic and dictionary answers',async()=>{
 const interpreter={available:true,status:()=>({backend:'fixture'}),interpret:async()=>{throw new Error('network offline');}};
 const answer={answer:'A verified definition.',route:'dictionary',kind:'definition',confidence:70,verified:false,trust:'licensed-dictionary'};
 const f=fib({unified:fakeUnified(answer),interpreter});
 for(let i=0;i<4;i++)assert.equal((await f.answer('Define a random term')).answer,answer.answer);
 assert.equal(f.runtime.faults.get('language-interpreter').failures,2);
 assert.equal(f.status().components['language-interpreter'].status,'isolated');
});
test('unavailable atomic reasoning does not disable independently grounded model computation',async()=>{
 const f=fib({unified:{answer:()=>{throw new Error('core unavailable')},status:()=>({})},
  interpreter:{available:true,status:()=>({backend:'fixture'}),interpret:async()=>({
   kind:'arithmetic',operation:'add',left:6,right:4,unit:'units',support:['6 units','4 units']})}});
 const result=await f.answer('Add 6 units and 4 units.');
 assert.equal(result.operation.result,10);
 assert.equal(f.runtime.faults.get('atomic-adapters').failures,1);
});
test('scoped private conversation recall is never replaced by model guesses',async()=>{
 let called=0;
 const f=fib({unified:fakeUnified({answer:'You said the name is Kofi.',route:'conversation',kind:'remembered',confidence:80,trust:'premise-only'}),
  interpreter:{available:true,status:()=>({}),interpret:async()=>{called++;return {kind:'unknown'};}}});
 assert.match((await f.answer('What did I say my name was?')).answer,/Kofi/);
 assert.equal(called,0);
});
test('verified events hash-chain, dependencies, and repair gates survive simulated restart',async()=>{
 let time=10000;
 const state={},j=new FabricJournal({state,now:()=>time});
 assert.equal(j.depend('mol:alpha',['atom:one'],{kind:'molecule'}).ok,true);
 const bad=j.verifiedChange({id:'atom:one',revision:1,proof:'evidence one'},{authorized:false});
 assert.equal(bad.ok,false);
 const a=j.verifiedChange({id:'atom:one',revision:1,proof:'independent evidence one'},{authorized:true});
 assert.equal(a.ok,true);
 assert.equal(a.invalidated,1);
 const reboot=new FabricJournal({state:JSON.parse(JSON.stringify(state)),now:()=>time+100});
 assert.equal(reboot.verifyChain().ok,true);
 assert.equal(reboot.status().pending,1);
 const unresolved=reboot.noteFailure('What is an unknown action?',{kind:'missing-knowledge'});
 const repair=reboot.stageRepair({failureId:unresolved.id,kind:'relation',candidateRef:'atom:correction'}, {authorized:true});
 assert.equal(repair.ok,true);
 assert.equal(reboot.evaluateRepair(repair.id,[{testId:'trial-1',source:'verified-test',passed:true}],{authorized:true}).ok,false);
 const reviewed=reboot.evaluateRepair(repair.id,[{testId:'trial-1',source:'verified-test',passed:true},
   {testId:'trial-2',source:'verified-test',passed:true}],{authorized:true});
 assert.equal(reviewed.status,'tested');
 assert.equal(reboot.S.repairs[repair.id].status,'tested');
 assert.equal(reboot.S.dirty['mol:alpha'].status,'pending');
 await reboot.drain({rebuild:async()=>{}});
 assert.equal(reboot.status().pending,0);
});
test('snapshot integrity rejects corruption without overwriting live knowledge',async()=>{
 const saved=new Map();const blobs={write:async(k,v)=>saved.set(k,v),read:async k=>saved.get(k)};
 const journal=new FabricJournal({state:{}});
 journal.verifiedChange({id:'atom:one',kind:'atom',revision:1,proof:'trusted evidence'},{authorized:true});
 const snap=await journal.snapshot({blobs,nodeId:'node-1',material:{publicAtomIds:['one']}});
 assert.equal(snap.ok,true);
 assert.equal((await journal.inspectSnapshot({blobs,name:snap.name})).ok,true);
 const json=JSON.parse(saved.get(snap.name).toString());json.exported.knowledge.publicAtomIds=['tampered'];
 saved.set(snap.name,Buffer.from(JSON.stringify(json)));
 assert.equal((await journal.inspectSnapshot({blobs,name:snap.name})).ok,false);
});
test('local language model requires a loopback endpoint and remote interpretation requires consent',async()=>{
 const remote=new FabricInterpreter({env:{KENUXA_FABRIC_MODEL_BACKEND:'teacher'},
  teachers:{list:()=>[{primary:true,configured:true}]}});
 assert.equal(remote.available,false);
 const local=new FabricInterpreter({env:{KENUXA_FABRIC_MODEL_BACKEND:'local',
  KENUXA_FABRIC_MODEL_ID:'tiny-quantized',KENUXA_FABRIC_MODEL_URL:'https://example.org/v1/chat/completions'}});
 await assert.rejects(local.interpret('Question?'),/loopback/);
});
