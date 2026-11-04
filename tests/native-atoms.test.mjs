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
 const p=m.propose({format:'event',payload:{claim:'unknown'},source:'untrusted-chat'});
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-a',evidenceId:'proof-0001'}).status,'quarantined');
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-a',evidenceId:'proof-0002'}).status,'quarantined');
 assert.equal(m.verify({id:p.id,verified:true,verifier:'trusted:lab-b',evidenceId:'proof-0003'}).status,'validated');
 assert.ok(new NativeAtomMemory({state}).get(p.id));
});
test('rejected evidence prevents promotion',()=>{
 const m=new NativeAtomMemory(),p=m.propose({format:'relation',payload:{x:'y'}});
 assert.equal(m.verify({id:p.id,verified:false,verifier:'trusted:lab-a',evidenceId:'proof-0001'}).status,'rejected');
 assert.equal(m.get(p.id),null);
});
