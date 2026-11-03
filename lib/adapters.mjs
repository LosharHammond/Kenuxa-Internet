// Platform adapters around the host-independent node core.
import { createNode } from './node.mjs';

let shared = null; // reused across warm serverless invocations
export function nodeOnce(opts) { return (shared ??= createNode(opts).catch(e => { shared = null; throw e; })); }

export async function readNodeBody(req, limit = 64000) {
  if (typeof req.body === 'string') return req.body;                         // some hosts pre-read the body
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return JSON.stringify(req.body);
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  let raw = ''; for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > limit) throw new Error('Request is too large'); } return raw;
}
// Node http / Vercel (IncomingMessage, ServerResponse)
export async function nodeHttp(node, req, res) {
  let body = '';
  try { body = ['GET', 'HEAD'].includes(req.method) ? '' : await readNodeBody(req, String(req.url).startsWith('/mtp/store/') ? 3000000 : 64000); }
  catch (e) { res.writeHead(413, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
  const forwarded = node.local ? null : String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const out = await node.handle({ method: req.method, url: req.url, headers: req.headers, body, remoteAddress: forwarded || req.socket?.remoteAddress });
  res.writeHead(out.status, out.headers); res.end(out.body);
}
// Web-standard Request → Response (Netlify Functions v2, Deno-style hosts)
export async function webRequest(node, request, clientIp) {
  const u = new URL(request.url), body = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  if (Buffer.byteLength(body) > (u.pathname.startsWith('/mtp/store/') ? 3000000 : 64000)) return new Response(JSON.stringify({ error: 'Request is too large' }), { status: 413 });
  const out = await node.handle({ method: request.method, url: u.pathname + u.search, headers: Object.fromEntries(request.headers), body, remoteAddress: clientIp || request.headers.get('x-nf-client-connection-ip') || 'unknown' });
  return new Response(out.body, { status: out.status, headers: out.headers });
}
