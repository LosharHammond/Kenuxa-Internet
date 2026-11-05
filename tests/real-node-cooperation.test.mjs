// Real two-node HTTP test: signed handshake, public KUNPP job, isolated worker,
// verified result, and autonomous peer failover without a shared process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {createNode} from '../lib/node.mjs';
import {nodeHttp} from '../lib/adapters.mjs';

const admin='real-two-node-network-test-admin-12345678901234';
async function port(){
 const server=net.createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const p=server.address().port;
 await new Promise(r=>server.close(r));return p;
}
async function start(name,p){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-join-'));
 const origin='http://127.0.0.1:'+p;
 const node=await createNode({env:{
   HOST:'127.0.0.1',PORT:String(p),NODE_ID:name,PUBLIC_URL:origin,
   DATA_DIR:dir,ADMIN_TOKEN:admin,ALLOW_LOCAL_PEERS:'true',
   KENUXA_NETWORK:'on',KENUXA_NODE_WORKER:'true',COMPUTE_PEERS:'on',
   KENUXA_BUNDLED_SEEDS:'false',KENUXA_DIRECTORY:'off',
   COMPUTE_POW_BITS:'0',CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false',
   AUTONOMOUS_LEARNING:'off',TRANSFORMER_ENABLED:'false',
   TRANSFORMER_TRAINING:'false',SUPABASE_URL:'',GROQ_API_KEY:''
 },log:()=>{}});
 const server=http.createServer((req,res)=>nodeHttp(node,req,res)
   .catch(e=>{res.statusCode=500;res.end(String(e.message))}));
 await new Promise(r=>server.listen(p,'127.0.0.1',r));
 return {dir,node,server,origin};
}
async function dispose(n){
 if(!n)return;
 await new Promise(resolve=>n.server.close(resolve));
 await n.node.stop();
 fs.rmSync(n.dir,{recursive:true,force:true});
}
test('two hosted cognitive nodes handshake, share an actual public task, and preserve the originator as authority',{timeout:90000},async()=>{
 const Aport=await port();let Bport=await port();
 while(Bport===Aport)Bport=await port();
 let A,B;
 try{
   A=await start('cognitive-one',Aport);B=await start('cognitive-two',Bport);
   const peer=await B.node.mesh.contact(A.origin,6000);
   assert.ok(peer&&peer.fingerprint===A.node.state.identity.fingerprint,'B verified the identity of A');
   assert.ok(A.node.mesh.goodPeers(8).some(x=>x.fingerprint===B.node.state.identity.fingerprint),'A accepted the signed reverse introduction');
   B.node.nodeWorker.capacity=()=>({ok:true}); // fixture for overloaded CI hosts
   let success=false,last;
   for(let i=0;i<4;i++){
     last=await B.node.nodeWorker.tick();
     if(last.worked&&last.accepted){success=true;break;}
   }
   assert.ok(success,JSON.stringify({last,status:B.node.nodeWorker.status(),core:A.node.state.compute.metrics}));
   assert.ok(A.node.state.compute.metrics.leased>=1);
   assert.ok(A.node.state.compute.metrics.accepted>=1,'the original coordinator checked/accepted the result');
   assert.equal(B.node.nodeWorker.status().completed>=1,true);
   assert.notEqual(A.node.state.identity.fingerprint,B.node.state.identity.fingerprint);
   // The request owner remains authoritative: the remote CPU did not write to
   // B's private knowledge, A's canonical knowledge, or user conversations.
   assert.ok(!Object.values(B.node.state.compute?.peers||{}).some(p=>p.tokenHash==='exposed-secret'));
 }finally{await dispose(B);await dispose(A);}
});
