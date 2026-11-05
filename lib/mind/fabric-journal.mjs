// Durable, content-addressed control plane for the Cognitive Fabric.
// Stored under the existing node state (Supabase or file); never stores raw user chat.
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const ident=x=>typeof x==='string'&&/^[a-zA-Z0-9:._/-]{3,150}$/.test(x);
const bound=(n,max)=>typeof n==='string'?n.slice(0,max):'';
export class FabricJournal {
 constructor({state={},now=()=>Date.now()}={}){
  this.now=now;this.S=state.cognitiveFabric??={schemaVersion:1,seq:0,anchor:'GENESIS',head:'GENESIS',events:[],dependencies:{},dirty:{},failures:[],repairs:{},snapshots:[],stats:{processed:0,recovered:0}};
  const s=this.S;s.events??=[];s.dependencies??={};s.artifactSources??={};s.dirty??={};s.failures??=[];s.repairs??={};s.snapshots??=[];s.stats??={processed:0,recovered:0};
  s.seq??=s.events.at(-1)?.seq||0;s.anchor??='GENESIS';s.head??=s.events.at(-1)?.hash||s.anchor;
 }
 // Replace the source set atomically when the molecule/cell changes.
 // Without this, obsolete edges remain and old atoms invalidate unrelated work.
 depend(artifact,sources,{kind='materialized'}={}){
  if(!ident(artifact)||!Array.isArray(sources)||sources.length>80||
     sources.some(x=>!ident(x)))return {ok:false,reason:'invalid dependency'};
  const s=this.S,valid=[...new Set(sources)],previous=s.artifactSources[artifact]||
    Object.entries(s.dependencies).filter(([,items])=>items.some(x=>x.artifact===artifact)).map(([id])=>id);
  for(const source of valid){
   const existing=s.dependencies[source]||[];
   if(!existing.some(x=>x.artifact===artifact)&&existing.length>=120)
    return {ok:false,reason:'dependency fanout capacity exceeded'};
  }
  for(const source of previous)if(!valid.includes(source)){
   s.dependencies[source]=(s.dependencies[source]||[]).filter(x=>x.artifact!==artifact);
   if(!s.dependencies[source].length)delete s.dependencies[source];
  }
  for(const source of valid){
   const next=(s.dependencies[source]||[]).filter(x=>x.artifact!==artifact);
   next.push({artifact,kind:bound(kind,32)});
   s.dependencies[source]=next;
  }
  s.artifactSources[artifact]=valid;
  return {ok:true,registered:valid.length,replaced:previous.length};
 }
 verifiedChange({id,kind='atom',revision=1,source='owner-reviewed',proof=''}={}, {authorized=false}={}){
  if(!authorized||!ident(id)||!ident(kind)||typeof proof!=='string'||proof.length<8||!Number.isInteger(revision)||revision<1)
   return {ok:false,reason:'authenticated and evidenced verified change required'};
  const s=this.S;
  const event={seq:s.seq+1,at:new Date(this.now()).toISOString(),id,kind,revision,source:bound(source,60),
   proofHash:digest(proof),previous:s.head};
  event.hash=digest(event);
  s.events.push(event);s.seq=event.seq;s.head=event.hash;
  while(s.events.length>300){const discarded=s.events.shift();s.anchor=discarded.hash;}
  // A newly verified atom can invalidate a molecule, its parent cell, and
  // a dependent skill/index. Traverse the dependency graph, never just one hop.
  const seen=new Set([id]),pending=[id];let affected=0,truncated=false;
  while(pending.length){
   const parent=pending.shift();
   for(const entry of s.dependencies[parent]||[]){
    if(seen.has(entry.artifact))continue;
    if(seen.size>=4000){truncated=true;break;}
    seen.add(entry.artifact);
    s.dirty[entry.artifact]={source:id,via:parent,seq:event.seq,kind:entry.kind,
      status:'pending',failures:0,retryAt:0};
    pending.push(entry.artifact);affected++;
   }
   if(truncated)break;
  }
  if(truncated)this.noteFailure(id,{component:'dependency-graph',kind:'infrastructure',
    details:'invalidation fanout exceeded safety budget'});
  return {ok:true,event:{seq:event.seq,hash:event.hash,id,revision},invalidated:affected,truncated};
 }
 verifyChain(){
  const s=this.S;
  let prev=s.anchor,seq=s.events.length?s.events[0].seq-1:s.seq;
  for(const e of s.events){
   if(e.previous!==prev||e.seq!==++seq||digest(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='hash')))!==e.hash)
    return {ok:false,reason:'chain tampering or gap',seq:e.seq};
   prev=e.hash;
  }
  return {ok:prev===s.head&&seq===s.seq,head:prev,events:s.events.length};
 }
 noteFailure(question,{component='kernel',kind='reasoning-error',details=''}={}){
  const allowed=new Set(['missing-knowledge','misunderstanding','reasoning-error','invalid-procedure','infrastructure','conflict']);
  const id='gap:'+digest([question,component,kind]).slice(0,24);
  const s=this.S,found=s.failures.find(x=>x.id===id);
  if(found){found.count++;found.lastAt=new Date(this.now()).toISOString();return {id,duplicate:true};}
  s.failures.push({id,kind:allowed.has(kind)?kind:'reasoning-error',component:bound(component,40),
   diagnostic:bound(details,80).replace(/https?:\/\/\S+/g,'[url]'),
   at:new Date(this.now()).toISOString(),count:1,status:'unresolved'});
  if(s.failures.length>250)s.failures.shift();
  return {id,recorded:true};
 }
 stageRepair({failureId,kind='relation',candidateRef='',evidenceRef=''}={}, {authorized=false}={}){
  if(!authorized||!this.S.failures.some(f=>f.id===failureId)||!ident(candidateRef)||!ident(kind))
   return {ok:false,reason:'owner-authorized correction must reference an existing failure and bounded candidate'};
  const id='repair:'+digest([failureId,kind,candidateRef]).slice(0,24);
  this.S.repairs[id]??={id,failureId,kind,candidateRef,evidenceHash:digest(evidenceRef),status:'quarantined',tests:[]};
  return {ok:true,id,status:this.S.repairs[id].status};
 }
 evaluateRepair(id,trials,{authorized=false}={}){
  const r=this.S.repairs[id];
  if(!authorized||!r)return {ok:false,reason:'authenticated repair review required'};
  if(!Array.isArray(trials)||trials.length<2||trials.length>30||
    trials.some(t=>!ident(t?.testId)||t.source!=='verified-test'||typeof t.passed!=='boolean')||
    new Set(trials.map(t=>t.testId)).size!==trials.length)
    return {ok:false,reason:'two or more distinct independently verified tests required'};
  r.tests=trials.map(t=>({testHash:digest(t.testId),passed:t.passed}));
  r.status=trials.every(t=>t.passed)?'tested':'rejected';
  // A passing evaluation is NOT approval; owner must promote the actual
  // cognitive atom through its existing trusted review gate.
  return {ok:true,status:r.status,pass:r.tests.filter(t=>t.passed).length,total:trials.length};
 }
 async drain({limit=4,rebuild=null}={}){
  let processed=0,failed=0;
  const eligible=Object.entries(this.S.dirty)
   .filter(([,item])=>item.status==='pending'&&(item.retryAt||0)<=this.now())
   .sort((a,b)=>(a[1].seq||0)-(b[1].seq||0));
  for(const [id,item] of eligible.slice(0,Math.min(16,Math.max(1,limit)))){
   if(typeof rebuild!=='function')break;
   try{
    const outcome=await rebuild({artifact:id,...item});
    if(outcome?.ok===false)throw Error('rebuild verification failed');
    // A newer event may have invalidated the same artifact while we worked.
    // Never acknowledge that newer revision using an older rebuild.
    if(this.S.dirty[id]!==item)continue;
    delete this.S.dirty[id];processed++;this.S.stats.processed++;
   }catch{
    if(this.S.dirty[id]!==item)continue;
    item.failures=Math.min(10,(item.failures||0)+1);
    item.retryAt=this.now()+Math.min(120000,1000*2**(item.failures-1));
    failed++;
   }
  }
  return {processed,failed,pending:Object.values(this.S.dirty).filter(x=>x.status==='pending').length};
 }
 // Immutable, independently hashed storage snapshots. Restore is a separate,
 // explicit owner decision; never overwrite live knowledge on an unverified blob.
 async snapshot({blobs,material={},nodeId='node'}={}){
  if(!blobs?.write||!ident(nodeId))return {ok:false,reason:'durable blob storage required'};
  if(!this.verifyChain().ok)return {ok:false,reason:'journal integrity verification failed'};
  const exported={schemaVersion:1,nodeId,at:new Date(this.now()).toISOString(),
   seq:this.S.seq,anchor:this.S.anchor,head:this.S.head,
   events:this.S.events,knowledge:material};
  const raw=JSON.stringify(exported);
  if(Buffer.byteLength(raw)>2500000)return {ok:false,reason:'snapshot too large'};
  const sha=digest(raw),name='cognitive-fabric-'+sha.slice(0,20)+'.json';
  await blobs.write(name,Buffer.from(JSON.stringify({sha,exported})));
  this.S.snapshots.push({name,sha,seq:this.S.seq,at:exported.at});
  this.S.snapshots=this.S.snapshots.slice(-12);
  return {ok:true,name,sha,seq:this.S.seq};
 }
 async inspectSnapshot({blobs,name}={}){
  if(!blobs?.read||typeof name!=='string'||!/^cognitive-fabric-[a-f0-9]{20}\.json$/.test(name))
   return {ok:false,reason:'invalid snapshot name'};
  const bytes=await blobs.read(name);if(!bytes||bytes.length>3000000)return {ok:false,reason:'snapshot absent or too large'};
  try{const v=JSON.parse(bytes.toString('utf8'));if(digest(JSON.stringify(v.exported))!==v.sha||
     v.sha.slice(0,20)!==name.slice('cognitive-fabric-'.length,-'.json'.length))
    return {ok:false,reason:'snapshot checksum mismatch'};
   const probe=new FabricJournal({state:{cognitiveFabric:{
    seq:v.exported.seq,anchor:v.exported.anchor,head:v.exported.head,events:v.exported.events,
    dependencies:{},dirty:{},failures:[],repairs:{},snapshots:[],stats:{processed:0,recovered:0}}}});
   if(!probe.verifyChain().ok)return {ok:false,reason:'snapshot event-chain mismatch'};
   return {ok:true,sha:v.sha,seq:v.exported.seq,nodeId:v.exported.nodeId,
    knowledge:v.exported.knowledge,events:v.exported.events.length};
  }catch{return {ok:false,reason:'corrupt snapshot'};}
 }
 status(){return {schemaVersion:1,revision:this.S.seq,head:this.S.head,events:this.S.events.length,
  chain:this.verifyChain().ok,dependencies:Object.keys(this.S.dependencies).length,
  pending:Object.keys(this.S.dirty).length,failures:this.S.failures.length,
  repairs:Object.keys(this.S.repairs).length,snapshots:this.S.snapshots.length,
  rebuilt:this.S.stats.processed};}
}
