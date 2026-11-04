import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeAtomMemory } from '../lib/mind/native-atoms.mjs';
test('supports non-word graph, vector, and binary payloads',()=>{
 const m=new NativeAtomMemory();
 for(const [format,payload] of [['graph',{nodes:[1,2],edges:[[1,2]]}],['vector',[0.2,-0.3]],['binary',{encoding:'base64',bytes:'AAECAw=='}]]){
  const p=m.propose({format,payload});assert.equal(p.status,'quarantined');assert.equal(m.get(p.id),null);
  assert.equal(m.get(p.id,{includeQuarantine:true}).format,format);
 }
});
test('quarantines chat and requires two distinct trusted verifier identities',()=>{
 const state={},m=new NativeAtomMemory({state});
 const auth={authenticate: e=>e.verifier==='trusted:lab-a'||e.verifier==='trusted:lab-b'};
 const p=m.propose({format:'event',payload:{claim:'unknown'},source:'untrusted-chat'});
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-a',evidenceId:'proof-0001'},auth).status,'quarantined');
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-a',evidenceId:'proof-0002'},auth).status,'quarantined');
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-b',evidenceId:'proof-0003'},auth).status,'validated');
 assert.ok(new NativeAtomMemory({state}).get(p.id));
});
test('rejected evidence prevents promotion',()=>{
 const m=new NativeAtomMemory(),p=m.propose({format:'relation',payload:{x:'y'}});
 const auth={authenticate:()=>true};
 assert.equal(m.verify({id:p.id,verified:false,verifier:'trusted:lab-a',evidenceId:'proof-0001'},auth).status,'rejected');
 assert.equal(m.get(p.id),null);
});

test('verification fails closed without authenticated verifier',()=>{
 const m=new NativeAtomMemory(),p=m.propose({format:'structured',payload:{x:1}});
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:forged',evidenceId:'proof-0001'}).ok,false);
 assert.equal(m.get(p.id),null);
});
test('owner can extend atom formats without code changes',()=>{
 const m=new NativeAtomMemory();
 assert.equal(m.registerFormat('sensor-fusion').ok,false);
 assert.equal(m.registerFormat('sensor-fusion',{authorized:true}).ok,true);
 assert.equal(m.propose({format:'sensor-fusion',payload:{channels:[1,2]}}).ok,true);
});
