// Learns reusable morphological transformations from the *actual* WordNet exception
// mappings. Training and hold-out tokens are disjoint. Promoted transforms need
// minimum support and high measured precision, and are never taken as world facts.
import { createHash } from 'node:crypto';
const bucket=s=>createHash('sha256').update(s).digest()[0];
const fit=(surface,lemma)=>{
 let n=0;while(n<surface.length&&n<lemma.length&&surface[n]===lemma[n])n++;
 const from=surface.slice(n),to=lemma.slice(n);
 return n>=2&&from.length>0&&from.length<=8&&to.length<=8?{from,to}:null;
};
export class MorphologyLearner{
 constructor({state={},catalog,minSupport=3,minAccuracy=0.8}={}){
  this.S=state;this.catalog=catalog;this.minSupport=minSupport;this.minAccuracy=minAccuracy;
  this.S.rules ||= [];this.S.trained ||= 0;this.S.heldOut ||= 0;this.S.lastFit ||= null;
 }
 train(){
  if(!this.catalog)return {ok:false,reason:'no licensed source'};
  const exceptions=this.catalog.shard('morphology.json.gz');
  const candidates=new Map(),training=[],held=[];
  for(const [surface,roots] of Object.entries(exceptions)){
    const dest=bucket(surface)<48?held:training;
    for(const root of Array.isArray(roots)?roots:[]) {
      const f=fit(surface,root);if(!f)continue;
      dest.push({surface,root,...f});
    }
  }
  for(const x of training){
    const id=x.from+'->'+x.to;
    if(!candidates.has(id))candidates.set(id,{from:x.from,to:x.to,support:0,success:0,attempts:0});
    candidates.get(id).support++;
  }
  const candidateList=[...candidates.values()].filter(x=>x.support>=this.minSupport);
  const snapshot=held.map(({surface,root})=>({surface,root}));
  for(const rule of candidateList)for(const e of snapshot){
    if(!e.surface.endsWith(rule.from))continue;
    rule.attempts++;
    if(e.surface.slice(0,-rule.from.length)+rule.to===e.root)rule.success++;
  }
  const rules=candidateList.map(r=>({
    ...r,accuracy:r.attempts?r.success/r.attempts:0,
    status:r.attempts>=2&&r.success/r.attempts>=this.minAccuracy?'validated':'unverified',
    evidence:'wordnet-3.0 exception mappings; independent form-level hold-out'
  })).sort((a,b)=>b.from.length-a.from.length||b.accuracy-a.accuracy||b.support-a.support).slice(0,128);
  this.S.rules=rules;this.S.trained=training.length;this.S.heldOut=held.length;
  this.S.lastFit=new Date().toISOString();
  return {ok:true,...this.status()};
 }
 infer(surface){
  const w=String(surface||'').toLowerCase();
  if(!/^[a-z]{3,60}$/.test(w))return null;
  const options=[];
  for(const r of this.S.rules){
    if(r.status!=='validated'||!w.endsWith(r.from)||w.length<=r.from.length)continue;
    const lemma=w.slice(0,-r.from.length)+r.to;
    if(!this.catalog?.lookup(lemma,{limit:1}).senses.length)continue;
    options.push({lemma,confidence:r.accuracy,rule:{from:r.from,to:r.to},support:r.support,verification:'held-out WordNet morphology'});
  }
  return options.sort((a,b)=>b.confidence-a.confidence||b.support-a.support)[0]||null;
 }
 status(){return {trained:this.S.trained,heldOut:this.S.heldOut,
  proposed:this.S.rules.length,validated:this.S.rules.filter(r=>r.status==='validated').length,lastFit:this.S.lastFit};}
}