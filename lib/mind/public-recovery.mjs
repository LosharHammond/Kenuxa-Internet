// Signed, bounded recovery of independently verified PUBLIC procedure atoms.
// A failing origin Render host need not be online: its last signed bundle lives
// in owner-controlled shared storage. Never export private conversation or state.
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {fingerprintOf} from '../mesh.mjs';
import {makeAtom} from './atoms.mjs';
import {contentHash} from '../atoms/codec.mjs';
import {testProcedure} from '../peers/tasks.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const MAX_BYTES=200000, MAX_ATOMS=48;
const safeId=x=>typeof x==='string'&&/^[a-z0-9:._-]{3,120}$/.test(x);
const iso=()=>new Date().toISOString();
const encode=x=>JSON.stringify(x);
export class PublicKnowledgeRecovery {
 constructor({store,identity,cognitiveStore,knownPeers=()=>[],nodeId,log=()=>{}}={}){
  Object.assign(this,{store,identity,cognitiveStore,knownPeers,nodeId,log});
 }
 get enabled(){return !!(this.store?.publicKnowledge?.publish&&this.store?.publicKnowledge?.read);}
 exported(){
  const atoms=[];
  for(const rec of this.cognitiveStore.exportPublic()){
   const a=rec.atom;
   if(a.category!=='procedure'||a.status!=='promoted'||a.visibility!=='public'||
    !safeId(a.id)||!Array.isArray(a.body?.tests)||a.body.tests.length<2)continue;
   const own=testProcedure(a.body);
   if(own.total<2||own.passed!==own.total)continue;
   // Preserve only the validated declarative spec; never serialize private
   // evidence, prompts, conversations, teacher responses or credentials.
   const made=makeAtom({id:a.id,category:'procedure',label:a.id,
    body:a.body,status:'promoted',visibility:'public',
    evidence:[{kind:'test',ref:'revalidated',detail:own.passed+'/'+own.total}],
    provenance:{source:'signed-public-recovery',node:this.identity.fingerprint,derivedFrom:[]}},{now:0});
   if(!made.ok)continue;
   atoms.push({atom:made.atom,head:contentHash({...made.atom,updatedAt:0}),version:rec.version});
   if(atoms.length>=MAX_ATOMS)break;
  }
  return atoms;
 }
 async publish(){
  if(!this.enabled)return {ok:false,reason:'shared durable recovery storage unavailable'};
  if(!this.identity?.privateKey||!safeId(this.nodeId))return {ok:false,reason:'missing identity'};
  const items=this.exported();
  const data={version:1,nodeId:this.nodeId,publicKey:this.identity.publicKey,
   fingerprint:this.identity.fingerprint,issuedAt:iso(),items};
  const raw=encode(data);
  if(Buffer.byteLength(raw)>MAX_BYTES)return {ok:false,reason:'public recovery bundle too large'};
  const key=createPrivateKey({key:Buffer.from(this.identity.privateKey,'base64'),format:'der',type:'pkcs8'});
  const signature=sign(null,Buffer.from(raw),key).toString('base64');
  const envelope={data,sha:hash(raw),signature};
  await this.store.publicKnowledge.publish(this.nodeId,Buffer.from(encode(envelope)));
  return {ok:true,nodeId:this.nodeId,items:items.length,sha:envelope.sha};
 }
 verifyBundle(bytes,{allowedFingerprint=null,allowedNodeId=null}={}){
  try{
   if(!bytes||bytes.length>MAX_BYTES+15000)return {ok:false,reason:'oversized or absent recovery bundle'};
   const v=JSON.parse(Buffer.from(bytes).toString('utf8')),b=v.data;
   if(!b||b.version!==1||!safeId(b.nodeId)||b.nodeId!==allowedNodeId||
    !Array.isArray(b.items)||b.items.length>MAX_ATOMS||typeof v.sha!=='string')return {ok:false,reason:'invalid public recovery manifest'};
   if(fingerprintOf(b.publicKey)!==b.fingerprint||
     b.fingerprint!==allowedFingerprint)return {ok:false,reason:'peer signature identity not trusted'};
   const raw=encode(b);
   if(hash(raw)!==v.sha)return {ok:false,reason:'public recovery checksum mismatch'};
   const key=createPublicKey({key:Buffer.from(b.publicKey,'base64'),format:'der',type:'spki'});
   if(!verify(null,Buffer.from(raw),key,Buffer.from(v.signature,'base64')))
    return {ok:false,reason:'public recovery signature invalid'};
   if(!Number.isFinite(Date.parse(b.issuedAt))||Date.now()-Date.parse(b.issuedAt)>90*86400000||Date.parse(b.issuedAt)>Date.now()+120000)
    return {ok:false,reason:'stale recovery bundle'};
   if(b.items.some(x=>x?.atom?.category!=='procedure'||x.atom.status!=='promoted'||
      x.atom.visibility!=='public'||x.atom.provenance?.source!=='signed-public-recovery'||
      x.atom.provenance.node!==b.fingerprint||!Array.isArray(x.atom.body?.tests)||
      x.atom.body.tests.length<2||
      contentHash({...x.atom,updatedAt:0})!==x.head))
    return {ok:false,reason:'invalid or unapproved public atom in bundle'};
   return {ok:true,items:b.items,source:b.nodeId,fingerprint:b.fingerprint};
  }catch{return {ok:false,reason:'unverifiable recovery bundle'};}
 }
 async recover({nodeId=null}={}){
  if(!this.enabled)return {ok:false,reason:'recovery storage unavailable'};
  const peers=(await this.store.publicKnowledge.list()).filter(p=>p.node_id!==this.nodeId&&
    (!nodeId||p.node_id===nodeId)).slice(0,20);
  const report={ok:true,examined:0,verifiedBundles:0,verifiedPeers:[],offeredItems:0,adopted:[],rejected:[],unavailable:[]};
  const known=this.knownPeers();
  for(const peer of peers){
   const trust=known.find(p=>p.url===peer.public_url&&p.publicKey&&p.fingerprint&&p.reputation>0.15);
   if(!trust){report.rejected.push({nodeId:peer.node_id,reason:'not a trusted signed mesh peer'});continue;}
   try{
    const bytes=await this.store.publicKnowledge.read(peer.node_id);
    const validation=this.verifyBundle(bytes,{allowedFingerprint:trust.fingerprint,allowedNodeId:peer.node_id});
    report.examined++;
    if(!validation.ok){report.rejected.push({nodeId:peer.node_id,reason:validation.reason});continue;}
    report.verifiedBundles++;report.verifiedPeers.push(peer.node_id);
    report.offeredItems+=validation.items.length;
    const pending=validation.items.filter(item=>{
      const existing=this.cognitiveStore.get(item.atom.id);
      return !(existing?.status==='adopted-from-peer'&&
        existing.provenance?.node===trust.fingerprint&&
        JSON.stringify(existing.body)===JSON.stringify(item.atom.body));
    });
    const outcome=this.cognitiveStore.adoptFrom(trust.fingerprint,pending);
    report.adopted.push(...outcome.adopted);
    report.rejected.push(...outcome.rejected);
   }catch(e){report.unavailable.push({nodeId:peer.node_id,reason:String(e.message).slice(0,90)});}
  }
  return report;
 }
}
