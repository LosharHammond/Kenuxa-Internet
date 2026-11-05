// Release smoke test for the actual Render deployment. Requires no private credentials.
// Checks exact deployed commit when Render exposes RENDER_GIT_COMMIT.
import assert from 'node:assert/strict';
const origin=String(process.env.DEPLOYMENT_URL||'https://kenuxa-internet.onrender.com').replace(/\/$/,'');
const expected=String(process.env.EXPECTED_COMMIT||'');
const attempts=Math.max(1,Math.min(20,Number(process.env.DEPLOY_ATTEMPTS||12)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,options={}){
 const res=await fetch(origin+path,{...options,signal:AbortSignal.timeout(45000)});
 const body=await res.text();let data;try{data=JSON.parse(body);}catch{data=null;}
 return {status:res.status,data,body:body.slice(0,300)};
}
let health,lastError;
for(let i=0;i<attempts;i++){
 try{
  const r=await request('/health');
  assert.equal(r.status,200,'health HTTP '+r.status);
  assert.equal(r.data?.status,'ok');
  const actual=String(r.data?.buildCommit||'');
  if(expected&&actual&&!expected.startsWith(actual)&&!actual.startsWith(expected.slice(0,12)))
   throw new Error('new commit is not deployed yet: '+actual);
  if(expected&&!actual)throw new Error('health endpoint does not expose a deployment SHA; cannot verify release identity');
  health=r.data;break;
 }catch(e){lastError=e;console.log('Deployment check '+(i+1)+'/'+attempts+': '+e.message);if(i+1<attempts)await delay(30000);}
}
if(!health)throw new Error('Live deployment verification failed: '+String(lastError?.message));
const response=await request('/chat/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Define dog',history:[]})});
assert.equal(response.status,200,JSON.stringify(response));
assert.ok(typeof response.data?.answer==='string'&&response.data.answer.length>20,'chatbot did not return a substantive answer');
assert.match(String(response.data.engine||''),/foundation cognition|dictionary/i,'dictionary was not used by the deployed chatbot');

// Verify an entire unseen reasoning conversation against the ACTUAL deployed chat
// endpoint after warming the service. This catches regressions that a local
// in-process test or a single dictionary lookup cannot detect.
const cases=[
  {
    q:'My name is Arin. Use that name for this conversation.',
    check:d=>/Arin/i.test(d.answer)
  },
  {q:'What is my name?',check:d=>/Arin/i.test(d.answer)},
  {
    q:'A fictional instrument called a Neralith has seven channels. Every Neralith can rotate. Io is a Neralith. How many channels does Io have, and can Io rotate? Explain.',
    check:d=>/7 channels/i.test(d.answer)&&/can rotate/i.test(d.answer)
  },
  {
    q:'If Io loses three channels, how many remain? Explain.',
    check:d=>/4 channels remaining/i.test(d.answer)
  },
  {
    q:'What did I tell you about the Neralith earlier?',
    check:d=>/Neralith has 7 channels/i.test(d.answer)
  },
  {
    q:'Which of your earlier conclusions were statements I supplied, which were deductions, and which remain uncertain?',
    check:d=>/Neralith has 7 channels/i.test(d.answer)&&/Io inherits 7 channels/i.test(d.answer)&&/uncertain/i.test(d.answer)
  },
  {
    q:'Correction: A Neralith has five channels, not seven. How many channels did I originally say it had, and can you identify the conflict?',
    check:d=>/originally.*7 channels/i.test(d.answer)&&/latest.*5 channels/i.test(d.answer)&&/conflict/i.test(d.answer)
  }
];
const history=[],durations=[];
const convId='smoke-'+(expected||String(Date.now())).slice(0,12);
for(let i=0;i<cases.length;i++){
  const testcase=cases[i];
  const started=performance.now();
  const response=await request('/chat/ask',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({question:testcase.q,history:history.slice(-8),conversation:convId})});
  const wallMs=Math.round(performance.now()-started);
  assert.equal(response.status,200,'live test '+(i+1)+': HTTP '+response.status+': '+response.body);
  const data=response.data;
  assert.ok(data&&testcase.check(data),'live test '+(i+1)+' unexpectedly answered: '+String(data?.answer).slice(0,650));
  assert.ok(/unified cognition/i.test(data.engine||''),'live test '+(i+1)+' used unexpected engine: '+data.engine);
  assert.ok(Number.isFinite(data.performance?.latencyMs),'live test '+(i+1)+' has no measured server latency');
  // This check measures WARM response latency, not Render cold-start time.
  assert.ok(data.performance.latencyMs<10000,'live test '+(i+1)+' exceeded warm 10-second response budget: '+data.performance.latencyMs+'ms; phases='+JSON.stringify(data.performance.phases||{}));
  durations.push({n:i+1,wallMs,serverMs:data.performance.latencyMs,phases:data.performance.phases||null,engine:data.engine});
  history.push({question:testcase.q,answer:data.answer,entityIds:data.entityIds||[],context:data.context||null});
}
console.log(JSON.stringify({ok:true,origin,commit:health.buildCommit,
  dictionary:{engine:response.data.engine,answerLength:response.data.answer.length},
  conversation:{passed:cases.length,latency:durations}}));

