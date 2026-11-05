// Compositional conversation-local quantity state.
// Derives a new state from a previously checked arithmetic trace, never from
// an arbitrary asserted assistant number. Does not modify persistent atoms.
const normalize=x=>String(x||'').trim().toLowerCase();
const NUMBER_WORDS=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
const num=x=>{const n=Number(x);return Number.isFinite(n)?n:NUMBER_WORDS.indexOf(normalize(x));};
const amount='(\\d+(?:\\.\\d+)?|'+NUMBER_WORDS.join('|')+')';
const plus=new RegExp('\\b(?:receiv(?:e|es|ed|ing)|gain(?:s|ed|ing)?|add(?:s|ed|ing)?|get|gets|got|obtain(?:s|ed)?|find|finds|found)\\s+'+amount+'\\s+(?:more\\s+)?([a-z][a-z0-9_-]{1,40})\\b','gi');
const minus=new RegExp('\\b(?:los(?:e|es|t)|remov(?:e|es|ed)|subtract(?:s|ed)?|spend|spends|spent|give away|gave away)\\s+'+amount+'\\s+(?:more\\s+)?([a-z][a-z0-9_-]{1,40})\\b','gi');
const singular=x=>normalize(x).replace(/s$/,'');
const answerPattern=/\b([a-z][a-z0-9_-]{2,63})\s+has\s+(\d+(?:\.\d+)?)\s+([a-z][a-z0-9_-]{1,40})\s+remaining\s*:\s*(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/i;
function anchor(message,states){
 const question=String(message?.question||''),answer=String(message?.answer||'');
 const m=answerPattern.exec(answer);
 if(!m)return null;
 const [,name,totalRaw,unit,firstRaw,operator,changeRaw,resultRaw]=m;
 const first=Number(firstRaw),change=Number(changeRaw),result=Number(resultRaw);
 if([first,change,result].some(x=>!Number.isFinite(x)||Math.abs(x)>1e8))return null;
 if(Math.abs((operator==='+'?first+change:first-change)-result)>1e-9||Number(totalRaw)!==result)return null;
 if(!new RegExp('\\b'+name+'\\b','i').test(question)||!new RegExp('\\b'+unit+'\\b','i').test(question))return null;
 const nums=[...question.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(x=>Number(x[0]));
 const prior=states.get(normalize(name)+'|'+singular(unit));
 // A new answer may depend on an earlier checked state, but a fabricated
 // chain cannot introduce an unobserved intermediate value.
 if(!nums.includes(change)||!(nums.includes(first)||prior?.value===first))return null;
 const polarity=operator==='+'?/\b(?:receiv|gain|add|get|got|obtain|find|found)\w*\b/i:
  /\b(?:los|remov|subtract|spend|spent|gave|give)\w*\b/i;
 if(!polarity.test(question)||/\b(?:did not|does not|never|cannot|can't|didn't|doesn't)\b/i.test(question))
  return null;
 return {name,unit,value:result,from:answer};
}
export function resolveQuantityFollowup(question,{history=[]}={}){
 if(typeof question!=='string'||question.length>1000||!Array.isArray(history))return null;
 const candidates=[];
 for(const [op,pattern] of [['add',plus],['subtract',minus]]){
  pattern.lastIndex=0;
  for(const m of question.matchAll(new RegExp(pattern.source,'gi'))){
   if(/\b(?:not|never|didn't|doesn't|cannot|can't)\b/i.test(question.slice(Math.max(0,m.index-12),m.index)))return null;
   const change=num(m[1]);
   if(!Number.isFinite(change)||change<0||change>1000000)return null;
   candidates.push({op,change,unit:m[2],span:m[0]});
  }
 }
 if(candidates.length!==1||!/\b(?:how many|how much|total|remain|left|now)\b/i.test(question))return null;
 const operation=candidates[0],trustedHistory=history.slice(0,12);
 const states=new Map();
 for(const record of [...trustedHistory].reverse()){
  const checked=anchor(record,states);
  if(checked)states.set(normalize(checked.name)+'|'+singular(checked.unit),checked);
 }
 for(const prior of [...states.values()].reverse()){
  if(!prior||singular(prior.unit)!==singular(operation.unit)||
   !new RegExp('\\b'+prior.name+'\\b','i').test(question))continue;
  const result=operation.op==='add'?prior.value+operation.change:prior.value-operation.change;
  if(!Number.isFinite(result)||result<0||result>1e8)return null;
  const symbol=operation.op==='add'?'+':'-';
  return {answer:prior.name+' has '+result+' '+prior.unit+' remaining: '+
   prior.value+' '+symbol+' '+operation.change+' = '+result+'.',
   kind:'conversation-quantity-transition',route:'quantity-state',
   confidence:85,verified:false,trust:'conversation-premises + checked arithmetic',
   provenance:[{source:'prior checked calculation'},{source:'current user action',quote:operation.span}],
   operation:{kind:operation.op,left:prior.value,right:operation.change,result},
   context:{name:prior.name,unit:prior.unit,result}};
 }
 return null;
}
