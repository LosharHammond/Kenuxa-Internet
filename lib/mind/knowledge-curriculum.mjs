// KENUXA knowledge inventory and developmental curriculum.
// Inspect existing imported knowledge without copying millions of records into node state.
// Incremental sampling; preserves source provenance and never treats imports as verified user facts.
const count=x=>Array.isArray(x)?x.length:x&&typeof x==='object'?Object.keys(x).length:0;
export class KnowledgeCurriculum{
 constructor({state,catalog,registry,learning}){
  this.state=state;this.catalog=catalog;this.registry=registry;this.learning=learning;
  state.foundationCurriculum??={cursor:0,cycles:0,seen:0,known:0,unknown:0,history:[],lastRun:null};
 }
 inventory(){
  const s=this.state,c=this.catalog?.status();
  return {nodeState:{legacyAtoms:count(s.atoms),legacyMemory:count(s.memory),learningRecords:count(s.learning?.records),learningMethods:count(s.learning?.methods),mindProcedures:count(s.mind?.store?.procedures),mindDevelopmental:count(s.mind?.developmental),lexiconQueue:count(s.lexicon?.queue),lexiconPending:count(s.lexicon?.pending)},atomRegistry:{manifests:this.registry?.manifests?.size??0,revisions:this.registry?.revisions?.size??0},foundation:c?{dataset:c.dataset,counts:c.counts,compressedBytes:c.compressedBytes}:null,developmental:this.learning?.status()||null,curriculum:{...s.foundationCurriculum,history:undefined}};
 }
 // Read only small bounded samples per tick. No wholesale copying or mutation of curated atoms.
 tick({limit=20}={}){
  if(!this.catalog)return {ok:false,reason:'dictionary disabled'};
  const budget=Math.max(1,Math.min(50,Math.floor(Number(limit)||20))),c=this.state.foundationCurriculum;
  const imported=[...(this.state.lexicon?.queue||[]).filter(x=>typeof x==='string').slice(0,1000),
   ...(this.state.atoms||[]).map(x=>x?.title||x?.canonical||x?.word).filter(x=>typeof x==='string').slice(0,1000)];
  if(!imported.length)return {ok:true,processed:0,reason:'no imported lexical queue or legacy atom titles',inventory:this.inventory()};
  const start=c.cursor%imported.length,items=[];
  for(let i=0;i<Math.min(budget,imported.length);i++){
   const raw=imported[(start+i)%imported.length],word=raw.startsWith('lex:en:')?raw.slice(7):raw;
   if(word.length>100||!word.trim())continue;
   const r=this.catalog.lookup(word,{limit:3});
   const known=r.senses.length>0;
   c.seen++;if(known)c.known++;else c.unknown++;
   // A dictionary sense is a lexical candidate. It is NOT a verified fact about the world.
   items.push({word,known,senses:r.senses.map(x=>x.id).slice(0,3)});
  }
  c.cursor=(start+budget)%imported.length;c.cycles++;c.lastRun=new Date().toISOString();
  c.history.push({at:c.lastRun,processed:items.length,known:items.filter(x=>x.known).length});c.history=c.history.slice(-30);
  return {ok:true,processed:items.length,known:items.filter(x=>x.known).length,unknown:items.filter(x=>!x.known).length,nextCursor:c.cursor,source:'imported lexical queue + legacy atom titles',items};
 }
}
