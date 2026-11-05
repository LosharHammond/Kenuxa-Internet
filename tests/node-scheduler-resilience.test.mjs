import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeComputeWorker} from '../lib/peers/node-worker.mjs';

const peer=(letter)=>({url:'https://peer-'+letter+'.example',fingerprint:'kx'+letter.repeat(30),capabilities:['kunpp-coordinator']});
function fixture({peers,lease,runner,clock=()=>Date.now(),active=()=>0,env={}}={}){
  const calls=[];
  const mesh={enabled:true,goodPeers:()=>peers,
    call:async(url,method,route,body)=>{
      calls.push({url,route,body});
      const output=route.endsWith('/lease')?await lease(url):
        route.endsWith('/result')?{status:'accepted'}:{ok:true};
      return {text:JSON.stringify(output),headers:{},status:200};
    },
    verifyResponse:r=>({data:JSON.parse(r.text)})};
  const worker=new NodeComputeWorker({mesh,state:{},now:clock,activeRequests:active,
    lastInteractiveAt:()=>0,env:{KENUXA_NODE_WORKER:'true',...env},
    runner:runner||async()=>({kind:'graph-metrics/1',checked:0,digest:'a'.repeat(64),issues:[]})});
  worker.capacity=()=>({ok:true});
  return {worker,calls};
}
test('when an idle coordinator has no task, scheduler attempts the NEXT distinct peer',async()=>{
  const A=peer('a'),B=peer('b'),C=peer('c');
  const {worker,calls}=fixture({peers:[A,B,C],lease:async url=>url===C.url?
    {task:{leaseId:'lease-3',taskId:'task-3',kind:'graph-metrics/1',deadline:Date.now()+8000,payload:{atoms:[]}}}:
    {task:null,retryAfterMs:6000}});
  try{
    const result=await worker.tick();
    assert.equal(result.worked,true);
    assert.equal(result.accepted,true);
    assert.deepEqual(calls.filter(x=>x.route.endsWith('/lease')).map(x=>x.url),[A.url,B.url,C.url]);
    assert.equal(worker.cursor,0);
    assert.equal(worker.stats.completed,1);
  }finally{await worker.stop();}
});
test('preemption ends worker immediately without marking an interrupted job as remote failure',async()=>{
  const A=peer('a');
  let notifyStarted;
  const started=new Promise(resolve=>{notifyStarted=resolve;});
  let rejectWorker;
  const resultPromise=new Promise((_,reject)=>{rejectWorker=reject;});
  const runner=async(kind,payload,{onWorker})=>{
    onWorker({terminate:async()=>{rejectWorker(new Error('worker exited 1'));}});
    notifyStarted();
    return resultPromise;
  };
  const {worker}=fixture({peers:[A],lease:async()=>({task:{
    leaseId:'lease-1',taskId:'task-1',kind:'graph-metrics/1',
    deadline:Date.now()+10000,payload:{atoms:[]}}}),runner});
  try{
    const job=worker.tick();
    await started;
    worker.setInteractiveLoad(1);
    const out=await job;
    assert.equal(out.skipped,true);
    assert.match(out.reason,/preempted/);
    assert.equal(worker.stats.failed,0);
    assert.equal(worker.stats.completed,0);
  }finally{await worker.stop();}
});
test('worker failure backs off only failed peer and records the diagnostic',async()=>{
  const A=peer('a'),B=peer('b');
  const {worker,calls}=fixture({peers:[A,B],lease:async url=>{
    if(url===A.url)throw new Error('External HTTPS timeout');
    return {task:{leaseId:'lease-2',taskId:'task-2',kind:'graph-metrics/1',
      deadline:Date.now()+10000,payload:{atoms:[]}}};
  }});
  try{
    const out=await worker.tick();
    assert.equal(out.worked,true);
    assert.equal(worker.stats.failed,1);
    assert.equal(worker.stats.completed,1);
    assert.equal(worker.backoff.has(A.fingerprint),true);
    assert.equal(worker.backoff.has(B.fingerprint),false);
    assert.deepEqual(calls.filter(x=>x.route.endsWith('/lease')).map(x=>x.url),[A.url,B.url]);
  }finally{await worker.stop();}
});
