// KENUXA developmental relational workspace.
// Open vocabulary: predicates, entities and attributes are learned from utterances, not enumerated domains.
// Conversation premises are scoped, provisional and never promoted to global verified knowledge.
const clean=s=>String(s||'').trim().toLowerCase().replace(/^(?:the|a|an)\s+/,'').replace(/[.!?]+$/,'');
const numberWords={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
const number=s=>/^\d+$/.test(s)?Number(s):numberWords[clean(s)]??null;
const quantity='(\\d+|'+Object.keys(numberWords).join('|')+')';
const word='([\\p{L}][\\p{L}\\p{N}_-]*)';
const regex=(s)=>new RegExp(s,'giu');
const latest=(a,p)=>a.filter(p).at(-1);
const baseAttribute=s=>clean(s).replace(/(?:es|s)$/,'');
const result=(answer,kind,proof)=>({answer,kind,basis:proof.map(x=>x.source).join(', '),proof});
function parse(text,source){
 const facts=[];
 const sentences=String(text||'').slice(0,2400).split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
 for(const s of sentences){
  let m;
  for(const x of s.matchAll(regex('(?:a|an|the)\\s+(?:(?:fictional|imaginary|hypothetical)\\s+)?(?:\\w+\\s+)?(?:called|named)\\s+(?:a|an|the)?\\s*'+word+'\\s+has\\s+'+quantity+'\\s+'+word))){
   const n=number(x[2]);if(n!==null)facts.push({kind:'quantity',entity:clean(x[1]),attribute:clean(x[3]),value:n,source});
  }
  for(const x of s.matchAll(regex(word+'\\s+has\\s+'+quantity+'\\s+'+word))){
   const n=number(x[2]);if(n!==null)facts.push({kind:'quantity',entity:clean(x[1]),attribute:clean(x[3]),value:n,source});
  }
  for(const x of s.matchAll(regex(word+'\\s+is\\s+(?:a|an)\\s+'+word)))facts.push({kind:'isa',entity:clean(x[1]),value:clean(x[2]),source});
  for(const x of s.matchAll(regex('(?:every|all|each)\\s+'+word+'\\s+(?:can|is able to)\\s+'+word)))facts.push({kind:'can',entity:clean(x[1]),value:clean(x[2]),source});
  for(const x of s.matchAll(regex(word+'\\s+(?:can|is able to)\\s+'+word))){
    const subject=clean(x[1]);
    // Do not turn question conjunctions ('and can Nova ...') into factual abilities.
    if(!new Set(['and','or','but','if','when','where','who','what','why','how','which','then','can','does','did']).has(subject))
      facts.push({kind:'can',entity:subject,value:clean(x[2]),source});
  }
  for(const x of s.matchAll(regex('(?:my name is|call me)\\s+'+word)))facts.push({kind:'name',entity:'speaker',value:x[1],source});
  m=s.match(/(?:a|the)\s+([\p{L} ]+?)\s+(\w+)\s+whenever\s+its\s+([\p{L} ]+?)\s+(\w+)$/iu);
  if(m)facts.push({kind:'rule',entity:clean(m[1]),value:clean(m[2]),conditionEntity:clean(m[3]),condition:clean(m[4]),source});
 }
 return [...new Map(facts.map(x=>[JSON.stringify([x.kind,x.entity,x.value,x.attribute,x.conditionEntity,x.condition]),x])).values()];
}
export class DevelopmentalWorkspace{
 constructor({maxFacts=256}={}){this.maxFacts=maxFacts;}
 interpret(question,history=[]){
  const earlier=(Array.isArray(history)?history:[]).slice(0,20).reverse();
  const prior=earlier.map(x=>typeof x==='string'?x:x?.question).filter(x=>typeof x==='string');
  const priorAnswers=earlier.filter(x=>x&&typeof x==='object'&&typeof x.answer==='string').map(x=>({
    question:String(x.question||'').slice(0,500),
    answer:String(x.answer).slice(0,1200),
    provenance:'unverified-prior-assistant-output'
  }));
  const facts=[...prior.flatMap((t,i)=>parse(t,'turn:'+i)),...parse(question,'current')].slice(-this.maxFacts);
  return {facts,prior,priorAnswers};
 }
 infer(question,history=[]){
  if(typeof question!=='string'||!question.trim())return null;
  const q=question.trim(),{facts,prior,priorAnswers}=this.interpret(q,history);
  const get=(kind,entity)=>latest(facts,x=>x.kind===kind&&x.entity===clean(entity));
  const property=(entity,attribute)=>{
   const visited=new Set(),queue=[clean(entity)],proof=[];
   while(queue.length&&visited.size<16){
    const e=queue.shift();if(visited.has(e))continue;visited.add(e);
    const candidates=facts.filter(x=>x.kind==='quantity'&&x.entity===e&&baseAttribute(x.attribute)===baseAttribute(attribute));
    if(new Set(candidates.map(x=>x.value)).size>1)return {conflict:true,proof:candidates};
    if(candidates.length)return {fact:candidates.at(-1),proof:[...proof,candidates.at(-1)]};
    for(const x of facts.filter(x=>x.kind==='isa'&&x.entity===e))queue.push(x.value);
   }
   return null;
  };
  // Prior-conversation recall must never enter the web, network or generative cascade.
  // Evidence is confined to the supplied conversation; unknown entities are not
  // interpreted as dictionary words. Retain the source sentences for provenance.
  const recallAny=q.match(/\b(?:what did i (?:tell|say|mention)(?: you)? about|what (?:have|did) we (?:discuss|say) about|remind me what i (?:said|told you) about)\s+(?:(?:a|an|the)\s+)?([\p{L}][\p{L}\p{N}_-]*)/iu);
  if(recallAny){
    const subject=clean(recallAny[1]);
    const related=facts.filter(x=>x.entity===subject||
      (x.kind==='isa'&&x.value===subject));
    const evidence=prior.flatMap((line,index)=>String(line).split(/[.!?]+/)
      .map(s=>s.trim())
      .filter(s=>s&&s.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).includes(subject))
      .map(s=>({source:'turn:'+index,text:s.slice(0,320)}))).slice(-8);
    if(related.length||evidence.length){
      const quoted=[...new Map(evidence.map(x=>[x.text.toLowerCase(),x])).values()].slice(-5);
      const summary=[...new Set(related.map(x=>{
        const label=x.entity===subject?recallAny[1]:x.entity;
        if(x.kind==='quantity')return label+' has '+x.value+' '+x.attribute;
        if(x.kind==='can')return label+' can '+x.value;
        if(x.kind==='isa')return label+' is a '+x.value;
        return null;
      }).filter(Boolean))];
      return result('You told me: '+(summary.length?summary.join('; ')+'. ':'')+
        (quoted.length?'Your original statements were '+quoted.map(x=>'“'+x.text+'.”').join(' '):
        'I have the related premises but not their original wording.'),
        'remembered',related.length?related:quoted);
    }
    return result('I cannot find an earlier statement about '+recallAny[1]+
      ' in the conversation history available to me. I will not invent one or search the web for a fictional subject.',
      'unknown',[]);
  }
  // Higher-order reasoning uses the same scoped evidence graph as ordinary
  // quantities and inheritance. A question about earlier conclusions is not
  // a request for internet facts and must never fall through to web research.
  const wantsProvenance=/\b(?:which|what|classify|separate|distinguish|identify|earlier)\b/i.test(q)
    && [
      /\b(?:statements?|premises?|supplied|said|told)\b/i,
      /\b(?:deductions?|inferences?|inferred|derived)\b/i,
      /\b(?:uncertain|unknown|unverified|confidence)\b/i
    ].filter(rx=>rx.test(q)).length>=2;
  if(wantsProvenance){
    const supplied=facts.filter(x=>x.source!=='current');
    const premises=[],deductions=[];
    const add=(array,text)=>{if(text&&!array.includes(text)&&array.length<8)array.push(text);};
    for(const f of supplied){
      if(f.kind==='name')add(premises,'You said your name is '+f.value);
      if(f.kind==='quantity')add(premises,f.entity+' has '+f.value+' '+f.attribute);
      if(f.kind==='isa')add(premises,f.entity+' is a '+f.value);
      if(f.kind==='can')add(premises,f.entity+' can '+f.value);
      if(f.kind==='rule')add(premises,f.entity+' '+f.value+' when its '+f.conditionEntity+' '+f.condition);
    }
    for(const relation of supplied.filter(x=>x.kind==='isa')){
      for(const p of supplied.filter(x=>x.kind==='quantity'&&x.entity===relation.value)){
        add(deductions,relation.entity+' inherits '+p.value+' '+p.attribute+' from the '+relation.value+' category');
      }
      for(const p of supplied.filter(x=>x.kind==='can'&&x.entity===relation.value)){
        add(deductions,relation.entity+' can '+p.value+' because it belongs to the '+relation.value+' category');
      }
    }
    for(const turn of prior){
      const lost=turn.match(/\b([\p{L}][\p{L}\p{N}_-]*)\s+(?:loses?|lost)\s+(\d+|[\p{L}]+)\s+([\p{L}][\p{L}\p{N}_-]*)\b/iu);
      if(!lost)continue;
      const n=number(lost[2]),p=property(lost[1],lost[3]);
      if(n!==null&&p?.fact&&n<=p.fact.value){
        const remaining=p.fact.value-n;
        add(deductions,lost[1]+' has '+remaining+' '+p.fact.attribute+' remaining after losing '+n+
          ' ('+p.fact.value+' − '+n+' = '+remaining+')');
      }
    }
    const fictional=prior.some(t=>/\b(?:fictional|imaginary|hypothetical|made-up)\b/i.test(t));
    const unknown=fictional
      ? 'These are premises of your fictional scenario, not independently verified real-world facts. Outcomes not entailed by those premises remain unknown.'
      : 'Anything not established by the supplied statements, a valid deduction, or independent evidence remains uncertain.';
    const answer='**Statements you supplied:** '+
      (premises.length?premises.map(s=>'• '+s).join('; '):'No clear factual premises are available in the visible conversation.')+
      '\n**Deductions from those statements:** '+
      (deductions.length?deductions.map(s=>'• '+s).join('; '):'No supported deductions can be established from the visible premises.')+
      '\n**Still uncertain:** '+unknown+
      '\nRecalling what you told me is memory of a premise, not independent verification.'+
      (priorAnswers.length?'\n**Earlier responses:** '+priorAnswers.slice(-4).map(a=>'“'+a.answer.replace(/\\s+/g,' ').slice(0,300)+'”').join(' | ')+
        '. These are records of earlier responses, not independent proof.':
        '\nEarlier assistant responses were not supplied with the available history, so I cannot verify exactly which answers KENUXA gave.');
    return result(answer,'provenance',supplied.slice(-16));
  }
  // Revision history is append-only for this conversation: a correction changes
  // which premise is current without erasing what the speaker originally said.
  const priorQuantities=facts.filter(x=>x.kind==='quantity'&&x.source!=='current');
  const presentQuantities=facts.filter(x=>x.kind==='quantity'&&x.source==='current');
  const asksEarlier=/\b(?:originally|first\s+said|previously|earlier)\b/i.test(q);
  const asksConflict=/\b(?:conflict|contradiction|contradict|inconsisten|disagree|different)\b/i.test(q);
  const correction=/\b(?:correction|corrected|correcting|actually|instead|not\s+\w+)\b/i.test(q);
  if((asksEarlier||asksConflict)&&(correction||asksEarlier)){
    const changed=presentQuantities.find(x=>priorQuantities.some(p=>p.entity===x.entity&&
      baseAttribute(p.attribute)===baseAttribute(x.attribute)));
    const target=changed||priorQuantities.find(x=>q.toLowerCase().includes(x.entity)&&
      q.toLowerCase().includes(baseAttribute(x.attribute)));
    if(target){
      const previous=priorQuantities.filter(x=>x.entity===target.entity&&
        baseAttribute(x.attribute)===baseAttribute(target.attribute));
      const original=previous[0];
      const current=changed||previous.at(-1);
      if(original){
        const conflict=current.value!==original.value;
        let answer='Originally, you said '+original.entity+' has '+original.value+' '+original.attribute+'.';
        if(changed)answer+=' Your latest statement says '+current.entity+' has '+current.value+' '+current.attribute+'.';
        else if(previous.length>1)answer+=' The latest earlier statement says '+current.value+' '+current.attribute+'.';
        answer+=' '+(conflict?'These statements conflict ('+original.value+' versus '+current.value+'). I will keep the original and the correction distinct.':'There is no numerical conflict between the available statements.');
        answer+=' This is a comparison of conversation premises, not external fact-checking.';
        return result(answer,conflict?'contradiction':'remembered',[original,...(current===original?[]:[current])]);
      }
    }
    return result('I cannot establish the original quantity or a contradiction from the earlier conversation available to me. I will not invent an original statement.','unknown',[]);
  }
  const name=get('name','speaker');
  if(/^(?:what(?:'s| is) my name|do you remember my name)\??$/i.test(q))return result(name?'Your name is '+name.value+'.':'You have not given me a name in the conversation I can see.',name?'remembered':'unknown',name?[name]:[]);
  if(/\b(?:my name is|call me)\b/i.test(q)&&name)return result("I'll use "+name.value+" in this conversation.",'remembered',[name]);
  const how=q.match(/how many\s+(\w+)\s+does\s+(\w+)\s+have/i);
  if(how){
   const p=property(how[2],how[1]);
   if(p?.conflict)return result('Your premises disagree about the quantity, so I cannot determine a single answer.','unknown',p.proof);
   if(p?.fact){
    const member=get('isa',how[2]),can=member&&get('can',member.value);
    return result(how[2]+' has '+p.fact.value+' '+clean(how[1])+(can&&/\bcan\b/i.test(q)?' and can '+can.value:'')+'. This follows from the information you supplied.','inferred',[...p.proof,...(member?[member]:[]),...(can?[can]:[])]);
   }
  }
  const loss=q.match(/(\w+)\s+(?:loses?|lost)\s+(\d+|\w+)\s+(\w+)/i);
  if(loss&&/\b(?:remain|left|how many)\b/i.test(q)){
   const p=property(loss[1],loss[3]),n=number(loss[2]);
   if(p?.conflict)return result('Your premises disagree, so the remainder cannot be established.','unknown',p.proof);
   if(p?.fact&&n!==null&&n<=p.fact.value)return result(loss[1]+' has '+(p.fact.value-n)+' '+(p.fact.attribute||loss[3])+' remaining: '+p.fact.value+' - '+n+' = '+(p.fact.value-n)+'.','inferred',p.proof);
  }
  const recall=q.match(/what did i tell you about (?:the\s+)?(\w+)/i);
  if(recall){
   const e=clean(recall[1]),related=facts.filter(x=>x.entity===e||(x.kind==='isa'&&x.value===e)).filter((x,i,a)=>a.findIndex(y=>JSON.stringify([y.kind,y.entity,y.value,y.attribute])===JSON.stringify([x.kind,x.entity,x.value,x.attribute]))===i);
   if(related.length)return result('You told me: '+related.map(x=>x.kind==='quantity'?(x.entity===e?recall[1]:x.entity)+' has '+x.value+' '+x.attribute:x.kind==='can'?(x.entity===e?recall[1]:x.entity)+' can '+x.value:x.entity+' is a '+x.value).join('; ')+'.','remembered',related);
  }
  const rule=latest(facts,x=>x.kind==='rule');
  if(rule){
   if(/what should happen/i.test(q)&&[...prior,q].some(t=>{const words=rule.conditionEntity.split(/\s+/);const pivot=words.at(-1);const root=rule.condition.replace(/(?:s|ed|ing)$/,'');return t.toLowerCase().includes(pivot)&&t.toLowerCase().includes(root);}))return result('The '+rule.entity+' should '+rule.value+', based on your rule about its '+rule.conditionEntity+' '+rule.condition+'.','inferred',[rule]);
   if(/\bprove\b/i.test(q)&&/\bworking again\b/i.test(q))return result('No. The rule about '+rule.conditionEntity+' '+rule.condition+' does not prove the converse.','inferred',[rule]);
  }
  if(/which of your answers came from my statements/i.test(q))return result('Statements supplied by you are conversation premises. Calculations and implications derived from them are inferences. Claims without sufficient support remain uncertain.','inferred',facts.slice(-8));
  return null;
 }
}
