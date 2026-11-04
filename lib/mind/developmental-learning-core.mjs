// KENUXA online developmental learning: persistent, scoped, evidence-aware and bounded.
// Learns reusable transformations from demonstrations, never executes generated code.
// State is plain JSON and is saved through the node's configured PostgreSQL/File store.
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const normalize=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const safe=s=>typeof s==='string'&&s.length>0&&s.length<=300;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9;
const clone=x=>JSON.parse(JSON.stringify(x));
const shape=x=>Array.isArray(x)?'array':x===null?'null':typeof x;
const matches=(pattern,value,bindings)=>{
 if(typeof pattern==='string'&&/^\$[a-z][a-z0-9_]*$/.test(pattern)){
  const k=pattern.slice(1);
  if(Object.hasOwn(bindings,k))return JSON.stringify(bindings[k])===JSON.stringify(value);
  bindings[k]=value;return true;
 }
 if(shape(pattern)!==shape(value))return false;
 if(Array.isArray(pattern))return pattern.length===value.length&&pattern.every((p,i)=>matches(p,value[i],bindings));
 if(pattern&&typeof pattern==='object')return Object.keys(pattern).length===Object.keys(value).length&&Object.keys(pattern).every(k=>Object.hasOwn(value,k)&&matches(pattern[k],value[k],bindings));
 return pattern===value;
};
const substitute=(template,bindings)=>{
 if(typeof template==='string'&&/^\$[a-z][a-z0-9_]*$/.test(template))return clone(bindings[template.slice(1)]);
 if(Array.isArray(template))return template.map(x=>substitute(x,bindings));
 if(template&&typeof template==='object')return Object.fromEntries(Object.entries(template).map(([k,v])=>[k,substitute(v,bindings)]));
 return template;
};
const OPERATORS={
 add:(a,b)=>a+b,subtract:(a,b)=>a-b,multiply:(a,b)=>a*b,divide:(a,b)=>b===0?null:a/b,
 min:(a,b)=>Math.min(a,b),max:(a,b)=>Math.max(a,b)
};
function candidate(input,output){
 if(!input||typeof input!=='object'||Array.isArray(input)||!output||typeof output!=='object'||Array.isArray(output))return null;
 const keys=Object.keys(input),outKeys=Object.keys(output);
 if(keys.length>12||outKeys.length!==1)return null;
 const outKey=outKeys[0],target=output[outKey];if(!finite(target))return null;
 for(const [aKey,a] of Object.entries(input))for(const [bKey,b] of Object.entries(input)){
  if(aKey===bKey||!finite(a)||!finite(b))continue;
  for(const [op,fn] of Object.entries(OPERATORS)){
   const value=fn(a,b);if(value!==null&&finite(value)&&Math.abs(value-target)<1e-9)return {kind:'arithmetic',op,aKey,bKey,outKey};
  }
 }
 return null;
}
function apply(rule,input){
 if(rule.kind==='arithmetic'){
  const a=input?.[rule.aKey],b=input?.[rule.bKey],fn=OPERATORS[rule.op];
  if(!finite(a)||!finite(b)||!fn)return null;
  const v=fn(a,b);return v!==null&&finite(v)?{[rule.outKey]:v}:null;
 }
 if(rule.kind==='symbolic'){
  const bindings={};return matches(rule.pattern,input,bindings)?substitute(rule.template,bindings):null;
 }
 return null;
}
export class DevelopmentalLearning{
 constructor({state={},maxExamples=1000,maxRules=256,now=()=>Date.now()}={}){
  this.state=state;this.state.examples ||= [];this.state.rules ||= [];this.state.events ||= [];
  this.maxExamples=Math.max(10,Math.min(10000,maxExamples));this.maxRules=Math.max(10,Math.min(1000,maxRules));this.now=now;
 }
 observe({input,output,scope='private',source='user',consent=false}={}){
  if(!consent)return {ok:false,reason:'consent required'};
  if(!['private','public'].includes(scope))return {ok:false,reason:'invalid scope'};
  const payload={input,output};const bytes=JSON.stringify(payload);
  if(bytes.length>4000||!input||!output||typeof input!=='object'||typeof output!=='object')return {ok:false,reason:'invalid or oversized example'};
  const id=digest([payload,scope,source]);if(this.state.examples.some(x=>x.id===id))return {ok:true,id,duplicate:true};
  if(this.state.examples.length>=this.maxExamples)this.state.examples.shift();
  this.state.examples.push({id,input:clone(input),output:clone(output),scope,source:String(source).slice(0,80),verified:false,at:this.now()});
  return {ok:true,id,verified:false};
 }
 verifyExample(id,{expected,authority=false}={}){const e=this.state.examples.find(x=>x.id===id);if(!e)return {ok:false,reason:'unknown example'};if(!authority)return {ok:false,reason:'trusted server-side verification required'};if(JSON.stringify(e.output)!==JSON.stringify(expected))return {ok:false,reason:'independent evaluator disagrees'};e.verified=true;this.evaluate();return {ok:true,id};}
 propose({pattern,template,scope='private'}={}){
  if(!pattern||!template||typeof pattern!=='object'||typeof template!=='object'||JSON.stringify({pattern,template}).length>4000)return {ok:false,reason:'invalid rule'};
  return this._put({kind:'symbolic',pattern:clone(pattern),template:clone(template),scope});
 }
 _put(rule){
  const id=digest(rule),existing=this.state.rules.find(x=>x.id===id);
  if(existing)return {ok:true,id,duplicate:true};
  if(this.state.rules.length>=this.maxRules)return {ok:false,reason:'rule capacity reached'};
  this.state.rules.push({...rule,id,status:'candidate',support:0,failures:0,createdAt:this.now()});
  return {ok:true,id};
 }
 discover(){
  let added=0;
  for(const e of this.state.examples.filter(x=>x.verified)){
   const rule=candidate(e.input,e.output);if(!rule)continue;
   if(this._put({...rule,scope:e.scope}).ok)added++;
  }
  this.evaluate();return {candidates:this.state.rules.length,considered:this.state.examples.length,discovered:added};
 }
 evaluate(){
  // Only independent trusted-evaluator examples can promote a rule. Unknown evidence stays quarantined.
  for(const r of this.state.rules){
   const examples=this.state.examples.filter(e=>e.verified&&e.scope===r.scope);
   let support=0,failures=0;
   for(const e of examples){
    const predicted=apply(r,e.input);if(predicted===null)continue;
    if(JSON.stringify(predicted)===JSON.stringify(e.output))support++;else failures++;
   }
   r.support=support;r.failures=failures;
   r.status=failures>0?'conflicted':support>=3?'validated':'candidate';
  }
  return this.status();
 }
 predict(input,{scope='private'}={}){
  const hits=[];
  for(const rule of this.state.rules){
   if(rule.status!=='validated'||rule.scope!==scope)continue;
   const output=apply(rule,input);if(output!==null)hits.push({output,ruleId:rule.id,support:rule.support});
  }
  if(!hits.length)return {ok:false,reason:'no validated transferable rule'};
  const variants=new Set(hits.map(x=>JSON.stringify(x.output)));
  if(variants.size>1)return {ok:false,reason:'validated rules disagree',conflicts:hits.map(x=>x.ruleId)};
  return {ok:true,output:hits[0].output,proof:hits.map(x=>({ruleId:x.ruleId,support:x.support})),kind:'learned-procedure'};
 }
 rollback(id){const r=this.state.rules.find(x=>x.id===id);if(!r)return {ok:false};r.status='retired';this.state.events.push({type:'rollback',id,at:this.now()});this.state.events=this.state.events.slice(-100);return {ok:true};}
 status(){return {examples:this.state.examples.length,verified:this.state.examples.filter(x=>x.verified).length,rules:this.state.rules.length,validated:this.state.rules.filter(x=>x.status==='validated').length,conflicted:this.state.rules.filter(x=>x.status==='conflicted').length};}
}
