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
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',RENDER:'',PORT:String(p),NODE_ID:id,DATA_DIR:dir,ADMIN_TOKEN:admin,NETWORK_SECRET:secret,PEER_URLS:peers,ALLOW_LOCAL_PEERS:'true',TRANSFORMER_TRAINING:'false',GROQ_API_KEY:'',CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false'},stdio:'pipe'});
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
  await api(a,'grow',{id:learned.data.atom.id,context:'PRIVATE-DNA-CONTEXT'});
  assert.match((await api(a,'ask',{question:'Name the training beacon'})).data.answer,/Lumen/);
  const signed=headers(secret,'GET','/federation/snapshot');const rawResponse=await fetch(a.origin+'/federation/snapshot',{headers:signed});const raw=await rawResponse.text();
  assert.ok(verify(secret,'RESPONSE','/federation/snapshot',raw,Object.fromEntries(rawResponse.headers),new Map()));
  assert.ok(!raw.includes('PRIVATE-DO-NOT-SHARE'));assert.ok(!raw.includes('memory'));assert.ok(!raw.includes('PRIVATE-DNA-CONTEXT'));
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
  assert.equal(backup.version,2);assert.ok(backup.atoms[0].dna.agent.bornFromDNA);
  const provider=await api(b,'providers',{id:'openai',model:'test-model',key:'private-provider-fixture',primary:true});assert.equal(provider.status,200);
  assert.ok(!JSON.stringify((await api(b,'export')).data).includes('private-provider-fixture'));
  assert.ok(!fs.readFileSync(path.join(dir,'state.json'),'utf8').includes('private-provider-fixture'));
  assert.ok((await fetch(a.origin+'/')).headers.get('content-security-policy'));
  const addDomain=async(name,tags)=>(await api(a,'atoms',{name,definition:`${name} is a knowledge domain used for design.`,tags})).data.atom;
  const shoe=await addDomain('Shoe',['fashion']),dress=await addDomain('Dress',['fashion']),perfume=await addDomain('Perfume',['scent']),spray=await addDomain('Body spray',['scent']);
  const m1=(await api(a,'form',{kind:'molecule',title:'Outfit',memberIds:[shoe.id,dress.id]})).data;
  const m2=(await api(a,'form',{kind:'molecule',title:'Scent',memberIds:[perfume.id,spray.id]})).data;
  const cell=(await api(a,'form',{kind:'cell',title:'Fashion cell',memberIds:[m1.id,m2.id]})).data;
  const program=(await api(a,'capabilities/learn',{id:shoe.id,program:{name:'fit-brief',label:'Fit brief',steps:['Consider {{brief}} with {{domain}} knowledge'],checks:['Check wearer comfort']}})).data.program;
  await api(a,'grow',{id:shoe.id,meaning:'Shoes should match the wearer’s comfort needs.'});
  const grown=(await api(a,'entity?id='+encodeURIComponent(cell.id))).data;assert.ok(grown.dna.evolution.revision>cell.dna.evolution.revision);assert.ok(grown.dna.capabilities.includes(program.id));
  const output=await api(a,'agents/run',{id:cell.id,skill:program.id,task:'Walking in Accra'});assert.equal(output.status,200);assert.match(output.data.sections[0].items[0],/Walking in Accra/);
  assert.equal((await api(a,'crawler/config',{sources:['https://127.0.0.1/private']})).status,400);
 }finally{await stop(a);await stop(b);}
});
