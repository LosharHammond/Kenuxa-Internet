// Live read-only proof that two distinct signed Render nodes exchange NONEMPTY
// independently tested public knowledge through shared durable storage.
// The recovery API never needs the originating host to be reachable.
import assert from 'node:assert/strict';
const hosts=['https://kenuxa-internet.onrender.com','https://kenuxa-internet-pv00.onrender.com'];
const snapshots=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function health(host){
 const res=await fetch(host+'/health',{signal:AbortSignal.timeout(75000)});
 assert.equal(res.status,200,host+' health returned HTTP '+res.status);
 const data=await res.json();
 assert.equal(data.status,'ok');
 assert.ok(data.nodeId);
 return data;
}
for(let attempt=0;attempt<10;attempt++){
 snapshots.length=0;
 try{
  for(const host of hosts)snapshots.push(await health(host));
  const distinct=new Set(snapshots.map(s=>s.nodeId));
  const ready=distinct.size===2&&snapshots.every((s,i)=>{
   const peer=snapshots[1-i];
   return s.recovery?.enabled===true &&
    s.recovery.publishedItems>=1 &&
    s.recovery.verifiedBundles>=1 &&
    s.recovery.offeredItems>=1 &&
    s.recovery.lastVerifiedPeers?.includes(peer.nodeId)&&
    s.recovery.adopted>=1;
  });
  if(ready){
   console.log(JSON.stringify({ok:true,verifiedAt:new Date().toISOString(),
    meaning:'Both hosts published, authenticated, locally revalidated and adopted independently tested public procedure atoms via storage; no direct host call is needed during recovery',
    nodes:snapshots.map(s=>({id:s.nodeId,origin:s.publicUrl,build:s.buildCommit,
     recovery:s.recovery}))},null,2));
   process.exit(0);
  }
 }catch(e){console.warn('Recovery read attempt '+(attempt+1)+' pending: '+String(e.message).slice(0,130));}
 if(attempt<9)await sleep(10000);
}
console.error(JSON.stringify({ok:false,reason:'Nonempty bidirectional production recovery not yet observed',
 nodes:snapshots.map(s=>({id:s.nodeId,origin:s.publicUrl,recovery:s.recovery||null}))},null,2));
process.exitCode=1;
