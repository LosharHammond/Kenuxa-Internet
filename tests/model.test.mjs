import test from 'node:test';
import assert from 'node:assert/strict';
import {AnswerModel} from '../lib/model.mjs';
import {seeds} from '../lib/seed.mjs';
import {teach} from '../lib/teacher.mjs';
import {headers,verify,peerOrigin} from '../lib/federation.mjs';

test('own model learns starter answers, generalizes a paraphrase and abstains',()=>{
 const model=new AnswerModel(seeds());
 assert.match(model.predict('Which city is the capital of Ghana?').atom.answer,/Accra/);
 assert.match(model.predict('Explain solar energy').atom.answer,/sunlight/);
 assert.equal(model.predict('Describe quantum chromodynamics confinement'),null);
 assert.equal(model.predict('What is the capital of Nigeria?'),null);
 assert.ok(model.loss<0.2); assert.ok(model.snapshot().weights.some(w=>Object.keys(w).length));
});
test('teacher is isolated and drafts structured lessons through Groq',async()=>{
 let called=false;
 const result=await teach('basic science',{key:'test-only',model:'test-model',fetcher:async(url,options)=>{
  called=true;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(JSON.parse(options.body).messages.length,2);
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({lessons:[{title:'Test',answer:'Draft',questions:[],tags:[]}]})}}]})};
 }});
 assert.ok(called);assert.equal(result.lessons[0].answer,'Draft');
 await assert.rejects(()=>teach('test',{key:''}),/not configured/);
 await assert.rejects(()=>teach('test',{key:'test',fetcher:async()=>({ok:false,status:429})}),/429/);
});
test('federation rejects wrong keys, replays, expired signatures and unsafe peers',()=>{
 const secret='test-network-secret-'.repeat(3),seen=new Map(),h=headers(secret,'GET','/federation/snapshot');
 assert.ok(verify(secret,'GET','/federation/snapshot','',h,seen));
 assert.equal(verify(secret,'GET','/federation/snapshot','',h,seen),false);
 assert.equal(verify('wrong-secret'.repeat(4),'GET','/federation/snapshot','',h,new Map()),false);
 assert.equal(verify(secret,'GET','/federation/snapshot','',{...h,'x-kenuxa-time':'1'},new Map()),false);
 assert.throws(()=>peerOrigin('http://169.254.169.254/'));
 assert.equal(peerOrigin('https://kenuxa.up.railway.app'),'https://kenuxa.up.railway.app');assert.throws(()=>peerOrigin('https://10.0.0.1/'));assert.throws(()=>peerOrigin('https://router.local/'));
 assert.throws(()=>peerOrigin('https://node.onrender.com/path'));
 assert.equal(peerOrigin('https://kenuxa-a.onrender.com'),'https://kenuxa-a.onrender.com');
});
