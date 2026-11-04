import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {basicAnswer,calculate,performanceAttribution} from '../lib/basic-qa.mjs';
import {createNode} from '../lib/node.mjs';
import {webRequest} from '../lib/adapters.mjs';

test('arithmetic transfers to generated expressions, corrections, and invalid inputs',()=>{
  let seed=730149;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%900+1;};
  for(let i=0;i<100;i++){const a=next(),b=next(),c=next();assert.equal(calculate(`${a} * (${b} - ${c})`),a*(b-c));assert.match(basicAnswer(`Check: ${a} + ${b} = ${a+b+1}.`).answer,new RegExp(`= ${a+b}\\.`));}
  assert.equal(calculate('-5 + 20% * 30'),1);
  assert.match(basicAnswer('Check: 999999999999998 + 1 = 999999999999998.').answer,/incorrect/);
  assert.match(basicAnswer('What is 2 + 2.').answer,/= 4\./);
  for(const invalid of ['1/0','(2+3','2 3','2**3','globalThis.process.exit()','('.repeat(35)+'1'+')'.repeat(35),'1000000000000000 * 10'])assert.throws(()=>calculate(invalid));
  assert.equal(basicAnswer('What happened in 2024?'),null);
});
test('conversions check dimensions and physical boundaries',()=>{
  assert.match(basicAnswer('Convert 3.125 kilometers to meters.').answer,/3125/);
  assert.match(basicAnswer('32 fahrenheit in celsius').answer,/= 0 celsius/);
  for(const q of ['3 kg to meters','1 cubit to meters','-2 kelvin to celsius'])assert.equal(basicAnswer(q).native.status,'insufficient');
});
test('passage comprehension binds subject and object and refuses negation/conflicting updates',()=>{
  const ask=p=>basicAnswer(`Passage: ${p} Question: Where did Neri store the red cup?`);
  assert.match(ask('Osa stored the blue cup on the desk. Neri stored the red cup inside the cabinet.').answer,/inside the cabinet/);
  for(const p of ['Neri did not store the red cup in the cabinet.','Neri stored the red cup in the cabinet. Neri stored the red cup on the shelf.','Neri stored the green cup in the cabinet.'])assert.equal(ask(p).native.status,'insufficient');
  assert.equal(basicAnswer('Passage: The copper box is heavy. Question: Why is the copper box heavy?').native.status,'insufficient');
});
test('writing and summary preserve supplied facts without creating claims',()=>{
  const draft=basicAnswer('Draft an email using only these facts: The workshop starts Friday; Bring a notebook.');
  assert.match(draft.answer,/starts Friday/);assert.match(draft.answer,/Bring a notebook/);assert.equal(draft.native.status,'draft');
  const summary=basicAnswer('Text: Rain filled the tank. The pump remained off. Question: Summarize the text.');assert.ok(summary.answer.includes('The pump remained off.'));
});
test('cached teacher content and teacher-derived methods never become independent results',()=>{
  assert.equal(performanceAttribution({result:{teacherDerived:true,cached:true},assistance:[]}).teacherDerived,true);
  const cached=performanceAttribution({result:{},composedBy:'fixture-model',assistance:[{stage:'composition',reused:true}]});assert.equal(cached.teacherDerived,true);assert.equal(cached.newTeacherCall,false);
  assert.equal(performanceAttribution({result:{methodTeacher:'fixture'}}).teacherDerived,true);
});

test('owner and public HTTP use native methods, report teacher provenance, and respect research disable',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-basic-qa-')),token='basic-qa-isolated-test-owner-token-12345';
  const node=await createNode({env:{HOST:'127.0.0.1',DATA_DIR:dir,ADMIN_TOKEN:token,TRANSFORMER_ENABLED:'false',KENUXA_NETWORK:'off',RESEARCH_ENABLED:'false',CRAWLER_ENABLED:'false',COMPUTE_PEERS:'off'},log:()=>{}});
  let calls=0;const original=node.teachers.list.bind(node.teachers);
  try{
    node.teachers.list=()=>[{id:'fixture',name:'Fixture',primary:true,configured:true}];
    node.teachers.generate=async()=>{calls++;return {provider:'fixture',model:'mock-only',reused:calls>1,data:{answer:'This fixture answer was supplied by a simulated teacher; no live model was called.'}};};
    const ask=async(route,question)=>{const response=await webRequest(node,new Request('http://127.0.0.1'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({question})}),'127.0.0.1');assert.equal(response.status,200);return response.json();};
    for(const route of ['/api/ask','/chat/ask']){const r=await ask(route,'Calculate 47 * 23');assert.match(r.answer,/1081/);assert.equal(r.performance.mode,'native-procedure');assert.equal(r.performance.teacherDerived,false);}
    const next=await node.answerQuestion('Check: 19 * 17 = 324.',{offline:true,memory:[{question:'Calculate 47 * 23',context:{topic:{focus:'47 * 23',question:'Calculate 47 * 23'}}}]});
    assert.equal(next.understanding.context.dependsOnContext,false);assert.equal(next.result.verification.passed,true);
    assert.equal(calls,0,'native tasks must not call the teacher');
    const first=await ask('/chat/ask','Explain the mechanism of zorloplum.');assert.equal(first.performance.teacherDerived,true);assert.equal(first.performance.newTeacherCall,true);
    const reused=await ask('/chat/ask','Explain the mechanism of zorloplum.');assert.equal(reused.performance.teacherDerived,true);assert.equal(reused.performance.newTeacherCall,false);assert.equal(reused.teacherUsed,true);
    node.teachers.list=original;const unknown=await ask('/chat/ask','Who is the current governor of Zorblevia?');assert.equal(unknown.performance.teacherDerived,false);assert.match(unknown.answer,/reliable|not know|won.t guess/i);
  }finally{await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
