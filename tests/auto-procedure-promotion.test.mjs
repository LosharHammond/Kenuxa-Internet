import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentalLearning} from '../lib/mind/developmental-learning-core.mjs';
const add=(m,i,split='train')=>{
 const input={items:Array.from({length:i},(_,k)=>'name'+k)},output={count:i};
 const r=m.observe({input,output,scope:'public',source:'wordnet-intrinsic',consent:true,split});
 assert.equal(m.verifyExample(r.id,{expected:output,authority:true}).ok,true);
};
test('verified independent holdouts automatically promote without owner approval',()=>{
 const state={},m=new DevelopmentalLearning({state});
 for(const n of [3,4,5,6,9])add(m,n);
 for(const n of [7,8])add(m,n,'holdout');
 m.discover();const release=m.autoPromote({scope:'public'});
 assert.ok(release.promoted>=1,JSON.stringify(release));
 assert.equal(m.predict({items:['novel','atomic','vocabulary']},{scope:'public'}).output.count,3);
 const resumed=new DevelopmentalLearning({state:JSON.parse(JSON.stringify(state))});
 assert.equal(resumed.predict({items:[1,2,3,4]},{scope:'public'}).output.count,4);
});
test('unverified and insufficient independent holdouts do not promote',()=>{
 const m=new DevelopmentalLearning();
 for(const n of [3,4,5,6])add(m,n);
 add(m,7,'holdout');
 const fake=m.observe({input:{items:['a','b','c','d','e','f','g','h']},
  output:{count:999},scope:'public',source:'wordnet-intrinsic',consent:true,split:'holdout'});
 assert.equal(m.verifyExample(fake.id,{expected:{count:8},authority:true}).ok,false);
 m.discover();assert.equal(m.autoPromote({scope:'public'}).promoted,0);
});
