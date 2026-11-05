// Read-only production acceptance: two independent Render nodes, signed ATP
// identity, mutual peer visibility and bounded public compute capability.
// Live Render can cold-start; no admin credentials or private chat are sent.
import assert from 'node:assert/strict';
import {verifySigned} from '../lib/mesh.mjs';

const urls=[
 'https://kenuxa-internet.onrender.com',
 'https://kenuxa-internet-pv00.onrender.com'
];
async function get(origin,path){
 let error;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(origin+path,{
    headers:{accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(85000)
   });
   const raw=await response.text();
   assert.equal(response.status,200,origin+path+' HTTP '+response.status);
   return {data:JSON.parse(raw),raw,headers:Object.fromEntries(response.headers)};
  }catch(e){
   error=e;
   if(attempt<2)await new Promise(r=>setTimeout(r,2000));
  }
 }
 throw new Error(origin+path+' unreachable: '+String(error?.message||error).slice(0,100));
}
const result=[];
for(const origin of urls){
 const h=await get(origin,'/health');
 assert.equal(h.data.status,'ok','health status');
 assert.equal(h.data.publicUrl,origin,'public identity URL mismatch');
 assert.equal(h.data.nodeCompute?.enabled,true,'node worker not enabled');
 const response=await get(origin,'/atp/info');
 const who=verifySigned(response.headers,'RESPONSE','/atp/info',response.raw);
 assert.ok(who,'ATP info signature is invalid or absent');
 assert.equal(who.fingerprint,response.data.fingerprint,'ATP signer does not match advertisement');
 assert.equal(response.data.url,origin,'ATP advertised origin mismatch');
 assert.ok(response.data.capabilities?.includes('kunpp-coordinator'),'missing KUNPP compute capability');
 result.push({origin,nodeId:h.data.nodeId,fingerprint:who.fingerprint,
  peers:response.data.peers,build:h.data.buildCommit||null,
  workerCompleted:h.data.nodeCompute?.completed});
}
assert.notEqual(result[0].nodeId,result[1].nodeId,'two hosts share one node namespace');
assert.notEqual(result[0].fingerprint,result[1].fingerprint,'two hosts share one signing key');
for(let i=0;i<result.length;i++){
 const expected=result[1-i].origin;
 assert.ok(result[i].peers?.includes(expected),
  result[i].origin+' does not advertise the other Render host as a verified peer');
}
console.log(JSON.stringify({ok:true,checkedAt:new Date().toISOString(),
  message:'Two uniquely signed hosted nodes mutually advertise each other as KUNPP peers',
  nodes:result.map(({origin,nodeId,fingerprint,build,workerCompleted})=>
   ({origin,nodeId,fingerprint,build,workerCompleted}))}));
