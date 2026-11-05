// One conservative, data-driven relation memory shared by Mind and public chat.
// New nouns and relations are DATA. No generated code, no automatic truth promotion.
// Natural-language conversation premises are ephemeral, not global knowledge.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const valid=x=>typeof x==='string'&&x.trim().length>0&&x.length<=120;
const norm=x=>String(x).trim().replace(/\s+/g,' ').toLowerCase();
const clean=x=>norm(x).replace(/^(?:an?|the)\s+/,'');
const baseRelation=x=>norm(x).replace(/[\s_]+/g,'-');
const MAX_FACTS=2500,MAX_HOPS=12;
function parseStatements(input){
 const out=[];
 for(const part of String(input||'').split(/[.;\n]+/).slice(0,24)){
  const s=part.trim();
  let m=/^(?:all|every)\s+(.+?)\s+(?:are|is)\s+(?:an?\s+)?(.+)$/i.exec(s);
  if(m){out.push({subject:clean(m[1]),relation:'is-a',object:clean(m[2]),scope:'premise'});continue;}
  m=/^(?:an?\s+|the\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+)$/i.exec(s);
  if(m&&!/^(?:what|who|why|how|when|where|which)\b/i.test(s))
   out.push({subject:clean(m[1]),relation:'is-a',object:clean(m[2]),scope:'premise'});
 }
 return out.filter(x=>[x.subject,x.object].every(valid));
}
function questionOf(text,last=null){
 let q=String(text||'').trim().replace(/[?.!]+$/,'');
 let m=/^(?:is|are)\s+(?:an?\s+|the\s+)?(.+?)\s+(?:an?\s+)?(.+)$/i.exec(q);
 if(!m)return null;
 let subject=clean(m[1]),object=clean(m[2]);
 if(subject==='it'&&valid(last))subject=last;
 if(!valid(subject)||!valid(object)||subject===object)return null;
 return {subject,relation:'is-a',object};
}
export class RelationFabric {
 constructor({state={},maxFacts=MAX_FACTS}={}){
  this.S=state;this.S.facts||={};this.S.proposals||={};this.S.relations||={};
  this.maxFacts=Math.min(MAX_FACTS,Math.max(10,maxFacts));
 }
 relation(name,{transitive=false,symmetric=false,inverse=null,authorized=false}={}){
  if(!authorized||!valid(name)||!/^[-a-z0-9_ ]+$/i.test(name)||inverse!==null&&!valid(inverse))
   return {ok:false,reason:'authenticated owner definition required'};
  this.S.relations[baseRelation(name)]={transitive:!!transitive,symmetric:!!symmetric,inverse:inverse?baseRelation(inverse):null};
  return {ok:true,name:baseRelation(name)};
 }
 propose({subject,relation='is-a',object,source='observation',evidence=null}={}){
  if(![subject,relation,object].every(valid)||!['observation','measurement','owner','verified-test'].includes(source))
    return {ok:false,reason:'invalid or untrusted relation'};
  const fact={subject:clean(subject),relation:baseRelation(relation),object:clean(object)};
  if(Object.values(this.S.proposals).length>=this.maxFacts)return {ok:false,reason:'proposal capacity'};
  const id='relation:'+hash(fact);
  if(this.S.facts[id])return {ok:true,id,status:'approved',duplicate:true};
  this.S.proposals[id]||={...fact,id,status:'quarantined',source,evidence:evidence&&typeof evidence==='string'?evidence.slice(0,240):null};
  return {ok:true,id,status:this.S.proposals[id].status};
 }
 review(id,{authorized=false,approve=false,evidence=null}={}){
  if(!authorized)return {ok:false,reason:'owner authorization required'};
  const p=this.S.proposals[id];
  if(!p)return {ok:false,reason:'unknown proposal'};
  if(approve&&!valid(evidence))return {ok:false,reason:'review evidence required'};
  if(approve&&Object.keys(this.S.facts).length>=this.maxFacts)return {ok:false,reason:'approved memory full'};
  p.status=approve?'approved':'rejected';
  p.reviewedAt=new Date().toISOString();
  if(approve)this.S.facts[id]={...p,evidence:evidence.slice(0,240)};
  else delete this.S.facts[id];
  return {ok:true,id,status:p.status};
 }
 infer({subject,relation='is-a',object,extra=[],maxHops=MAX_HOPS}={}){
  if(![subject,relation,object].every(valid))return {ok:false,reason:'invalid query'};
  const start=clean(subject),target=clean(object),rel=baseRelation(relation);
  const rule=rel==='is-a'?{transitive:true}:this.S.relations[rel]||{};
  const facts=Object.values(this.S.facts).filter(x=>x.status==='approved');
  const premises=(Array.isArray(extra)?extra:[]).slice(0,40).filter(x=>x&&[x.subject,x.relation,x.object].every(valid)).map(x=>({
   subject:clean(x.subject),relation:baseRelation(x.relation),object:clean(x.object),
   scope:'premise'
  }));
  const all=facts.concat(premises);
  const edges=new Map();
  const add=(from,to,proof)=>{const k=from+'|'+rel;const list=edges.get(k)||[];list.push({to,proof});edges.set(k,list);};
  for(const f of all){
   const from=clean(f.subject),to=clean(f.object),type=baseRelation(f.relation);
   if(type===rel){
    add(from,to,{subject:from,relation:rel,object:to,source:f.scope==='premise'?'conversation':f.id});
    if(rule.symmetric)add(to,from,{subject:to,relation:rel,object:from,source:f.scope==='premise'?'conversation':f.id});
   }
   if(this.S.relations[type]?.inverse===rel)add(to,from,{subject:to,relation:rel,object:from,source:f.scope==='premise'?'conversation':f.id});
  }
  const queue=[{at:start,proof:[]}],seen=new Set([start]),limit=Math.max(1,Math.min(MAX_HOPS,Number(maxHops)||MAX_HOPS));
  for(let i=0;i<queue.length&&i<500;i++){
   const current=queue[i];
   if(current.proof.length>=limit)continue;
   for(const e of edges.get(current.at+'|'+rel)||[]){
    const proof=current.proof.concat(e.proof);
    if(e.to===target)return {ok:true,verified:proof.every(p=>p.source!=='conversation'),proof,hops:proof.length,
      answer:subject+' is '+(rel==='is-a'?'a ':'related by '+rel+' to ')+object+'.'};
    if(rule.transitive&&!seen.has(e.to)){seen.add(e.to);queue.push({at:e.to,proof});}
   }
  }
  return {ok:false,reason:'not established by available evidence',searched:seen.size};
 }
 answerNatural(question,{history=[]}={}){
  if(typeof question!=='string'||question.length>1000)return null;
  const messages=Array.isArray(history)?history.slice(0,12):[];
  let context=[],last=null;
  for(const h of messages.slice().reverse()){
   const utterance=typeof h==='string'?h:h?.question;
   if(typeof utterance!=='string')continue;
   context.push(...parseStatements(utterance));
   const prior=questionOf(utterance,last);
   if(prior)last=prior.subject;
  }
  // The current prompt may contain multiple declarative premises followed by a query.
  const clauses=question.split(/[.!?\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,24);
  context.push(...parseStatements(clauses.slice(0,-1).join('. ')));
  const lastQuestion=clauses.at(-1)||'';
  const query=questionOf(lastQuestion,last);
  if(!query)return null;
  const result=this.infer({...query,extra:context});
  // Unknown is not false; pass control to other cognition adapters.
  if(!result.ok)return null;
  return {...result,kind:'relation-proof',route:'relation-fabric',
    confidence:result.verified?90:75};
 }
 status(){return {approved:Object.keys(this.S.facts).length,quarantined:Object.values(this.S.proposals).filter(x=>x.status==='quarantined').length,
  rejected:Object.values(this.S.proposals).filter(x=>x.status==='rejected').length,
  relations:Object.keys(this.S.relations).length};}
}
