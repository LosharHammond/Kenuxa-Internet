import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';
import {FabricInterpreter} from '../lib/mind/fabric-model.mjs';

test('actual node uses the Cognitive Fabric and preserves its journal across process restarts',{timeout:90000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-cognitive-fabric-'));
 const env={HOST:'127.0.0.1',NODE_ID:'fabric-restart-test',DATA_DIR:dir,
  ADMIN_TOKEN:'cognitive-fabric-local-admin-test-123456789',
  KENUXA_NETWORK:'off',CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false',
  TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',
  AUTONOMOUS_LEARNING:'off',GROQ_API_KEY:'',
  PUBLIC_QUESTIONS_PER_MINUTE:'100'};
 let first,second;
 try{
  first=await createNode({env,log:()=>{}});
  assert.equal(first.cognitiveFabric.status().mode,'multi-capability-evidence-kernel');
  const question='Is a dog an animal?';
  const reply=await first.handle({method:'POST',url:'/chat/ask',
   headers:{host:'localhost','content-type':'application/json'},
   remoteAddress:'127.0.0.1',body:JSON.stringify({question,history:[]})});
  assert.equal(reply.status,200,JSON.stringify(reply.body));
  const answer=JSON.parse(reply.body);
  assert.match(answer.engine,/unified cognition/i);
  assert.equal(answer.fabric?.version,1,'the live public chat must use the new kernel');
  const j=first.cognitiveFabric.journal;
  assert.equal(j.depend('mol:fictional',['atom:fictional'],{kind:'molecule'}).ok,true);
  assert.equal(first.cognitiveFabric.verifiedUpdate({
   id:'atom:fictional',kind:'atom',revision:1,proof:'independent controlled evidence'
  },{authorized:true}).invalidated,1);
  await first.cognitiveFabric.save();await first.flush();await first.stop();first=null;
  second=await createNode({env,log:()=>{}});
  assert.equal(second.cognitiveFabric.journal.verifyChain().ok,true);
  assert.equal(second.cognitiveFabric.status().journal.revision,1);
  assert.equal(second.cognitiveFabric.status().journal.pending,1);
 }finally{if(first)await first.stop();if(second)await second.stop();
  fs.rmSync(dir,{recursive:true,force:true});}
});
test('quantized local-model HTTP adapter accepts a mock OpenAI-compatible interpreter without remote service',async()=>{
 let called=0;
 const env={KENUXA_FABRIC_MODEL_BACKEND:'local',
   KENUXA_FABRIC_MODEL_ID:'cpu-local-model',
   KENUXA_FABRIC_MODEL_URL:'http://127.0.0.1:8080/v1/chat/completions'};
 const interpreter=new FabricInterpreter({env,fetcher:async(url,request)=>{
  called++;assert.equal(url,env.KENUXA_FABRIC_MODEL_URL);
  const req=JSON.parse(request.body);
  assert.equal(req.messages[0].role,'system');
  return {ok:true,status:200,text:async()=>JSON.stringify({
   choices:[{message:{content:JSON.stringify({kind:'arithmetic',
    operation:'subtract',left:9,right:2,unit:'wheels',subject:'Nori',
    support:['Nori has 9 wheels','Nori loses 2 wheels']})}}]
  })};
 }});
 const frame=await interpreter.interpret('Nori has 9 wheels. Nori loses 2 wheels. How many remain?');
 assert.equal(frame.left,9);assert.equal(frame.right,2);assert.equal(called,1);
});
