import test from 'node:test';
import assert from 'node:assert/strict';
import {RelationFabric} from '../lib/mind/relation-fabric.mjs';
import {UnifiedCognition} from '../lib/mind/unified-cognition.mjs';

function ready(){
 const state={},fabric=new RelationFabric({state});
 const add=(subject,relation,object)=>{
  const p=fabric.propose({subject,relation,object});
  assert.equal(p.ok,true);
  assert.equal(fabric.review(p.id,{authorized:true,approve:true,evidence:'independent owner reviewed fixture'}).ok,true);
 };
 return {state,fabric,add};
}
test('arbitrary unseen symbols compose relations across 2 to 12 hops without new code',()=>{
 for(let size=2;size<=12;size++){
  const {fabric,add}=ready();
  const labels=Array.from({length:size+1},(_,i)=>'zunor'+size+'x'+i);
  for(let i=0;i<size;i++)add(labels[i],'is-a',labels[i+1]);
  const q=fabric.infer({subject:labels[0],relation:'is-a',object:labels[size]});
  assert.equal(q.ok,true,JSON.stringify(q));
  assert.equal(q.hops,size);
  assert.equal(q.verified,true);
  assert.equal(fabric.infer({subject:'something-new',object:labels[size]}).ok,false);
 }
});
test('new relation types are declarative and inference preserves direction',()=>{
 const {fabric,add}=ready();
 assert.equal(fabric.relation('flows to',{authorized:true,transitive:true}).ok,true);
 add('river alpha','flows to','reservoir beta');
 add('reservoir beta','flows to','lake gamma');
 assert.equal(fabric.infer({subject:'river alpha',relation:'flows to',object:'lake gamma'}).hops,2);
 assert.equal(fabric.infer({subject:'lake gamma',relation:'flows to',object:'river alpha'}).ok,false);
});
test('quarantined claims cannot become global truth and survive serialization',()=>{
 const {state,fabric}=ready();
 const proposal=fabric.propose({subject:'qevos',relation:'is-a',object:'nuvet',source:'observation'});
 assert.equal(fabric.infer({subject:'qevos',object:'nuvet'}).ok,false);
 assert.equal(fabric.review(proposal.id,{approve:true,evidence:'owner proof'}).ok,false);
 const restored=new RelationFabric({state:JSON.parse(JSON.stringify(state))});
 assert.equal(restored.infer({subject:'qevos',object:'nuvet'}).ok,false);
 assert.equal(restored.review(proposal.id,{authorized:true,approve:true,evidence:'reviewed evidence'}).ok,true);
 assert.equal(restored.infer({subject:'qevos',object:'nuvet'}).ok,true);
});
test('unexpected followups can use temporary premises but never persist private chat facts',()=>{
 const {state,fabric}=ready();
 const h=[{question:'A kalora is a meruvu.'},{question:'Every meruvu is a tenisa.'}];
 const r=fabric.answerNatural('Is kalora a tenisa?',{history:h});
 assert.equal(r?.ok,true,JSON.stringify(r));
 assert.equal(r.verified,false);
 assert.equal(r.proof.length,2);
 assert.equal(Object.keys(state.facts).length,0);
 assert.equal(fabric.infer({subject:'kalora',object:'tenisa'}).ok,false);
});
test('a failing reasoning adapter leaves dictionary available through existing circuit breakers',()=>{
 const {fabric}=ready();fabric.answerNatural=()=>{throw new Error('simulated subsystem fault')};
 const c=new UnifiedCognition({state:{},mind:{relationFabric:fabric,think:()=>null,store:{status:()=>({})}},
  skills:{predict:()=>({ok:false}),status:()=>({})},
  foundation:{answer:()=>({answer:'Known dictionary fallback',kind:'definition'})}});
 for(let i=0;i<3;i++)assert.equal(c.answer('Is zevora a panto?').answer,'Known dictionary fallback');
 assert.equal(c.status().components['relation-fabric'].state,'isolated');
 assert.equal(c.status().recentFaults.length,2);
});
test('verified relation proofs feed the single existing cognition coordinator',()=>{
 const {fabric,add}=ready();add('vanto','is-a','zelora');add('zelora','is-a','mukari');
 const c=new UnifiedCognition({state:{},mind:{relationFabric:fabric,think:()=>null,store:{status:()=>({})}},
  skills:{predict:()=>({ok:false}),status:()=>({})},foundation:{answer:()=>({answer:'Should not replace proof'})}});
 const r=c.answer('Is vanto a mukari?');
 assert.equal(r.route,'relation-fabric',JSON.stringify(r));
 assert.equal(r.provenance.length,2);
 assert.equal(r.verified,true);
});
