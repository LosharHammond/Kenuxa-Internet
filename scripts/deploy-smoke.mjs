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
console.log(JSON.stringify({ok:true,origin,commit:health.buildCommit,engine:response.data.engine,answerLength:response.data.answer.length}));
