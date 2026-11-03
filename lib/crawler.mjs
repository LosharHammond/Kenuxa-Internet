import {publicRequest,publicURL,plainText,robotsAllowed} from './web.mjs';
import {digest,hydrateAtom,touchAtom} from './organism.mjs';
import {features} from './model.mjs';
import {INSPECT_INSTRUCTION} from './providers.mjs';

export const DEFAULT_SOURCES=['https://en.wikipedia.org/wiki/Solar_energy','https://en.wikipedia.org/wiki/Photosynthesis','https://en.wikipedia.org/wiki/Knowledge_graph'];
export function initCrawler(state){state.crawler??={enabled:true,intervalMinutes:10,maxPagesPerCycle:2,autoApprove:false,discoverLinks:false,sources:DEFAULT_SOURCES.map(url=>({url,lastHash:null,lastFetched:null,error:null})),lastRun:null,nextRun:null,busy:false};state.crawler.busy=false;return state.crawler;}
export function crawlURL(value){const u=publicURL(value);if(u.search)throw new Error('Crawler URLs cannot contain query strings');return u;}
export function sourceDocument(html,url){
 const title=plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).pathname).replace(/\s*[-|–]\s*Wikipedia.*$/i,'').slice(0,180);
 const paragraphs=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>plainText(m[1])).filter(p=>p.length>100);
 const excerpt=(paragraphs.length?paragraphs.slice(0,12).join('\n'):plainText(html)).slice(0,12000);
 if(excerpt.length<100)throw new Error('Page contains insufficient readable text');
 const answer=excerpt.split('\n')[0].slice(0,1800);
 return {title,excerpt,answer,hash:digest(excerpt),url};
}
export async function inspectWithTeacher(atom,evidence,registry,provider){
 const result=await registry.generate(INSPECT_INSTRUCTION,JSON.stringify({question:atom.title,answer:atom.answer,sourceURL:evidence.url,sourceExcerpt:evidence.excerpt}),provider);
 const x=result.data;
 if(!['supported','uncertain','contradicted'].includes(x.verdict)||typeof x.reason!=='string'||x.reason.length>2000||typeof x.quote!=='string'||x.quote.length>4000)throw new Error('Invalid inspection response; atom remains pending');
 const quoteMatches=x.quote.trim().length>=24&&evidence.excerpt.includes(x.quote);
 const verdict=x.verdict==='supported'&&!quoteMatches?'uncertain':x.verdict;
 return {id:digest([atom.id,Date.now(),result.provider]),evidenceId:evidence.id,provider:result.provider,model:result.model,verdict,reason:x.reason,quote:x.quote,quoteMatches,at:new Date().toISOString()};
}
export class CrawlEngine{
 constructor(state,{registry,addLesson,save,train,event,request=publicRequest}={}){this.state=state;this.registry=registry;this.addLesson=addLesson;this.save=save;this.train=train;this.event=event;this.request=request;this.busy=false;this.robots=new Map();initCrawler(state);}
 async inspectCandidate(atom,evidence){
  const teacher=this.registry.list().find(p=>p.primary&&p.configured);if(!teacher)return false;
  let review=atom.dna.trust.reviews.find(r=>r.evidenceId===evidence.id&&r.provider===teacher.id&&r.model===teacher.model);
  if(!review){try{review=await inspectWithTeacher({...atom,answer:atom.dna.meaning.proposedDefinition?.text||atom.answer},evidence,this.registry);atom.dna.trust.reviews.push(review);atom.dna.trust.reviews=atom.dna.trust.reviews.slice(-30);if(review.verdict==='contradicted')atom.dna.trust.contradictions.push({reason:review.reason,at:review.at,type:'teacher-conflict'});atom.dna.trust.status=review.verdict==='supported'?'teacher-supported':'needs-review';atom.dna.trust.score=review.verdict==='supported'?0.65:0.1;touchAtom(atom,'Primary teacher inspected source-grounded atom');}
   catch(e){atom.dna.trust.limitations=[...new Set([...atom.dna.trust.limitations,e.message])].slice(-10);return false;}}
  if(this.state.crawler.autoApprove&&review.verdict==='supported'&&review.quoteMatches&&!atom.dna.trust.contradictions.some(c=>!c.resolved)&&!atom.dna.meaning.proposedDefinition){const changed=atom.status!=='approved';atom.status='approved';if(changed)touchAtom(atom,'Teacher-supported atom accepted under automatic learning policy');return changed;}
  return false;
 }
 async page(url){
  let u=crawlURL(url);const allowedOrigins=new Set(this.state.crawler.sources.map(s=>new URL(s.url).origin));
  for(let redirects=0;redirects<4;redirects++){
   if(!allowedOrigins.has(u.origin))throw new Error('Redirect left the configured source origins');
   const cached=this.robots.get(u.origin);
   let rules=cached&&Date.now()-cached.at<3600000?cached.rules:null;
   if(rules===null){const r=await this.request(u.origin+'/robots.txt',{headers:{'User-Agent':'KenuxaBot/0.2 (knowledge research)'},maxBytes:100000});if(r.status===404)rules='';else if(r.status===200)rules=r.text;else throw new Error('robots.txt unavailable; source skipped');this.robots.set(u.origin,{at:Date.now(),rules});}
   if(!robotsAllowed(rules,u.pathname))throw new Error('robots.txt disallows this page');
   const res=await this.request(u.href,{headers:{'User-Agent':'KenuxaBot/0.2 (knowledge research)','Accept':'text/html,text/plain'},maxBytes:3000000});
   if([301,302,303,307,308].includes(res.status)){u=crawlURL(new URL(res.headers.location,u).href);continue;}
   if(res.status!==200)throw new Error(`Source returned HTTP ${res.status}`);
   if(!/text\/(html|plain)/i.test(res.headers['content-type']||''))throw new Error('Only public HTML or plain text pages are supported');
   return {...sourceDocument(res.text,u.href),html:res.text};
  }throw new Error('Too many redirects');
 }
 async cycle(){
  if(this.busy)return {busy:true};this.busy=true;const c=this.state.crawler;c.busy=true;const results=[];let learned=false;
  try{
   const sources=[...c.sources].sort((a,b)=>(a.lastFetched||'').localeCompare(b.lastFetched||'')).slice(0,c.maxPagesPerCycle);
   for(const source of sources){
    try{
     const doc=await this.page(source.url);source.lastFetched=new Date().toISOString();source.error=null;
     if(doc.hash===source.lastHash){const existing=this.state.atoms.find(a=>a.status==='pending'&&a.dna?.evidence.some(e=>e.contentHash===doc.hash&&e.url===doc.url));if(existing){const evidence=existing.dna.evidence.find(e=>e.contentHash===doc.hash);if(await this.inspectCandidate(existing,evidence))learned=true;}results.push({url:source.url,status:existing?.status==='approved'?'approved':'unchanged'});continue;}
     const evidence={id:`evidence:${doc.hash}`,url:doc.url,retrievedAt:new Date().toISOString(),contentHash:doc.hash,excerpt:doc.excerpt,quote:doc.answer,sourceType:'public-web-page'};
     const title=`What does ${doc.title} explain?`;let atom=this.state.atoms.find(a=>a.dna?.evidence.some(e=>e.url===doc.url)&&a.title===title);
     if(atom){hydrateAtom(atom);atom.dna.evidence.push(evidence);atom.dna.evidence=atom.dna.evidence.slice(-10);if(atom.answer!==doc.answer){atom.dna.trust.contradictions.push({reason:'Source changed; answer needs fresh review',type:'source-update',at:new Date().toISOString()});atom.dna.meaning.proposedDefinition={text:doc.answer,evidenceId:evidence.id,at:new Date().toISOString()};atom.status='pending';}touchAtom(atom,'New source capture');}
     else{atom=this.addLesson({title,answer:doc.answer,questions:[`Explain ${doc.title}`,`Tell me about ${doc.title}`],tags:[...features(doc.title).slice(0,3),'web-knowledge']},{source:`Web capture: ${doc.url}`,status:'pending',visibility:'private'});if(!atom){source.lastHash=doc.hash;continue;}hydrateAtom(atom);atom.dna.evidence.push(evidence);}
     if(await this.inspectCandidate(atom,evidence))learned=true;
     source.lastHash=doc.hash;results.push({url:source.url,status:atom.status,atomId:atom.id});
     if(c.discoverLinks&&c.sources.length<20){
      const links=[...doc.html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>m[1]);
      for(const href of links){if(c.sources.length>=20)break;try{const u=crawlURL(new URL(href,doc.url).href);if(u.origin===new URL(doc.url).origin&&!/login|signup|logout|Special:|action=/i.test(u.href)&&!c.sources.some(s=>s.url===u.href))c.sources.push({url:u.href,lastHash:null,lastFetched:null,error:null});}catch{}}
     }
    }catch(e){source.error=e.message;source.lastFetched=new Date().toISOString();results.push({url:source.url,status:'error',error:e.message});}
   }
   c.lastRun=new Date().toISOString();c.nextRun=new Date(Date.now()+c.intervalMinutes*60000).toISOString();c.lastResults=results;this.event('crawl',`${results.length} pages checked; ${results.filter(r=>r.atomId).length} atoms created or enriched`);
   if(learned)this.train();else this.save();return {results};
  }finally{this.busy=false;c.busy=false;this.save();}
 }
}
