import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedCognition } from '../lib/mind/unified-cognition.mjs';

const fixtures=()=>{
 const state={};
 const skills={status:()=>({verified:1}),predict:(x,{scope})=>scope==='public'&&x.question==='skill question'?
   {ok:true,output:{answer:'Skill result'},kind:'learned-procedure',proof:[{ruleId:'test'}]}:{ok:false}};
 const mind={store:{status:()=>({atoms:5})},think:()=>({handled:true,type:'planning',answer:'Plan'})};
 const contextual=(q,h)=>q==='What is my name?'?{answer:'Your name is Kofi.',kind:'remembered',proof:[{source:'conversation'}]}:null;
 const ontology={answer:q=>q==='Is a dog an animal?'?{answer:'Yes; dictionary taxonomy',kind:'ontology-proof',proof:[{source:'wordnet'}]}:null};
 const foundation={answer:q=>q==='Define dog'?{answer:'Dog is a mammal.',kind:'dictionary',detail:{source:'wordnet'}}:null};
 const autonomous={tick:async()=>({ok:true,scanned:12,grammarExamples:4,relationExamples:3,cognitiveDocuments:2}),status:()=>({cycles:1})};
 return {state,skills,mind,contextual,ontology,foundation,autonomous};
};
test('one coordinator routes conversation, validated skills, ontology and lexicon, then cognitive fallback',()=>{
 const d=fixtures(),c=new UnifiedCognition(d);
 assert.equal(c.answer('What is my name?').route,'conversation');
 assert.equal(c.answer('skill question').route,'learned');
 assert.equal(c.answer('Is a dog an animal?').route,'ontology');
 assert.equal(c.answer('Define dog').route,'dictionary');
 assert.equal(c.answer('Unknown random task'),null);
 assert.equal(c.reason('A problem').answer,'Plan');
 assert.equal(d.state.unifiedCognition.answered,5);
 assert.equal(d.state.unifiedCognition.fallthrough,1);
});
test('history-specific user statements never become globally verified facts',()=>{
 const c=new UnifiedCognition(fixtures());
 const r=c.answer('What is my name?');
 assert.equal(r.verified,false);
 assert.equal(r.trust,'premise-only');
 const lex=c.answer('Define dog');
 assert.equal(lex.verified,false);
 assert.equal(lex.trust,'licensed-dictionary');
});
test('one tick advances existing autonomous learner with shared state',async()=>{
 const d=fixtures(),c=new UnifiedCognition(d);
 const x=await c.tick({limit:12});
 assert.equal(x.ok,true);
 assert.equal(d.state.unifiedCognition.learningCycles,1);
 assert.equal(c.status().cognitiveMemory.atoms,5);
 assert.equal(c.status().lastCycle.relationExamples,3);
 const copy=JSON.parse(JSON.stringify(d.state));
 assert.equal(new UnifiedCognition({...fixtures(),state:copy}).status().learningCycles,1);
});
test('no untrusted material is promoted when the coordinator falls through',()=>{
 const c=new UnifiedCognition(fixtures());
 assert.equal(c.answer('Question with new unknown concepts'),null);
 assert.equal(c.status().recent.at(-1).verified,false);
 assert.equal(c.status().recent.at(-1).route,'unresolved');
});


test('conversation recall short-circuits other cognition backends, including unknown local facts',()=>{
 const d=fixtures();
 let calls=0;
 d.contextual=(q)=>/what did i tell you about the/i.test(q)?
   {answer:q.includes('Tarvek')?'You told me Tarvek has 7 tails.':'No earlier statement found.',kind:q.includes('Tarvek')?'remembered':'unknown',proof:[{source:'conversation'}]}:null;
 d.skills.predict=()=>{calls++;throw new Error('skill route must not execute');};
 d.ontology.answer=()=>{calls++;throw new Error('ontology must not execute');};
 d.foundation.answer=()=>{calls++;throw new Error('dictionary must not execute');};
 const c=new UnifiedCognition(d);
 const known=c.answer('What did I tell you about the Tarvek earlier?');
 assert.equal(known.route,'conversation');
 assert.match(known.answer,/7 tails/);
 assert.equal(known.verified,false);
 const missing=c.answer('What did I tell you about the Neral earlier?');
 assert.equal(missing.route,'conversation');
 assert.equal(missing.confidence,0);
 assert.equal(calls,0);
 assert.equal(c.status().answered,2);
});
