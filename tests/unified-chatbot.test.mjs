// Real public chatbot regression, not a unit test of a disconnected solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';

test('new conversation routes name, fictional quantities, inheritance and lexical knowledge through one chatbot',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-unified-chat-'));
 const env={HOST:'127.0.0.1',NODE_ID:'unified-chat-test',DATA_DIR:dir,
   ADMIN_TOKEN:'unified-chat-test-admin-123456789abcdef',KENUXA_NETWORK:'off',
   CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false',TRANSFORMER_TRAINING:'false',
   TRANSFORMER_ENABLED:'false',AUTONOMOUS_LEARNING:'off',GROQ_API_KEY:'',
   PUBLIC_QUESTIONS_PER_MINUTE:'30',PUBLIC_QUESTIONS_PER_DAY:'2000'};
 let node;
 try{
  node=await createNode({env,log:()=>{}});
  const history=[];
  const ask=async(question,record=true)=>{
    const response=await node.handle({method:'POST',url:'/chat/ask',
      headers:{host:'localhost','content-type':'application/json'},
      remoteAddress:'127.0.0.1',body:JSON.stringify({question,history,conversation:'unified-test-conversation'})});
    assert.equal(response.status,200,JSON.stringify(response.body));
    const data=JSON.parse(response.body);
    assert.ok(typeof data.answer==='string'&&data.answer.trim().length>0);
    if(record)history.push({question});
    return data;
  };
  const a=await ask('My name is Kofi. Remember that for this conversation.');
  assert.match(a.answer,/Kofi/);
  const b=await ask('What is my name?');assert.match(b.answer,/Kofi/);
  const c=await ask('A fictional sensor called a Velon has eight channels. Every Velon can rotate. Nova is a Velon. How many channels does Nova have and can Nova rotate? Explain.');
  assert.match(c.answer,/8 channels/);assert.match(c.answer,/can rotate/);
  const d=await ask('If Nova loses two channels, how many remain? Explain.');
  assert.match(d.answer,/6 channels remaining/);
  const recallStarted=performance.now();
  const e=await ask('What did I tell you about the Velon earlier?');
  assert.ok(performance.now()-recallStarted<5000,'conversation recall must not fall into slow teacher or web cascade');
  assert.ok(Number.isFinite(e.performance?.latencyMs),'server must expose real latency for diagnostics');
  assert.match(e.answer,/Velon has 8 channels/);
  const dictionary=await ask('Define dog',false);
  assert.match(dictionary.answer,/dog/i);assert.match(dictionary.engine,/unified cognition/);
  const relation=await ask('Is a python an animal?',false);
  assert.match(relation.answer,/animal/i);assert.match(relation.answer,/sense/i);
  const status=node.unifiedCognition.status();
  assert.ok(status.answered>=7);
  assert.ok(status.skillMemory&&status.cognitiveMemory);
 }finally{if(node)await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
