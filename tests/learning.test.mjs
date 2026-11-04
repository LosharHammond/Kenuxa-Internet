import test from 'node:test';
import assert from 'node:assert/strict';
import {LearningEngine,Discovery,validateMethod,critique} from '../lib/learning.mjs';
import {TeacherRegistry} from '../lib/providers.mjs';
import {hydrateAtom,rebuildOrganism} from '../lib/organism.mjs';
const recipe={steps:['discover','read','rank','extract','critique'],maxClaims:2,titleWeight:3};
function fixture(state={atoms:[]},fail=false){
 let calls=0,searches=0;
 const teachers={list:()=>[{id:'groq',primary:true,configured:true}],generate:async()=>{calls++;await new Promise(r=>setTimeout(r,10));if(fail)throw new Error('Offline');return {data:recipe,provider:'groq',model:'fixture'};}};
 const discovery={status:()=>({provider:'fixture',coverage:'Bounded fixture search'}),search:async q=>{searches++;return [{url:'https://example.com/'+(q.includes('Saturn')?'saturn':'venus')}];}};
 const crawler={page:async url=>{const title=url.endsWith('saturn')?'Saturn':'Venus';return {url,title,excerpt:`${title} is a planet in the Solar System and this passage describes its orbital properties.\n${title} has a distinctive atmosphere that scientists investigate using observations and spacecraft.`};}};
 const deps={teachers,discovery,crawler,predict:()=>null,save:()=>{},event:()=>{},addLesson:(x,meta)=>{const a={...x,...meta,id:'atom:'+state.atoms.length,questions:[]};hydrateAtom(a);state.atoms.push(a);return a;}};
 return {state,deps,engine:new LearningEngine(state,deps),counts:()=>({calls,searches})};
}
test('learns a method once, applies it to a new subject, persists evidence, deduplicates concurrent questions',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.engine.ask('What is Venus?'),f.engine.ask('What is Venus?')]);
 assert.equal(a.answer,b.answer);assert.equal(f.counts().calls,1);assert.equal(f.counts().searches,1);assert.ok(a.answer.includes('Venus'));assert.equal(a.teacherUsed,true);
 const repeat=await f.engine.ask('What is Venus?');assert.equal(repeat.teacherUsed,false);assert.equal(repeat.reused,true);assert.equal(f.counts().searches,1);
 const related=await f.engine.ask('Explain Saturn');assert.ok(related.answer.includes('Saturn'));assert.ok(!related.answer.includes('Venus'));assert.equal(related.methodId,a.methodId);assert.equal(related.teacherUsed,false);assert.equal(f.counts().calls,1);
 assert.equal(related.teacherDerived,true,'transferred teacher method retains its lineage');assert.equal(related.methodTeacher,'groq');assert.equal(repeat.teacherDerived,true,'cached answer retains teacher dependency');assert.equal(repeat.teacherCallAttempted,false);
 for(const a of f.state.atoms)a.status='approved';rebuildOrganism(f.state);assert.ok(f.state.organism.cells[0].dna.learning.methodIds.includes(a.methodId));
 for(const e of related.evidence)assert.ok(related.answer.includes(e.quote));
 const persisted=JSON.parse(JSON.stringify(f.state)),g=fixture(persisted);assert.equal((await g.engine.ask('What is Venus?')).reused,true);await g.engine.ask('Describe Venus');assert.equal(g.counts().calls,0);assert.equal(persisted.atoms[0].dna.learning.methodIds[0],a.methodId);
 const fresh=await f.engine.ask('What is Venus?',{refresh:true});assert.equal(fresh.teacherUsed,false);assert.equal(fresh.selfReview.changed,false);assert.ok(f.state.learning.records[0].previousVersion);
 f.state.atoms.find(a=>a.id===f.state.learning.records[0].atomId).status='rejected';assert.match((await f.engine.ask('What is Venus?')).answer,/rejected/);
});
test('related concurrent questions share one teacher attempt; failures never automatically retry',async()=>{
 const f=fixture();await Promise.all([f.engine.ask('Explain Venus'),f.engine.ask('Explain Saturn')]);assert.equal(f.counts().calls,1);
 const g=fixture({atoms:[]},true);await g.engine.ask('Explain Venus');await g.engine.ask('Explain Saturn');assert.equal(g.counts().calls,1);assert.equal(g.state.learning.attempts.explanation.status,'failed');
 assert.throws(()=>validateMethod({...recipe,steps:['execute-arbitrary-code']}),/Unsupported/);
});
test('discovery routes key only to Brave, validates result URLs, and reports search errors',async()=>{
 let call;const d=new Discovery({env:{},request:async(url,options)=>{call={url,options};return {status:200,text:JSON.stringify({query:{search:[{title:'Venus'}]}})};}});
 assert.match((await d.search('What is Venus?'))[0].url,/wikipedia/);assert.match(call.url,/srsearch=venus/);assert.equal(call.options.headers['X-Subscription-Token'],undefined);
 d.configure('fixture-secret');d.request=async(url,options)=>{call={url,options};return {status:200,text:JSON.stringify({web:{results:[{url:'https://example.com/venus',title:'Venus'},{url:'http://localhost/private'}]}})};};assert.equal((await d.search('Venus')).length,1);assert.equal(call.options.headers['X-Subscription-Token'],'fixture-secret');assert.ok(!JSON.stringify(d.status()).includes('fixture-secret'));
 d.request=async()=>({status:429,text:''});await assert.rejects(()=>d.search('Venus'),/HTTP 429/);
});
test('teacher lesson cache survives restart and avoids duplicate upstream requests or quota use',async()=>{
 let calls=0;const state={};const opts={env:{GROQ_API_KEY:'fixture-secret'},request:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {status:200,text:JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]})};}};
 const t=new TeacherRegistry(state,opts);await Promise.all([t.generate('JSON','question'),t.generate('JSON','question')]);assert.equal(calls,1);
 const next=new TeacherRegistry(JSON.parse(JSON.stringify(state)),{env:{}});assert.equal((await next.generate('JSON','question')).reused,true);assert.equal(calls,1);assert.equal(state.teacherUsage.calls,1);assert.ok(!JSON.stringify(state).includes('fixture-secret'));
});

test('critique flags missing citation support and incomplete coverage',()=>{const e=[{url:'https://example.com',quote:'Venus is a planet in the Solar System with an atmosphere studied by scientists.'}];assert.equal(critique('Venus orbital period',e[0].quote,e).metrics.questionTermsCovered,1);assert.equal(critique('Venus','An invented answer',e).supported,false);});
