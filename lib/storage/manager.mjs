import {sha256} from '../foundation/catalog.mjs';
import {adapters,FileRecordAdapter} from './adapters.mjs';
const stable=x=>JSON.stringify(sort(x));
function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
export class FederatedKnowledgeStorage{
 constructor({providers,control,replicas=1,maxRecords=2000,foundation=null}){if(!Number.isInteger(replicas)||replicas<1||replicas>5)throw new Error('Replica policy must be 1-5 independent durable domains');if(new Set(providers.map(p=>p.id)).size!==providers.length)throw new Error('Duplicate provider ID');Object.assign(this,{providers,control,replicas,maxRecords,foundation});this.state={format:'kenuxa-storage-ledger/1',records:{},pending:{},metrics:{}};this.chain=Promise.resolve();}
 async init(){const raw=await this.control.read('federated-knowledge-ledger.json');if(raw){const s=JSON.parse(raw.toString());if(s.format!=='kenuxa-storage-ledger/1')throw new Error('Unsupported storage ledger');this.state=s;}return this;}
 async persist(){await this.control.write('federated-knowledge-ledger.json',Buffer.from(stable(this.state)));}
 exclusive(fn){const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
 metric(p){const month=new Date().toISOString().slice(0,7);let m=this.state.metrics[p.id];if(!m||m.month!==month)m=this.state.metrics[p.id]={month,requests:0,failures:0,writtenBytes:0,latencyMs:null,lastError:null};return m;}
 async call(p,op,...args){const m=this.metric(p);if(m.requests+(op==='put'&&p.kind==='record'&&p.type!=='file-records'?2:1)>(p.maxRequests||1000000))throw new Error(p.id+' request budget reached');m.requests+=(op==='put'&&p.type!=='file-records'?2:1);const at=Date.now();try{const r=await p[op](...args);m.latencyMs=Date.now()-at;m.lastError=null;return r;}catch(e){m.failures++;m.lastError=e.message;throw e;}}
 async status(){return {format:this.state.format,policy:{requiredIndependentDurableDomains:this.replicas,scope:'configured owner-controlled providers; no global consensus'},records:Object.keys(this.state.records).length,pending:Object.keys(this.state.pending).length,providers:await Promise.all(this.providers.map(async p=>({id:p.id,type:p.type,kind:p.kind,domain:p.domain,durable:p.durable,allowPrivate:p.allowPrivate,capabilities:p.capabilities,metrics:this.metric(p),capacity:await Promise.resolve(p.capacity()).catch(()=>({measurement:'unavailable'}))}))),adapters:adapters.list()};}
 async health(){const results=[];for(const p of this.providers){try{await this.call(p,'health');results.push({id:p.id,available:true});}catch(e){results.push({id:p.id,available:false,error:e.message});}}await this.persist();return results;}
 async put(record,{privacy='public',authorized=false}={}){return this.exclusive(async()=>{
  if(!authorized)throw new Error('Owner authorization required');
  if(!record||typeof record.id!=='string'||record.id.length>300||!Number.isInteger(record.version)||record.version<1||!record.provenance?.length||!['curated','verified','corroborated'].includes(record.validation))throw new Error('Record requires canonical identity, version, provenance and accepted validation');
  if(!['public','private'].includes(privacy))throw new Error('Invalid privacy scope');
  const payload=stable({...record,privacy});if(Buffer.byteLength(payload)>131072)throw new Error('Record exceeds 128 KiB; use a bounded external package importer');
  const checksum=sha256(payload),old=this.state.records[record.id];
  if(old&&old.privacy!==privacy)throw new Error('Privacy changes require an explicit reviewed migration');
  if(old?.checksum===checksum)return {...old,duplicate:true};
  if(old&&record.version<=old.version)throw new Error('Stale or conflicting canonical version');
  if(!old&&Object.keys(this.state.records).length>=this.maxRecords)throw new Error('Canonical manifest capacity reached');
  if(Object.keys(this.state.pending).length>=100&&!this.state.pending[checksum])throw new Error('Pending write queue full; storage backpressure active');
  const item={id:record.id,version:record.version,checksum,key:'record:'+checksum,privacy,payload,locations:[],required:this.replicas,previous:old?.checksum||null,state:'PREPARING',at:new Date().toISOString()};
  this.state.pending[checksum]??=item;await this.persist();return this.complete(this.state.pending[checksum]);
 });}
 async complete(item){
  const errors=[];
  const candidates=[...this.providers].filter(p=>p.durable&&(item.privacy==='public'||p.allowPrivate)).sort((a,b)=>{const A=this.metric(a),B=this.metric(b);return A.failures-B.failures+(A.writtenBytes/(a.maxBytes||1)-B.writtenBytes/(b.maxBytes||1));});
  for(const p of candidates){if(new Set(item.locations.map(l=>l.domain)).size>=item.required)break;if(item.locations.some(l=>l.domain===p.domain))continue;
   try{const cap=await p.capacity();const used=cap.usedBytes??this.metric(p).writtenBytes;if(used+Buffer.byteLength(item.payload)>p.maxBytes)throw new Error('Configured capacity budget reached');await this.call(p,'put',item.key,item.payload);const read=await this.call(p,'get',item.key);if(sha256(read||'')!==item.checksum)throw new Error('Read-back integrity mismatch');item.locations.push({provider:p.id,domain:p.domain,verifiedAt:new Date().toISOString(),durable:true});this.metric(p).writtenBytes+=Buffer.byteLength(item.payload);item.state='REPLICATING';await this.persist();}catch(e){errors.push({provider:p.id,error:e.message});}
  }
  if(new Set(item.locations.map(l=>l.domain)).size<item.required){item.state='PENDING_DURABILITY';item.errors=errors;await this.persist();return {id:item.id,checksum:item.checksum,state:item.state,locations:item.locations,errors};}
  const current=this.state.records[item.id];if(current&&current.checksum!==item.previous&&current.checksum!==item.checksum){item.state='CONFLICT';await this.persist();return {id:item.id,state:'CONFLICT'};}
  const {payload,...manifest}=item;manifest.state='COMMITTED';manifest.history=[...(current?.history||[]),...(current&&current.checksum!==item.checksum?[{checksum:current.checksum,version:current.version,key:current.key,locations:current.locations}]:[])];
  this.state.records[item.id]=manifest;delete this.state.pending[item.checksum];try{await this.persist();}catch(e){if(current)this.state.records[item.id]=current;else delete this.state.records[item.id];this.state.pending[item.checksum]=item;throw e;}return manifest;
 }
 async get(id,{authorized=false}={}){
  const m=this.state.records[id];if(m){if(m.privacy==='private'&&!authorized)throw new Error('Private knowledge is not authorized');const errors=[];for(const l of m.locations){const p=this.providers.find(p=>p.id===l.provider);if(!p)continue;try{const raw=await this.call(p,'get',m.key);if(typeof raw!=='string'||sha256(raw)!==m.checksum)throw new Error('Missing or corrupt replica');const record=JSON.parse(raw);if(record.id!==id||record.version!==m.version)throw new Error('Canonical identity mismatch');return {record,manifest:m,source:p.id};}catch(e){errors.push({provider:p.id,error:e.message});}}throw new Error('All canonical replicas unavailable: '+errors.map(e=>e.provider).join(', '));}
  if(this.foundation){const atom=this.foundation.atom(id);if(atom)return {record:atom,source:'bundled-foundation',manifest:{id,version:'3.0',checksum:sha256(stable(atom)),state:'BUNDLED'}};}
  throw new Error('Canonical record not found');
 }
 recover(){return this.exclusive(async()=>{const result=[];for(const item of Object.values(this.state.pending).slice(0,100)){if(item.state!=='CONFLICT'){// Recheck every partial receipt; a stale receipt cannot establish durability.
    const valid=[];for(const l of item.locations){const p=this.providers.find(p=>p.id===l.provider);if(p){try{if(sha256(await this.call(p,'get',item.key)||'')===item.checksum)valid.push(l);}catch{}}}item.locations=valid;result.push(await this.complete(item));}}
   return result;});}
 repair(id){return this.exclusive(async()=>{const {record,manifest}=await this.get(id,{authorized:true});if(manifest.state!=='COMMITTED')throw new Error('Only committed records can be repaired');const item={...manifest,payload:stable(record),previous:manifest.checksum,locations:[],required:this.replicas,state:'PREPARING'};this.state.pending[item.checksum]=item;await this.persist();return this.complete(item);});}
 manifest(id,{authorized=false}={}){const m=this.state.records[id];if(m?.privacy==='private'&&!authorized)throw new Error('Private manifest is not authorized');return m||null;}
}
export async function createKnowledgeStorage({env,dataDir,control,foundation}){
 const providers=[new FileRecordAdapter({directory:dataDir+'/knowledge-records',durable:env.KNOWLEDGE_LOCAL_DURABLE==='true'||!(env.RENDER||env.VERCEL||env.NETLIFY),domain:env.KNOWLEDGE_LOCAL_DOMAIN||'local-disk'})];
 let configs=[];try{configs=JSON.parse(env.KNOWLEDGE_STORAGE_PROVIDERS||'[]');}catch{throw new Error('Invalid KNOWLEDGE_STORAGE_PROVIDERS JSON');}if(!Array.isArray(configs)||configs.length>8)throw new Error('Configure at most 8 storage adapters');
 for(const c of configs){if(!['supabase-records','turso-records'].includes(c.type))throw new Error('Remote configuration requires a registered hosted record adapter');if(c.eligible!==true||!Number.isFinite(c.maxBytes)||c.maxBytes<=0||!Number.isFinite(c.maxRequests)||c.maxRequests<=0||!Number.isFinite(Date.parse(c.quotaReviewedAt))||Math.abs(Date.now()-Date.parse(c.quotaReviewedAt))>30*86400000)throw new Error('Remote storage requires eligible=true, positive owner budgets, and quotaReviewedAt within 30 days; verify account limits before enabling');const key=env[c.keyEnv];providers.push(adapters.create({...c,key,namespace:c.namespace||env.NODE_ID||'kenuxa-home'}));}
 return new FederatedKnowledgeStorage({providers,control,foundation,replicas:Number(env.KNOWLEDGE_STORAGE_REPLICAS||1)}).init();
}
