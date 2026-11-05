import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';

test('public chat retains unknown quantitative entity state across turns without provider', {timeout:90000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-stateful-'));
 const env={HOST:'127.0.0.1',NODE_ID:'stateful-unknown',DATA_DIR:dir,
  ADMIN_TOKEN:'stateful-test-admin-key-123456789000',
  KENUXA_NETWORK:'off',CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false',
  TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',AUTONOMOUS_LEARNING:'off',
  GROQ_API_KEY:'',PUBLIC_QUESTIONS_PER_MINUTE:'100'};
 let n;
 const ask=async(question,history=[])=>{
  const res=await n.handle({method:'POST',url:'/chat/ask',headers:{host:'localhost',
   'content-type':'application/json'},remoteAddress:'127.0.0.1',
   body:JSON.stringify({question,history})});
  assert.equal(res.status,200,JSON.stringify(res.body));return JSON.parse(res.body);
 };
 try{
  n=await createNode({env,log:()=>{}});
  const novel='Nnovelxy';
  const one=novel+' has 17 shells. '+novel+' loses 6 shells. How many remain?';
  const first=await ask(one);
  assert.match(first.answer,/\b11\b/,JSON.stringify(first));
  const two=novel+' receives 3 more shells. How many shells does it have now?';
  const second=await ask(two,[{question:one,answer:first.answer}]);
  assert.match(second.answer,/\b14\b/,JSON.stringify(second));
  assert.match(second.engine,/quantity-state/);
  const three=novel+' loses 2 shells. How many shells remain?';
  const third=await ask(three,[{question:two,answer:second.answer},{question:one,answer:first.answer}]);
  assert.match(third.answer,/\b12\b/,JSON.stringify(third));
 }finally{if(n)await n.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
