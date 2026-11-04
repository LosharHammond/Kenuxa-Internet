// The KENUXA open mesh — ATP/1.0, the Atom Transfer Protocol (successor of the MTP/0.5 wire format;
// legacy /mtp/ routes and x-mtp-* headers are still accepted so older nodes keep working during migration).
// Every node that is online joins the network by itself: no shared secret, no manual peer list.
//  • Identity: each node grows its own Ed25519 key pair; its network id is the key's fingerprint.
//  • Every request and response is signed by the sender's key, timestamped and nonce-protected.
//  • Bootstrap: bundled genesis seeds + a living directory (network/seeds.json in the public repo)
//    + everything learned by gossip. Seeds are only a first contact; the mesh persists without them.
//  • Knowledge spreads epidemically (deduplicated by content hash); trust adapts per peer.
//  • Knowledge confirmed independently by several nodes is promoted by network consensus.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { publicRequest } from './web.mjs';
import { peerOrigin } from './federation.mjs';
import { features } from './model.mjs';

export const MESH_PROTOCOL = 'ATP/1.0';
export const LEGACY_PROTOCOLS = ['MTP/0.5-open'];
const legacyPath = p => p.replace(/^\/atp\//, '/mtp/'), atpPath = p => p.replace(/^\/mtp\//, '/atp/');
const sha = x => createHash('sha256').update(x).digest('hex');
export function fingerprintOf(publicKeyB64) { return 'kx' + sha(Buffer.from(publicKeyB64, 'base64')).slice(0, 30); }

export function ensureIdentity(state) {
  if (state.identity?.publicKey && state.identity?.privateKey) return state.identity;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  state.identity = { publicKey: pub, privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), fingerprint: fingerprintOf(pub), createdAt: new Date().toISOString() };
  return state.identity;
}
const payload = (method, path, t, n, body) => Buffer.from([method, path, t, n, sha(body || '')].join('\n'));
export function signHeaders(identity, method, path, body = '') {
  const t = String(Date.now()), n = randomUUID(), key = createPrivateKey({ key: Buffer.from(identity.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const sig = sign(null, payload(method, path, t, n, body), key).toString('base64');
  const h = { 'x-atp-node': identity.fingerprint, 'x-atp-key': identity.publicKey, 'x-atp-time': t, 'x-atp-nonce': n, 'x-atp-sig': sig };
  // Legacy mirror headers so nodes still on MTP/0.5 can verify us during the migration.
  return { ...h, 'x-mtp-node': h['x-atp-node'], 'x-mtp-key': h['x-atp-key'], 'x-mtp-time': t, 'x-mtp-nonce': n, 'x-mtp-sig': sig };
}
// Returns the verified sender {fingerprint, publicKey} or null.
export function verifySigned(h, method, path, body, seen = null, expectFingerprint = null) {
  try {
    const pre = h['x-atp-node'] ? 'x-atp-' : 'x-mtp-', fp = h[pre + 'node'], pub = h[pre + 'key'], t = h[pre + 'time'], n = h[pre + 'nonce'], sig = h[pre + 'sig'];
    if (!fp || !pub || !t || !n || !sig || pub.length > 200 || n.length > 64) return null;
    if (fingerprintOf(pub) !== fp || (expectFingerprint && fp !== expectFingerprint)) return null;
    if (Math.abs(Date.now() - Number(t)) > 120000) return null;
    if (seen) { const now = Date.now(); for (const [k, exp] of seen) if (exp < now) seen.delete(k); if (seen.has(fp + n)) return null; }
    const key = createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, payload(method, path, t, n, body), key, Buffer.from(sig, 'base64'))) return null;
    seen?.set(fp + n, Date.now() + 240000); return { fingerprint: fp, publicKey: pub };
  } catch { return null; }
}

export function loadSeeds(root, env) {
  let bundled = { seeds: [], directory: null };
  try { bundled = JSON.parse(fs.readFileSync(new URL('../network/seeds.json', import.meta.url), 'utf8')); } catch { /* optional */ }
  const extra = String(env.KENUXA_SEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return { seeds: [...new Set([...(bundled.seeds || []), ...extra])], directory: env.KENUXA_DIRECTORY || bundled.directory || null };
}

export class Mesh {
  constructor({ state, identity, name, publicUrl, platform, enabled, allowLocal = false, seeds = [], directory = null, request = publicRequest, shareable, findForQuery, importAtom, log = () => {}, event = () => {}, verifyRotation = null }) {
    Object.assign(this, { state, identity, name, publicUrl, platform, enabled, allowLocal, seeds, directory, request, shareable, findForQuery, importAtom, log, event, verifyRotation });
    state.mesh ??= { peers: [], cursor: {}, lastBootstrap: null, consensus: {} };
    this.seen = new Map(); this.busy = false;
  }
  get peers() { return this.state.mesh.peers; }
  origin(u) { return peerOrigin(u, this.allowLocal); }
  async call(url, method, path, body = '', timeout = 15000) {
    const headers = { ...signHeaders(this.identity, method, path.split('?')[0], body), ...(body ? { 'content-type': 'application/json' } : {}), 'user-agent': 'KENUXA-ATP/1.0' };
    let res;
    if (this.allowLocal && url.startsWith('http://')) { const r = await fetch(url + path, { method, headers, body: body || undefined, redirect: 'error', signal: AbortSignal.timeout(timeout) }); res = { status: r.status, headers: Object.fromEntries(r.headers), text: await r.text() }; }
    else res = await this.request(url + path, { method, headers, body, maxBytes: 3000000, timeout });
    if (res.status === 404 && path.startsWith('/atp/')) return this.call(url, method, legacyPath(path), body, timeout); // peer still speaks MTP/0.5
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  verifyResponse(res, path, expect) { const who = verifySigned(res.headers, 'RESPONSE', path, res.text, null, expect) || verifySigned(res.headers, 'RESPONSE', path.startsWith('/atp/') ? legacyPath(path) : atpPath(path), res.text, null, expect); if (!who) throw new Error('Response signature invalid'); return { who, data: JSON.parse(res.text) }; }
  respond(path, data) { const body = JSON.stringify(data); return { body, headers: signHeaders(this.identity, 'RESPONSE', path, body) }; }
  info(counts = {}, extra = {}) {
    return { protocol: MESH_PROTOCOL, accepts: [MESH_PROTOCOL, ...LEGACY_PROTOCOLS], fingerprint: this.identity.fingerprint, publicKey: this.identity.publicKey, name: this.name, url: this.publicUrl || null, platform: this.platform, counts,
      peers: this.goodPeers(20).map(p => p.url), ...extra };
  }
  goodPeers(n = 50) { return [...this.peers].filter(p => p.url && p.reputation > 0.15).sort((a, b) => b.reputation - a.reputation || (b.lastOk || '').localeCompare(a.lastOk || '')).slice(0, n); }
  upsert(who, url, extra = {}) {
    if (who.fingerprint === this.identity.fingerprint) return null;
    let p = this.peers.find(x => x.fingerprint === who.fingerprint);
    if (!p) { if (this.peers.length >= 200) { this.peers.sort((a, b) => a.reputation - b.reputation); this.peers.shift(); } p = { fingerprint: who.fingerprint, publicKey: who.publicKey, url, firstSeen: new Date().toISOString(), reputation: 0.5, failures: 0, received: 0, shared: 0 }; this.peers.push(p); this.event('mesh', `Joined peer ${extra.name || who.fingerprint.slice(0, 10)} (${url})`); }
    if (p.publicKey !== who.publicKey) return null; // a fingerprint is bound to exactly one key
    Object.assign(p, { url: url || p.url, lastSeen: new Date().toISOString(), ...extra }); return p;
  }
  reward(p, ok, weight = 0.05) { if (!p) return; p.reputation = Math.max(0, Math.min(1, p.reputation + (ok ? weight : -weight * 2))); if (ok) { p.failures = 0; p.lastOk = new Date().toISOString(); } else p.failures = (p.failures || 0) + 1; }
  // First contact: read a node's signed /atp/info, then introduce ourselves.
  async contact(rawUrl, timeout = 45000) {
    const url = this.origin(rawUrl); if (url === this.publicUrl) return null;
    const res = await this.call(url, 'GET', '/atp/info', '', timeout), { who, data } = this.verifyResponse(res, '/atp/info');
    if (data.url && data.url !== url) throw new Error('Node reports a different URL');
    // v1.10 key rotation: a node that rotated its identity presents a certificate signed by its old AND new key;
    // trust (reputation, counters) moves to the new fingerprint only if the old key is the one we knew
    if (data.rotation && this.verifyRotation && data.rotation.to === who.fingerprint) { const old = this.peers.find(x => x.fingerprint === data.rotation.from); if (old && !this.peers.some(x => x.fingerprint === who.fingerprint)) { const v = this.verifyRotation(data.rotation, { knownKey: old.publicKey }); if (v.ok) { old.previousFingerprint = old.fingerprint; old.fingerprint = who.fingerprint; old.publicKey = who.publicKey; old.rotatedAt = new Date().toISOString(); this.event('peer-key-rotated', `${v.from} → ${v.to}`); } } }
    const p = this.upsert(who, url, { name: String(data.name || '').slice(0, 64), platform: String(data.platform || '').slice(0, 20), protocol: data.protocol, protocols: data.protocols && typeof data.protocols === 'object' ? Object.fromEntries(Object.entries(data.protocols).slice(0, 8).map(([k, v]) => [String(k).slice(0, 20), Array.isArray(v) ? v.slice(0, 6).map(x => String(x).slice(0, 30)) : []])) : null, capabilities: Array.isArray(data.capabilities) ? data.capabilities.slice(0, 60).map(x => String(x).slice(0, 40)) : [] }); if (!p) return null;
    this.reward(p, true);
    for (const u of (data.peers || []).slice(0, 20)) this.remember(u);
    if (this.publicUrl) { try { await this.call(url, 'POST', '/atp/hello', JSON.stringify({ url: this.publicUrl, name: this.name, platform: this.platform, protocol: MESH_PROTOCOL }), 20000); } catch (e) { this.log('hello failed: ' + e.message); } }
    return p;
  }
  remember(u) { try { const url = this.origin(u); if (url === this.publicUrl || this.peers.some(p => p.url === url)) return; this.state.mesh.pending ??= []; if (!this.state.mesh.pending.includes(url) && this.state.mesh.pending.length < 100) this.state.mesh.pending.push(url); } catch { /* not a public origin */ } }
  // A node announced itself: verify its key, then confirm the URL really belongs to that key.
  async hello(headers, body) {
    const who = verifySigned(headers, 'POST', '/atp/hello', body, this.seen); if (!who) throw new Error('Invalid signature');
    const msg = JSON.parse(body || '{}'), url = this.origin(String(msg.url || ''));
    const known = this.peers.find(p => p.fingerprint === who.fingerprint && p.url === url);
    if (!known) { const res = await this.call(url, 'GET', '/atp/info', '', 30000); this.verifyResponse(res, '/atp/info', who.fingerprint); }
    const p = this.upsert(who, url, { name: String(msg.name || '').slice(0, 64), platform: String(msg.platform || '').slice(0, 20), protocol: String(msg.protocol || '').slice(0, 30) }); this.reward(p, true, 0.02);
    return { ok: true, peers: this.goodPeers(20).map(x => x.url) };
  }
  async bootstrap({ timeout = 45000 } = {}) {
    if (!this.enabled) return { disabled: true };
    let seeds = [...this.seeds];
    if (this.directory) { try { const r = await this.request(this.directory, { timeout: Math.min(15000, timeout), maxBytes: 200000 }); if (r.status === 200) seeds = [...new Set([...seeds, ...(JSON.parse(r.text).seeds || [])])]; } catch (e) { this.log('directory: ' + e.message); } }
    const targets = [...new Set([...seeds, ...this.goodPeers(10).map(p => p.url), ...(this.state.mesh.pending || []).splice(0, 10)])].filter(u => u && u !== this.publicUrl).slice(0, 20);
    const out = await Promise.allSettled(targets.map(u => this.contact(u, timeout)));
    this.state.mesh.lastBootstrap = new Date().toISOString();
    return { contacted: targets.length, joined: out.filter(o => o.status === 'fulfilled' && o.value).length };
  }
  // Pull new knowledge from peers (epidemic spread, content-hash dedup, adaptive trust).
  async exchange({ maxPeers = 8, budgetMs = 30000 } = {}) {
    if (!this.enabled || this.busy) return { skipped: true }; this.busy = true; const start = Date.now(), results = [];
    try {
      if (this.state.mesh.pending?.length) await Promise.allSettled(this.state.mesh.pending.splice(0, 5).map(u => this.contact(u, 20000)));
      const due = this.goodPeers(50).filter(p => !p.backoffUntil || Date.now() > new Date(p.backoffUntil).getTime()).slice(0, maxPeers);
      for (const p of due) {
        if (Date.now() - start > budgetMs) break;
        const path = '/atp/snapshot?since=' + encodeURIComponent(this.state.mesh.cursor[p.fingerprint] || '');
        try {
          const res = await this.call(p.url, 'GET', path, '', 20000), { data } = this.verifyResponse(res, path.split('?')[0], p.fingerprint);
          let imported = 0, confirmed = 0;
          for (const a of (Array.isArray(data.atoms) ? data.atoms.slice(0, 200) : [])) { const r = this.importAtom(a, p); if (r === 'imported') imported++; if (r === 'confirmed') confirmed++; }
          for (const u of (data.peers || []).slice(0, 20)) this.remember(u);
          if (data.cursor) this.state.mesh.cursor[p.fingerprint] = String(data.cursor).slice(0, 40);
          p.received += imported; this.reward(p, true, imported ? 0.04 : 0.01); p.backoffUntil = null; results.push({ peer: p.name || p.fingerprint, url: p.url, ok: true, imported, confirmed });
        } catch (e) { this.reward(p, false); p.backoffUntil = new Date(Date.now() + Math.min(6 * 3600000, 60000 * 2 ** Math.min(8, p.failures))).toISOString(); results.push({ peer: p.name || p.fingerprint, url: p.url, ok: false, error: e.message }); }
      }
      this.state.mesh.peers = this.peers.filter(p => !(p.reputation < 0.05 && p.failures > 8)); // the network forgets dead or hostile nodes
      this.state.mesh.lastExchange = new Date().toISOString(); this.state.mesh.lastResults = results;
      return { peers: results };
    } finally { this.busy = false; }
  }
  // Ask the network when this node does not know something yet.
  async query(q, { peers = 6, timeout = 4000 } = {}) {
    if (!this.enabled || !q) return [];
    const path = '/atp/query?q=' + encodeURIComponent(q.slice(0, 200)), targets = this.goodPeers(peers);
    const settled = await Promise.allSettled(targets.map(async p => { const res = await this.call(p.url, 'GET', path, '', timeout), { data } = this.verifyResponse(res, '/atp/query', p.fingerprint); this.reward(p, true, 0.01); return (data.atoms || []).slice(0, 5).map(a => ({ atom: a, peer: p })); }));
    settled.forEach((s, i) => { if (s.status === 'rejected') this.reward(targets[i], false, 0.02); });
    return settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
  }
  // Server side helpers.
  snapshot(since) {
    const list = this.shareable().filter(a => !since || (a.dna?.evolution?.updatedAt || a.createdAt) > since).sort((a, b) => (a.dna?.evolution?.updatedAt || '').localeCompare(b.dna?.evolution?.updatedAt || '')).slice(0, 200);
    return { protocol: MESH_PROTOCOL, atoms: list.map(publicForm), peers: this.goodPeers(20).map(p => p.url), cursor: list.at(-1)?.dna?.evolution?.updatedAt || since || null };
  }
  answerQuery(q) { return { protocol: MESH_PROTOCOL, atoms: this.findForQuery(String(q || '').slice(0, 200)).slice(0, 5).map(publicForm) }; }
  status() { return { enabled: this.enabled, protocol: MESH_PROTOCOL, fingerprint: this.identity.fingerprint, url: this.publicUrl || null, seeds: this.seeds, directory: this.directory, peers: this.peers.map(({ publicKey, ...p }) => p), pending: (this.state.mesh.pending || []).length, lastBootstrap: this.state.mesh.lastBootstrap, lastExchange: this.state.mesh.lastExchange || null }; }
}

export function publicForm(a) {
  return { hash: a.hash, title: a.title, answer: a.answer, questions: (a.questions || []).slice(0, 8), tags: (a.tags || []).slice(0, 8), origin: a.dna?.network?.trueOrigin || a.origin, stage: a.dna?.evolution?.stage, revision: a.dna?.evolution?.revision,
    confirmations: (a.dna?.network?.confirmations || []).length, essence: a.dna?.meaning?.frame?.essence,
    evidence: (a.dna?.evidence || []).slice(-3).map(e => ({ url: e.url, title: e.title, quote: String(e.quote || '').slice(0, 1200), retrievedAt: e.retrievedAt, contentHash: e.contentHash })) };
}
export function queryScore(q, a) { const qt = new Set(features(q)), at = features(`${a.title} ${(a.questions || []).join(' ')} ${(a.tags || []).join(' ')}`); if (!qt.size) return 0; return at.filter(t => qt.has(t)).length / qt.size; }
