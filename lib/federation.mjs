// ATP — Atom Transfer Protocol: legacy pull federation between configured peers (ATP/0.4, formerly called MTP).
// Signed HTTPS exchange between independent KENUXA nodes on any host: Render, Railway, Fly,
// Vercel, Netlify, a VPS or a custom domain. Every request AND response is HMAC-signed with the
// shared NETWORK_SECRET, timestamped and nonce-protected against replay.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { publicRequest } from './web.mjs';

export const PROTOCOL = 'ATP/0.4';
export function signature(secret, method, path, timestamp, nonce, body = '') {
  return createHmac('sha256', secret).update([method, path, timestamp, nonce, body].join('\n')).digest('hex');
}
export function headers(secret, method, path, body = '') {
  const timestamp = String(Date.now()), nonce = randomUUID();
  return { 'x-kenuxa-time': timestamp, 'x-kenuxa-nonce': nonce, 'x-kenuxa-signature': signature(secret, method, path, timestamp, nonce, body) };
}
export function verify(secret, method, path, body, h, seen) {
  if (!secret || secret.length < 32) return false;
  const t = h['x-kenuxa-time'], n = h['x-kenuxa-nonce'], sig = h['x-kenuxa-signature'];
  const now = Date.now(); for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
  if (!t || !n || !sig || n.length > 100 || !Number.isFinite(Number(t)) || Math.abs(now - Number(t)) > 60000 || seen.has(n)) return false;
  const expected = signature(secret, method, path, t, n, body);
  if (!/^[a-f0-9]{64}$/.test(sig) || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  seen.set(n, now + 120000); return true;
}
// Any public HTTPS origin (no path, port, credentials or IP literal). Loopback only when explicitly enabled for tests.
export function peerOrigin(input, local = false) {
  let u; try { u = new URL(String(input ?? '')); } catch { throw new Error('That is not a valid node URL'); }
  const loopback = local && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  const publicHttps = u.protocol === 'https:' && !u.port && !isIP(u.hostname.replace(/^\[|\]$/g, '')) && u.hostname.includes('.') && !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(u.hostname);
  if ((!publicHttps && !loopback) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new Error('Peers must be public HTTPS origins such as https://my-node.onrender.com, https://x.up.railway.app, https://x.vercel.app or https://x.netlify.app');
  return u.origin;
}
async function send(origin, method, path, secret, body = '', local = false) {
  const h = { ...headers(secret, method, path, body), ...(body ? { 'content-type': 'application/json' } : {}) };
  if (local && origin.startsWith('http://')) {
    const res = await fetch(origin + path, { method, headers: h, body: body || undefined, redirect: 'error', signal: AbortSignal.timeout(12000) });
    return { status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() };
  }
  return publicRequest(origin + path, { method, headers: h, body, maxBytes: 2000000, timeout: 15000 }); // DNS-pinned, public addresses only
}
async function signedCall(origin, method, path, secret, body, local) {
  const res = await send(origin, method, path, secret, body, local);
  if (res.status !== 200) throw new Error(`Peer returned HTTP ${res.status}`);
  if (Buffer.byteLength(res.text) > 2000000) throw new Error('Peer response too large');
  if (!verify(secret, 'RESPONSE', path, res.text, res.headers, new Map())) throw new Error('Peer response signature invalid');
  return JSON.parse(res.text);
}
export const pullPeer = (origin, secret, local = false) => signedCall(origin, 'GET', '/federation/snapshot', secret, '', local);
export const helloPeer = (origin, secret, info, local = false) => signedCall(origin, 'POST', '/federation/hello', secret, JSON.stringify(info), local);
