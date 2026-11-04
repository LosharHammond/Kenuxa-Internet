// Capability-specific immutable record adapters. No automatic provisioning or deletion.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256} from '../foundation/catalog.mjs';
import {publicRequest,publicURL} from '../web.mjs';
export class AdapterRegistry{
 constructor(){this.factories=new Map();}
 register(type,version,factory){if(this.factories.has(type))throw new Error('Adapter already registered');this.factories.set(type,{version,factory});}
 create(config,options){const a=this.factories.get(config.type);if(!a)throw new Error('Unknown storage adapter: '+config.type);if(config.adapterVersion&&config.adapterVersion!==a.version)throw new Error('Unsupported adapter version');return Object.assign(a.factory(config,options),{adapterVersion:a.version});}
 list(){return [...this.factories].map(([type,v])=>({type,version:v.version}));}
}
export class FileRecordAdapter{
 constructor({id='local',directory,domain='local-disk',maxBytes=268435456,durable=true,allowPrivate=true}){Object.assign(this,{id,directory,domain,maxBytes,durable,allowPrivate,type:'file-records',kind:'record',capabilities:['get','put-immutable','list','health','capacity'],costPerRequest:0});}
 file(key){return path.join(this.directory,sha256(key)+'.json');}
 async health(){await fs.mkdir(this.directory,{recursive:true});return true;}
 async get(key){try{return await fs.readFile(this.file(key),'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async put(key,value){await this.health();const prior=await this.get(key);if(prior!==null){if(prior!==value)throw new Error('Immutable record conflict');return;}const c=await this.capacity();if(c.usedBytes+Buffer.byteLength(value)>this.maxBytes)throw new Error('Storage quota reached');const temp=this.file(key)+'.'+randomUUID()+'.tmp';let handle;try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(value);await handle.sync();await handle.close();handle=null;try{await fs.link(temp,this.file(key));}catch(e){if(e.code!=='EEXIST'||await this.get(key)!==value)throw e;}}finally{if(handle)await handle.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 async list(){await this.health();return (await fs.readdir(this.directory)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));}
 async capacity(){await this.health();const names=await this.list(),sizes=await Promise.all(names.map(n=>fs.stat(path.join(this.directory,n))));return {usedBytes:sizes.reduce((s,f)=>s+f.size,0),maxBytes:this.maxBytes,measurement:'actual local files',providerRemainingBytes:null};}
}
class RemoteRecordAdapter{
 constructor(c,{request=publicRequest}={}){if(!/^[a-z][a-z0-9-]{1,39}$/.test(c.id))throw new Error('Invalid provider ID');Object.assign(this,{id:c.id,domain:c.domain||c.type,maxBytes:Number(c.maxBytes)||10485760,maxRequests:Number(c.maxRequests)||10000,durable:true,allowPrivate:c.allowPrivate===true,request,capabilities:['get','put-immutable','health'],kind:'record',costPerRequest:null});this.config=c;}
 async send(url,options){try{const r=await this.request(url,{...options,timeout:15000,maxBytes:2000000});if(r.status<200||r.status>=300)throw new Error('HTTP '+r.status);return r.text?JSON.parse(r.text):null;}catch(e){throw new Error(`${this.id} storage request failed (${/^HTTP \d+$/.test(e.message)?e.message:'connection or protocol error'})`);}}
 capacity(){return {usedBytes:null,maxBytes:this.maxBytes,providerRemainingBytes:null,measurement:'owner-configured budget; provider usage unavailable'};}
}
export class SupabaseRecordAdapter extends RemoteRecordAdapter{
 constructor(c,options){super(c,options);const u=publicURL(c.url);if(!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)||u.pathname!=='/'||u.search)throw new Error('Use a Supabase project HTTPS origin');if(!c.key)throw new Error('Supabase server credential missing');this.url=u.origin;this.key=c.key;this.namespace=c.namespace||'default';this.type='supabase-records';}
 headers(extra={}){return {apikey:this.key,...(this.key.startsWith('eyJ')?{Authorization:'Bearer '+this.key}:{}),'Content-Type':'application/json',...extra};}
 async health(){await this.send(this.url+'/rest/v1/kenuxa_federated_records?select=record_key&limit=0',{headers:this.headers()});return true;}
 async get(key){const q=new URLSearchParams({namespace:'eq.'+this.namespace,record_key:'eq.'+key,select:'payload',limit:'1'});const rows=await this.send(this.url+'/rest/v1/kenuxa_federated_records?'+q,{headers:this.headers()});return rows?.[0]?.payload??null;}
 async put(key,value){await this.send(this.url+'/rest/v1/kenuxa_federated_records?on_conflict=namespace,record_key',{method:'POST',headers:this.headers({Prefer:'resolution=ignore-duplicates'}),body:JSON.stringify({namespace:this.namespace,record_key:key,payload:value})});if(await this.get(key)!==value)throw new Error('Immutable record verification failed');}
}
export class TursoRecordAdapter extends RemoteRecordAdapter{
 constructor(c,options){super(c,options);const u=publicURL(c.url.replace(/^libsql:/,'https:').replace(/^turso:/,'https:'));if(!/^[a-z0-9-]+\.(?:turso|turso-db)\.io$/.test(u.hostname)||u.pathname!=='/'||u.search)throw new Error('Use a Turso database HTTPS origin');if(!c.key)throw new Error('Turso token missing');this.url=u.origin;this.key=c.key;this.namespace=c.namespace||'default';this.type='turso-records';}
 async sql(sql,args=[]){const result=await this.send(this.url+'/v2/pipeline',{method:'POST',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({requests:[{type:'execute',stmt:{sql,args:args.map(value=>({type:'text',value:String(value)}))}},{type:'close'}]})});const r=result?.results?.[0];if(r?.type!=='ok')throw new Error(this.id+' database operation rejected; check table setup');return r.response.result;}
 async health(){await this.sql('SELECT record_key FROM kenuxa_federated_records LIMIT 0');return true;}
 async get(key){const r=await this.sql('SELECT payload FROM kenuxa_federated_records WHERE namespace = ? AND record_key = ? LIMIT 1',[this.namespace,key]);return r.rows?.[0]?.[0]?.value??null;}
 async put(key,value){await this.sql('INSERT INTO kenuxa_federated_records(namespace,record_key,payload) VALUES (?,?,?) ON CONFLICT(namespace,record_key) DO NOTHING',[this.namespace,key,value]);if(await this.get(key)!==value)throw new Error('Immutable record verification failed');}
}
export const adapters=new AdapterRegistry();
adapters.register('file-records',1,c=>new FileRecordAdapter(c));
adapters.register('supabase-records',1,(c,o)=>new SupabaseRecordAdapter(c,o));
adapters.register('turso-records',1,(c,o)=>new TursoRecordAdapter(c,o));
