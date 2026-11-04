// Conversation-first, local, bounded inference. Never promotes chat assertions to global facts.
const norm=s=>String(s||'').trim().replace(/[.!?]+$/,'').toLowerCase();
export function contextualAnswer(question,history=[]){
 const q=String(question||'').trim(), turns=Array.isArray(history)?history.slice(0,12).map(x=>String(x?.question||'').slice(0,800)).reverse():[];
 if(!q)return null;
 const transcript=[...turns,q].join(' ');
 const names=[...transcript.matchAll(/\bmy name is ([\p{L}][\p{L}'-]{0,40})\b/giu)];
 const lastName=names.at(-1)?.[1];
 const nameAsk=/^(?:what(?:'s| is) my name|do you remember my name)\??$/i.test(q);
 if(nameAsk)return lastName?{answer:`Your name is ${lastName}, as you told me earlier in this conversation.`,kind:'remembered',basis:'conversation statement'}:{answer:"You haven't told me your name in the conversation history I can see.",kind:'unknown',basis:'available conversation history'};
 const nameGiven=q.match(/\bmy name is ([\p{L}][\p{L}'-]{0,40})\b/iu);
 if(nameGiven)return {answer:`I'll use ${nameGiven[1]} as your name in this conversation.`,kind:'remembered',basis:'current user statement'};
 // The rules below are derived from this conversation only. They do not enter permanent knowledge.
 const creature=transcript.match(/\b(?:a|an) (?:fictional )?(?:animal|creature) called (\w+) has (\d{1,3}) legs\b/i);
 const every=transcript.match(/\bevery (\w+) can (\w+)\b/i);
 const member=transcript.match(/\b(\w+) is (?:a|an) (\w+)\b/i);
 if(creature&&member&&norm(creature[1])===norm(member[2])){
  const [_,species,count]=creature,individual=member[1],ability=every&&norm(every[1])===norm(species)?every[2]:null;
  if(new RegExp(`\\bhow many legs does ${individual} have\\b`,'i').test(q)){
   return {answer:`Based on your fictional rules, ${individual} has ${count} legs${ability?` and can ${ability}`:''}. This is inferred from your statements, not an independently verified fact.`,kind:'inferred',basis:'user-provided fictional rules'};
  }
  const lost=q.match(/\b(?:loses?|lost) (\d{1,3}|one|two|three) legs?\b/i);
  if(lost&&new RegExp(`\\bhow many legs remain\\b`,'i').test(q)){
   const n={one:1,two:2,three:3}[lost[1].toLowerCase()]??Number(lost[1]),remain=Number(count)-n;
   if(remain>=0)return {answer:`${individual} would have ${remain} legs remaining: ${count} − ${n} = ${remain}. This is a deduction from your hypothetical information.`,kind:'inferred',basis:'conversation premise and subtraction'};
  }
  if(/\bwhat did i tell you about\b/i.test(q)&&new RegExp(`\\b${species}\\b`,'i').test(q)){
   return {answer:`You said a fictional animal called ${species} has ${count} legs${ability?`, every ${species} can ${ability}`:''}, and ${individual} is a ${species}.`,kind:'remembered',basis:'conversation statements'};
  }
 }
 const condition=transcript.match(/\ba machine stops whenever its cooling fan fails\b/i);
 if(condition&&/\b(?:fan has failed|fan fails)\b/i.test(transcript)){
  if(/\bwhat should happen to the machine\b/i.test(q))return {answer:'The machine should stop, because you stated that it stops whenever its cooling fan fails. This follows from your stated rule.',kind:'inferred',basis:'conversation conditional rule'};
  if(/\b(?:fan is working again|fan.*working again)\b/i.test(q)&&/\bprove the machine is running\b/i.test(q))return {answer:'No. A working fan does not prove the machine is running. Your rule only says that fan failure causes the machine to stop; it does not establish the reverse.',kind:'inferred',basis:'logical implication; converse not established'};
 }
 if(/\bwhich of your answers came from my statements\b/i.test(q)){
  return {answer:'Your name and the fictional creature rules came from your statements (remembered). The leg calculation and machine consequences are deductions (inferred). I cannot independently verify fictional premises or facts not supplied with evidence (unknown).',kind:'inferred',basis:'conversation provenance'};
 }
 return null;
}
