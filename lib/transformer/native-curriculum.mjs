import {executeSemanticFrame} from '../mind/fabric-model.mjs';
const letters='abcdefghijklmnopqrstuvwxyz';
const prng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const word=rand=>'N'+Array.from({length:7},()=>letters[Math.floor(rand()*26)]).join('');
const property=rand=>['shells','sensors','fins','modules','crystals','wheels','plates','wings'][Math.floor(rand()*8)];
export const nativeFramePrompt=(question,history=[])=>{
 const recent=Array.isArray(history)?history.slice(0,3).map(x=>x?.question).filter(x=>typeof x==='string'):[];
 return 'Interpret the given statements as a checked declarative JSON frame. Do not invent evidence.\n'+
  (recent.length?'Context: '+recent.join(' ')+'\n':'')+
  'Question: '+String(question).slice(0,1000)+'\nFrame:';
};
function scenario(rand,kind){
 const subject=word(rand),type=word(rand),unit=property(rand);
 const initial=8+Math.floor(rand()*35),change=1+Math.floor(rand()*7),op=rand()>0.5?'add':'subtract';
 const verb=op==='add'?'receives':'loses';
 const result=initial+(op==='add'?change:-change);
 if(kind==='inherit'){
  const question=type+' has '+initial+' '+unit+'. '+subject+' is a '+type+'. '+subject+' '+verb+' '+change+' '+unit+'. How many '+unit+' remain for '+subject+'?';
  const frame={kind:'world-transition',classes:[{name:type,properties:[{name:unit,value:initial,quote:type+' has '+initial+' '+unit}]}],
   entities:[{name:subject,class:type,quote:subject+' is a '+type}],
   changes:[{entity:subject,property:unit,operation:op,amount:change,quote:subject+' '+verb+' '+change+' '+unit}],
   query:{entity:subject,property:unit}};
  return {kind,question,frame,expected:result};
 }
 if(kind==='unknown'){
  const question=subject+' is an unfamiliar type of creature. How many '+unit+' does '+subject+' have?';
  return {kind,question,frame:{kind:'unknown'},expected:null};
 }
 const question=subject+' has '+initial+' '+unit+'. '+subject+' '+verb+' '+change+' '+unit+'. How many '+unit+' remain?';
 const frame={kind:'arithmetic',operation:op,left:initial,right:change,subject,unit,
  support:[subject+' has '+initial+' '+unit,subject+' '+verb+' '+change+' '+unit]};
 return {kind,question,frame,expected:result};
}
export function buildNativeCurriculum({seed=17011,perKind=12}={}){
 const rand=prng(seed>>>0),cases=[];
 for(const kind of ['arithmetic','inherit','unknown'])
  for(let i=0;i<Math.max(1,Math.min(100,perKind));i++)cases.push(scenario(rand,kind));
 return cases;
}
export function nativeTrainingDocuments({seed=17011,perKind=12}={}){
 return buildNativeCurriculum({seed,perKind}).map(x=>nativeFramePrompt(x.question)+' '+JSON.stringify(x.frame));
}
export async function evaluateNativeGeneralization({draft,seed=825617,perKind=6}={}){
 if(typeof draft!=='function')return {ok:false,reason:'no native checkpoint draft function'};
 const cases=buildNativeCurriculum({seed,perKind});
 const stats={arithmetic:{correct:0,total:0},inherit:{correct:0,total:0},unknown:{correct:0,total:0}};
 const failures=[];
 for(const item of cases){
  stats[item.kind].total++;
  try{
   const raw=await draft(nativeFramePrompt(item.question),{max:384});
   const content=typeof raw==='string'?raw:raw?.text;
   const frame=JSON.parse(String(content||'').trim().replace(/^[\x60]{3}(?:json)?\s*|\s*[\x60]{3}$/g,''));
   const executed=executeSemanticFrame(frame,{question:item.question});
   const correct=item.kind==='unknown'?frame.kind==='unknown'&&!executed:
    executed?.operation?.result===item.expected;
   if(correct)stats[item.kind].correct++;
   else failures.push({kind:item.kind,reason:'frame did not solve held-out input'});
  }catch{failures.push({kind:item.kind,reason:'native interpreter did not return valid JSON'});}
 }
 const total=cases.length,correct=Object.values(stats).reduce((a,v)=>a+v.correct,0);
 const accuracy=correct/total;
 const passed=accuracy>=0.8&&stats.arithmetic.correct>=Math.ceil(stats.arithmetic.total*0.75)&&
  stats.inherit.correct>=Math.ceil(stats.inherit.total*0.75)&&
  stats.unknown.correct>=Math.ceil(stats.unknown.total*0.75);
 return {ok:true,passed,accuracy,correct,total,stats,independentSeed:seed,failures:failures.slice(0,12)};
}
