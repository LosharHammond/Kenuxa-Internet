import test from 'node:test';
import assert from 'node:assert/strict';
import { FoundationCatalog } from '../lib/foundation/catalog.mjs';
import { FoundationTrainingCorpus } from '../lib/mind/foundation-training.mjs';
import { GrammarInduction } from '../lib/mind/grammar-induction.mjs';
import { MorphologyLearner } from '../lib/mind/morphology-learning.mjs';
import { AutonomousLearningEngine } from '../lib/mind/autonomous-learning.mjs';
import { corpusFromState } from '../lib/transformer/train.mjs';
import { curateDataset } from '../lib/transformer/pipeline.mjs';
import {makeConfig,initParams} from '../lib/transformer/core.mjs';
import {Trainer} from '../lib/transformer/train.mjs';

test('real imported WordNet shards become streaming transformer documents with a persisted cursor',()=>{
 const catalog=new FoundationCatalog({maxShards:2}),state={atoms:[]};
 const source=new FoundationTrainingCorpus({catalog,state,maxDocuments:80});
 const first=source.next({limit:12});
 assert.ok(first.documents.length>0);
 assert.match(first.documents[0],/Part of speech:|Meaning:/);
 assert.ok(first.documents.every(x=>x.includes('Question:')&&x.includes('Answer:')));
 assert.ok(source.status().scanned>0);
 const before=JSON.stringify(state.foundationTraining);
 const restored=new FoundationTrainingCorpus({catalog,state:JSON.parse(JSON.stringify(state))});
 const second=restored.next({limit:12});
 assert.notDeepEqual(first.documents,second.documents,'cursor resumes at new senses');
 assert.notEqual(before,JSON.stringify(restored.state.foundationTraining));
 assert.ok(catalog.cache.size<=2,'dictionary shard cache is bounded');
});
test('WordNet examples update a persistent corpus-induced POS grammar',()=>{
 const catalog=new FoundationCatalog(),state={};
 const grammar=new GrammarInduction({catalog,state});
 const result=grammar.observe(['The dog walked across the street.','A person drives a car.','The woman opened the window.']);
 assert.ok(result.accepted>0);
 assert.ok(grammar.status().transitions>0);
 assert.deepEqual(new GrammarInduction({catalog,state:JSON.parse(JSON.stringify(state))}).status(),grammar.status());
 const analysis=grammar.analyze('The dog walks across a road.');
 assert.equal(analysis.tokens[0],'The');
 assert.ok(analysis.tags.length>2);
 assert.match(analysis.warning,/not a grammar/);
});
test('user-specific approved atoms are excluded from public model training',()=>{
 const state={atoms:[
  {title:'Public energy',answer:'Solar energy comes from sunlight.',status:'approved',visibility:'public',origin:'seed'},
  {title:'Employee private detail',answer:'Confidential internal identifier 1234.',status:'approved',visibility:'private',origin:'human'},
  {title:'Unverified result',answer:'Teacher speculation.',status:'pending',visibility:'public',origin:'teacher'}]};
 const docs=corpusFromState(state,{allowPrivate:false});
 assert.ok(docs.some(x=>x.includes('Solar energy')));
 assert.ok(!docs.some(x=>x.includes('Confidential')));
 assert.ok(!docs.some(x=>x.includes('Teacher speculation')));
});
test('autonomous cycle trains on dictionary plus approved source, advances, and persists state',async()=>{
 const state={atoms:[{title:'A concept',answer:'A public approved test definition.',visibility:'public',status:'approved'}]};
 const catalog=new FoundationCatalog(),history=[],model={
  enabled:true,refreshCorpus:(docs)=>history.push(docs),
  trainSync:async(_state,_steps,{corpus})=>({step:1,review:{status:'held'},length:corpus.length}),
  status:()=>({release:{live:{version:0}}})};
 let saves=0;
 const engine=new AutonomousLearningEngine({state,catalog,transformer:model,save:async()=>saves++});
 const r=await engine.tick({limit:16,trainSteps:1});
 assert.equal(r.ok,true,r.reason);
 assert.ok(r.documents>0);
 assert.ok(history.length>0);
 assert.ok(history[0].some(x=>x.includes('Part of speech:')));
 assert.equal(engine.status().foundation.documents,r.documents);
 assert.ok(saves>0);
 const recreated=new AutonomousLearningEngine({state:JSON.parse(JSON.stringify(state)),catalog,transformer:model});
 assert.equal(recreated.status().foundation.scanned,r.scanned);
});
test('interactive load defers background training and keeps progress',async()=>{
 const catalog=new FoundationCatalog(),state={},model={enabled:true,status:()=>({release:{}})};
 const engine=new AutonomousLearningEngine({state,catalog,transformer:model,activeRequests:()=>1});
 const r=await engine.tick();
 assert.equal(r.ok,false);
 assert.match(r.reason,/priority/);
 assert.equal(engine.status().foundation.documents,0);
});
test('train/eval split and privacy screening on generated corpus are bounded',()=>{
 const catalog=new FoundationCatalog(),source=new FoundationTrainingCorpus({catalog,state:{}});
 const docs=source.next({limit:80}).documents;
 const ds=curateDataset(docs);
 assert.ok(ds.train.length>0&&ds.eval.length>0);
 assert.equal(ds.dropped.privacy,0);
 const n=new Set(ds.train);
 assert.ok(ds.eval.every(x=>!n.has(x)));
});

test('morphology skills are learned from held-out patterns and transfer to unseen words',()=>{
 const bases=[];for(let i=0;i<130;i++)bases.push('term'+String.fromCharCode(97+(i%26))+String.fromCharCode(97+Math.floor(i/26)));
 const morphology=Object.fromEntries(bases.map(w=>[w+'ed',[w]]));
 const catalog={shard:name=>{assert.equal(name,'morphology.json.gz');return morphology;},lookup:word=>({senses:[{id:'mock:'+word,pos:'v'}]})};
 const state={},learner=new MorphologyLearner({state,catalog});
 const status=learner.train();assert.equal(status.ok,true);
 assert.ok(status.trained>10&&status.heldOut>2);
 assert.ok(status.validated>0);
 const prediction=learner.infer('newstemmed');
 assert.ok(prediction);assert.equal(prediction.lemma,'newstemm');
 const reboot=new MorphologyLearner({state:JSON.parse(JSON.stringify(state)),catalog});
 assert.deepEqual(reboot.infer('newstemmed'),prediction);
});
test('morphology inference does not invent stems without held-out validation',()=>{
 const catalog={shard:()=>({abcde:['abcd']}),lookup:()=>({senses:[{pos:'n'}]})};
 const learner=new MorphologyLearner({state:{},catalog});
 learner.train();assert.equal(learner.infer('newworde'),null);
});

test('actual CPU gradient training learns from imported WordNet bytes rather than a stub',()=>{
 const catalog=new FoundationCatalog();
 const source=new FoundationTrainingCorpus({catalog,state:{atoms:[]}});
 const wordnetDocument=source.next({limit:3}).documents[0];
 assert.ok(wordnetDocument.includes('Meaning:'));
 const config=makeConfig('test',{layers:1,heads:4,kvHeads:2,headDim:2,ffn:12});
 const trainer=new Trainer(config,initParams(config,17),{lr:0.01,warmup:3,seq:24});
 trainer.setCorpus([wordnetDocument.slice(0,160)]);
 const initial=trainer.trainStep();
 for(let step=0;step<45;step++)trainer.trainStep();
 assert.ok(trainer.loss<initial,'training loss should improve from actual WordNet bytes');
 assert.equal(trainer.step,46);
 assert.ok(trainer.tokens>100);
});

test('dictionary-induced grammar keeps independent held-out usage examples',()=>{
 const catalog=new FoundationCatalog(),state={},learner=new GrammarInduction({catalog,state});
 const examples=[];
 for(let i=0;i<200;i++) examples.push('A thoughtful person opened the wooden window '+(i+1)+' times.');
 for(let i=0;i<4;i++)learner.observe(examples.slice(i*50,(i+1)*50),{limit:50});
 const measured=learner.evaluateHeldout();
 assert.ok(measured.samples>0);
 assert.ok(Number.isFinite(measured.meanSurprisal));
 assert.ok(measured.transitionCoverage>=0&&measured.transitionCoverage<=1);
 assert.deepEqual(new GrammarInduction({catalog,state:JSON.parse(JSON.stringify(state))}).evaluateHeldout(),measured);
});

test('licensed WordNet hypernym relationships enter persistent cognitive curriculum',async()=>{
 const state={atoms:[],mind:{developmentalCurriculum:{examples:[]}}};
 const catalog=new FoundationCatalog();
 const recorded=[];
 const mind={curriculumRecord:(e)=>{recorded.push(e);state.mind.developmentalCurriculum.examples.push(e);return {ok:true};}};
 const engine=new AutonomousLearningEngine({state,catalog,mind,transformer:{enabled:false,status:()=>({release:{}})},save:async()=>{}});
 for(let i=0;i<8&&recorded.length===0;i++)await engine.tick({limit:128,refresh:false});
 assert.ok(recorded.length>0,'the imported sense stream must provide relations');
 assert.equal(recorded[0].domain,'language-relation');
 assert.equal(recorded[0].relation,'is-a');
 assert.equal(recorded[0].evidence,'observation');
 assert.ok(JSON.parse(JSON.stringify(state)).mind.developmentalCurriculum.examples.length>0);
});
