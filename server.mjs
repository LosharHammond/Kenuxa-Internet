import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {AnswerModel} from './lib/model.mjs';
import {seeds} from './lib/seed.mjs';
import {headers,verify,peerOrigin,pullPeer} from './lib/federation.mjs';
import {teach} from './lib/teacher.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.HOST||'127.0.0.1', PORT=Number(process.env.PORT||3210);
const DATA=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data'));
const NODE=process.env.NODE_ID||'kenuxa-home', ADMIN=process.env.ADMIN_TOKEN||'', SECRET=process.env.NETWORK_SECRET||'';
const LOCAL=HOST==='127.0.0.1' && !process.env.RENDER;
if(!/^[a-zA-Z0-9_-]{3,64}$/.test(NODE)) throw new Error('NODE_ID must be 3-64 letters, digits, underscores or hyphens.');
if(!LOCAL && ADMIN.length<32) throw new Error('A public node requires ADMIN_TOKEN with at least 32 characters.');
if(SECRET && SECRET.length<32) throw new Error('NETWORK_SECRET must contain at least 32 characters.');
const PEERS=[...new Set((process.env.PEER_URLS||'').split(',').filter(Boolean).map(s=>peerOrigin(s.trim(),process.env.ALLOW_LOCAL_PEERS==='true')))];
if(PEERS.length>10) throw new Error('This prototype supports up to 10 configured peers per node.');
fs.mkdirSync(DATA,{recursive:true});
const statePath=path.join(DATA,'state.json');
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:1,atoms:seeds(),outcomes:[],memory:[],goals:[],peerStatus:[]};
let model,training,trainingRevision=0;
function save(){const temp=statePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.renameSync(temp,statePath);}
function train(){
 model=new AnswerModel(state.atoms.filter(a=>a.status==='approved')); training={...model.snapshot(),trainedAt:new Date().toISOString(),revision:++trainingRevision};
 fs.writeFileSync(path.join(DATA,'model.json.tmp'),JSON.stringify(training)); fs.renameSync(path.join(DATA,'model.json.tmp'),path.join(DATA,'model.json')); save();
}
train();
const seen=new Map(),limits=new Map(); let syncing=false,teaching=false;
function event(type,detail){state.outcomes.unshift({id:randomUUID(),type,detail,at:new Date().toISOString()});state.outcomes=state.outcomes.slice(0,300);}
function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Expected text between 1 and ${max} characters`);return value.trim();}
function validateLesson(x){
 if(!x||typeof x!=='object')throw new Error('Invalid lesson');
 return {title:text(x.title,240),answer:text(x.answer,4000),questions:Array.isArray(x.questions)?x.questions.slice(0,8).map(q=>text(q,240)):[],tags:Array.isArray(x.tags)?[...new Set(x.tags.slice(0,8).map(t=>text(t,50).toLowerCase()))]:[]};
}
function addLesson(x,{source='Manual lesson',status='approved',visibility='private',origin=NODE,upstreamId=null}={}){
 if(state.atoms.length>=500)throw new Error('Prototype capacity reached (500 lessons). Export your data before expanding.');
 const clean=validateLesson(x); const hash=createHash('sha256').update(JSON.stringify(clean)).digest('hex');
 if(state.atoms.some(a=>a.hash===hash))return null;
 const atom={...clean,id:`${NODE}:${randomUUID()}`,hash,source,status,visibility,origin,upstreamId,createdAt:new Date().toISOString()};state.atoms.push(atom);return atom;
}
async function sync(){
 if(syncing)return {busy:true}; if(!SECRET)return {disabled:true,reason:'NETWORK_SECRET is not configured'};
 syncing=true;const results=[];
 try{
  for(const peer of PEERS){
   let imported=0;
   try{
    const data=await pullPeer(peer,SECRET);
    if(!Array.isArray(data.atoms)||data.atoms.length>500||typeof data.nodeId!=='string')throw new Error('Invalid peer snapshot');
    if(data.nodeId===NODE)throw new Error('Peer NODE_ID duplicates this node; assign unique IDs');
    for(const a of data.atoms){
     if(a.visibility!=='public'||a.status!=='approved'||a.origin==='seed'||a.origin===NODE)continue;
     const upstreamId=text(a.id,160);
     // Only accept the peer's own originals. No circular rebroadcasting.
     if(a.origin!==data.nodeId || !upstreamId.startsWith(data.nodeId+':'))continue;
     if(state.atoms.some(x=>x.upstreamId===upstreamId))continue;
     if(addLesson(a,{source:`Peer ${data.nodeId} via ${peer}`,status:'pending',visibility:'private',origin:data.nodeId,upstreamId}))imported++;
    }
    results.push({peer,ok:true,imported,at:new Date().toISOString()});
   }catch(e){results.push({peer,ok:false,error:e.message,at:new Date().toISOString()});}
  }
  state.peerStatus=results;event('sync',`${results.filter(r=>r.ok).length}/${PEERS.length} peers reachable; lessons require approval`);save();return {peers:results};
 }finally{syncing=false;}
}
function authorized(req){
 if(LOCAL&&!ADMIN)return ['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
 const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
 return !!ADMIN && supplied.length===ADMIN.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(ADMIN));
}
function rate(req){const now=Date.now(),key=req.socket.remoteAddress;for(const [k,v]of limits)if(v.until<now)limits.delete(k);const b=limits.get(key)||{n:0,until:now+60000};b.n++;limits.set(key,b);return b.n<=180;}
async function readBody(req){let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>64000)throw new Error('Request is too large');}return raw;}
function graph(){const atoms=state.atoms.filter(a=>a.status==='approved');const edges=[];for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++){const shared=atoms[i].tags.filter(t=>atoms[j].tags.includes(t));if(shared.length)edges.push({from:atoms[i].id,to:atoms[j].id,tags:shared});}return {nodes:atoms.map(({id,title,tags,source,origin})=>({id,title,tags,source,origin})),edges:edges.slice(0,2000)};}
const CAPABILITIES=['answer-question','resolve-meaning','train-answer-model','propose-teacher-lessons','review-lessons','sync-public-knowledge','record-goal','record-outcome'];
export const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const route=url.pathname;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
  if(!rate(req))return reply(429,{error:'Too many requests. Try again in one minute.'});
  if(route==='/health'&&req.method==='GET')return reply(200,{status:'ok',nodeId:NODE});
  if(route==='/federation/snapshot'&&req.method==='GET'){
   if(!verify(SECRET,'GET',route,'',req.headers,seen))return reply(401,{error:'Invalid federation signature'});
   const raw=JSON.stringify({protocol:'MKP/0.1',nodeId:NODE,atoms:state.atoms.filter(a=>a.status==='approved'&&a.visibility==='public'&&a.origin===NODE)});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',...headers(SECRET,'RESPONSE',route,raw)});return res.end(raw);
  }
  if(route.startsWith('/api/')){
   if(!authorized(req))return reply(401,{error:'Enter this node’s admin token to continue.'});
   if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`)return reply(403,{error:'Cross-origin requests are not allowed'});
   if(req.method==='GET'){
    if(route==='/api/status')return reply(200,{nodeId:NODE,model:{architecture:training.architecture,examples:training.examples,vocabulary:training.vocabulary,loss:training.loss,epochs:training.epochs,trainedAt:training.trainedAt},counts:{approved:state.atoms.filter(a=>a.status==='approved').length,pending:state.atoms.filter(a=>a.status==='pending').length},teacher:{configured:!!process.env.GROQ_API_KEY,model:process.env.GROQ_MODEL||'openai/gpt-oss-20b'},peers:PEERS,peerStatus:state.peerStatus,capabilities:CAPABILITIES,localAccess:LOCAL&&!ADMIN});
    if(route==='/api/knowledge')return reply(200,{atoms:state.atoms});
    if(route==='/api/graph')return reply(200,graph());
    if(route==='/api/activity')return reply(200,{outcomes:state.outcomes,goals:state.goals,memory:state.memory});
    if(route==='/api/export')return reply(200,{...state,exportedAt:new Date().toISOString(),nodeId:NODE});
    if(route==='/api/resolve'){const address=text(url.searchParams.get('address'),240);if(!address.startsWith('meaning://'))return reply(400,{error:'Use meaning://topic'});const topic=decodeURIComponent(address.slice(10)).replaceAll('-',' ');return reply(200,{address,matches:state.atoms.filter(a=>a.status==='approved'&&(`${a.title} ${a.tags.join(' ')}`).toLowerCase().includes(topic.toLowerCase())).slice(0,20)});}
   }
   if(req.method!=='POST')return reply(404,{error:'Route not found'});
   if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'Send application/json'});
   const body=JSON.parse(await readBody(req)||'{}');
   if(route==='/api/ask'){
    const question=text(body.question,1000);const prediction=model.predict(question);
    const result=prediction?{answer:prediction.atom.answer,engine:'KENUXA own model',confidence:Math.round(prediction.score*100),evidence:[{id:prediction.atom.id,title:prediction.atom.title,source:prediction.atom.source}],tags:prediction.atom.tags}:{answer:'I do not have a reliable learned answer yet. Add a lesson or ask the Groq teacher to propose one, then review and train me.',engine:'KENUXA own model',confidence:0,evidence:[],tags:[]};
    result.id=randomUUID();state.memory.unshift({id:result.id,question,answer:result.answer,at:new Date().toISOString()});state.memory=state.memory.slice(0,100);event('answer',prediction?'Answered from learned knowledge':'Abstained: no reliable answer');save();return reply(200,result);
   }
   if(route==='/api/lessons'){const a=addLesson(body,{visibility:body.visibility==='public'?'public':'private'});if(a){event('learn',`Approved manual lesson: ${a.title}`);train();}return reply(200,{atom:a,duplicate:!a});}
   if(route==='/api/review'){
    const a=state.atoms.find(a=>a.id===body.id&&a.status==='pending');if(!a)return reply(404,{error:'Pending lesson not found'});
    a.status=body.approve===true?'approved':'rejected';a.visibility=body.visibility==='public'&&a.origin===NODE?'public':'private';event('review',`${a.status}: ${a.title}`);train();return reply(200,{atom:a});
   }
   if(route==='/api/train'){train();event('training','Rebuilt local model from approved examples');save();return reply(200,{examples:training.examples,loss:training.loss});}
   if(route==='/api/teacher'){
    if(teaching)return reply(409,{error:'A teacher batch is already running'});
    const topic=text(body.topic,500);teaching=true;
    try{const batch=await teach(topic);const validated=batch.lessons.map(validateLesson);const added=[];for(const lesson of validated){const a=addLesson(lesson,{source:`Groq teacher (${batch.model}); unverified draft`,status:'pending',visibility:'private'});if(a)added.push(a);}event('teacher',`${added.length} draft lessons; awaiting review`);save();return reply(200,{lessons:added});}finally{teaching=false;}
   }
   if(route==='/api/sync')return reply(200,await sync());
   if(route==='/api/goals'){const goal={id:randomUUID(),text:text(body.text,500),status:'open',createdAt:new Date().toISOString()};state.goals.unshift(goal);state.goals=state.goals.slice(0,100);save();return reply(200,goal);}
   if(route==='/api/feedback'){if(!state.memory.some(m=>m.id===body.id))return reply(404,{error:'Answer not found'});event('feedback',`${body.helpful===true?'Helpful':'Needs improvement'} answer ${body.id}`);save();return reply(200,{saved:true});}
   if(route==='/api/import'){
    if(!Array.isArray(body.atoms)||body.atoms.length>100)return reply(400,{error:'Import up to 100 lessons per batch'});
    const validated=body.atoms.map(validateLesson);let count=0;for(const a of validated)if(addLesson(a,{source:'Imported backup; awaiting review',status:'pending'}))count++;save();return reply(200,{imported:count});
   }
   return reply(404,{error:'Route not found'});
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(req.method==='GET'&&files[route]){
   const type=route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html';
   res.writeHead(200,{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(fs.readFileSync(path.join(ROOT,'public',files[route])));
  }return reply(404,{error:'Not found'});
 }catch(e){return reply(400,{error:e.message.includes('fetch failed')?'Could not reach external service':e.message});}
});
server.requestTimeout=60000;server.headersTimeout=15000;
server.listen(PORT,HOST,()=>console.log(`KENUXA ${NODE} running at http://${HOST}:${PORT} | own model: ${training.examples} examples`));
const timer=setInterval(()=>sync().catch(()=>{}),Math.max(30,Number(process.env.SYNC_INTERVAL_SECONDS)||120)*1000);timer.unref();
function shutdown(){clearInterval(timer);server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
