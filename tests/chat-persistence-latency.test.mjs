import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';

test('public chat does not block behind slow asynchronous state persistence on a long-running host',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-chat-write-latency-'));
 const env={HOST:'127.0.0.1',NODE_ID:'slow-storage-test',DATA_DIR:dir,
   ADMIN_TOKEN:'slow-storage-test-admin-token-1234567890',RESEARCH_ENABLED:'false',
   CRAWLER_ENABLED:'false',GROQ_API_KEY:'',KENUXA_NETWORK:'off',
   TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',
   AUTONOMOUS_LEARNING:'off',PUBLIC_QUESTIONS_PER_MINUTE:'50'};
 let node;
 try{
   node=await createNode({env,log:()=>{}});
   await node.flush();
   const original=node.store.save.bind(node.store);
   let saves=0;
   node.store.save=async(...args)=>{saves++;await new Promise(resolve=>setTimeout(resolve,2200));return original(...args);};
   const request={method:'POST',url:'/chat/ask',headers:{host:'localhost','content-type':'application/json'},
    remoteAddress:'127.0.0.1',body:JSON.stringify({question:'A fictional device called a Xurlon has seven flanges. UnitQ is a Xurlon. How many flanges does UnitQ have?',history:[],conversation:'fast-storage-test'})};
   const before=performance.now(),response=await node.handle(request),elapsed=performance.now()-before;
   assert.equal(response.status,200,response.body);
   const answer=JSON.parse(response.body);
   assert.match(answer.answer,/7 flanges/);
   assert.ok(saves>0,'unseen word atomization must enqueue an actual write');
   assert.ok(elapsed<1800,'chat blocked on artificial 2200ms store write: '+elapsed);
   assert.ok(Number.isFinite(answer.performance?.latencyMs));
   await node.flush();
 }finally{if(node)await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
