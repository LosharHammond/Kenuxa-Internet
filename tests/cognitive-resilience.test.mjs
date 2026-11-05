import test from 'node:test';
import assert from 'node:assert/strict';
import {UnifiedCognition} from '../lib/mind/unified-cognition.mjs';

function fixture(overrides={}){
 const state={};
 const skills={predict:()=>({ok:false}),status:()=>({validated:0})};
 const mind={think:()=>({handled:true,answer:'Safe inference'}),store:{status:()=>({atoms:3})}};
 const foundation={answer:q=>/^define /i.test(q)?{answer:'Dictionary definition available.',kind:'definition'}:null};
 return new UnifiedCognition({state,contextual:()=>null,skills,ontology:{answer:()=>null},
   foundation,mind,...overrides});
}
test('one broken conversation adapter does not take down available dictionary knowledge',()=>{
 let failures=0;
 const c=fixture({contextual:()=>{failures++;throw new Error('fault in local parser')}});
 assert.equal(c.answer('Define instrument').answer,'Dictionary definition available.');
 assert.equal(c.answer('Define instrument').answer,'Dictionary definition available.');
 assert.equal(c.answer('Define instrument').answer,'Dictionary definition available.');
 assert.equal(failures,2,'circuit breaker temporarily isolates a repeatedly failing adapter');
 assert.equal(c.status().components.conversation.state,'isolated');
 assert.equal(c.status().recentFaults.length,2);
});
test('broken learned skill execution and ontology still leave healthy dictionary available',()=>{
 const c=fixture({skills:{predict:()=>{throw new Error('skill crashed')},status:()=>({})},
   ontology:{answer:()=>{throw new Error('ontology crashed')}}});
 assert.match(c.answer('Define instrument').answer,/Dictionary/);
 assert.match(c.answer('Define instrument').answer,/Dictionary/);
 assert.equal(c.status().components['learned-procedures'].state,'isolated');
 assert.equal(c.status().components.ontology.state,'isolated');
});
test('faulty Mind cannot crash the coordinator or erase its saved knowledge',()=>{
 const s={mind:{saved:'knowledge'}};
 const c=fixture({state:s,mind:{think:()=>{throw new Error('mind failed')},store:{status:()=>({})}}});
 assert.equal(c.reason('any prompt'),null);
 assert.equal(s.mind.saved,'knowledge');
 assert.match(c.answer('Define instrument').answer,/Dictionary/);
});
