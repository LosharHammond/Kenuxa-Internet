// Conversation-first bounded inference: never promotes conversation assertions to global facts.
const WORDS={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const numberPattern='(?:\\d{1,5}|'+Object.keys(WORDS).join('|')+')(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?';
const namePattern='[\\p{L}][\\p{L}\\p{N}\\x27-]{0,60}';
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().trim().replace(/^(?:a|an|the)\s+/,'').replace(/[.!?]+$/,'');
const re=(s,flags='giu')=>new RegExp(s,flags);
const numeric=s=>{const t=norm(s).replace(/-/g,' ');if(/^\d{1,5}$/.test(t))return Number(t);const w=t.split(' ');if(w.length===1)return WORDS[t]??null;if(w.length===2&&WORDS[w[0]]>=20&&WORDS[w[0]]%10===0&&WORDS[w[1]]<10)return WORDS[w[0]]+WORDS[w[1]];return null;};
const result=(answer,kind,basis)=>({answer,kind,basis});
const upper=s=>s?s[0].toUpperCase()+s.slice(1):s;
function parse(text,turn,all){
 const parts=String(text).replace(/\s+/g,' ').split(/(?<=[.!?])\s+(?=[A-Z\d])/u);
 for(const part of parts){
  const nm=part.match(re('\\bmy name is ('+namePattern+')\\b','iu'));if(nm)all.push({type:'name',value:nm[1],turn});
  // Category declarations: fictional animal, imaginary machine, any named object.
  for(const m of part.matchAll(re('\\b(?:a|an|the)\\s+(?:(?:fictional|imaginary|hypothetical)\\s+)?(?:\\w+\\s+)?(?:called|named)\\s+('+namePattern+')\\s+has\\s+('+numberPattern+')\\s+('+namePattern+')\\b'))){
   const n=numeric(m[2]);if(n!==null)all.push({type:'quantity',entity:norm(m[1]),label:m[1],amount:n,unit:norm(m[3]),turn});
  }
  for(const m of part.matchAll(re('\\b(?:every|each|all)\\s+('+namePattern+')\\s+(?:can|is able to)\\s+('+namePattern+')\\b')))all.push({type:'ability',entity:norm(m[1]),verb:norm(m[2]),turn});
  for(const m of part.matchAll(re('\\b('+namePattern+')\\s+is\\s+(?:a|an)\\s+('+namePattern+')\\b'))){
   if(!['what','which','this','there','that'].includes(norm(m[1])))all.push({type:'member',entity:norm(m[1]),label:m[1],category:norm(m[2]),turn});
  }
  for(const m of part.matchAll(re('\\b('+namePattern+')\\s+has\\s+('+numberPattern+')\\s+('+namePattern+')\\b'))){
   const n=numeric(m[2]);if(n!==null)all.push({type:'quantity',entity:norm(m[1]),label:m[1],amount:n,unit:norm(m[3]),turn});
  }
  const conditional=part.match(/\b(?:a|the)\s+([\p{L}][\p{L} -]{0,60}?)\s+(\w+)\s+whenever\s+its\s+([\p{L} ]{2,50}?)\s+(\w+)\b/iu);
  if(conditional)all.push({type:'conditional',entity:norm(conditional[1]),outcome:norm(conditional[2]),part:norm(conditional[3]),trigger:norm(conditional[4]),turn});
 }
}
export function contextualAnswer(question,history=[]){
 if(typeof question!=='string'||!question.trim())return null;
 const q=question.trim(),old=(Array.isArray(history)?history.slice(0,12):[]).map(x=>typeof x==='string'?x:x?.question).filter(x=>typeof x==='string').reverse();
 const facts=[];old.forEach((s,i)=>parse(s.slice(0,1000),i,facts));parse(q.slice(0,2000),old.length,facts);
 const latest=pred=>facts.filter(pred).at(-1);
 const given=q.match(re('\\bmy name is ('+namePattern+')\\b','iu'));
 if(given)return result("I'll use "+given[1]+" as your name in this conversation.",'remembered','current user statement');
 if(/^(?:what(?:'s| is) my name|do you remember my name)\??$/i.test(q)){
  const n=latest(x=>x.type==='name');return result(n?'Your name is '+n.value+', as you told me earlier in this conversation.':"You haven't told me your name in the conversation history I can see.",n?'remembered':'unknown','conversation history');
 }
 const membership=entity=>latest(x=>x.type==='member'&&x.entity===entity);
 const quantity=(entity,unit)=>{
  const category=membership(entity)?.category;
  const candidates=facts.filter(x=>x.type==='quantity'&&(x.entity===entity||x.entity===category)&&(!unit||x.unit===unit));
  if(new Set(candidates.map(x=>x.amount)).size>1)return {conflict:true};
  return candidates.at(-1)||null;
 };
 const how=q.match(re('\\bhow many\\s+('+namePattern+')\\s+does\\s+('+namePattern+')\\s+have\\b','iu'));
 if(how){
  const unit=norm(how[1]),entity=norm(how[2]),p=quantity(entity,unit);
  if(p?.conflict)return result('Your statements contain conflicting quantities; I cannot infer a single answer.','unknown','conflicting conversation premises');
  if(p){
   const category=membership(entity)?.category,ability=latest(x=>x.type==='ability'&&x.entity===category);
   return result('Based on your statements, '+upper(how[2])+' has '+p.amount+' '+unit+(ability&&/\bcan\b/i.test(q)?' and can '+ability.verb:'')+'. This is inferred from your conversation premises.','inferred','conversation property and category inference');
  }
 }
 const lost=q.match(re('\\b('+namePattern+')\\s+(?:loses?|lost)\\s+('+numberPattern+')\\s+('+namePattern+')\\b','iu'));
 if(lost&&/\b(?:how many|remain|left)\b/i.test(q)){
  const p=quantity(norm(lost[1]),norm(lost[3])),n=numeric(lost[2]);
  if(p?.conflict)return result('The quantities conflict, so I cannot calculate a reliable remainder.','unknown','conflicting conversation premises');
  if(p&&n!==null&&n<=p.amount)return result(upper(lost[1])+' would have '+(p.amount-n)+' '+norm(lost[3])+' remaining: '+p.amount+' − '+n+' = '+(p.amount-n)+'.','inferred','conversation premises and arithmetic');
 }
 const recall=q.match(re('\\bwhat did i tell you about (?:the |a |an )?('+namePattern+')\\b','iu'));
 if(recall){
  const entity=norm(recall[1]),p=latest(x=>x.type==='quantity'&&x.entity===entity),a=latest(x=>x.type==='ability'&&x.entity===entity),m=latest(x=>x.type==='member'&&x.category===entity);
  if(p||a||m)return result('You said '+[p?recall[1]+' has '+p.amount+' '+p.unit:null,a?'every '+recall[1]+' can '+a.verb:null,m?m.label+' is a '+recall[1]:null].filter(Boolean).join('; ')+'.','remembered','conversation statements');
 }
 const rule=latest(x=>x.type==='conditional');
 if(rule){
  const transcript=[...old,q].join(' ').toLowerCase();
  if(/\bwhat should happen\b/i.test(q)&&transcript.includes(rule.part+' has '+rule.trigger))return result('The '+rule.entity+' should '+rule.outcome+', because you stated that it '+rule.outcome+' whenever its '+rule.part+' '+rule.trigger+'.','inferred','conversation conditional rule');
  if(/\b(?:does that prove|does this prove|necessarily mean)\b/i.test(q)&&/\bworking again\b/i.test(q))return result('No. A working '+rule.part+' does not prove the '+rule.entity+' is running. Your rule only establishes the consequence of failure, not the reverse.','inferred','conditional implication');
 }
 if(/\bwhich of your answers came from my statements\b/i.test(q)){
  const sources=[facts.some(x=>x.type==='name')?'your name':null,facts.some(x=>x.type==='quantity')?'the stated quantities':null,facts.some(x=>x.type==='conditional')?'the stated conditional rule':null].filter(Boolean);
  return result('Remembered statements: '+(sources.join(', ')||'your conversation premises')+'. Inferences: conclusions derived from those statements, including arithmetic and conditional reasoning when applicable. Uncertain: unsupported or contradictory claims.','inferred','conversation provenance');
 }
 return null;
}
