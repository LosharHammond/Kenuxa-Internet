// KENUXA's single non-destructive cognitive coordination layer.
// Legacy components remain as specializations, not parallel public chatbots.
// One request -> scoped evidence -> one chosen answer -> verified learning feedback.
// No human message or peer report is automatically promoted to global ground truth.
import { createHash } from 'node:crypto';
const fingerprint=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,16);
const sourceTrust=Object.freeze({
 'conversation':'premise-only','learned':'verified-procedure','ontology':'licensed-dictionary',
 'dictionary':'licensed-dictionary','cognitive':'reasoned-unverified'
});
const concise=s=>String(s||'').slice(0,240);
export class UnifiedCognition {
  constructor({state={},contextual,skills,ontology,foundation,mind,autonomous=null,curriculum=null,growth=null,log=()=>{}}={}){
    if(!skills||!mind)throw new Error('UnifiedCognition requires the shared skill store and Mind');
    this.S=state;
    this.S.unifiedCognition ||= {schemaVersion:1,answered:0,fallthrough:0,learningCycles:0,history:[],lastCycle:null};
    this.contextual=contextual;this.skills=skills;this.ontology=ontology;this.foundation=foundation;
    this.mind=mind;this.autonomous=autonomous;this.curriculum=curriculum;this.growth=growth;this.log=log;
  }
  attach({autonomous,curriculum}={}){
    if(autonomous)this.autonomous=autonomous;
    if(curriculum)this.curriculum=curriculum;
    return this;
  }
  audit({question,route,kind,verified=false}){
    const s=this.S.unifiedCognition;
    if(route==='unresolved')s.fallthrough++;else s.answered++;
    s.history.push({fingerprint:fingerprint(question),route,kind,verified,at:new Date().toISOString()});
    if(s.history.length>120)s.history.splice(0,s.history.length-120);
  }
  answer(question,{history=[],offline=false,scope='public'}={}){
    if(typeof question!=='string'||!question.trim())return null;
    const candidates=[];
    if(!offline&&this.contextual){
      const x=this.contextual(question,history);
      if(x?.answer){
        // An explicit conversation-local answer (including an evidence-scoped
        // 'not found') is terminal: do not invoke skills, ontology, dictionaries,
        // teacher composition, web research or the peer network for user premises.
        const result={answer:x.answer,kind:x.kind,route:'conversation',
          provenance:x.proof||[],confidence:x.kind==='unknown'?0:80,verified:false,
          trust:sourceTrust.conversation};
        this.audit({question,route:'conversation',kind:x.kind,verified:false});
        return result;
      }
    }
    // Only rules verified on independent cases and scoped as public are available to visitors.
    if(!offline&&this.skills){
      const x=this.skills.predict({question},{scope});
      if(x?.ok&&typeof x.output?.answer==='string'&&x.output.answer.trim()){
        candidates.push({answer:x.output.answer,kind:x.kind,route:'learned',
          provenance:x.proof||[],confidence:80,verified:true,trust:sourceTrust.learned});
      }
    }
    if(!offline&&this.ontology){
      const x=this.ontology.answer(question);
      if(x?.answer)candidates.push({answer:x.answer,kind:x.kind,route:'ontology',
        provenance:x.proof||[],confidence:75,verified:false,trust:sourceTrust.ontology});
    }
    if(!offline&&this.foundation){
      const x=this.foundation.answer(question);
      if(x?.answer)candidates.push({answer:x.answer,kind:x.kind,route:'dictionary',
        provenance:x.detail||x.proof||[],confidence:70,verified:false,trust:sourceTrust.dictionary});
    }
    // Context premises override general lexicon, which overrides fallback research.
    const priority={conversation:1,learned:2,ontology:3,dictionary:4};
    candidates.sort((a,b)=>priority[a.route]-priority[b.route]);
    const winner=candidates[0]||null;
    this.audit({question,route:winner?.route||'unresolved',kind:winner?.kind||'fallback',
      verified:winner?.verified===true});
    return winner;
  }
  reason(question,options={}){
    if(!this.mind||typeof this.mind.think!=='function')return {handled:false,reason:'Mind unavailable'};
    // Existing world-model, causal, planning, procedure, and hypothesis methods retain
    // the original controller and their established safeguards.
    const r=this.mind.think(question,options);
    if(r?.handled)this.audit({question,route:'cognitive',kind:r.type||'reasoning',verified:false});
    return r;
  }
  async tick({limit=64,force=false,refresh=true,trainSteps=0}={}){
    if(!this.autonomous)return {ok:false,reason:'autonomous curriculum unavailable'};
    const out=await this.autonomous.tick({limit,force,refresh,trainSteps});
    if(out.ok){
      // First consume new lexical atoms in the existing dictionary curriculum;
      // this is independent of whether those words are in verified public knowledge.
      const lexicalReview=this.curriculum?.tick?.({limit:16})||null;
      if(lexicalReview?.ok&&lexicalReview.processed&&typeof this.autonomous.save==='function')
        await this.autonomous.save();
      const s=this.S.unifiedCognition;
      s.learningCycles++;
      // Every reviewed growth epoch feeds the existing shared grammar, skill,
      // relation and transformer evaluation loop, not a separate learning branch.
      this.growth?.acknowledgedEvaluation?.();
      s.lastCycle={at:new Date().toISOString(),scanned:out.scanned||0,
        grammarExamples:out.grammarExamples||0,relationExamples:out.relationExamples||0,
        cognitiveDocuments:out.cognitiveDocuments||0,
        lexicalReviewed:lexicalReview?.processed||0,lexicalKnown:lexicalReview?.known||0,
        lexicalUnknown:lexicalReview?.unknown||0};
    }
    return out;
  }
  status(){
    return {version:1,execution:'one coordinated entry point',
      answered:this.S.unifiedCognition.answered,fallthrough:this.S.unifiedCognition.fallthrough,
      learningCycles:this.S.unifiedCognition.learningCycles,
      skillMemory:this.skills?.status()||null,
      cognitiveMemory:this.mind?.store?.status?.()||null,
      curriculum:this.autonomous?.status?.()||null,
      importedKnowledge:this.curriculum?.inventory?.()||null,
      organismGrowth:this.growth?.status?.()||null,
      lastCycle:this.S.unifiedCognition.lastCycle,
      recent:this.S.unifiedCognition.history.slice(-10)};
  }
}
