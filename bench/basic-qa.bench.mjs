// Fresh-value end-to-end evaluation, no secrets, network, or live teacher.
// Success means the explicit rubric passed, never universal understanding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNode} from '../lib/node.mjs';
let seed=Number(process.argv[2]||20261104)>>>0;const initialSeed=seed;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%97+2;};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kenuxa-qa-eval-'));
const node=await createNode({env:{HOST:'127.0.0.1',DATA_DIR:dir,TRANSFORMER_ENABLED:'false',KENUXA_NETWORK:'off',RESEARCH_ENABLED:'false',CRAWLER_ENABLED:'false',COMPUTE_PEERS:'off'},log:()=>{}});
const cases=[];
const add=(category,question,rubric,check)=>cases.push({category,question,rubric,check});
for(let i=0;i<8;i++){const a=next(),b=next(),c=next();
  add('arithmetic',`Evaluate ${a} * (${b} + ${c})`,`computed result ${a*(b+c)}`,r=>r.answer.includes(`= ${a*(b+c)}.`));
  add('correction',`Check: ${a} * ${b} = ${a*b+3}.`,`correct erroneous result to ${a*b}`,r=>r.answer.includes(`= ${a*b}.`)&&r.answer.includes('incorrect'));
  add('method-transfer',`Convert ${a}.${b} kilometers to meters.`,`fresh unit conversion ${Number(`${a}.${b}`)*1000}`,r=>r.answer.includes(`= ${Number((Number(`${a}.${b}`)*1000).toPrecision(12))} meters`));
}
for(let i=0;i<4;i++){const name='Nera'+i,item='case '+next(),place='locker '+next();
  add('passage-comprehension',`Passage: Nera stored another case on the desk. ${name} stored the ${item} inside ${place}. Question: Where did ${name} store the ${item}?`,'bind exact subject and object; answer relative to passage',r=>r.answer.includes(`inside ${place}`)&&r.native?.status==='answered-relative-to-text');
}
for(const kind of ['email','announcement','paragraph','bullet list'])add('writing',`Write an ${kind} using these facts: The class starts Thursday; Bring a pen.`,'preserve both supplied facts, label as draft',r=>r.answer.includes('class starts Thursday')&&r.answer.includes('Bring a pen')&&r.native?.status==='draft');
for(const q of ['Calculate 9 / 0','Convert 3 kilograms to meters','Passage: Neri did not store the cup in the drawer. Question: Where did Neri store the cup?','Who is the current leader of Blorvax?'])add('uncertainty',q,'explicitly withhold unsupported answer',r=>/cannot|not have reliable|won.t guess|undefined/i.test(r.answer)&&(!r.construction.grounded||r.native?.status==='insufficient'));
// Deliberately broader tasks. Report these separately; unsupported is a coverage failure,
// not silently counted as successful QA because an answer was nonempty.
for(const [q,re] of [
  ['Explain why the sky is blue.',/rayleigh|shorter wavelengths/i],
  ['What is the capital of Japan?',/Tokyo/i],
  ['How many sides does a hexagon have?',/six|6/],
  ['Write a four-line poem about a lighthouse.',/\n.+\n.+\n/],
  ['Translate good morning into Spanish.',/buenos d[ií]as/i],
  ['If all daxes are lumens and all lumens are norts, are all daxes norts?',/yes/i],
])add('broader-challenge',q,'content rubric: '+re,r=>!r.answer.includes("won't guess")&&re.test(r.answer));
const results=[];try{for(const c of cases){const start=performance.now();const {result}=await node.answerQuestion(c.question,{offline:true,memory:[]});results.push({category:c.category,question:c.question,rubric:c.rubric,passed:c.check(result),answer:result.answer,engine:result.engine,performance:result.performance,ms:Math.round(performance.now()-start)});}}finally{await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
const categories={};for(const r of results){categories[r.category]??={passed:0,total:0};categories[r.category].total++;categories[r.category].passed+=Number(r.passed);}
const report={format:'kenuxa-basic-qa-evaluation/1',seed:initialSeed,at:new Date().toISOString(),node:process.version,conditions:'Fresh isolated node, no network, no API keys. Generated values are not saved lessons. Families are known to implementer. Rubrics are limited automated checks; this is not a blind independent benchmark.',teacherAssistance:'None in this evaluation. Simulated teacher attribution is separately tested; live teacher quality is unmeasured.',categories,universalQAEstablished:false,results};
const output=process.env.QA_REPORT||'docs/BASIC-QA-EVALUATION.json';fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,categories,universalQAEstablished:false},null,2));
if(results.some(r=>r.category!=='broader-challenge'&&!r.passed))process.exitCode=1;
