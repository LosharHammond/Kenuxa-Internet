// KENUXA server-to-server KUNPP participant.
// The hosted node offers only spare compute, runs a fixed verified task vocabulary
// in a disposable worker thread, and never receives private conversations.
// All traffic goes through Ed25519-signed ATP peers already authenticated by Mesh.
import {Worker} from 'node:worker_threads';
import os from 'node:os';
import {TASK_SPECS} from './tasks.mjs';

const clamp=(n,lo,hi,def)=>Number.isFinite(Number(n))?Math.min(hi,Math.max(lo,Number(n))):def;
const EXECUTABLE=new Set(Object.keys(TASK_SPECS).filter(k=>!['replicate/1','restore/1','storage-proof/1'].includes(k)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isolatedRun(kind,payload,{budgetMs=5000,onWorker=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./node-runner.mjs',import.meta.url),{
      workerData:{kind,payload,budgetMs},
      resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16}
    });
    onWorker(worker);
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);onWorker(null);
      worker.terminate().catch(()=>{});
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error('worker task deadline exceeded')),budgetMs+1500);
    timer.unref?.();
    worker.on('message',m=>m?.ok?finish(null,m.result):finish(new Error(String(m?.error||'worker failure').slice(0,180))));
    worker.on('error',e=>finish(e));
    worker.on('exit',code=>finish(new Error('worker exited '+code)));
  });
}
export class NodeComputeWorker {
  constructor({mesh,state={},env={},activeRequests=()=>0,lastInteractiveAt=()=>0,save=()=>{},log=()=>{},runner=isolatedRun,now=()=>Date.now()}={}){
    if(!mesh)throw new Error('NodeComputeWorker requires the authenticated ATP mesh');
    Object.assign(this,{mesh,state,env,activeRequests,lastInteractiveAt,save,log,runner,now});
    const hosted=env.RENDER||env.RAILWAY_ENVIRONMENT||env.KENUXA_PLATFORM==='render'||env.KENUXA_PLATFORM==='railway';
    this.enabled=mesh.enabled&&env.KENUXA_NODE_WORKER!=='off'&&env.KENUXA_NODE_WORKER!=='false'&&(hosted||env.KENUXA_NODE_WORKER==='true');
    this.intervalMs=clamp(env.KENUXA_NODE_WORKER_INTERVAL_MS,5000,120000,15000);
    this.budgetMs=clamp(env.KENUXA_NODE_WORKER_TASK_MS,500,12000,5000);
    this.maxBytes=clamp(env.KENUXA_NODE_WORKER_MAX_BYTES,10000,200000,100000);
    this.running=null;this.worker=null;this.timer=null;this.stopping=false;this.cursor=0;this.backoff=new Map();
    this.stats=state.nodeWorker??={schemaVersion:1,completed:0,failed:0,leased:0,cancelled:0,offeredTo:[],recent:[],lastRun:null};
  }
  status(){
    return {enabled:this.enabled,busy:!!this.running,intervalMs:this.intervalMs,taskBudgetMs:this.budgetMs,
      availablePeers:this.mesh.goodPeers(12).length,completed:this.stats.completed,failed:this.stats.failed,
      leased:this.stats.leased,cancelled:this.stats.cancelled,lastRun:this.stats.lastRun,recent:this.stats.recent.slice(-8)};
  }
  record(row){
    this.stats.lastRun=new Date(this.now()).toISOString();
    this.stats.recent.push({at:this.stats.lastRun,...row});
    this.stats.recent=this.stats.recent.slice(-30);
  }
  capacity(){
    if(this.activeRequests()>0)return {ok:false,reason:'interactive question in progress'};
    if(this.now()-this.lastInteractiveAt()<3000)return {ok:false,reason:'conversation quiet period'};
    const cores=Math.max(1,os.cpus().length);
    const load=os.loadavg()[0]/cores;
    const heap=process.memoryUsage().heapUsed/Math.max(1,process.memoryUsage().heapTotal);
    if(load>clamp(this.env.KENUXA_NODE_WORKER_MAX_LOAD,0.2,2,0.9))
      return {ok:false,reason:'CPU busy'};
    if(heap>0.92)return {ok:false,reason:'memory busy'};
    return {ok:true,load,heap};
  }
  async call(peer,path,payload){
    const body=JSON.stringify(payload);
    const response=await this.mesh.call(peer.url,'POST',path,body,clamp(this.env.KENUXA_NODE_WORKER_NET_MS,1000,12000,4500));
    if(Buffer.byteLength(response.text)>this.maxBytes+30000)throw new Error('peer response exceeds bounded size');
    return this.mesh.verifyResponse(response,path,peer.fingerprint).data;
  }
  async cancel(peer,leaseId){
    try {await this.call(peer,'/atp/compute/cancel',{leaseId});this.stats.cancelled++;}catch{}
  }
  async runOnce(){
    const p=this.capacity();
    if(!p.ok)return {skipped:true,reason:p.reason};
    const nodes=this.mesh.goodPeers(12).filter(x=>x.url&&(!x.capabilities?.length||x.capabilities.includes('kunpp-coordinator'))&&(!x.backoffUntil||Date.parse(x.backoffUntil)<=this.now()));
    if(!nodes.length)return {skipped:true,reason:'no signed peers yet; waiting for bootstrap'};
    for(let i=0;i<Math.min(nodes.length,4);i++){
      const peer=nodes[(this.cursor+i)%nodes.length];
      const delay=this.backoff.get(peer.fingerprint)||0;
      if(this.now()<delay)continue;
      let lease=null;
      try{
        if(!this.capacity().ok)return {skipped:true,reason:'interactive work took priority'};
        const r=await this.call(peer,'/atp/compute/lease',{maxBytes:this.maxBytes});
        lease=r?.task;
        this.cursor=(this.cursor+i+1)%nodes.length;
        if(!lease){this.backoff.set(peer.fingerprint,this.now()+clamp(r?.retryAfterMs,5000,120000,20000));continue;}
        if(typeof lease.leaseId!=='string'||typeof lease.taskId!=='string'||
           !EXECUTABLE.has(lease.kind)||!lease.payload||Buffer.byteLength(JSON.stringify(lease.payload))>this.maxBytes){
          await this.cancel(peer,lease?.leaseId);throw new Error('untrusted, oversized or unsupported lease');
        }
        if(!this.capacity().ok){await this.cancel(peer,lease.leaseId);return {skipped:true,reason:'preempted for chat'};}
        this.stats.leased++;
        const started=this.now();
        const result=await this.runner(lease.kind,lease.payload,{
          budgetMs:Math.min(this.budgetMs,Math.max(500,(lease.deadline||this.now()+10000)-this.now()-1000)),
          onWorker:w=>{this.worker=w}
        });
        if(!this.capacity().ok){await this.cancel(peer,lease.leaseId);return {skipped:true,reason:'preempted by chat'};}
        const ack=await this.call(peer,'/atp/compute/result',{leaseId:lease.leaseId,taskId:lease.taskId,result});
        const accepted=['accepted','awaiting-replica','recorded'].includes(ack?.status);
        if(accepted)this.stats.completed++;else this.stats.failed++;
        this.record({peer:peer.fingerprint.slice(0,12),kind:lease.kind,accepted,status:ack?.status||'unknown',elapsedMs:this.now()-started});
        this.save();
        return {worked:true,accepted,peer:peer.fingerprint,kind:lease.kind};
      }catch(e){
        if(lease?.leaseId)await this.cancel(peer,lease.leaseId);
        this.stats.failed++;
        this.backoff.set(peer.fingerprint,this.now()+30000);
        this.record({peer:peer.fingerprint.slice(0,12),error:String(e.message).slice(0,150)});
      }
    }
    return {skipped:true,reason:'all peers were busy or unreachable'};
  }
  tick(){
    if(!this.enabled||this.stopping)return Promise.resolve({skipped:true,reason:'node worker disabled'});
    if(this.running)return Promise.resolve({skipped:true,reason:'one job already running'});
    const job=this.runOnce().catch(e=>({error:e.message})).finally(()=>{this.running=null;this.worker=null;});
    this.running=job;return job;
  }
  setInteractiveLoad(active){
    // A new human request takes precedence even if a peer job is still running.
    if(active>0&&this.worker){this.worker.terminate().catch(()=>{});this.worker=null;}
  }
  start(){
    if(!this.enabled||this.timer||this.stopping)return false;
    const beat=async()=>{
      this.timer=null;
      if(this.stopping)return;
      await this.tick();
      if(!this.stopping){this.timer=setTimeout(beat,this.intervalMs);this.timer.unref?.();}
    };
    this.timer=setTimeout(beat,clamp(this.env.KENUXA_NODE_WORKER_FIRST_MS,1000,120000,18000));
    this.timer.unref?.();return true;
  }
  async stop(){
    this.stopping=true;clearTimeout(this.timer);this.timer=null;
    if(this.worker)await this.worker.terminate().catch(()=>{});
    if(this.running)await Promise.race([this.running,pause(1000)]);
  }
}