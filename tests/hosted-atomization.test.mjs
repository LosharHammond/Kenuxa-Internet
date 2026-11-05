import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';

test('hosted chatbot replies before slow atomic hydration, then learns in idle queue',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-hosted-idle-'));
 const node=await createNode({env:{
   KENUXA_PLATFORM:'render',HOST:'127.0.0.1',NODE_ID:'hosted-idle-test',
   DATA_DIR:dir,ADMIN_TOKEN:'hosted-atom-queue-test-secret-123456789',
   KENUXA_NETWORK:'off',TRANSFORMER_ENABLED:'false',AUTONOMOUS_LEARNING:'off',
   RESEARCH_ENABLED:'false',CRAWLER_ENABLED:'false',COMPUTE_PEERS:'off',
   TRANSFORMER_TRAINING:'false'
 },log:()=>{}});
 try{
   // The production interpreter activates the induced grammar only after sufficient observations.
   // Make the spy reachable without changing the initial chatbot's deferred-atomization policy.
   node.autonomousLearning.grammar.S.observed = 30;
   let grammarCalls=0;
   node.autonomousLearning.grammar.tags=()=>{
     grammarCalls++;
     const stop=performance.now()+150;
     while(performance.now()<stop){} // deliberately simulate CPU-heavy grammar analysis
     return {tags:[],unknown:0};
   };
   const start=performance.now();
   const response=await node.handle({method:'POST',url:'/chat/ask',
     headers:{host:'localhost','content-type':'application/json'},
     remoteAddress:'127.0.0.1',
     body:JSON.stringify({question:'My name is Rami. Use that name for this conversation.',history:[],conversation:'hosted-idle-case'})});
   const elapsed=performance.now()-start,data=JSON.parse(response.body);
   assert.equal(response.status,200);
   assert.match(data.answer,/Rami/);
   assert.equal(data.performance.lexicalQueued,true);
   assert.equal(grammarCalls,0,'grammar must not hold up a simple contextual reply');
   assert.ok(elapsed<1000,'fast answer must finish without slow hydration');
   // The same node later performs the queued word-to-atom work.
   const deadline=Date.now()+4000;
   while(grammarCalls<1 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
   assert.ok(grammarCalls>=1,'idle worker must eventually process the queued sentence');
 }finally{await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
