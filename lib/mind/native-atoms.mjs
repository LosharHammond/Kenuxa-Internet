// Machine-native atoms: arbitrary bounded JSON structures and binary payloads, not only words.
// Candidate evidence is quarantined until an external, trusted verification step.
import { createHash } from 'node:crypto';
const hash = x => createHash('sha256').update(x).digest('hex');
const safe = x => x && typeof x === 'object' && !Array.isArray(x);
const formats = new Set(['symbol','graph','vector','procedure','perception','event','relation','binary','structured']);
export class NativeAtomMemory {
 constructor({ state = {}, maxAtoms = 5000 } = {}) {
  this.S=state;this.S.atoms ||= {};this.S.proposals ||= {};
  this.maxAtoms=Math.max(1,Math.min(5000,maxAtoms));
 }
 propose({ format, payload, source = 'untrusted-chat', context = null }) {
  if(typeof format!=='string'||format.length>64||!formats.has(format))return {ok:false,reason:'unsupported format'};
  if(!['untrusted-chat','observation','instrument','reference','owner'].includes(source))return {ok:false,reason:'invalid provenance'};
  let encoded;
  try { encoded=JSON.stringify({format,payload}); }catch{return {ok:false,reason:'non-serializable payload'};}
  if(typeof encoded!=='string'||encoded.length>32768)return {ok:false,reason:'payload exceeds bound'};
  if(Object.keys(this.S.proposals).length>=this.maxAtoms)return {ok:false,reason:'proposal capacity reached'};
  const id='native:'+hash(encoded);
  const prior=this.S.atoms[id];
  if(prior)return {ok:true,id,status:prior.status,duplicate:true};
  this.S.proposals[id] ||= {id,format,payload,source,context,status:'quarantined',evidence:[],revisions:0};
  return {ok:true,id,status:'quarantined'};
 }
 // The caller must authenticate verifier identity and the evidence independently.
 verify({ id, verified, verifier, evidenceId }) {
  const p=this.S.proposals[id];
  if(!p||typeof verified!=='boolean'||typeof verifier!=='string'||!verifier.startsWith('trusted:')||typeof evidenceId!=='string'||evidenceId.length<8)return {ok:false,reason:'trusted verification required'};
  if(p.evidence.some(e=>e.evidenceId===evidenceId))return {ok:false,reason:'duplicate evidence'};
  p.evidence.push({verifier,evidenceId,verified});p.revisions++;
  if(!verified){p.status='rejected';delete this.S.atoms[id];return {ok:true,status:p.status};}
  // Two distinct trusted evidence records; never count user chat or model claims as proof.
  const positive=p.evidence.filter(e=>e.verified);
  if(new Set(positive.map(e=>e.verifier)).size>=2 && p.status!=='rejected'){
   p.status='validated';this.S.atoms[id]={...p};
  }
  return {ok:true,status:p.status};
 }
 get(id,{includeQuarantine=false}={}) {
  return this.S.atoms[id] || (includeQuarantine?this.S.proposals[id]:null) || null;
 }
 status(){return {validated:Object.keys(this.S.atoms).length,quarantined:Object.values(this.S.proposals).filter(p=>p.status==='quarantined').length,rejected:Object.values(this.S.proposals).filter(p=>p.status==='rejected').length};}
}
