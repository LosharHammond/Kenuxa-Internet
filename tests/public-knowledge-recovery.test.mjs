import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureIdentity} from '../lib/mesh.mjs';
import {CognitiveStore} from '../lib/mind/atoms.mjs';
import {PublicKnowledgeRecovery} from '../lib/mind/public-recovery.mjs';
import {LIBRARY} from '../lib/mind/procedures.mjs';

function setup(){
 const saved=new Map(),registry=[];
 const store=id=>({publicKnowledge:{
  publish:async(node,bytes)=>{if(node!==id)throw Error('unauthorized publish');saved.set(node,Buffer.from(bytes));},
  read:async node=>saved.get(node)||null,
  list:async()=>registry
 }});
 const aIdentity=ensureIdentity({}),bIdentity=ensureIdentity({});
 const trusted=[{fingerprint:aIdentity.fingerprint,publicKey:aIdentity.publicKey,
  reputation:0.7,url:'https://origin.example'}];
 const A=new CognitiveStore({state:{}}),B=new CognitiveStore({state:{}});
 registry.push({node_id:'node-origin',public_url:'https://origin.example'},
  {node_id:'node-survivor',public_url:'https://survivor.example'});
 const original=new PublicKnowledgeRecovery({store:store('node-origin'),identity:aIdentity,
  cognitiveStore:A,knownPeers:()=>[],nodeId:'node-origin'});
 const survivor=new PublicKnowledgeRecovery({store:store('node-survivor'),identity:bIdentity,
  cognitiveStore:B,knownPeers:()=>trusted,nodeId:'node-survivor'});
 return {saved,A,B,original,survivor,trusted};
}
test('verified public procedure survives origin node failure in shared durable storage',async()=>{
 const {A,B,original,survivor}=setup();
 const spec=LIBRARY.find(x=>x.id==='proc:energy-consumption');
 const put=A.put({...spec,id:'proc:recovery-energy',status:'promoted',visibility:'public',
  provenance:{source:'verified-owner',derivedFrom:[]}}, {reason:'verified controlled teaching'});
 assert.equal(put.ok,true,JSON.stringify(put));
 A.put({...spec,id:'proc:private-energy',status:'promoted',visibility:'private',
  provenance:{source:'private-owner'}});
 const published=await original.publish();
 assert.equal(published.ok,true);
 assert.equal(published.items,1,'no private atom in the shared bundle');
 // The original node disappears. The survivor never contacts it:
 const recovered=await survivor.recover();
 assert.equal(recovered.examined,1);
 assert.deepEqual(recovered.adopted,['proc:recovery-energy']);
 assert.equal(B.get('proc:recovery-energy').status,'adopted-from-peer');
 assert.equal(B.get('proc:private-energy'),null);
 assert.equal((await survivor.recover()).adopted.length,0,'idempotent recovery');
});
test('unknown, corrupted and impersonated snapshots cannot become trusted knowledge',async()=>{
 const {A,original,survivor,saved,trusted}=setup();
 const spec=LIBRARY.find(x=>x.id==='proc:energy-consumption');
 A.put({...spec,id:'proc:recovery-energy',status:'promoted',visibility:'public'});
 await original.publish();
 const valid=saved.get('node-origin');
 trusted[0].reputation=0.1;
 let r=await survivor.recover();
 assert.deepEqual(r.adopted,['proc:recovery-energy'],'signed offline source remains recoverable despite transport reputation');
 trusted[0].reputation=0.8;
 const modified=JSON.parse(valid.toString());
 modified.data.items[0].atom.body.steps[0].expr='1+1';
 saved.set('node-origin',Buffer.from(JSON.stringify(modified)));
 r=await survivor.recover();assert.equal(r.adopted.length,0);
 assert.ok(r.rejected.length>0);
 saved.set('node-origin',valid);
 trusted[0].fingerprint='kx'+'f'.repeat(30);
 r=await survivor.recover();assert.equal(r.adopted.length,0);
});

test('reviewed core procedure is published with executable evidence without private data',async()=>{
 const {A,original,survivor}=setup();
 const initial=original.seedVerifiedCore();
 assert.equal(initial.ok,true,JSON.stringify(initial));
 assert.equal(initial.seeded,true);
 const stored=A.get(initial.id);
 assert.equal(stored.status,'promoted');
 assert.equal(stored.visibility,'public');
 const published=await original.publish();
 assert.ok(published.items>0,'live recovery bundle must not be empty');
 const recovery=await survivor.recover();
 assert.equal(recovery.adopted.includes(initial.id),true,JSON.stringify(recovery));
});
