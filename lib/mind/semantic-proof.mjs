// KENUXA semantic proof search over licensed WordNet atoms.
// Proofs are constructed by graph search on actual sense pointers, not pre-written
// answers or semantic word similarity. Absence of a proof is UNKNOWN (open world).
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').trim();
const inverseRel={ '@':'is-a','@i':'instance-of','#p':'part-of','#m':'member-of','#s':'substance-of','!':'antonym' };
const idFor=p=>'sense:wn30:'+(p.pos==='s'?'a':p.pos)+':'+p.offset;
const compatible=(a,b)=>a?.pos==='s'?'a':a?.pos;
export class SemanticProofSearch{
 constructor({catalog,maxDepth=9,maxVisited=250,maxSenses=18}={}){
  this.catalog=catalog;this.maxDepth=Math.min(14,Math.max(2,maxDepth));
  this.maxVisited=Math.min(1000,Math.max(20,maxVisited));
  this.maxSenses=Math.min(30,Math.max(1,maxSenses));
 }
 senses(word){return this.catalog?.lookup(norm(word),{limit:this.maxSenses})?.senses||[];}
 search(subject,object,{kinds=['@','@i'],depth=this.maxDepth}={}){
  const left=this.senses(subject),right=this.senses(object);
  if(!left.length||!right.length)return {proved:false,unknown:true,reason:'No dictionary sense for one or both terms',explored:0};
  const dest=new Set(right.map(s=>s.id));
  const queue=left.map(s=>({id:s.id,chain:[],start:s.id})),visited=new Set();
  while(queue.length&&visited.size<this.maxVisited){
   const current=queue.shift();
   if(visited.has(current.id))continue;visited.add(current.id);
   const sense=this.catalog.sense(current.id);
   if(!sense)continue;
   if(dest.has(current.id))return {proved:true,relation:'same-sense-or-ancestor',from:subject,to:object,
      subjectSense:current.start,objectSense:current.id,chain:current.chain,steps:current.chain.length,
      explored:visited.size,ambiguous:left.length>1||right.length>1,
      evidence:'WordNet 3.0 sense graph'};
   if(current.chain.length>=depth)continue;
   for(const p of sense.pointers||[]){
    if(!kinds.includes(p.symbol))continue;
    const next=idFor(p);
    if(visited.has(next))continue;
    const target=this.catalog.sense(next);
    if(!target)continue;
    queue.push({id:next,start:current.start,
      chain:[...current.chain,{relation:inverseRel[p.symbol]||p.symbol,
        from:sense.words?.[0]?.replaceAll('_',' ')||current.id,
        to:target.words?.[0]?.replaceAll('_',' ')||next,fromId:current.id,toId:next}]});
   }
  }
  return {proved:false,unknown:true,reason:'No relevant path found within bounded graph search; this is NOT evidence of falsehood',
    explored:visited.size,subjectSenses:left.length,objectSenses:right.length};
 }
 category(subject,category){return this.search(subject,category,{kinds:['@','@i']});}
 explain(subject,category){
  const proof=this.category(subject,category);
  if(!proof.proved)return null;
  const sequence=proof.chain.map(x=>x.from+' → '+x.to);
  return {answer:subject+' is a '+category+' in at least one WordNet sense.'+
    (sequence.length?' Dictionary relationship: '+sequence.join('; ')+'.':' The dictionary identifies matching senses.')+
    (proof.ambiguous?' This depends on the intended meanings of the words.':''),
    kind:'ontology-proof',basis:'Licensed WordNet synset hypernym graph',
    proof};
 }
 // Shared ancestors quantify relatedness without pretending the same word sense.
 commonAncestors(a,b,{depth=6}={}){
  const ascend=(word)=>{
   const seen=new Map(),queue=this.senses(word).map(s=>({id:s.id,steps:0}));
   while(queue.length&&seen.size<this.maxVisited){
    const x=queue.shift();if(seen.has(x.id))continue;seen.set(x.id,x.steps);
    if(x.steps>=depth)continue;
    const s=this.catalog.sense(x.id);
    for(const p of s?.pointers||[])if(p.symbol==='@'||p.symbol==='@i')queue.push({id:idFor(p),steps:x.steps+1});
   }
   return seen;
  };
  const A=ascend(a),B=ascend(b),common=[];
  for(const [id,da] of A)if(B.has(id)){
   const sense=this.catalog.sense(id);
   if(sense)common.push({id,label:sense.words?.[0]?.replaceAll('_',' '),distance:da+B.get(id)});
  }
  return common.sort((a,b)=>a.distance-b.distance).slice(0,8);
 }
}