import test from 'node:test';
import assert from 'node:assert/strict';
import {FoundationCatalog} from '../lib/foundation/catalog.mjs';
import {FoundationTrainingCorpus} from '../lib/mind/foundation-training.mjs';
import {DevelopmentalLearning} from '../lib/mind/developmental-learning-core.mjs';
import {AutonomousLearningEngine} from '../lib/mind/autonomous-learning.mjs';
test('imported WordNet teaches the universal learner a reusable list-count skill',()=>{
 const catalog=new FoundationCatalog(),state={},corpus=new FoundationTrainingCorpus({catalog,state});
 const learner=new DevelopmentalLearning({state:{}});
 for(let batch=0;batch<8;batch++){
   const r=corpus.next({limit:64});
   for(const task of r.intrinsicTasks||[]){
     const observed=learner.observe({input:task.input,output:task.output,scope:'public',source:'wordnet-intrinsic',consent:true});
     if(observed.ok)assert.equal(learner.verifyExample(observed.id,{expected:{count:task.input.items.length},authority:true}).ok,true);
   }
   learner.discover();
   if(learner.predict({items:['new','unseen','words']},{scope:'public'}).ok)break;
 }
 const predicted=learner.predict({items:['new','unseen','words']},{scope:'public'});
 assert.equal(predicted.ok,true,JSON.stringify({status:learner.status(),predicted}));
 assert.equal(predicted.output.count,3);
 assert.ok(predicted.proof.length>0,'must cite a validated learned program');
});
test('autonomous cycle connects the source-backed skill store and language curriculum',async()=>{
 const state={atoms:[]},skills=new DevelopmentalLearning({state:state.skills={}});
 const engine=new AutonomousLearningEngine({state,catalog:new FoundationCatalog(),skillLearning:skills,transformer:{enabled:false,status:()=>({release:{}})},save:async()=>{}});
 for(let i=0;i<4;i++)assert.equal((await engine.tick({limit:64})).ok,true);
 assert.ok(skills.status().verified>0);
 assert.ok(state.foundationTraining.documents>0);
 assert.ok(state.grammarLearning.observed>=0);
 assert.ok(engine.status().foundation.scanned>0);
});
