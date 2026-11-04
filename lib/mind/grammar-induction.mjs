// Corpus-induced English surface grammar. Learns POS transition probabilities from
// licensed dictionary usage examples. This is a statistical grammar component,
// not a claim that bigram statistics alone provide fluent general comprehension.
import { tokenize } from '../atoms/language.mjs';
import { privacyIssue } from '../transformer/pipeline.mjs';
const FUNCTION = Object.freeze({
  the:'DET',a:'DET',an:'DET',this:'DET',that:'DET',these:'DET',those:'DET',
  i:'PRON',you:'PRON',he:'PRON',she:'PRON',it:'PRON',we:'PRON',they:'PRON',
  my:'DET',your:'DET',his:'DET',her:'DET',its:'DET',our:'DET',their:'DET',
  and:'CONJ',or:'CONJ',but:'CONJ',because:'CONJ',if:'CONJ',
  in:'ADP',on:'ADP',at:'ADP',of:'ADP',to:'ADP',for:'ADP',with:'ADP',
  is:'AUX',am:'AUX',are:'AUX',was:'AUX',were:'AUX',be:'AUX',been:'AUX',
  can:'AUX',could:'AUX',will:'AUX',would:'AUX',should:'AUX',
  do:'AUX',does:'AUX',did:'AUX',have:'AUX',has:'AUX',had:'AUX',
  not:'ADV',very:'ADV',more:'ADV',most:'ADV'
});
const POS = Object.freeze({n:'NOUN',v:'VERB',a:'ADJ',s:'ADJ',r:'ADV'});
const allowed = new Set(['NOUN','VERB','ADJ','ADV','PRON','DET','CONJ','ADP','AUX','NUM','X']);
const key = (a,b) => a + '|' + b;
export class GrammarInduction {
 constructor({ state = {}, catalog, maxTransitions = 160, maxSentences = 12000 } = {}) {
   this.S=state; this.catalog=catalog;
   this.S.transitions ||= {};this.S.starts ||= {};this.S.observed ||= 0;this.S.unknown ||= 0;
   this.S.examples ||= [];this.maxTransitions=Math.max(32,Math.min(500,maxTransitions));
   this.maxSentences=Math.max(100,Math.min(100000,maxSentences));
 }
 candidates(word) {
   const lower=String(word).toLowerCase();
   if(FUNCTION[lower])return [FUNCTION[lower]];
   if(/^\d+$/.test(lower))return ['NUM'];
   const senses=this.catalog?.lookup(lower,{limit:12})?.senses || [];
   const out=[...new Set(senses.map(x=>POS[x.pos]).filter(Boolean))];
   return out.length?out:(this.S.observed>=30?['NOUN','VERB','ADJ','ADV']:['X']);
 }
 tags(text) {
   const tokens=tokenize(text,'en').filter(x=>x.kind==='word'||x.kind==='number').slice(0,90);
   // Greedy Viterbi over small POS lattice from dictionary senses and empirical grammar.
   const lattice=tokens.map(t=>this.candidates(t.norm));
   let paths=new Map([['^',{score:0,tags:[]}]]);
   for(const options of lattice) {
     const next=new Map();
     for(const tag of options)for(const [prev,p] of paths){
       const total=(this.S.transitions[key(prev,tag)]||0),denom=1+allowed.size+
         Object.entries(this.S.transitions).reduce((n,[k,v])=>n+(k.startsWith(prev+'|')?v:0),0);
       const score=p.score+Math.log((total+1)/denom);
       const old=next.get(tag);
       if(!old||old.score<score)next.set(tag,{score,tags:[...p.tags,tag]});
     }
     paths=next;
   }
   const best=[...paths.values()].sort((a,b)=>b.score-a.score)[0];
   const unknown=tokens.filter(t=>!FUNCTION[t.norm]&&!(this.catalog?.lookup(t.norm,{limit:1})?.senses?.length)).length;
   return {tokens:tokens.map(x=>x.text),tags:best?.tags||[],score:best?.score??0,unknown};
 }
 observe(sentences,{limit=64}={}) {
   const accepted=[];
   for(const raw of (Array.isArray(sentences)?sentences:[]).slice(0,Math.max(1,Math.min(256,limit)))) {
     if(this.S.observed>=this.maxSentences)break;
     const text=String(raw||'').trim();
     if(text.length<12||text.length>400||privacyIssue(text))continue;
     const t=this.tags(text);
     if(t.tags.length<3||t.unknown>Math.ceil(t.tags.length/2))continue;
     let prev='^';for(const tag of [...t.tags,'$']){
       const k=key(prev,tag);
       if(Object.keys(this.S.transitions).length>=this.maxTransitions&&!Object.hasOwn(this.S.transitions,k))break;
       this.S.transitions[k]=(this.S.transitions[k]||0)+1;prev=tag;
     }
     this.S.observed++;this.S.unknown+=t.unknown;
     // Evidence samples are limited; no raw personal conversations are ingested here.
     if(this.S.examples.length<32)this.S.examples.push(text);
     accepted.push(t.tags);
   }
   return {accepted:accepted.length,observed:this.S.observed,transitions:Object.keys(this.S.transitions).length};
 }
 analyze(text) {
   const tagged=this.tags(text),s=tagged.tags;
   let plausible=0,seen=0;let prev='^';
   for(const tag of [...s,'$']){
     seen++;if((this.S.transitions[key(prev,tag)]||0)>0)plausible++;
     prev=tag;
   }
   return {tokens:tagged.tokens,tags:s,unknown:tagged.unknown,
     observed:this.S.observed,transitionCoverage:seen?plausible/seen:0,
     status:this.S.observed<30?'insufficient-grammar-evidence':'learned-usage-patterns',
     warning:'Transition likelihood is not a grammar or factual-correctness verdict.'};
 }
 status(){return {examples:this.S.observed,transitions:Object.keys(this.S.transitions).length,unknownTags:this.S.unknown};}
}