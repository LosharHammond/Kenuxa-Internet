import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FabricJournal} from '../lib/mind/fabric-journal.mjs';
import {CognitiveFabric} from '../lib/mind/cognitive-fabric.mjs';
import {executeSemanticFrame} from '../lib/mind/fabric-model.mjs';
const verified=(j,id,revision=1)=>j.verifiedChange({
 id,kind:'atom',revision,proof:'independent verified evidence '+revision
},{authorized:true});

test('versioned atom changes invalidate molecules, cells and skills transitively, even in a cycle',async()=>{
 const state={},j=new FabricJournal({state});
 assert.equal(j.depend('mol:first',['atom:root','skill:derived'],{kind:'molecule'}).ok,true);
 assert.equal(j.depend('cell:second',['mol:first'],{kind:'cell'}).ok,true);
 assert.equal(j.depend('skill:derived',['cell:second'],{kind:'skill'}).ok,true);
 const r=verified(j,'atom:root');
 assert.equal(r.ok,true);assert.equal(r.invalidated,3);
 assert.deepEqual(Object.keys(j.S.dirty).sort(),['cell:second','mol:first','skill:derived']);
 assert.equal(j.verifyChain().ok,true);
 const reloaded=new FabricJournal({state:JSON.parse(JSON.stringify(state))});
 const seen=[];
 const drained=await reloaded.drain({limit:9,rebuild:async({artifact})=>{seen.push(artifact);return {ok:true};}});
 assert.equal(drained.processed,3);
 assert.equal(reloaded.status().pending,0);
 assert.equal(seen.length,3);
});
test('changing a dependency removes obsolete source edges without losing independent dependencies',()=>{
 const j=new FabricJournal({state:{}});
 j.depend('mol:dependent',['atom:old','atom:kept']);
 j.depend('mol:dependent',['atom:new','atom:kept']);
 assert.equal(verified(j,'atom:old').invalidated,0);
 assert.equal(verified(j,'atom:new').invalidated,1);
 assert.equal(verified(j,'atom:kept').invalidated,1);
 assert.equal(j.verifyChain().ok,true);
});
test('a failed rebuild is backed off rather than starving unrelated work',async()=>{
 let t=200000;
 const j=new FabricJournal({state:{},now:()=>t});
 j.depend('mol:bad',['atom:root']);j.depend('mol:good',['atom:root']);
 verified(j,'atom:root');
 const touched=[];
 const run=()=>j.drain({limit:2,rebuild:async({artifact})=>{
  touched.push(artifact);
  if(artifact==='mol:bad'&&t<201000)throw Error('temporary unavailable');
  return {ok:true};
 }});
 let r=await run();assert.equal(r.processed,1);assert.equal(r.failed,1);
 assert.deepEqual(touched,['mol:bad','mol:good']);
 r=await run();assert.equal(r.processed,0);assert.equal(r.pending,1);
 t+=1100;r=await run();assert.equal(r.processed,1);assert.equal(r.pending,0);
});
test('an in-flight rebuild never acknowledges a newer verified revision',async()=>{
 const j=new FabricJournal({state:{}});
 j.depend('mol:derived',['atom:root']);
 verified(j,'atom:root');
 const first=await j.drain({rebuild:async()=>{
  verified(j,'atom:root',2);return {ok:true};
 }});
 assert.equal(first.processed,0);
 assert.equal(first.pending,1);
 const second=await j.drain({rebuild:async()=>({ok:true})});
 assert.equal(second.processed,1);
 assert.equal(second.pending,0);
});
test('a verified-evidence contradiction is never handed to the legacy chatbot',async()=>{
 let legacy=0, audited=[];
 const candidate=(answer,route)=>({answer,route,kind:'procedure',
  verified:true,confidence:90,trust:'verified-procedure',provenance:[{source:'independent-test'}]});
 const fabric=new CognitiveFabric({state:{},unified:{
  answer:()=>{legacy++;throw Error('must never route conflict to legacy');},
  collect:()=>[candidate('A = 8','learned-a'),candidate('A = 9','learned-b')],
  audit:x=>audited.push(x),status:()=>({})
 },interpreter:{available:false,status:()=>({backend:'off'})}});
 const result=await fabric.answer('A from contradictory evidence');
 assert.equal(result.route,'fabric-conflict');
 assert.equal(result.verified,false);
 assert.equal(result.fabric.conflict,true);
 assert.match(result.answer,/conflicting verified evidence/);
 assert.equal(legacy,0);
 assert.equal(fabric.journal.S.failures.length,1);
 assert.equal(audited[0].route,'fabric-conflict');
});
test('a negative claim cannot be turned into positive inheritance or a fictitious loss',()=>{
 const question='A Ferva has eight fins. Nori is a Ferva. Nori loses two fins. How many fins remain?';
 const good={kind:'world-transition',
  classes:[{name:'Ferva',properties:[{name:'fins',value:8,quote:'Ferva has eight fins'}]}],
  entities:[{name:'Nori',class:'Ferva',quote:'Nori is a Ferva'}],
  changes:[{entity:'Nori',property:'fins',operation:'subtract',amount:2,quote:'Nori loses two fins'}],
  query:{entity:'Nori',property:'fins'}};
 assert.equal(executeSemanticFrame(good,{question})?.operation.result,6);
 const inverted='A Ferva has eight fins. Nori is not a Ferva. Nori loses two fins. How many fins remain?';
 assert.equal(executeSemanticFrame({...good,entities:[{...good.entities[0],
  quote:'Nori is not a Ferva'}]},{question:inverted}),null);
 const negProperty='A Ferva does not have eight fins. Nori is a Ferva. Nori loses two fins.';
 assert.equal(executeSemanticFrame({...good,classes:[{name:'Ferva',properties:[{
  name:'fins',value:8,quote:'Ferva does not have eight fins'}]}]},{question:negProperty}),null);
 const negChange='A Ferva has eight fins. Nori is a Ferva. Nori did not lose two fins.';
 assert.equal(executeSemanticFrame({...good,changes:[{...good.changes[0],
  quote:'Nori did not lose two fins'}]},{question:negChange}),null);
});
test('snapshots require a valid journal chain, not just a self-consistent file hash',async()=>{
 const state={},j=new FabricJournal({state});
 const files=new Map(),blobs={write:async(n,b)=>files.set(n,b),read:async n=>files.get(n)};
 verified(j,'atom:root');
 const saved=await j.snapshot({blobs,nodeId:'node-home',material:{publicAtomIds:['atom:root']}});
 assert.equal(saved.ok,true);
 assert.equal((await j.inspectSnapshot({blobs,name:saved.name})).ok,true);
 const wrapper=JSON.parse(files.get(saved.name).toString());
 wrapper.exported.events[0].revision=55;
 wrapper.sha=createHash('sha256').update(JSON.stringify(wrapper.exported)).digest('hex');
 const differentName='cognitive-fabric-'+wrapper.sha.slice(0,20)+'.json';
 files.set(differentName,Buffer.from(JSON.stringify(wrapper)));
 const check=await j.inspectSnapshot({blobs,name:differentName});
 assert.equal(check.ok,false);
 assert.match(check.reason,/event-chain/i);
 // An already-corrupted in-memory chain cannot become a new trusted snapshot.
 state.cognitiveFabric.events[0].revision=55;
 const second=await j.snapshot({blobs,nodeId:'node-home',material:{}});
 assert.equal(second.ok,false);
});
