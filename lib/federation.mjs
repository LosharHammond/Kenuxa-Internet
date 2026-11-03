import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
export function signature(secret, method, path, timestamp, nonce, body='') {
 return createHmac('sha256',secret).update([method,path,timestamp,nonce,body].join('\n')).digest('hex');
}
export function headers(secret, method, path, body='') {
 const timestamp=String(Date.now()), nonce=randomUUID();
 return {'x-kenuxa-time':timestamp,'x-kenuxa-nonce':nonce,'x-kenuxa-signature':signature(secret,method,path,timestamp,nonce,body)};
}
export function verify(secret, method, path, body, h, seen) {
 if (!secret || secret.length<32) return false;
 const t=h['x-kenuxa-time'], n=h['x-kenuxa-nonce'], sig=h['x-kenuxa-signature'];
 const now=Date.now(); for (const [key,expiry] of seen) if(expiry<now) seen.delete(key);
 if(!t || !n || !sig || n.length>100 || !Number.isFinite(Number(t)) || Math.abs(now-Number(t))>60000 || seen.has(n)) return false;
 const expected=signature(secret,method,path,t,n,body);
 if(!/^[a-f0-9]{64}$/.test(sig) || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false;
 seen.set(n,now+120000); return true;
}
export function peerOrigin(input, local=false) {
 const u=new URL(input);
 const allowed = u.protocol==='https:' && /^[a-z0-9-]+\.onrender\.com$/.test(u.hostname) && !u.port;
 const loopback=local && u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname);
 if((!allowed && !loopback) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('Peers must be HTTPS *.onrender.com origins (or explicitly enabled localhost test peers).');
 return u.origin;
}
export async function pullPeer(origin,secret) {
 const path='/federation/snapshot';
 const res=await fetch(origin+path,{headers:headers(secret,'GET',path),redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!res.ok) throw new Error(`Peer returned HTTP ${res.status}`);
 const declared=Number(res.headers.get('content-length')||0); if(declared>1000000) throw new Error('Peer response too large');
 const reader=res.body.getReader(); let size=0; const parts=[];
 while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>1000000){await reader.cancel();throw new Error('Peer response too large');} parts.push(Buffer.from(value)); }
 const raw=Buffer.concat(parts).toString('utf8');
 // Authenticate the response as well as the request (also needed for local HTTP tests).
 if(!verify(secret,'RESPONSE',path,raw,Object.fromEntries(res.headers),new Map())) throw new Error('Peer response signature invalid');
 return JSON.parse(raw);
}
