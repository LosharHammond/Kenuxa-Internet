import test from 'node:test';
import assert from 'node:assert/strict';
import {seeds} from '../lib/seed.mjs';
import {hydrateAtom,rebuildOrganism,growAtom,runEntity,executeSkill,learnProgram} from '../lib/organism.mjs';
import {TeacherRegistry} from '../lib/providers.mjs';
import {CrawlEngine,inspectWithTeacher} from '../lib/crawler.mjs';
import {isPublicIP,publicURL,robotsAllowed} from '../lib/web.mjs';

function state(){return {atoms:seeds(),organism:{molecules:[],cells:[]},formations:{molecules:[],cells:[]},settings:{primaryTeacher:'groq',maxTeacherCallsPerDay:30}};}
function atom(title,tags){return hydrateAtom({id:'test:'+title,title,answer:title+' is a domain of knowledge.',questions:['Explain '+title],tags,status:'approved',visibility:'private',origin:'test',createdAt:new Date().toISOString()});}
test('atoms generate native specialists; molecule and cell growth follows DNA revisions',()=>{
 const s=state();s.atoms=[atom('Dolphin',['ocean']),atom('Shoe',['fashion']),atom('Dress',['fashion']),atom('Perfume',['scent']),atom('Homemade',['craft']),atom('Body spray',['scent'])];
 s.formations.molecules=[{id:'mol://outfit',title:'Outfit molecule',memberIds:s.atoms.slice(0,3).map(a=>a.id)},{id:'mol://scent',title:'Scent molecule',memberIds:s.atoms.slice(3).map(a=>a.id)}];
 s.formations.cells=[{id:'cell://fashion',title:'Fashion cell',memberIds:['mol://outfit','mol://scent']}];
 rebuildOrganism(s);const m=s.organism.molecules.find(m=>m.id==='mol://outfit'),c=s.organism.cells.find(c=>c.id==='cell://fashion');const mr=m.dna.evolution.revision,cr=c.dna.evolution.revision;
 assert.equal(s.atoms[1].dna.agent.bornFromDNA,s.atoms[1].id);assert.equal(m.dna.agent.level,'medium');assert.equal(c.dna.agent.level,'advanced');assert.equal(c.dna.council.length,3);
 assert.ok(c.dna.capabilities.includes('design-outfit'));assert.ok(c.dna.capabilities.includes('design-scent-concept'));
 growAtom(s.atoms[1],{meaning:'Shoe design includes fit and material selection.',question:'Explain shoe design',context:'Consider warm-weather comfort'});rebuildOrganism(s);
 assert.ok(s.organism.molecules.find(m=>m.id==='mol://outfit').dna.evolution.revision>mr);assert.ok(s.organism.cells.find(c=>c.id==='cell://fashion').dna.evolution.revision>cr);
 assert.equal(s.atoms[1].dna.meaning.claims.length,2);assert.equal(s.atoms[1].dna.identity.id,'test:Shoe');
 const output=executeSkill(s,'cell://fashion','design-outfit','Formal outfit for warm weather in Ghana');assert.match(output.sections[1].items.join(' '),/breathable/);assert.equal(output.engine,'KENUXA native procedural capability runtime');
 assert.equal(runEntity(s,'cell://fashion','Explain Shoe').council.length,3);
 const program=learnProgram(s.atoms[1],{name:'shoe-fit-brief',label:'Create a shoe fit brief',steps:['Start from the wearer’s task: {{brief}}','Record measurements and fit preferences for {{domain}}'],checks:['Confirm comfort with the wearer']});rebuildOrganism(s);
 assert.ok(s.organism.cells.find(c=>c.id==='cell://fashion').dna.capabilities.includes(program.id));
 assert.match(executeSkill(s,'cell://fashion',program.id,'Comfort for a long walk').sections[0].items[0],/Comfort for a long walk/);
});

test('provider adapters route exact keys and models; exports never hold runtime secrets',async()=>{
 const cases=[['groq','chat'],['openai','responses'],['anthropic','anthropic'],['deepseek','chat'],['gemini','gemini'],['xai','responses'],['mistral','chat'],['openrouter','chat'],['custom-lab','chat']];
 for(const [id,style] of cases){const s=state();let seen;
  const registry=new TeacherRegistry(s,{env:{},request:async(url,options)=>{seen={url,options};const text=JSON.stringify({ok:true});return {status:200,text:JSON.stringify(style==='responses'?{output:[{type:'message',content:[{type:'output_text',text}]}]}:style==='anthropic'?{content:[{type:'text',text}]}:style==='gemini'?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]})};}});
  registry.configure({id,base:'https://teacher.example.com/v1',model:'test-model',key:'secret-fixture-key',primary:true});
  assert.equal((await registry.generate('Return JSON','topic')).data.ok,true);
  assert.ok(!JSON.stringify(s).includes('secret-fixture-key'));assert.ok(!JSON.stringify(registry.list()).includes('secret-fixture-key'));
  if(style==='anthropic')assert.equal(seen.options.headers['x-api-key'],'secret-fixture-key');else if(style==='gemini')assert.equal(seen.options.headers['x-goog-api-key'],'secret-fixture-key');else assert.equal(seen.options.headers.Authorization,'Bearer secret-fixture-key');
  assert.ok(!seen.url.includes('secret-fixture-key'));
  s.settings.maxTeacherCallsPerDay=1;await assert.rejects(()=>registry.generate('JSON','topic'),/budget reached/);
 }
});

test('crawl creates evidence-bearing DNA, avoids duplicate extraction and never auto-approves unreviewed pages',async()=>{
 const s=state();let training=0;
 const registry=new TeacherRegistry(s,{env:{}});
 const engine=new CrawlEngine(s,{registry,addLesson:(x,opts)=>{const a=hydrateAtom({...x,...opts,id:'web:'+s.atoms.length,origin:'test',createdAt:new Date().toISOString()});s.atoms.push(a);return a;},save:()=>rebuildOrganism(s),train:()=>training++,event:()=>{},request:async url=>({status:200,headers:{'content-type':'text/html'},text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':'<title>Solar energy</title><p>Solar energy comes from sunlight. Solar panels can convert sunlight into electricity. This is a captured public source paragraph for a small knowledge atom.</p>'})});
 s.crawler.sources=[{url:'https://example.com/solar',lastHash:null}];
 await engine.cycle();const a=s.atoms.at(-1);assert.equal(a.status,'pending');assert.equal(a.dna.evidence.length,1);assert.equal(a.dna.agent.bornFromDNA,a.id);assert.equal(training,0);
 const count=s.atoms.length;await engine.cycle();assert.equal(s.atoms.length,count);
 assert.equal(s.crawler.lastResults[0].status,'unchanged');
});

test('teacher support requires an exact captured quotation; contradictions remain explicit',async()=>{
 const a=atom('Solar',['energy']),e={url:'https://example.com',excerpt:'Solar panels convert sunlight into electricity.'};
 const make=(verdict,quote)=>({generate:async()=>({provider:'fixture',model:'fixture',data:{verdict,quote,reason:'Source comparison'}})});
 assert.equal((await inspectWithTeacher(a,e,make('supported','Invented quotation not present in source text'))).verdict,'uncertain');
 assert.equal((await inspectWithTeacher(a,e,make('supported',e.excerpt))).verdict,'supported');
 assert.equal((await inspectWithTeacher(a,e,make('contradicted',''))).verdict,'contradicted');
});

test('a newly configured teacher inspects old captures; source changes require fresh owner review',async()=>{
 const s=state();let ready=false,calls=0,trained=0,changed=false;
 const registry={list:()=>[{id:'groq',primary:true,configured:ready,model:'fixture'}],generate:async(instruction,input)=>{calls++;const data=JSON.parse(input);return {provider:'groq',model:'fixture',data:{verdict:'supported',quote:data.sourceExcerpt,reason:'Exact captured source supports this extractive definition'}};}};
 const engine=new CrawlEngine(s,{registry,addLesson:(x,opts)=>{const a=hydrateAtom({...x,...opts,id:'web:'+s.atoms.length,origin:'test',createdAt:new Date().toISOString()});s.atoms.push(a);return a;},save:()=>rebuildOrganism(s),train:()=>trained++,event:()=>{},request:async url=>({status:200,headers:{'content-type':'text/html'},text:url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':`<title>Solar</title><p>${changed?'Updated solar energy knowledge.':'Solar energy comes from sunlight.'} Solar panels convert sunlight into electricity. This is a captured source paragraph long enough for the public knowledge extraction test.</p>`})});
 s.crawler.sources=[{url:'https://example.com/solar',lastHash:null}];s.crawler.autoApprove=true;
 await engine.cycle();const a=s.atoms.at(-1);assert.equal(a.status,'pending');assert.equal(calls,0);
 ready=true;await engine.cycle();assert.equal(a.status,'approved');assert.equal(calls,1);assert.equal(trained,1);
 await engine.cycle();assert.equal(calls,1);
 changed=true;const oldAnswer=a.answer;await engine.cycle();assert.equal(a.status,'pending');assert.equal(a.answer,oldAnswer);assert.match(a.dna.meaning.proposedDefinition.text,/Updated/);assert.ok(a.dna.trust.contradictions.some(c=>c.type==='source-update'));
});

test('public crawler rejects private/reserved IPs, embedded credentials and robots exclusions',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.20.0.1','192.168.1.2','100.64.0.1','::1','fe80::1','fc00::1','2001:db8::1'])assert.equal(isPublicIP(ip),false,ip);
 assert.equal(isPublicIP('8.8.8.8'),true);assert.throws(()=>publicURL('https://user:password@example.com'));
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/secret'),false);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/public','/private/public/a'),true);
 assert.equal(robotsAllowed('User-agent: KenuxaBot\nDisallow: /','/wiki/Solar_energy'),false);
});
