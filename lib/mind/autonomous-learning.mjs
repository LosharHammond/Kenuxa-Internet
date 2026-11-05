// Unified, CPU-budgeted developmental cycle: imported WordNet -> language usage
// -> compositional grammar -> candidate transformer -> gated evaluation/release.
// Interacts with the existing cognition, learning and lexical atom systems;
// does not make dictionary words globally "verified facts".
import { FoundationTrainingCorpus } from './foundation-training.mjs';
import { GrammarInduction } from './grammar-induction.mjs';
import { MorphologyLearner } from './morphology-learning.mjs';
import { corpusFromState } from '../transformer/train.mjs';
import { nativeTrainingDocuments } from '../transformer/native-curriculum.mjs';
import { privacyIssue } from '../transformer/pipeline.mjs';

const bounded=(n,min,max,def)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.floor(Number(n)))):def;
export class AutonomousLearningEngine {
 constructor({ state, catalog, registry, transformer, skillLearning, mind, env = {}, save = async()=>{}, activeRequests = ()=>0, learnFromGaps = null, clock = ()=>Date.now() } = {}){
  if(!state)throw new Error('AutonomousLearningEngine needs persistent node state');
  this.state=state;this.transformer=transformer;this.skillLearning=skillLearning;this.registry=registry;
  this.env=env;this.save=save;this.activeRequests=activeRequests;this.clock=clock;this.mind=mind;this.learnFromGaps=learnFromGaps;
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
   // Bridge licensed sense relations into the existing persistent developmental cognitive store.
   // They remain source-attested observations, not independently verified physical facts.
   let relationsLearned=0;
   for(const relation of (batch.relations||[]).slice(0,Math.min(128,max*2))){
     const observation=this.mind?.curriculumRecord?.({domain:'language-relation',subject:relation.subject,relation:relation.relation,object:relation.object,split:'train',evidence:'observation'});
     if(observation?.ok)relationsLearned++;
   }
   // Universal skill induction is fed with independently checkable properties of
   // licensed WordNet atom collections. The learner receives examples, NOT code.
   // This is source-attested intrinsic knowledge (count of an actual list), not
   // automatic validation of arbitrary claims in the dictionary definitions.
   let trustedExamples=0;
   if(this.skillLearning){
     const existing=this.skillLearning.state.examples.filter(e=>e.source==='wordnet-intrinsic').length;
     for(const example of (batch.intrinsicTasks||[]).slice(0,Math.max(0,Math.min(8,128-existing)))){
       const observed=this.skillLearning.observe({input:example.input,output:example.output,
         source:'wordnet-intrinsic',scope:'public',consent:true,
         split:(existing+trustedExamples)%3===0?'holdout':'train'});
       if(observed.ok&&!observed.duplicate){
         // Independent from a human/teacher answer: the list length is directly
         // computed from the licensed source record's own structure.
         this.skillLearning.verifyExample(observed.id,{expected:{count:example.input.items.length},authority:true});
         trustedExamples++;
       }
     }
   }
   // Verified owner/evaluator demonstrations induce reusable procedures automatically.
   // Unverified conversation content remains quarantined by the skill engine.
   const skills=this.skillLearning?.discover() || {candidates:0,discovered:0};
   const promotion=this.skillLearning?.autoPromote({scope:'public'})||{promoted:0};
   const approved=corpusFromState(this.state,{allowPrivate:false});
   const cognitive=this.curatedCognitiveDocuments();
   // Declarative frame examples are synthesized from known mathematical
   // operators and unfamiliar atom names, NOT copied from chatbot tests.
   // Fixed training seed is intentionally disjoint from quality-gate seeds.
   const nativeExamples=nativeTrainingDocuments({seed:17011,perKind:12});
   const candidateCorpus=[...new Set([...approved.slice(-1024),...cognitive,
    ...this.curatedWorldDocuments(),...this.buffer,...nativeExamples])].slice(-5000);
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
   let gapLearning=null;
   // Teacher-assisted knowledge-gap learning is opt-in because providers may charge money.
   // It reuses KENUXA's existing dissection/verification pipeline, never promotes raw teacher claims.
   if(this.env.AUTONOMOUS_TEACHER_LEARNING==='true' && this.learnFromGaps && this.activeRequests()===0){
     try{const out=await this.learnFromGaps({budgetMs:10000,limit:1});gapLearning={learned:out?.learned??0,reviewed:out?.reports?.length??0};}
     catch(e){gapLearning={error:String(e.message).slice(0,120)};}
   }
   const S=this.state.autonomousLearning;
   S.cycles++;S.lastAt=new Date(this.clock()).toISOString();S.lastError=null;
   S.lastMetrics={scanned:batch.scanned,documents:batch.documents.length,
     grammarExamples:grammar.accepted,relationExamples:relationsLearned,validatedSkillCandidates:skills.candidates,validatedSkillRules:this.skillLearning?.status()?.validated||0,autoPromoted:promotion.promoted,trustedExamples,trainingDocuments:candidateCorpus.length,
     elapsedMs:this.clock()-t0,trainedSteps:training?.step??null,cognitiveDocuments:cognitive.length,gapLearning};
   await this.save();
   return {ok:true,...S.lastMetrics,cursor:batch.cursor,model:training?.review??null};
  }catch(e){
   this.state.autonomousLearning.failures++;
   this.state.autonomousLearning.lastError=String(e.message).slice(0,200);
   await this.save().catch(()=>{});
   return {ok:false,reason:'curriculum cycle failed: '+this.state.autonomousLearning.lastError};
  }finally{this.busy=false;}
 }
 curatedCognitiveDocuments(){
   // The historical Mind cognitive atoms were formerly omitted from transformer training.
   // Only public, locally validated/promoted metadata is admitted, never private experiences.
   const docs=[];
   const s=this.state.mind?.store;
   if(!s?.atoms||!s?.revisions)return docs;
   for(const [id,head] of Object.entries(s.atoms).slice(0,500)){
     const atom=s.revisions[head?.head];
     if(!atom||atom.visibility!=='public'||!['validated','promoted'].includes(atom.status))continue;
     if(!['rule','causal','procedure','strategy'].includes(atom.category))continue;
     const label=String(atom.label||id).replace(/[\\r\\n]/g,' ').slice(0,120);
     if(!label)continue;
     const semantics=atom.semantics&&typeof atom.semantics==='object'?JSON.stringify(atom.semantics).slice(0,360):'';
     const doc='Cognitive knowledge ('+atom.category+'): '+label+'. '+semantics;
     if(doc.length>=24&&!privacyIssue(doc))docs.push(doc);
     if(docs.length>=128)break;
   }
   return docs;
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
   ...corpusFromState(this.state,{allowPrivate:false}).slice(-1024),...this.curatedCognitiveDocuments(),...this.curatedWorldDocuments(),...this.buffer
 ])].slice(-5000);}
}