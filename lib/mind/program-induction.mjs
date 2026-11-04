// KENUXA bounded declarative program induction.
// This is a reusable hypothesis language, NOT self-modifying executable JavaScript.
// Independent approved examples train candidates; held-out examples verify transfer.
import { createHash } from 'node:crypto';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deep=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e9;
const primitive=x=>x===null||['string','number','boolean'].includes(typeof x);
const supported=x=>typeof x==='string'||typeof x==='boolean'||finite(x);
const text=x=>typeof x==='string'&&x.length<=800;
const MAX_DEPTH=3,MAX_CANDIDATES=25000;
const TYPES=['add','subtract','multiply','divide','mod','min','max','greater','less','equal','and','or','concat'];
const op=(name,a,b)=>{
  if(['add','subtract','multiply','divide','mod','min','max','greater','less'].includes(name)){
    if(!finite(a)||!finite(b))return undefined;
    if((name==='divide'||name==='mod')&&b===0)return undefined;
    const v={add:()=>a+b,subtract:()=>a-b,multiply:()=>a*b,divide:()=>a/b,mod:()=>a%b,min:()=>Math.min(a,b),max:()=>Math.max(a,b),greater:()=>a>b,less:()=>a<b}[name]();
    return finite(v)||typeof v==='boolean'?v:undefined;
  }
  if(name==='equal')return same(a,b);
  if(name==='and'||name==='or')return typeof a==='boolean'&&typeof b==='boolean'?(name==='and'?a&&b:a||b):undefined;
  if(name==='concat')return text(a)&&text(b)?(a+b).slice(0,800):undefined;
};
function paths(obj,prefix='',depth=0,out=[]){
  if(out.length>=16||depth>2)return out;
  if(primitive(obj)){if(prefix&&supported(obj))out.push({path:prefix,value:obj});return out;}
  if(Array.isArray(obj)){for(let i=0;i<Math.min(obj.length,8);i++)paths(obj[i],prefix?prefix+'.'+i:String(i),depth+1,out);return out;}
  if(obj&&typeof obj==='object')for(const k of Object.keys(obj).sort().slice(0,12)){
    if(!/^[\w-]{1,50}$/.test(k))continue;
    paths(obj[k],prefix?prefix+'.'+k:k,depth+1,out);
  }
  return out;
}
function get(obj,p){
  if(typeof p!=='string'||p.length>160)return undefined;
  let x=obj;
  for(const k of p.split('.')){if(!x||typeof x!=='object'||!Object.hasOwn(x,k))return undefined;x=x[k];}
  return x;
}
export function runInducedProgram(expr,input,budget={visits:0}){
  if(!expr||typeof expr!=='object'||++budget.visits>80)return undefined;
  if(expr.type==='field')return get(input,expr.path);
  if(expr.type==='const')return primitive(expr.value)?expr.value:undefined;
  if(expr.type==='unary'){
    const a=runInducedProgram(expr.arg,input,budget);
    if(expr.op==='length')return typeof a==='string'||Array.isArray(a)?a.length:undefined;
    if(expr.op==='lower')return typeof a==='string'?a.toLowerCase():undefined;
    if(expr.op==='upper')return typeof a==='string'?a.toUpperCase():undefined;
    if(expr.op==='trim')return typeof a==='string'?a.trim():undefined;
    if(expr.op==='not')return typeof a==='boolean'?!a:undefined;
    if(expr.op==='negate')return finite(a)?-a:undefined;
    if(expr.op==='abs')return finite(a)?Math.abs(a):undefined;
    return undefined;
  }
  if(expr.type==='binary')return op(expr.op,runInducedProgram(expr.left,input,budget),runInducedProgram(expr.right,input,budget));
  if(expr.type==='template'){
    let s='';
    for(const part of expr.parts||[]){
      const v=part.path?get(input,part.path):part.literal;
      if(!primitive(v)||v===undefined)return undefined;
      s+=String(v);
      if(s.length>800)return undefined;
    }
    return s;
  }
  return undefined;
}
function leaves(first){
  const out=paths(first).map(p=>({expr:{type:'field',path:p.path},value:p.value,cost:1}));
  for(const n of [0,1,-1,2,10,100])out.push({expr:{type:'const',value:n},value:n,cost:3});
  return out;
}
function extractTemplate(input,output){
  if(!text(output)||output.length>600)return null;
  const fields=paths(input).filter(p=>typeof p.value==='string'&&p.value.length>=2).sort((a,b)=>b.value.length-a.value.length);
  if(!fields.length)return null;
  const parts=[],used=new Set();let pos=0;
  while(pos<output.length){
    const hit=fields.filter(f=>output.startsWith(f.value,pos)).sort((a,b)=>b.value.length-a.value.length)[0];
    if(hit){parts.push({path:hit.path});used.add(hit.path);pos+=hit.value.length;continue;}
    if(!parts.length||parts.at(-1).path)parts.push({literal:''});
    parts.at(-1).literal+=output[pos++];
  }
  return used.size?{type:'template',parts}:null;
}
function candidateOutputs(input,target,max=MAX_CANDIDATES){
  const field=leaves(input),results=[];
  const push=(expr,cost)=>{if(results.length<max)results.push({expr,cost});};
  for(const item of field)if(same(item.value,target))push(item.expr,item.cost);
  const unary=['length','lower','upper','trim','not','negate','abs'];
  for(const item of field)for(const name of unary){
    const expr={type:'unary',op:name,arg:item.expr};
    if(same(runInducedProgram(expr,input),target))push(expr,item.cost+2);
  }
  for(const a of field)for(const b of field){
    if(a===b)continue;
    for(const name of TYPES){
      const expr={type:'binary',op:name,left:a.expr,right:b.expr};
      if(same(runInducedProgram(expr,input),target))push(expr,a.cost+b.cost+2);
      if(results.length>=max)return results;
    }
  }
  // Depth-2 composition over three inputs, without running untrusted generated code.
  // Search is bounded and only materializes expressions matching the first example.
  if(results.length<max&&field.length<=12)
    for(const a of field)for(const b of field)for(const c of field){
      if(a===b||b===c)continue;
      for(const first of TYPES.slice(0,7)){
        const inner={type:'binary',op:first,left:a.expr,right:b.expr};
        const v=runInducedProgram(inner,input);
        if(v===undefined)continue;
        for(const second of TYPES.slice(0,9)){
          const expr={type:'binary',op:second,left:inner,right:c.expr};
          if(same(runInducedProgram(expr,input),target))push(expr,9);
          if(results.length>=max)return results;
        }
      }
    }
  return results;
}
export function induceProgram(examples,{minTrain=3,minHoldout=2}={}){
  if(!Array.isArray(examples)||examples.length<minTrain+minHoldout)return {ok:false,reason:'not enough independent examples'};
  const distinct=new Map();
  for(const e of examples.slice(0,256)){
    if(!e||!e.input||typeof e.input!=='object'||!e.output||typeof e.output!=='object'||Array.isArray(e.output))continue;
    if(JSON.stringify(e).length>4500)continue;
    const id=hash(e.input);
    if(distinct.has(id)&&!same(distinct.get(id).output,e.output))return {ok:false,reason:'contradictory verified examples'};
    distinct.set(id,e);
  }
  const all=[...distinct.values()].sort((a,b)=>hash(a.input).localeCompare(hash(b.input)));
  if(all.length<minTrain+minHoldout)return {ok:false,reason:'insufficient distinct inputs'};
  const heldout=all.filter((_,i)=>i%3===0);
  const train=all.filter((_,i)=>i%3!==0);
  if(train.length<minTrain||heldout.length<minHoldout)return {ok:false,reason:'insufficient independent holdout'};
  const fields=Object.keys(train[0].output);
  if(fields.length!==1||train.some(x=>Object.keys(x.output).join('|')!==fields.join('|')))return {ok:false,reason:'output schema is not consistent'};
  const key=fields[0],target=train[0].output[key];
  if(!supported(target))return {ok:false,reason:'output type not supported'};
  let candidates=candidateOutputs(train[0].input,target);
  if(typeof target==='string'){
    const template=extractTemplate(train[0].input,target);
    if(template)candidates.push({expr:template,cost:4});
  }
  candidates=candidates.filter(c=>train.every(e=>same(runInducedProgram(c.expr,e.input),e.output[key])));
  if(!candidates.length)return {ok:false,reason:'no compositional program fits training data',train:train.length,heldout:heldout.length};
  const winners=candidates.filter(c=>heldout.every(e=>same(runInducedProgram(c.expr,e.input),e.output[key])));
  if(!winners.length)return {ok:false,reason:'candidate failed blind holdout',train:train.length,heldout:heldout.length};
  // Preserve alternatives for future counterexamples; choose minimum-description-length candidate.
  const sorted=winners.sort((a,b)=>a.cost-b.cost||JSON.stringify(a.expr).length-JSON.stringify(b.expr).length);
  const expr=sorted[0].expr;
  return {ok:true,program:{kind:'induced',outputKey:key,expr},train:train.length,heldout:heldout.length,
    tested:all.length,alternatives:winners.length,signature:hash([fields,all.map(x=>hash(x.input))])};
}
export function evaluateInducedProgram(program,examples){
  if(program?.kind!=='induced'||!Array.isArray(examples))return {ok:false,reason:'invalid program'};
  let passed=0,failed=0;
  for(const e of examples.slice(0,256)){
    const got=runInducedProgram(program.expr,e.input);
    if(got===undefined||!same({[program.outputKey]:got},e.output))failed++;else passed++;
  }
  return {ok:failed===0&&passed>0,passed,failed,total:passed+failed};
}
