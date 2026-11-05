import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';
import {LIBRARY} from '../lib/mind/procedures.mjs';

test('two actual KENUXA nodes recover approved procedure after source crash and survivor restart',{timeout:90000},async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-recovery-e2e-'));
 const shared=new Map(),nodes=[];
 const directory=[
  {node_id:'recovery-origin',public_url:'https://origin.example'},
  {node_id:'recovery-survivor',public_url:'https://survivor.example'}];
 const backend=id=>({publish:async(node,bytes)=>{
    assert.equal(node,id);shared.set(node,Buffer.from(bytes));},
  read:async node=>shared.get(node)||null,
  list:async()=>directory});
 const env=(id)=>({HOST:'127.0.0.1',NODE_ID:id,DATA_DIR:path.join(base,id),
  KENUXA_NETWORK:'on',ALLOW_LOCAL_PEERS:'true',ADMIN_TOKEN:'recovery-test-admin-token-12345678900',
  TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',
  CRAWLER_ENABLED:'false',RESEARCH_ENABLED:'false',AUTONOMOUS_LEARNING:'off',
  GROQ_API_KEY:'',SUPABASE_URL:''});
 let A,B,B2;
 try{
  A=await createNode({env:env('recovery-origin'),log:()=>{}});
  B=await createNode({env:env('recovery-survivor'),log:()=>{}});
  A.store.publicKnowledge=backend(A.nodeId);
  B.store.publicKnowledge=backend(B.nodeId);
  const P=LIBRARY.find(x=>x.id==='proc:energy-consumption');
  const published=A.publicRecovery.cognitiveStore.put({...P,id:'proc:e2e-recovery',status:'promoted',
   visibility:'public',provenance:{source:'verified-local-test'}});
  assert.equal(published.ok,true);
  A.publicRecovery.cognitiveStore.put({...P,id:'proc:e2e-private',status:'promoted',
   visibility:'private',provenance:{source:'private-correction'}});
  assert.equal((await A.publicRecovery.publish()).items,1);
  await A.stop();A=null; // original node is offline for the rest of the test
  B.mesh.peers.push({fingerprint:published.atom.provenance?.node||'',publicKey:'',
    reputation:0,url:'https://unused.example'});
  // The peer fingerprint and signing key were verified and saved before the failure.
  const source=JSON.parse(shared.get('recovery-origin').toString()).data;
  B.mesh.peers.push({fingerprint:source.fingerprint,publicKey:source.publicKey,
    url:'https://origin.example',reputation:0.7});
  const recovered=await B.recoveryTick();
  assert.deepEqual(recovered.recover.adopted,['proc:e2e-recovery']);
  assert.equal(B.publicRecovery.cognitiveStore.get('proc:e2e-private'),null);
  await B.flush();await B.stop();B=null;
  B2=await createNode({env:env('recovery-survivor'),log:()=>{}});
  assert.equal(B2.publicRecovery.cognitiveStore.get('proc:e2e-recovery').status,'adopted-from-peer');
 }finally{
  for(const node of [A,B,B2])if(node)await node.stop();
  fs.rmSync(base,{recursive:true,force:true});
 }
});
