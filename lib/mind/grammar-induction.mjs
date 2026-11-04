// KENUXA evidence-scoped, corpus-induced English surface grammar.
// Every accepted example comes from licensed public usage, not private chat.
// The held-out partition never alters training counts, even on subsequent runs.
import { createHash } from 'node:crypto';
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
const POS={n:'NOUN',v:'VERB',a:'ADJ',s:'ADJ',r:'ADV'};
const TAGS=['NOUN','VERB','ADJ','ADV','PRON','DET','CONJ','ADP','AUX','NUM','X','$'];
const key=(a,b)=>a+'|'+b;
const hash=s=>createHash('sha256').update(s).digest('hex');

export class GrammarInduction {
  constructor({state={},catalog,maxTransitions=160,maxSentences=12000}={}){
    this.S=state;this.catalog=catalog;
    this.S.transitions ||= {};this.S.observed ||= 0;this.S.unknown ||= 0;
    this.S.examples ||= [];this.S.heldout ||= [];this.S.heldoutSeen ||= 0;
    this.S.seenTrain ||= {};this.S.seenHeldout ||= {};
    this.maxTransitions=Math.max(32,Math.min(500,maxTransitions));
    this.maxSentences=Math.max(100,Math.min(100000,maxSentences));
  }
  candidates(word){
    const w=String(word).toLowerCase();
    if(FUNCTION[w])return [FUNCTION[w]];
    if(/^\d+$/.test(w))return ['NUM'];
    const senses=this.catalog?.lookup(w,{limit:12})?.senses || [];
    const pos=[...new Set(senses.map(x=>POS[x.pos]).filter(Boolean))];
    if(pos.length)return pos;
    const m=this.morphology?.infer(w);
    if(m){const derived=this.catalog?.lookup(m.lemma,{limit:5})?.senses || [];
      const p=[...new Set(derived.map(s=>POS[s.pos]).filter(Boolean))];if(p.length)return p;}
    return this.S.observed>=30?['NOUN','VERB','ADJ','ADV']:['X'];
  }
  tags(text){
    const tokens=tokenize(text,'en').filter(x=>x.kind==='word'||x.kind==='number').slice(0,90);
    let paths=new Map([['^',{score:0,tags:[]}]]);
    const totals={};
    for(const [k,v] of Object.entries(this.S.transitions)){
      const from=k.split('|')[0];totals[from]=(totals[from]||0)+v;
    }
    for(const t of tokens){
      const next=new Map();
      for(const tag of this.candidates(t.norm))for(const [prev,p] of paths){
        const count=this.S.transitions[key(prev,tag)]||0;
        const score=p.score+Math.log((count+1)/(TAGS.length+1+(totals[prev]||0)));
        if(!next.has(tag)||next.get(tag).score<score)next.set(tag,{score,tags:[...p.tags,tag]});
      }
      paths=next;
    }
    const best=[...paths.values()].sort((a,b)=>b.score-a.score)[0];
    const unknown=tokens.filter(t=>!FUNCTION[t.norm]&&!(this.catalog?.lookup(t.norm,{limit:1})?.senses?.length)).length;
    return {tokens:tokens.map(x=>x.text),tags:best?.tags||[],score:best?.score??0,unknown};
  }
  observe(sentences,{limit=64}={}){
    let accepted=0,held=0;
    for(const raw of (Array.isArray(sentences)?sentences:[]).slice(0,Math.max(1,Math.min(256,limit)))){
      if(this.S.observed>=this.maxSentences)break;
      const text=String(raw||'').trim();
      if(text.length<12||text.length>400||privacyIssue(text))continue;
      const h=hash(text.toLowerCase());
      if(this.S.seenTrain[h]||this.S.seenHeldout[h])continue;
      // Stable and disjoint before tagging: no leakage from early observations.
      if(parseInt(h.slice(0,2),16)%7===0){
        this.S.seenHeldout[h]=true;this.S.heldoutSeen++;held++;
        if(this.S.heldout.length<256)this.S.heldout.push(text);
        continue;
      }
      const t=this.tags(text);
      if(t.tags.length<3||t.unknown>Math.ceil(t.tags.length/2))continue;
      let prev='^';
      for(const tag of [...t.tags,'$']){
        const k=key(prev,tag);
        if(Object.keys(this.S.transitions).length>=this.maxTransitions&&!Object.hasOwn(this.S.transitions,k))break;
        this.S.transitions[k]=(this.S.transitions[k]||0)+1;
        prev=tag;
      }
      this.S.seenTrain[h]=true;this.S.observed++;this.S.unknown+=t.unknown;accepted++;
      if(this.S.examples.length<32)this.S.examples.push(text);
    }
    // Prevent unbounded growth of hash sets in the shared node state.
    if(Object.keys(this.S.seenTrain).length>this.maxSentences)this.S.seenTrain=Object.fromEntries(Object.entries(this.S.seenTrain).slice(-this.maxSentences));
    if(Object.keys(this.S.seenHeldout).length>1024)this.S.seenHeldout=Object.fromEntries(Object.entries(this.S.seenHeldout).slice(-1024));
    return {accepted,held,observed:this.S.observed,transitions:Object.keys(this.S.transitions).length};
  }
  analyze(text){
    const tagged=this.tags(text);let prev='^',seen=0,matched=0;
    for(const tag of [...tagged.tags,'$']){
      seen++;if((this.S.transitions[key(prev,tag)]||0)>0)matched++;prev=tag;
    }
    return {tokens:tagged.tokens,tags:tagged.tags,unknown:tagged.unknown,
      observed:this.S.observed,transitionCoverage:seen?matched/seen:0,
      status:this.S.observed<30?'insufficient-grammar-evidence':'learned-usage-patterns',
      warning:'POS transition likelihood is not a grammar or factual-correctness verdict.'};
  }
  evaluateHeldout(){
    const cases=this.S.heldout||[];
    if(!cases.length)return {samples:0,transitionCoverage:null,meanSurprisal:null};
    const totals={};
    for(const [k,v] of Object.entries(this.S.transitions)){
      const from=k.split('|')[0];totals[from]=(totals[from]||0)+v;
    }
    let correct=0,total=0,surprisal=0;
    for(const example of cases){
      const tagged=this.tags(example);let prev='^';
      for(const tag of [...tagged.tags,'$']){
        const count=this.S.transitions[key(prev,tag)]||0;
        if(count>0)correct++;total++;
        surprisal-=Math.log((count+1)/(TAGS.length+1+(totals[prev]||0)));
        prev=tag;
      }
    }
    return {samples:cases.length,transitionCoverage:total?correct/total:0,meanSurprisal:total?surprisal/total:null};
  }
  status(){return {examples:this.S.observed,transitions:Object.keys(this.S.transitions).length,unknownTags:this.S.unknown,heldout:this.evaluateHeldout()};}
}
