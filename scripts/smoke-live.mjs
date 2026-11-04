// Deployed KENUXA HTTP smoke test. Safe public requests only; no credentials or private data.
// Run: KENUXA_LIVE_URL=https://kenuxa-internet.onrender.com node scripts/smoke-live.mjs
import assert from 'node:assert/strict';
const base=(process.env.KENUXA_LIVE_URL||'https://kenuxa-internet.onrender.com').replace(/\/+$/,'');
const checked=async(path,options={},retry=2)=>{
 let error;
 for(let i=0;i<=retry;i++){
  try{
   const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(85000)});
   const raw=await response.text();
   assert.ok(response.ok, path+' returned HTTP '+response.status+': '+raw.slice(0,150));
   const data=JSON.parse(raw);
   assert.ok(data&&typeof data==='object',path+' did not return JSON');
   return data;
  }catch(e){error=e;if(i<retry)await new Promise(r=>setTimeout(r,2500));}
 }
 throw new Error(path+': '+(error?.message||'unreachable'));
};
let health=await checked('/health');
assert.equal(health.status,'ok','node health check failed');
// Deployment rollouts are eventually consistent. Verify the NEW autonomous code is serving,
// not merely that an older chatbot deployment still returns HTTP 200.
if(process.env.KENUXA_REQUIRE_AUTONOMOUS==='true'){
  for(let i=0;i<8&&(!health.autonomous?.enabled||!health.autonomous?.cycles);i++){
    await new Promise(r=>setTimeout(r,15000));
    health=await checked('/health',{},0);
  }
  assert.ok(health.autonomous?.enabled,'deployed node does not expose autonomous learning');
  assert.ok(health.autonomous.cycles>0,'deployed autonomous curriculum has not executed');
  assert.ok(health.autonomous.trainedSenseDocuments>0,'deployed curriculum has not ingested dictionary senses');
}
const config=await checked('/chat/config');
assert.equal(typeof config.name,'string');
const chat=await checked('/chat/ask',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({question:'Define microscope',history:[]})},1);
assert.equal(typeof chat.answer,'string');
assert.ok(chat.answer.length>15,'no substantive public chatbot answer');
assert.equal(typeof chat.engine,'string');
console.log(JSON.stringify({ok:true,url:base,node:health.nodeId,platform:health.platform,autonomous:health.autonomous||null,buildCommit:health.buildCommit||null,
 chat:{engine:chat.engine,answerLength:chat.answer.length},checkedAt:new Date().toISOString()}));
