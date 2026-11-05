// KENUXA server-to-server KUNPP participant.
// The hosted node offers only spare compute, runs a fixed verified task vocabulary
// in a disposable worker thread, and never receives private conversations.
// All traffic goes through Ed25519-signed ATP peers already authenticated by Mesh.
import {Worker} from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import {TASK_SPECS} from './tasks.mjs';

const clamp=(n,lo,hi,def)=>Number.isFinite(Number(n))?Math.min(hi,Math.max(lo,Number(n))):def;
const EXECUTABLE=new Set(Object.keys(TASK_SPECS).filter(k=>!['replicate/1','restore/1','storage-proof/1'].includes(k)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// cgroup CPU quotas can be fractional even when os.cpus() reports the host's
// many physical cores. Never decide whether a free container is idle using
// the *host* load average.
function cpuAllowance(){
  let cores=Math.max(1,Number(os.availableParallelism?.()||os.cpus().length)||1);
  try{
    const [quota,period]=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\\s+/);
    if(quota!=='max'&&Number(quota)>0&&Number(period)>0)
      cores=Math.min(cores,Number(quota)/Number(period));
  }catch{
    try{
      const quota=Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us','utf8'));
      const period=Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us','utf8'));
      if(quota>0&&period>0)cores=Math.min(cores,quota/period);
    }catch{}
  }
  return Math.max(0.1,cores);
}
function memoryAllowance(){
  const limits=[];
  const constrained=Number(process.constrainedMemory?.()||0);
  if(constrained>0)limits.push(constrained);
  for(const file of ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory/memory.limit_in_bytes']){
    try{const n=Number(fs.readFileSync(file,'utf8').trim());if(Number.isFinite(n)&&n>0)limits.push(n);}catch{}
  }
  return limits.length?Math.min(...limits):0;
}
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
    this.running=null;this.worker=null;this.timer=null;this.stopping=false;
    this.cursor=0;this.backoff=new Map();this.failuresByPeer=new Map();this.preempted=false;
    this.cpuCores=cpuAllowance();
    this.memoryBudget=memoryAllowance();
    this.cpuSample={at:this.now(),reading:process.cpuUsage(),utilization:0};
    this.stats=state.nodeWorker??={schemaVersion:1,completed:0,failed:0,leased:0,cancelled:0,offeredTo:[],recent:[],lastRun:null};
  }
  status(){
    return {enabled:this.enabled,busy:!!this.running,intervalMs:this.intervalMs,taskBudgetMs:this.budgetMs,
      availablePeers:this.mesh.goodPeers(12).length,cpuCores:this.cpuCores,
      cpuUtilization:Math.round(this.cpuSample.utilization*100)/100,
      memoryBudgetMB:this.memoryBudget?Math.round(this.memoryBudget/1048576):null,
      completed:this.stats.completed,failed:this.stats.failed,
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
    const t=this.now(),elapsed=t-this.cpuSample.at;
    if(elapsed>=500){
      const delta=process.cpuUsage(this.cpuSample.reading);
      const utilization=Math.max(0,(delta.user+delta.system)/1000/elapsed/this.cpuCores);
      this.cpuSample={at:t,reading:process.cpuUsage(),utilization};
    }
    const load=this.cpuSample.utilization;
    const limit=this.memoryBudget;
    const rss=process.memoryUsage().rss;
    const reserve=clamp(this.env.KENUXA_NODE_WORKER_RESERVE_MB,32,512,128)*1048576;
    if(load>clamp(this.env.KENUXA_NODE_WORKER_MAX_CPU,0.1,1.25,0.70))
      return {ok:false,reason:'container CPU busy',load};
    if(limit&&limit-rss<Math.min(reserve,limit*0.25))
      return {ok:false,reason:'container memory reserve',load,freeMB:Math.round((limit-rss)/1048576)};
    return {ok:true,load,freeMB:limit?Math.round((limit-rss)/1048576):null};
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
    // Snapshot the cursor. Mutating it while indexing this same loop skipped
    // every second peer when a coordinator legitimately had no work.
    const first=this.cursor%nodes.length;
    for(let i=0;i<Math.min(nodes.length,4);i++){
      const index=(first+i)%nodes.length;
      const peer=nodes[index];
      const delay=this.backoff.get(peer.fingerprint)||0;
      if(this.now()<delay)continue;
      let lease=null;
      try{
        if(!this.capacity().ok)return {skipped:true,reason:'interactive work took priority'};
        const r=await this.call(peer,'/atp/compute/lease',{maxBytes:this.maxBytes});
        lease=r?.task;
        this.cursor=(index+1)%nodes.length;
        if(!lease){this.backoff.set(peer.fingerprint,this.now()+clamp(r?.retryAfterMs,5000,120000,20000));continue;}
        if(typeof lease.leaseId!=='string'||typeof lease.taskId!=='string'||
           !EXECUTABLE.has(lease.kind)||!lease.payload||Buffer.byteLength(JSON.stringify(lease.payload))>this.maxBytes){
          await this.cancel(peer,lease?.leaseId);throw new Error('untrusted, oversized or unsupported lease');
        }
        if(!this.capacity().ok){await this.cancel(peer,lease.leaseId);return {skipped:true,reason:'preempted for chat'};}
        this.stats.leased++;
        this.preempted=false;
        this.failuresByPeer.delete(peer.fingerprint);
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
        const interrupted=this.preempted||this.activeRequests()>0;
        this.preempted=false;
        if(interrupted){
          this.record({peer:peer.fingerprint.slice(0,12),skipped:'preempted for conversation'});
          this.save();
          return {skipped:true,reason:'preempted for conversation'};
        }
        this.stats.failed++;
        const count=Math.min(6,(this.failuresByPeer.get(peer.fingerprint)||0)+1);
        this.failuresByPeer.set(peer.fingerprint,count);
        this.backoff.set(peer.fingerprint,this.now()+Math.min(300000,15000*2**(count-1)));
        this.record({peer:peer.fingerprint.slice(0,12),error:String(e.message).slice(0,150)});
        this.save();
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
    if(active>0&&this.worker){
      this.preempted=true;
      this.worker.terminate().catch(()=>{});
      this.worker=null;
    }
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