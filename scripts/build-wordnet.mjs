// Reproducible importer for the OFFICIAL, locally downloaded WordNet 3.0 dict directory.
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const input=path.resolve(process.argv[2]||'data/bootstrap-source/WordNet-3.0');
const output=path.resolve(process.argv[3]||'foundation/wordnet-3.0');
const hash=x=>createHash('sha256').update(x).digest('hex');
const bucket=x=>hash(x).slice(0,2);
const lemmas=new Map(),synsets=new Map(),exceptions={},sourceHashes={};
const normalize=x=>x.replaceAll('_',' ').toLowerCase();
for(const pos of ['noun','verb','adj','adv']){
 const raw=fs.readFileSync(path.join(input,'dict','data.'+pos),'utf8');sourceHashes['data.'+pos]=hash(raw);
 for(const line of raw.split('\n')){
  if(!/^\d{8} /.test(line))continue;
  const bar=line.indexOf('|'),parts=line.slice(0,bar).trim().split(/\s+/);let at=0;
  const offset=parts[at++],lexFile=parts[at++],type=parts[at++],count=parseInt(parts[at++],16),words=[],lexIds=[];
  for(let i=0;i<count;i++){words.push(parts[at++]);lexIds.push(parts[at++]);}
  const pointerCount=Number(parts[at++]),pointers=[];
  for(let i=0;i<pointerCount;i++)pointers.push({symbol:parts[at++],offset:parts[at++],pos:parts[at++],wordIndices:parts[at++]});
  const gloss=line.slice(bar+1).trim(),id=`sense:wn30:${type==='s'?'a':type}:${offset}`;
  const examples=[...gloss.matchAll(/"([^\"]+)"/g)].map(m=>m[1]);
  const record={id,pos:type,lexFile,words,lexIds,definition:gloss.replace(/;?\s*"[^\"]+"/g,'').trim(),examples,pointers,frames:parts.slice(at),source:'princeton-wordnet-3.0',license:'WordNet-3.0'};
  synsets.set(id,record);
  for(const word of words){const lemma=normalize(word.replace(/\((?:a|p|ip)\)$/,''));if(!lemmas.has(lemma))lemmas.set(lemma,[]);if(!lemmas.get(lemma).includes(id))lemmas.get(lemma).push(id);}
 }
 const exc=fs.readFileSync(path.join(input,'dict',pos+'.exc'),'utf8');sourceHashes[pos+'.exc']=hash(exc);
 for(const line of exc.trim().split('\n')){const [form,...roots]=line.trim().split(/\s+/).map(normalize);exceptions[form]=[...new Set([...(exceptions[form]||[]),...roots])];}
}
fs.mkdirSync(output,{recursive:true});
const files={};
for(const [prefix,map]of [['lemmas',lemmas],['senses',synsets]]){
 const shards=new Map();for(const [key,value]of [...map].sort(([a],[b])=>a.localeCompare(b,'en'))){const b=bucket(key);if(!shards.has(b))shards.set(b,{});shards.get(b)[key]=value;}
 for(const [b,data]of shards){const name=`${prefix}-${b}.json.gz`,bytes=gzipSync(JSON.stringify(data),{level:9});fs.writeFileSync(path.join(output,name),bytes);files[name]={bytes:bytes.length,sha256:hash(bytes),records:Object.keys(data).length};}
}
const morphology=gzipSync(JSON.stringify(exceptions),{level:9});fs.writeFileSync(path.join(output,'morphology.json.gz'),morphology);files['morphology.json.gz']={bytes:morphology.length,sha256:hash(morphology),records:Object.keys(exceptions).length};
fs.copyFileSync(path.join(input,'LICENSE'),path.join(output,'LICENSE'));
const manifest={format:'kenuxa-foundation/1',dataset:'princeton-wordnet-3.0',version:'3.0',language:'en',license:'WordNet-3.0',source:'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz',sourceHashes,counts:{lemmas:lemmas.size,senses:synsets.size,morphology:Object.keys(exceptions).length},compressedBytes:Object.values(files).reduce((s,f)=>s+f.bytes,0),files};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({counts:manifest.counts,compressedBytes:manifest.compressedBytes}));
