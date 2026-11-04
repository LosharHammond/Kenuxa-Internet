import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';
test('end-to-end boot: persisted dictionary -> request -> response -> durable state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-e2e-'));
 let node;
 try{
   const env={...process.env,KENUXA_PLATFORM:'self-hosted',HOST:'127.0.0.1',NODE_ID:'kenuxa-e2e',DATA_DIR:dir,
    NETWORK_SECRET:'',PEER_URLS:'',KENUXA_NETWORK:'off',TRANSFORMER_PROFILE:'test',TRANSFORMER_TRAINING:'false',
    TRANSFORMER_ENABLED:'false',AUTONOMOUS_LEARNING:'off',CRAWLER_ENABLED:'false',STUDIO_ENABLED:'false',
    FOUNDATION_ENABLED:'true',ADMIN_TOKEN:'test-only-e2e-admin-token-1234567890'};
   node=await createNode({env,serverless:false,log:()=>{}});
   const health=await node.handle({method:'GET',url:'/health',headers:{host:'localhost'},remoteAddress:'127.0.0.1',body:''});
   assert.equal(health.status,200);assert.equal(JSON.parse(health.body).status,'ok');
   const ask=await node.handle({method:'POST',url:'/chat/ask',headers:{host:'localhost','content-type':'application/json'},remoteAddress:'127.0.0.1',
      body:JSON.stringify({question:'Define dog',history:[]})});
   assert.equal(ask.status,200,ask.body);
   const answer=JSON.parse(ask.body);
   assert.ok(typeof answer.answer==='string'&&answer.answer.length>12);
   assert.match(answer.engine,/foundation cognition|dictionary/i);
   const r=await node.autonomousLearning.tick({limit:4,force:true,refresh:false,trainSteps:0});
   assert.equal(r.ok,true,JSON.stringify(r));
   await node.flush();
   assert.ok(fs.existsSync(path.join(dir,'state.json')));
   const saved=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
   assert.ok(saved.autonomousLearning.cycles>=1);
   assert.ok(saved.foundationTraining.documents>=1);
 }finally{if(node)await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
