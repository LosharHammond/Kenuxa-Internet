import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';
import {NodeComputeWorker} from '../lib/peers/node-worker.mjs';
import {ensureIdentity,signHeaders,verifySigned} from '../lib/mesh.mjs';

const admin='automatic-node-worker-test-admin-1234567890';
const base={HOST:'127.0.0.1',ADMIN_TOKEN:admin,KENUXA_NETWORK:'on',
  ALLOW_LOCAL_PEERS:'true',KENUXA_BUNDLED_SEEDS:'false',KENUXA_DIRECTORY:'off',
  CRAWLER_ENABLED:'false',TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',
  RESEARCH_ENABLED:'false',COMPUTE_POW_BITS:'0',SUPABASE_URL:''};
const mk=(env={})=>createNode({env:{...base,NODE_ID:'node-'+Math.random().toString(36).slice(2,10),
  DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-node-worker-')),...env},log:()=>{}});
test('two hosted URLs derive different durable node ids without orphaning the original',async()=>{
 const one=await mk({RENDER:'true',NODE_ID:undefined,RENDER_EXTERNAL_URL:'https://kenuxa-internet.onrender.com'});
 const two=await mk({RENDER:'true',NODE_ID:undefined,RENDER_EXTERNAL_URL:'https://kenuxa-secondary.onrender.com'});
 try {
   assert.equal(one.nodeId,'kenuxa-home');
   assert.match(two.nodeId,/^kx-[a-f0-9]{20}$/);
   assert.notEqual(one.nodeId,two.nodeId);
   assert.notEqual(one.state.identity.fingerprint,two.state.identity.fingerprint);
 } finally {await one.stop();await two.stop();}
});
test('signed ATP peer may lease bounded public task only after reciprocal identity verification',async()=>{
 const A=await mk({NODE_ID:'compute-a'}),B=await mk({NODE_ID:'compute-b'});
 const addressA='http://127.0.0.1:12021',addressB='http://127.0.0.1:12022';
 const body='{}',route='/atp/compute/lease';
 try{
   const signed=signHeaders(B.state.identity,'POST',route,body);
   const request=(headers)=>A.handle({method:'POST',url:route,headers:{host:'localhost',
       'content-type':'application/json',...headers},remoteAddress:'127.0.0.1',body});
   const before=await request(signed);
   assert.equal(before.status,403,'signed but unknown peers must finish handshake first');
   A.mesh.upsert({fingerprint:B.state.identity.fingerprint,publicKey:B.state.identity.publicKey},addressB,{name:'B'});
   B.mesh.upsert({fingerprint:A.state.identity.fingerprint,publicKey:A.state.identity.publicKey},addressA,{name:'A'});
   const headers=signHeaders(B.state.identity,'POST',route,body);
   const response=await request(headers);
   assert.equal(response.status,200,JSON.stringify(response.body));
   assert.equal(verifySigned(response.headers,'RESPONSE',route,response.body).fingerprint,A.state.identity.fingerprint);
   const data=JSON.parse(response.body);
   assert.ok(Object.hasOwn(data,'task'));
   assert.ok(A.state.compute.peers['node_'+B.state.identity.fingerprint]);
   // A degraded but established mesh peer must not be offered as goodPeers()
   // while being denied by the compute handler. The production node fell into
   // this exact HTTP 403 loop at reputation 0.23 on 2026-11-05.
   const p=A.mesh.peers.find(x=>x.fingerprint===B.state.identity.fingerprint);
   p.reputation=0.23;
   assert.ok(A.mesh.goodPeers(10).includes(p));
   assert.equal((await request(signHeaders(B.state.identity,'POST',route,body))).status,200,
       'a low-reputation established peer can still lease bounded public work');
   p.reputation=0.1;
   assert.equal((await request(signHeaders(B.state.identity,'POST',route,body))).status,403,
       'a peer below the shared trust floor is rejected');
   p.reputation=0.5;
   assert.equal((await request(headers)).status,401,'signed messages cannot be replayed');
   const invalid=await A.handle({method:'POST',url:'/atp/compute/arbitrary-js',headers:{
     ...signHeaders(B.state.identity,'POST','/atp/compute/arbitrary-js',body),
     host:'localhost','content-type':'application/json'},remoteAddress:'127.0.0.1',body});
   assert.equal(invalid.status,404,'peer must not execute arbitrary code');
 } finally {await A.stop();await B.stop();}
});
test('Render NODE_WORKER enabled is always a Boolean even when RENDER is a string',()=>{
 const mesh={enabled:true,goodPeers:()=>[]};
 const enabled=new NodeComputeWorker({mesh,state:{},env:{RENDER:'true'}});
 assert.equal(enabled.enabled,true);assert.equal(typeof enabled.enabled,'boolean');
 const disabled=new NodeComputeWorker({mesh,state:{},env:{RENDER:'true',KENUXA_NODE_WORKER:'off'}});
 assert.equal(disabled.enabled,false);assert.equal(typeof disabled.enabled,'boolean');
});
test('rejected compute lease triggers a bounded signed rehandshake and peer-specific backoff',async()=>{
 const p={url:'https://peer.example',fingerprint:'kx'+'f'.repeat(30),capabilities:['kunpp-coordinator']};
 let handshake=0,requests=0;
 const mesh={enabled:true,goodPeers:()=>[p],
  call:async()=>{requests++;throw new Error('HTTP 403');},
  contact:async()=>{handshake++;return p;}};
 const w=new NodeComputeWorker({mesh,state:{},env:{RENDER:'true'},now:()=>200000});
 w.capacity=()=>({ok:true});
 try{
  assert.equal((await w.tick()).skipped,true);
  assert.equal(w.stats.failed,1);
  assert.equal(handshake,1);
  assert.equal((await w.tick()).skipped,true);
  assert.equal(handshake,1);
  assert.equal(requests,1,'backoff prevents repeated denied calls');
 }finally{await w.stop();}
});
test('idle hosted worker fails over between peers and yields to human interaction',async()=>{
 const good={url:'https://peer2.example',fingerprint:'kx'+'b'.repeat(30)},
   bad={url:'https://peer1.example',fingerprint:'kx'+'a'.repeat(30)};
 const routes=[],mesh={enabled:true,goodPeers:()=>[bad,good],
   call:async(url,method,route)=>{
     routes.push([url,route]);
     if(url===bad.url)throw new Error('peer offline');
     const data=route.endsWith('/lease')?{
       task:{leaseId:'lease1',taskId:'task1',kind:'graph-metrics/1',payload:{atoms:[]},deadline:Date.now()+9000}
     }:route.endsWith('/result')?{status:'accepted'}:{ok:true};
     return {status:200,text:JSON.stringify(data)};
   },
   verifyResponse:(res)=>({data:JSON.parse(res.text)})};
 const state={},w=new NodeComputeWorker({mesh,state,env:{KENUXA_NODE_WORKER:'true'},now:()=>Date.now(),
   runner:async()=>({kind:'graph-metrics/1',checked:0,digest:'a'.repeat(64),issues:[]})});
 w.capacity=()=>({ok:true});
 try{
   const worked=await w.tick();
   assert.equal(worked.worked,true);
   assert.equal(w.status().completed,1);
   assert.ok(routes.some(x=>x[0]===good.url&&x[1]==='/atp/compute/result'));
   assert.equal(w.status().failed,1,'the failed first peer is observable');
   w.capacity=()=>({ok:false,reason:'chat in progress'});
   const stalled=await w.tick();
   assert.equal(stalled.skipped,true);assert.match(stalled.reason,/chat/);
 }finally{await w.stop();}
});
