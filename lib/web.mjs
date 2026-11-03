import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export function isPublicIP(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);}
 return isIP(ip)===6 && /^[23][\da-f]{3}:/i.test(ip)&&!/^2001:(db8|0):/i.test(ip)&&!/^2002:/i.test(ip);
}
export function publicURL(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||isIP(u.hostname)||u.hostname==='localhost'||!u.hostname.includes('.')||u.hash)throw new Error('Use a public HTTPS URL without credentials, fragment or custom port');
 return u;
}
// DNS validation + pinning closes DNS rebinding between validation and connect.
// No redirects, cookies, browser sessions, proxy env or implicit credentials.
export async function publicRequest(value,{method='GET',headers={},body='',maxBytes=600000,timeout=20000}={}){
 const u=publicURL(value);const addresses=await lookup(u.hostname,{all:true});
 if(!addresses.length||addresses.some(x=>!isPublicIP(x.address)))throw new Error('Private or reserved destination blocked');
 const pinned=addresses[0];
 return await new Promise((resolve,reject)=>{
  const req=https.request(u,{method,headers,lookup:(host,options,cb)=>options.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},res=>{
   const chunks=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){req.destroy(new Error('Response size limit exceeded'));return;}chunks.push(chunk);});
   res.on('error',()=>reject(new Error('External response interrupted')));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
  });
  req.setTimeout(timeout,()=>req.destroy(new Error('External request timed out')));
  req.on('error',e=>reject(new Error(e.message==='Response size limit exceeded'?e.message:'External HTTPS request failed')));
  if(body)req.write(body);req.end();
 });
}
export function plainText(html){return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):' ').replace(/\s+/g,' ').trim();}
export function robotsAllowed(content,pathname){
 const groups=[];let agents=[],rules=[],readingRules=false;
 for(const line of content.split(/\r?\n/)){const clean=line.split('#')[0].trim(),i=clean.indexOf(':');if(i<0)continue;const key=clean.slice(0,i).toLowerCase(),value=clean.slice(i+1).trim();
  if(key==='user-agent'){if(readingRules){groups.push({agents,rules});agents=[];rules=[];readingRules=false;}agents.push(value.toLowerCase());}
  else if(['allow','disallow'].includes(key)&&agents.length){rules.push({allow:key==='allow',path:value});readingRules=true;}}
 if(agents.length)groups.push({agents,rules});
 const named=groups.filter(g=>g.agents.some(a=>a!=='*'&&'kenuxabot'.includes(a))),applicable=named.length?named:groups.filter(g=>g.agents.includes('*'));
 const matches=applicable.flatMap(g=>g.rules).filter(r=>r.path&&new RegExp('^'+r.path.split('*').map(s=>s.replace(/[.+?^{}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$')).test(pathname));
 matches.sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
