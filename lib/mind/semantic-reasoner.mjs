// Evidence-preserving semantic reasoning over imported, content-addressed WordNet atoms.
// General graph traversal: no manually coded facts about specific animals or objects.
// Derivations never promote dictionary relationships into unrestricted world knowledge.
const lemma=s=>String(s||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
const words=s=>(s?.words||[]).map(w=>lemma(w.replaceAll('_',' ')));
const POS={n:'noun',v:'verb',a:'adjective',s:'adjective',r:'adverb'};
export class SemanticReasoner {
 constructor({catalog,maxExpanded=256,maxDepth=9}={}) {this.catalog=catalog;this.maxExpanded=Math.min(1024,Math.max(16,maxExpanded));this.maxDepth=Math.min(15,Math.max(1,maxDepth));}
 senses(term,{partOfSpeech='n',limit=24}={}) {
   if(!this.catalog)return [];
   const r=this.catalog.lookup(lemma(term),{limit:Math.max(1,limit)});
   return r.senses.filter(s=>!partOfSpeech||s.pos===partOfSpeech);
 }
 proveIsA(subject,category,{maxDepth=this.maxDepth}={}) {
   const a=lemma(subject),b=lemma(category);
   if(!a||!b||a.length>120||b.length>120)return {status:'unknown',reason:'invalid terms'};
   const starts=this.senses(a),targets=this.senses(b);
   if(!starts.length||!targets.length)return {status:'unknown',reason:'no matching dictionary noun senses',source:'WordNet'};
   const targetIds=new Set(targets.map(x=>x.id));
   const queue=starts.map(s=>({id:s.id,path:[s.id]}));
   const visited=new Set();let expanded=0;
   while(queue.length&&expanded<this.maxExpanded){
     const {id,path}=queue.shift();
     if(visited.has(id))continue;visited.add(id);expanded++;
     if(targetIds.has(id)){
       const proof=path.map(sid=>this.catalog.sense(sid)).filter(Boolean).map(x=>({id:x.id,term:words(x)[0]||'',partOfSpeech:POS[x.pos]||x.pos,definition:x.definition}));
       return {status:'supported',subject:a,category:b,proof,depth:path.length-1,sensesConsidered:starts.length,expanded,source:'Princeton WordNet 3.0',limitations:'Lexical taxonomic inference only; context may select a different word sense.'};
     }
     if(path.length>maxDepth)continue;
     const current=this.catalog.sense(id);if(!current)continue;
     for(const p of current.pointers||[]){
       if(!['@','@i'].includes(p.symbol))continue;
       const next='sense:wn30:'+(p.pos==='s'?'a':p.pos)+':'+p.offset;
       if(!visited.has(next))queue.push({id:next,path:[...path,next]});
     }
   }
   return {status:'unknown',reason:expanded>=this.maxExpanded?'search limit reached':'no supporting path in dictionary taxonomy',expanded,sensesConsidered:starts.length,source:'Princeton WordNet 3.0',limitations:'Absence of a WordNet path does not prove that a claim is false.'};
 }
 answer(question){
   const q=String(question||'').trim();
   const match=q.match(/^is\s+(?:a|an|the)?\s*([\p{L}][\p{L}-]*(?:\s+[\p{L}-]+){0,2})\s+(?:a|an|the|a kind of|a type of)\s+([\p{L}][\p{L}-]*(?:\s+[\p{L}-]+){0,2})\??$/iu);
   if(!match)return null;
   const finding=this.proveIsA(match[1],match[2]);
   if(finding.status!=='supported')return null;
   const chain=finding.proof.map(x=>x.term).join(' → ');
   return {answer:'Yes, in at least one attested dictionary sense, '+finding.subject+' is a kind of '+finding.category+'. WordNet classification path: '+chain+'. Because words may have multiple senses, this conclusion depends on the sense intended.',kind:'semantic-deduction',basis:'WordNet hypernym graph',proof:finding.proof,confidence:0.8};
 }
}
