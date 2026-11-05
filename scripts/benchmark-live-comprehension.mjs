import {randomBytes} from 'node:crypto';
// An independent deployed evaluation, not a test of memorized examples.
const hosts=['https://kenuxa-internet.onrender.com','https://kenuxa-internet-pv00.onrender.com'];
const name='N'+randomBytes(5).toString('hex');
const scenarios=[
 {label:'unfamiliar-arithmetic',question:'A '+name+' has 17 shells. One '+name+' loses 6 shells. How many shells remain?',
  expected:11,check:s=>/\b11\b/.test(s)},
 {label:'follow-up',question:name+' receives 3 more shells. How many shells does it have now?',
  expected:14,check:s=>/\b14\b/.test(s)},
 {label:'unsupported-evidence',question:'What is the exact diameter in nanometers of the fictional '+name+'? The diameter has never been specified.',
  expected:'uncertain',check:s=>/unknown|not (?:specified|provided|known|enough)|cannot determine|can't determine|no (?:reliable |known )?(?:diameter|information)|unspecified|not establish|don.t have reliable knowledge|i have not invented an answer/i.test(s)}
];
const results=[];
async function ask(origin,body){
 const started=Date.now();
 try{
  const r=await fetch(origin+'/chat/ask',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await r.json();
  return {http:r.status,answer:typeof data.answer==='string'?data.answer:'',
   engine:String(data.engine||''),ms:Date.now()-started};
 }catch(e){return {http:0,answer:'',engine:'',ms:Date.now()-started,
  error:String(e?.message||e).slice(0,120)};}
}
for(const origin of hosts){
 const history=[];
 for(const scenario of scenarios){
  const reply=await ask(origin,{question:scenario.question,history});
  const correct=reply.http===200&&scenario.check(reply.answer);
  results.push({origin,label:scenario.label,correct,expected:scenario.expected,
   http:reply.http,latencyMs:reply.ms,engine:reply.engine,
   responseExcerpt:reply.answer.slice(0,190),error:reply.error||null});
  if(reply.http===200&&reply.answer)history.push({question:scenario.question,answer:reply.answer});
 }
}
const summary={runAt:new Date().toISOString(),generatedConcept:name,
 attempts:results.length,responded:results.filter(x=>x.http===200&&x.responseExcerpt).length,
 correct:results.filter(x=>x.correct).length,
 byHost:hosts.map(origin=>({origin,passed:results.filter(x=>x.origin===origin&&x.correct).length,
  total:scenarios.length})),results};
console.log('KENUXA_DEPLOYED_COMPREHENSION_REPORT '+JSON.stringify(summary,null,2));
if(summary.responded<4)process.exitCode=1;
