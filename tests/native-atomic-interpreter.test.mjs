import test from 'node:test';
import assert from 'node:assert/strict';
import {FabricInterpreter,executeSemanticFrame} from '../lib/mind/fabric-model.mjs';
test('KENUXA native checkpoint can interpret unfamiliar atoms without a pretrained provider',async()=>{
 let invoked=0;
 const transformer={enabled:true,step:1500,release:{live:{version:2}},
  draft:()=>{invoked++;return {text:JSON.stringify({kind:'arithmetic',
   operation:'subtract',left:17,right:4,subject:'Virexa',unit:'sensors',
   support:['Virexa has 17 sensors','Virexa loses 4 sensors']})};}};
 const i=new FabricInterpreter({transformer,env:{KENUXA_FABRIC_MODEL_BACKEND:'native',
  KENUXA_FABRIC_NATIVE_INFERENCE:'true'}});
 assert.equal(i.available,true);
 const question='Virexa has 17 sensors. Virexa loses 4 sensors. How many sensors remain?';
 const frame=await i.interpret(question);
 assert.equal(executeSemanticFrame(frame,{question}).operation.result,13);
 assert.equal(invoked,1);
});
test('untrained checkpoint and free hosted node do not block chat with synchronous inference',()=>{
 const transformer={enabled:true,step:4000,release:{live:{version:3}}};
 const i=new FabricInterpreter({transformer,env:{RENDER:'true',
  KENUXA_FABRIC_MODEL_BACKEND:'native',KENUXA_FABRIC_NATIVE_INFERENCE:'true'}});
 assert.equal(i.available,false);
 const untrained=new FabricInterpreter({transformer:{...transformer,step:0,release:{live:{version:0}}},
  env:{KENUXA_FABRIC_MODEL_BACKEND:'native',KENUXA_FABRIC_NATIVE_INFERENCE:'true'}});
 assert.equal(untrained.available,false);
});
