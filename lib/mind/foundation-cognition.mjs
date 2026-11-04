// KENUXA foundation-to-cognition bridge.
// Uses licensed WordNet sense atoms on demand, without loading the entire corpus into RAM.
// Dictionary attestation is lexical evidence, not proof of arbitrary world facts.
import {inflect} from '../atoms/registry.mjs';
const tokenize=text=>String(text||'').normalize('NFKC').match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu)||[];
const stop=new Set('a an the is are was were be been being am i you he she it we they my your his her their our of to in on at for with by from and or but if then that this these those do does did have has had can could would should will shall may might not no yes what which who whom whose why how where when'.split(' '));
const sentence=s=>s?s[0].toUpperCase()+s.slice(1):s;
function entries(catalog,word,limit=5){
 const found=catalog.lookup(word,{limit});
 return found.senses.slice(0,limit).map(s=>({
  id:s.id,lemma:s.words?.[0]?.replaceAll('_',' ')||word,
  words:(s.words||[]).map(w=>w.replaceAll('_',' ')),
  pos:({n:'noun',v:'verb',a:'adjective',s:'adjective',r:'adverb'})[s.pos]||s.pos,
  definition:s.definition,examples:(s.examples||[]).slice(0,2),
  hypernyms:(s.pointers||[]).filter(p=>p.symbol==='@').slice(0,5).map(p=>catalog.sense('sense:wn30:'+(p.pos==='s'?'a':p.pos)+':'+p.offset)?.words?.[0]?.replaceAll('_',' ')).filter(Boolean)
 }));
}
export class FoundationCognition{
 constructor({catalog,registry,maxTokens=64,maxSenses=5}={}){
  this.catalog=catalog;this.registry=registry;this.maxTokens=maxTokens;this.maxSenses=maxSenses;
 }
 analyze(text,{hydrate=false}={}){
  if(!this.catalog)return {available:false,tokens:[],concepts:[],unknown:[]};
  const tokens=tokenize(text).slice(0,this.maxTokens),concepts=[],unknown=[],seen=new Set();
  for(const token of tokens){
   const word=token.toLowerCase();if(stop.has(word)||seen.has(word))continue;seen.add(word);
   const senses=entries(this.catalog,word,this.maxSenses);
   if(!senses.length){unknown.push(word);continue;}
   if(hydrate&&this.registry)this.catalog.hydrate(this.registry,word);
   concepts.push({word,atomId:'lex:en:'+word,senses,ambiguous:senses.length>1});
  }
  return {available:true,tokens,concepts,unknown,coverage:seen.size?(seen.size-unknown.length)/seen.size:1,source:this.catalog.manifest.dataset};
 }
 explain(word){
  const analysis=this.analyze(word);const c=analysis.concepts.find(x=>x.word===String(word).trim().toLowerCase());
  if(!c)return null;
  const primary=c.senses[0],alternatives=c.senses.slice(1).map(x=>({pos:x.pos,definition:x.definition}));
  return {word:c.word,partOfSpeech:primary.pos,definition:primary.definition,examples:primary.examples,synonyms:primary.words.filter(x=>x!==c.word),hypernyms:primary.hypernyms,alternatives,ambiguous:c.ambiguous,provenance:'licensed dictionary',epistemic:'dictionary-attested, context-dependent'};
 }
 relate(a,b){
  const A=this.analyze(a).concepts.find(x=>x.word===a.toLowerCase());
  const B=this.analyze(b).concepts.find(x=>x.word===b.toLowerCase());
  if(!A||!B)return {related:false,reason:'missing dictionary evidence'};
  const pairs=[];
  for(const x of A.senses)for(const y of B.senses){
   if(x.id===y.id)pairs.push({relation:'same-sense',from:x.id,to:y.id});
   else if(x.hypernyms.includes(y.lemma))pairs.push({relation:'is-a',from:x.id,to:y.id});
   else if(y.hypernyms.includes(x.lemma))pairs.push({relation:'has-subtype',from:x.id,to:y.id});
   else if(x.words.includes(y.lemma))pairs.push({relation:'synonym',from:x.id,to:y.id});
  }
  return {related:pairs.length>0,relationships:pairs.slice(0,12),source:'WordNet sense graph',uncertainty:'Relationships depend on selecting the correct senses'};
 }
 // Grammar realization is compositional; arbitrary nouns/verbs can be supplied.
 // This is a grammatical baseline, not proof of semantic truth.
 construct({subject,verb,object=null,tense='present',negative=false,question=false}={}){
  if(!subject||!verb||!['present','past','future'].includes(tense))return null;
  const s=String(subject).trim().slice(0,100),v=String(verb).trim().toLowerCase().slice(0,60),o=object?String(object).trim().slice(0,120):'';
  if(!/^[\p{L}][\p{L} '-]*$/u.test(s)||!/^[\p{L}]+$/u.test(v))return null;
  const singular=/^(he|she|it|[\p{Lu}][\p{L}]+)$/u.test(s)&&!['I','You','We','They'].includes(s);
  const forms=inflect(v),aux=tense==='past'?'did':singular?'does':'do';
  let predicate;
  if(question)predicate=tense==='future'?'Will '+s+' '+v:sentence(aux)+' '+s+' '+v;
  else if(negative)predicate=tense==='future'?s+' will not '+v:s+' '+aux+' not '+v;
  else predicate=tense==='future'?s+' will '+v:tense==='past'?s+' '+forms.past:s+' '+(singular?forms.thirdSingular:v);
  return {sentence:sentence(predicate+(o?' '+o:'')+(question?'?':'.')),structure:{subject:s,verb:v,object:o,tense,negative,question},status:'syntactically constructed; meaning and truth unverified'};
 }
 answer(question){
  const q=String(question||'').trim();
  const def=q.match(/^(?:what (?:does|is the meaning of)|define|meaning of)\s+['"]?([\p{L}-]+)['"]?\??$/iu);
  if(def){const d=this.explain(def[1]);if(!d)return null;return {answer:sentence(d.word)+' ('+d.partOfSpeech+'): '+d.definition+(d.ambiguous?' This word has other dictionary senses.':''),kind:'dictionary',basis:d.provenance,detail:d};}
  const rel=q.match(/^is\s+([\p{L}-]+)\s+(?:a|an|a kind of|a type of)\s+([\p{L}-]+)\??$/iu);
  if(rel){const r=this.relate(rel[1].toLowerCase(),rel[2].toLowerCase());if(!r.related)return null;return {answer:'The dictionary contains a '+r.relationships[0].relation+' relationship between senses of '+rel[1]+' and '+rel[2]+'. The intended senses still depend on context.',kind:'dictionary-relation',basis:r.source,detail:r};}
  return null;
 }
}
