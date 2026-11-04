// Unified, CPU-budgeted developmental cycle: imported WordNet -> language usage
// -> compositional grammar -> candidate transformer -> gated evaluation/release.
// Interacts with the existing cognition, learning and lexical atom systems;
// does not make dictionary words globally "verified facts".
import { FoundationTrainingCorpus } from './foundation-training.mjs';
import { GrammarInduction } from './grammar-induction.mjs';
import { MorphologyLearner } from './morphology-learning.mjs';
import { corpusFromState } from '../transformer/train.mjs';

const bounded=(n,min,max,def)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.floor(Number(n)))):def;
export class AutonomousLearningEngine {
 constructor({ state, catalog, registry, transformer, skillLearning, mind, env = {}, save = async()=>{}, activeRequests = ()=>0, clock = ()=>Date.now() } = {}){
  if(!state)throw new Error('AutonomousLearningEngine needs persistent node state');
  this.state=state;this.transformer=transformer;this.skillLearning=skillLearning;this.registry=registry;
  this.env=env;this.save=save;this.activeRequests=activeRequests;this.clock=clock;this.mind=mind;
  state.autonomousLearning ||= {cycles:0,trainingRefreshes:0,skipped:0,failures:0,lastAt:null,lastError:null,lastMetrics:null};
  state.grammarLearning ||= {};
  state.morphologyLearning ||= {};
  this.morphology=new MorphologyLearner({state:state.morphologyLearning,catalog});
  this.grammar=new GrammarInduction({state:state.grammarLearning,catalog});
  this.grammar.morphology=this.morphology;
  this.corpus=new FoundationTrainingCorpus({catalog,registry,state,maxDocuments:bounded(env.KENUXA_TRAINING_CORPUS_DOCS,64,5000,1024)});
  this.buffer=[];
  this.busy=false;
 }
 status(){
  return {phase:this.busy?'running':'idle',...this.state.autonomousLearning,
    foundation:this.corpus.status(),grammar:this.grammar.status(),morphology:this.morphology.status(),
    skills:this.skillLearning?.status()||null,transformer:this.transformer?.status()?.release||null,
    knowledgePolicy:'licensed dictionary and approved public/seed knowledge; private chats excluded; weight promotion gated'};
 }
 // The updater never requires a prompt-specific hardcoded answer. It advances through
 // the full indexed sense space across successive ticks and persists each cursor.
 async tick({limit=64,force=false,refresh=true,trainSteps=0}={}){
  if(this.busy)return {ok:false,reason:'cycle already running'};
  if(!this.corpus.catalog)return {ok:false,reason:'foundation disabled'};
  if(!force&&this.activeRequests()>0){this.state.autonomousLearning.skipped++;return {ok:false,reason:'interactive request has priority'};}
  this.busy=true;const t0=this.clock();
  try{
   const max=bounded(limit,1,256,64);
   if(!this.morphology.S.lastFit)this.morphology.train();
   const batch=this.corpus.next({limit:max});
   this.buffer=[...this.buffer,...batch.documents].slice(-bounded(this.env.KENUXA_TRAINING_CORPUS_DOCS,64,5000,1024));
   const grammar=this.grammar.observe(batch.examples,{limit:max*2});
   const approved=corpusFromState(this.state,{allowPrivate:false});
   const candidateCorpus=[...new Set([...approved.slice(-1024),...this.curatedWorldDocuments(),...this.buffer])].slice(-5000);
   if(refresh&&this.transformer?.enabled&&candidateCorpus.length){
     this.transformer.refreshCorpus(candidateCorpus);
     this.state.autonomousLearning.trainingRefreshes++;
   }
   // Offline/deployed manual learning can do a few true gradient steps on CPU;
   // long-running nodes use transformer worker with held-out release gate instead.
   let training=null;
   if(trainSteps>0&&this.transformer?.enabled){
     training=await this.transformer.trainSync(this.state,
       bounded(trainSteps,1,3,1),{corpus:candidateCorpus});
   }
   const S=this.state.autonomousLearning;
   S.cycles++;S.lastAt=new Date(this.clock()).toISOString();S.lastError=null;
   S.lastMetrics={scanned:batch.scanned,documents:batch.documents.length,
     grammarExamples:grammar.accepted,trainingDocuments:candidateCorpus.length,
     elapsedMs:this.clock()-t0,trainedSteps:training?.step??null};
   await this.save();
   return {ok:true,...S.lastMetrics,cursor:batch.cursor,model:training?.review??null};
  }catch(e){
   this.state.autonomousLearning.failures++;
   this.state.autonomousLearning.lastError=String(e.message).slice(0,200);
   await this.save().catch(()=>{});
   return {ok:false,reason:'curriculum cycle failed: '+this.state.autonomousLearning.lastError};
  }finally{this.busy=false;}
 }
 curatedWorldDocuments(){
   const docs=[];
   for(const m of (this.registry?.manifests?.values()||[])) {
     if(!String(m.id).startsWith('concept:wikidata:'))continue;
     const a=this.registry.get(m.id);
     if(a?.identity?.originNode!=='foundation:wikidata'||a?.identity?.validation!=='curated')continue;
     const name=String(a.identity.canonical||'').slice(0,100),definition=String(a.semantic?.definition||'').slice(0,500);
     if(name&&definition)docs.push('Knowledge: '+name+'. Definition: '+definition+'.');
     if(docs.length>=512)break;
   }
   return docs;
 }
 // Called on host startup. The existing worker continues training candidate weights;
 // this source is periodically refreshed without restarting it.
 trainingCorpus(){return [...new Set([
   ...corpusFromState(this.state,{allowPrivate:false}).slice(-1024),...this.curatedWorldDocuments(),...this.buffer
 ])].slice(-5000);}
}