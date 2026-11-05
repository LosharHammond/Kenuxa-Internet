import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveQuantityFollowup} from '../lib/mind/quantity-context.mjs';
import {CognitiveFabric} from '../lib/mind/cognitive-fabric.mjs';
const contextual=(name,unit,total,lost)=>({
 question:'A '+name+' has '+total+' '+unit+'. One '+name+' loses '+lost+' '+unit+'. How many '+unit+' remain?',
 answer:name+' has '+(total-lost)+' '+unit+' remaining: '+total+' - '+lost+' = '+(total-lost)+'.'
});
test('unfamiliar quantity state carries across arbitrary named entities, units, and updates',async()=>{
 let seed=238;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const word=()=>Array.from({length:8},()=>String.fromCharCode(97+Math.floor(rand()*26))).join('');
 for(let i=0;i<60;i++){
  const name='N'+word(),unit=word()+'s',total=20+Math.floor(rand()*30),lost=1+Math.floor(rand()*10);
  const history=[contextual(name,unit,total,lost)];
  const change=1+Math.floor(rand()*8);
  const q=name+' receives '+change+' more '+unit+'. How many '+unit+' does it have now?';
  const result=resolveQuantityFollowup(q,{history});
  assert.equal(result?.operation.result,total-lost+change,JSON.stringify({q,result}));
  const next=resolveQuantityFollowup(name+' loses 2 '+unit+'. How many remain?',
    {history:[{question:q,answer:result.answer},...history]});
  assert.equal(next?.operation.result,total-lost+change-2);
 }
});
test('wrong arithmetic, unauthenticated premises, other entities, negation and absent context are rejected',()=>{
 const history=[contextual('Zorven','shells',17,6)];
 const query='Zorven receives 3 more shells. How many shells now?';
 assert.equal(resolveQuantityFollowup(query,{history})?.operation.result,14);
 assert.equal(resolveQuantityFollowup(query,{history:[{...history[0],answer:'Zorven has 12 shells remaining: 17 - 6 = 12.'}]}),null);
 assert.equal(resolveQuantityFollowup(query,{history:[]}),null);
 assert.equal(resolveQuantityFollowup('Other receives 3 more shells. How many now?',{history}),null);
 assert.equal(resolveQuantityFollowup('Zorven did not receive 3 shells. How many now?',{history}),null);
 assert.equal(resolveQuantityFollowup('Zorven receives 3 more stones. How many now?',{history}),null);
});
test('fabric handles a checked state update without waiting for broken providers',async()=>{
 const engine=new CognitiveFabric({state:{},unified:{answer:()=>{throw Error('bad routing')},
  collect:()=>{throw Error('bad routing')},status:()=>({})},
  interpreter:{available:false,status:()=>({backend:'off'})}});
 const q='Zorven receives 3 more shells. How many now?';
 const result=await engine.answer(q,{history:[contextual('Zorven','shells',17,6)]});
 assert.equal(result.route,'quantity-state');
 assert.equal(result.fabric.sourceScope,'conversation-premises + checked arithmetic');
 assert.equal(result.operation.result,14);
});
