// KENUXA Cognitive Fabric: a bounded, failure-isolated coordinator.
// The code executes general operators; knowledge, relationships, policies and
// verified corrections are data in durable atomic stores, not source branches.
// A model may interpret language but cannot write verified truth.
import {FabricJournal} from './fabric-journal.mjs';
import {FabricInterpreter,executeSemanticFrame} from './fabric-model.mjs';

const fingerprint=s=>typeof s==='string'?s.length:0;
const bounded=(n,min,max,def)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Number(n))):def;
const ranks=Object.freeze({
 'verified-procedure':100,'verified-relation':100,
 'conversation-premises + checked arithmetic':89,
 'premise-only':86,'licensed-dictionary':70,'reasoned-unverified':55
});
const score=c=>{
 const evidence=Array.isArray(c.provenance)?c.provenance:[];
 const credible=Number.isFinite(Number(c.confidence))?Number(c.confidence):0;
 return (ranks[c.trust]||45)+Math.min(10,Math.max(0,credible/20))+
  (c.verified===true?15:0)+Math.min(4,evidence.length);
};
function safeCandidate(value){
 if(!value||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>8000)return null;
 return {answer:value.answer,kind:String(value.kind||'answer').slice(0,64),
  route:String(value.route||'unknown').slice(0,64),verified:value.verified===true,
  trust:String(value.trust||'reasoned-unverified').slice(0,80),
  confidence:bounded(value.confidence,0,100,35),
  provenance:Array.isArray(value.provenance)?value.provenance.slice(0,12):[],
  ...(value.operation?{operation:value.operation}:{})};
}
export class CognitiveFabric {
 constructor({state={},unified,interpreter=null,env={},log=()=>{},now=()=>Date.now(),save=()=>{}}={}){
  if(!unified||typeof unified.answer!=='function')throw new Error('Cognitive Fabric requires unified adapters');
  this.S=state;this.unified=unified;this.env=env;this.log=log;this.now=now;this.save=save;
  this.journal=new FabricJournal({state,now});
  this.interpreter=interpreter||new FabricInterpreter({env});
  this.runtime={faults:new Map(),attempts:0,recovered:0};
 }
 async attempt(name,run,{timeoutMs=9000}={}){
  const previous=this.runtime.faults.get(name)||{failures:0,until:0};
  if(previous.until>this.now())return null;
  this.runtime.attempts++;
  try{
   // Promise timers avoid hanging the request behind an unresponsive model.
   // All external inference is bounded; synchronous adapters may still need
   // worker-thread isolation in a later release.
   let timer;
   const result=await Promise.race([
    Promise.resolve().then(run),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('capability timeout')),timeoutMs);timer.unref?.();})
   ]).finally(()=>clearTimeout(timer));
   if(previous.failures){previous.failures=0;previous.until=0;this.runtime.recovered++;}
   this.runtime.faults.set(name,previous);
   return result;
  }catch(e){
   previous.failures++;
   if(previous.failures>=2)previous.until=this.now()+Math.min(120000,10000*2**Math.min(previous.failures-2,4));
   this.runtime.faults.set(name,previous);
   // Do not persist question text or raw model responses.
   this.journal.noteFailure(name,{component:name,kind:'infrastructure',
    details:String(e?.name||'component failed')});
   try{this.log('fabric component '+name+' unavailable');}catch{}
   return null;
  }
 }
 async answer(question,{history=[],scope='public',offline=false}={}){
  if(typeof question!=='string'||!question.trim()||question.length>2000)return null;
  const candidates=[];
  // Existing ontology/skills/atomic reasoning are evaluated independently;
  // an exception does not disable a healthy model or fallback.
  const native=await this.attempt('atomic-adapters',()=>this.unified.collect?
    this.unified.collect(question,{history,scope,offline}):
    this.unified.answer(question,{history,scope,offline}),{timeoutMs:3000});
  const gathered=Array.isArray(native)?native:[native];
  for(const item of gathered){
    const candidate=safeCandidate(item);
    if(candidate)candidates.push(candidate);
  }
  // A personal memory answer, including a negative recall result, must remain
  // conversation-scoped rather than being overridden by generic world facts.
  const protectedConversation=candidates.some(x=>x.route==='conversation');
  if(!offline&&!protectedConversation&&this.interpreter.available){
   const frame=await this.attempt('language-interpreter',
    ()=>this.interpreter.interpret(question,{history,scope}),{
      timeoutMs:bounded(this.env.KENUXA_FABRIC_MODEL_TIMEOUT_MS,1000,20000,7000)+1500});
   const evaluated=safeCandidate(executeSemanticFrame(frame,{question,history}));
   if(evaluated)candidates.push(evaluated);
  }
  if(!candidates.length){if(this.unified.collect)this.unified.audit?.({question,route:'unresolved',kind:'fallback',verified:false});return null;}
  // Do not treat disagreeing candidate answers as interchangeable facts.
  // If a verified source contradicts another verified source, refuse to pick.
  const verified=candidates.filter(x=>x.verified);
  if(verified.length>1&&new Set(verified.map(x=>x.answer.trim().toLowerCase())).size>1){
   // Null would accidentally return control to the legacy chatbot, which
   // could select a contradictory answer after the Fabric withheld it.
   this.journal.noteFailure(question,{kind:'conflict',component:'evidence-arbiter'});
   this.unified.audit?.({question,route:'fabric-conflict',kind:'conflict',verified:false});
   return {answer:'I found conflicting verified evidence and cannot establish a reliable answer yet.',
    kind:'evidence-conflict',route:'fabric-conflict',verified:false,
    trust:'conflict-withheld',confidence:0,provenance:[],
    alternatives:candidates.length,
    fabric:{version:1,conflict:true,componentsUsed:candidates.map(x=>x.route),
     eventRevision:this.journal.S.seq,sourceScope:'conflict-withheld',confidence:0}};
  }
  candidates.sort((a,b)=>score(b)-score(a));
  const chosen=candidates[0];
  if(this.unified.collect)this.unified.audit?.({question,route:chosen.route,kind:chosen.kind,verified:chosen.verified});
  const result={...chosen,route:chosen.route,alternatives:candidates.length,
   fabric:{version:1,componentsUsed:candidates.map(x=>x.route),eventRevision:this.journal.S.seq,
    sourceScope:chosen.verified?'verified-evidence':chosen.trust,confidence:chosen.confidence}};
  return result;
 }
 // A durable event is emitted ONLY after independently validated knowledge
 // has been committed in its original atom store by the owner or verifier.
 verifiedUpdate(event,options){return this.journal.verifiedChange(event,options);}
 async idle({limit=4,rebuild=null}={}) {
  const r=await this.journal.drain({limit,rebuild});
  if(r.processed>0)this.save();
  return r;
 }
 status(){return {version:1,mode:'multi-capability-evidence-kernel',
   interpreter:this.interpreter.status(),journal:this.journal.status(),
   attempts:this.runtime.attempts,recovered:this.runtime.recovered,
   components:Object.fromEntries([...this.runtime.faults].map(([name,s])=>[name,{
    status:s.until>this.now()?'isolated':'available',failures:s.failures}])),
   atomicAdapters:this.unified.status?.()||null};}
}
