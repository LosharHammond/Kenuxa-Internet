import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {headers,verify} from '../lib/federation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const admin='integration-test-admin-token-1234567890', secret='integration-test-network-secret-1234567890';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function start(id,p,peers='',dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-test-'))){
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',RENDER:'',PORT:String(p),NODE_ID:id,DATA_DIR:dir,ADMIN_TOKEN:admin,NETWORK_SECRET:secret,PEER_URLS:peers,ALLOW_LOCAL_PEERS:'true',GROQ_API_KEY:''},stdio:'pipe'});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const origin=`http://127.0.0.1:${p}`;
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(output);try{const r=await fetch(origin+'/health');if(r.ok)return {child,origin,dir};}catch{}await new Promise(r=>setTimeout(r,100));}
 child.kill();throw new Error('Node startup timed out: '+output);
}
async function stop(node){if(!node||node.child.exitCode!==null)return;const done=new Promise(r=>node.child.once('exit',r));node.child.kill();await done;}
async function api(node,url,body){const res=await fetch(node.origin+'/api/'+url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json()};}

test('two real nodes: learn, persist, authenticate, synchronize, review and answer independently', {timeout:30000},async()=>{
 let a,b;const pa=await port(),pb=await port();
 try{
  a=await start('node-a',pa);b=await start('node-b',pb,a.origin);
  assert.equal((await fetch(a.origin+'/api/export')).status,401);
  assert.equal((await fetch(a.origin+'/federation/snapshot')).status,401);
  assert.equal((await api(a,'ask',{question:'What is the capital of Ghana?'})).data.answer.includes('Accra'),true);
  const privateLesson={title:'What is the private lighthouse code?',answer:'PRIVATE-DO-NOT-SHARE',questions:['private lighthouse code'],tags:['private']};
  await api(a,'lessons',privateLesson);
  const lesson={title:'What is the Kenuxa training beacon?',answer:'The Kenuxa training beacon is called Lumen.',questions:['Name the training beacon','Kenuxa beacon name'],tags:['beacon'],visibility:'public'};
  const learned=await api(a,'lessons',lesson);assert.equal(learned.status,200);
  assert.match((await api(a,'ask',{question:'Name the training beacon'})).data.answer,/Lumen/);
  const signed=headers(secret,'GET','/federation/snapshot');const rawResponse=await fetch(a.origin+'/federation/snapshot',{headers:signed});const raw=await rawResponse.text();
  assert.ok(verify(secret,'RESPONSE','/federation/snapshot',raw,Object.fromEntries(rawResponse.headers),new Map()));
  assert.ok(!raw.includes('PRIVATE-DO-NOT-SHARE'));assert.ok(!raw.includes('memory'));
  assert.equal((await fetch(a.origin+'/federation/snapshot',{headers:signed})).status,401);
  const sync=await api(b,'sync',{});assert.equal(sync.data.peers[0].imported,1);
  const before=(await api(b,'ask',{question:'Name the training beacon'})).data;assert.equal(before.confidence,0);
  const queue=(await api(b,'knowledge')).data.atoms;const incoming=queue.find(x=>x.upstreamId===learned.data.atom.id);assert.equal(incoming.status,'pending');
  await api(b,'review',{id:incoming.id,approve:true,visibility:'public'});
  assert.match((await api(b,'ask',{question:'Name the training beacon'})).data.answer,/Lumen/);
  assert.equal((await api(b,'sync',{})).data.peers[0].imported,0);
  assert.equal((await api(b,'teacher',{topic:'energy'})).status,400);
  const bSnap=await fetch(b.origin+'/federation/snapshot',{headers:headers(secret,'GET','/federation/snapshot')});assert.equal((await bSnap.json()).atoms.length,0);
  const dir=b.dir;await stop(b);b=await start('node-b',pb,a.origin,dir);
  assert.match((await api(b,'ask',{question:'Name the training beacon'})).data.answer,/Lumen/);
  const model=JSON.parse(fs.readFileSync(path.join(dir,'model.json')));assert.equal(model.architecture,'sparse-softmax-v1');assert.ok(model.weights.length);
  const backup=(await api(b,'export')).data;assert.ok(backup.atoms.length>13);
  assert.ok((await fetch(a.origin+'/')).headers.get('content-security-policy'));
 }finally{await stop(a);await stop(b);}
});
