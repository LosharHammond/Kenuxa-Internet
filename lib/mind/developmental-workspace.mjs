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
  for(const x of s.matchAll(regex(word+'\\s+(?:can|is able to)\\s+'+word)))facts.push({kind:'can',entity:clean(x[1]),value:clean(x[2]),source});
  for(const x of s.matchAll(regex('(?:my name is|call me)\\s+'+word)))facts.push({kind:'name',entity:'speaker',value:x[1],source});
  m=s.match(/(?:a|the)\s+([\p{L} ]+?)\s+(\w+)\s+whenever\s+its\s+([\p{L} ]+?)\s+(\w+)$/iu);
  if(m)facts.push({kind:'rule',entity:clean(m[1]),value:clean(m[2]),conditionEntity:clean(m[3]),condition:clean(m[4]),source});
 }
 return facts;
}
export class DevelopmentalWorkspace{
 constructor({maxFacts=256}={}){this.maxFacts=maxFacts;}
 interpret(question,history=[]){
  const prior=(Array.isArray(history)?history:[]).slice(0,20).map(x=>typeof x==='string'?x:x?.question).filter(x=>typeof x==='string').reverse();
  const facts=[...prior.flatMap((t,i)=>parse(t,'turn:'+i)),...parse(question,'current')].slice(-this.maxFacts);
  return {facts,prior};
 }
 infer(question,history=[]){
  if(typeof question!=='string'||!question.trim())return null;
  const q=question.trim(),{facts,prior}=this.interpret(q,history);
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
   if(p?.fact&&n!==null&&n<=p.fact.value)return result(loss[1]+' has '+(p.fact.value-n)+' '+loss[3]+' remaining: '+p.fact.value+' - '+n+' = '+(p.fact.value-n)+'.','inferred',p.proof);
  }
  const recall=q.match(/what did i tell you about (?:the\s+)?(\w+)/i);
  if(recall){
   const e=clean(recall[1]),related=facts.filter(x=>x.entity===e||(x.kind==='isa'&&x.value===e)).filter((x,i,a)=>a.findIndex(y=>JSON.stringify([y.kind,y.entity,y.value,y.attribute])===JSON.stringify([x.kind,x.entity,x.value,x.attribute]))===i);
   if(related.length)return result('You told me: '+related.map(x=>x.kind==='quantity'?(x.entity===e?recall[1]:x.entity)+' has '+x.value+' '+x.attribute:x.kind==='can'?(x.entity===e?recall[1]:x.entity)+' can '+x.value:x.entity+' is a '+x.value).join('; ')+'.','remembered',related);
  }
  const rule=latest(facts,x=>x.kind==='rule');
  if(rule){
   if(/what should happen/i.test(q)&&prior.some(t=>{const words=rule.conditionEntity.split(/\s+/);const pivot=words.at(-1);const root=rule.condition.replace(/(?:s|ed|ing)$/,'');return t.toLowerCase().includes(pivot)&&t.toLowerCase().includes(root);})))return result('The '+rule.entity+' should '+rule.value+', based on your rule about its '+rule.conditionEntity+' '+rule.condition+'.','inferred',[rule]);
   if(/\bprove\b/i.test(q)&&/\bworking again\b/i.test(q))return result('No. The rule about '+rule.conditionEntity+' '+rule.condition+' does not prove the converse.','inferred',[rule]);
  }
  if(/which of your answers came from my statements/i.test(q))return result('Statements supplied by you are conversation premises. Calculations and implications derived from them are inferences. Claims without sufficient support remain uncertain.','inferred',facts.slice(-8));
  return null;
 }
}
