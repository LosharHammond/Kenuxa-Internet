// Preservation transport over the open KENUXA mesh (ATP/1.0, signed). Members are this node plus
// trusted peers; failure domains are the peers' hosts, so fragments spread across platforms
// (Render, Railway, Vercel, Netlify, Fly, home servers …). Metadata records are signed by their
// writer's node key and verified on read, so a peer cannot forge manifests.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { encode as msgEncode } from './codec.mjs';

export class MeshTransport {
  constructor({ mesh, local, identity, minReputation = 0.25 }) { Object.assign(this, { mesh, local, identity, minReputation }); }
  peer(id) { return this.mesh.peers.find(p => p.fingerprint === id) || (this.hints?.has(id) ? { fingerprint: id, url: this.hints.get(id) } : null); }
  // Manifests carry holder URLs, so a node can fetch fragments from holders it has not met yet (responses are still
  // verified against the holder's fingerprint, which is bound to its public key).
  urlOf(id) { return id === this.identity.fingerprint ? this.mesh.publicUrl : this.mesh.peers.find(p => p.fingerprint === id)?.url || this.hints?.get(id) || null; }
  hint(hosts) { this.hints ||= new Map(); for (const [id, url] of Object.entries(hosts || {})) if (typeof url === 'string' && /^https?:\/\//.test(url) && !this.hints.has(id)) this.hints.set(id, url); if (this.hints.size > 2000) this.hints = new Map([...this.hints].slice(-1000)); }
  members() {
    const self = { id: this.identity.fingerprint, domain: hostOf(this.mesh.publicUrl) || 'self' };
    return [self, ...this.mesh.goodPeers(64).filter(p => p.reputation >= this.minReputation).map(p => ({ id: p.fingerprint, domain: hostOf(p.url) }))];
  }
  signRec(rec) { const key = createPrivateKey({ key: Buffer.from(this.identity.privateKey, 'base64'), format: 'der', type: 'pkcs8' }); return { ...rec, signer: this.identity.fingerprint, signerKey: this.identity.publicKey, sig: sign(null, msgEncode({ key: rec.key, value: rec.value, version: rec.version }), key).toString('base64') }; }
  verifyRec(rec) {
    try { if (!rec?.sig) return false; const k = createPublicKey({ key: Buffer.from(rec.signerKey, 'base64'), format: 'der', type: 'spki' }); if (!verify(null, msgEncode({ key: rec.key, value: rec.value, version: rec.version }), k, Buffer.from(rec.sig, 'base64'))) return false;
      return rec.signer === this.identity.fingerprint || this.mesh.peers.some(p => p.fingerprint === rec.signer && p.publicKey === rec.signerKey); } catch { return false; }
  }
  async call(to, method, path, body = '') { const p = this.peer(to); if (!p) throw new Error('unknown peer'); const res = await this.mesh.call(p.url, method, path, body, 20000); const { data } = this.mesh.verifyResponse(res, path.split('?')[0], to); return data; }
  async put(from, to, key, bytes) { if (to === this.identity.fingerprint) return this.local.putChunk(key, bytes); const r = await this.call(to, 'POST', '/atp/store/put', JSON.stringify({ key, data: bytes.toString('base64') })); if (!r.ok) throw new Error(r.error || 'store refused'); return true; }
  async get(from, to, key) { if (to === this.identity.fingerprint) return this.local.getChunk(key); const r = await this.call(to, 'GET', '/atp/store/get?key=' + encodeURIComponent(key)); return r.data ? Buffer.from(r.data, 'base64') : null; }
  async has(from, to, key) { return !!(await this.get(from, to, key)); }
  async metaPut(from, to, key, rec) { const signed = rec.sig ? rec : this.signRec(rec); if (to === this.identity.fingerprint) return this.local.metaPut(key, signed); const r = await this.call(to, 'POST', '/atp/meta/put', JSON.stringify(signed)); return !!r.ok; }
  async metaGet(from, to, key) { const rec = to === this.identity.fingerprint ? this.local.metaGet(key) : (await this.call(to, 'GET', '/atp/meta/get?key=' + encodeURIComponent(key))).record; return rec && this.verifyRec(rec) ? rec : null; }
  async metaKeys(from, to, prefix) { if (to === this.identity.fingerprint) return this.local.metaKeys(prefix); return (await this.call(to, 'GET', '/atp/meta/keys?prefix=' + encodeURIComponent(prefix))).keys || []; }
  async ping(from, to) { if (to === this.identity.fingerprint) return true; await this.call(to, 'GET', '/atp/ping'); return true; }
}
function hostOf(u) { try { return new URL(u).host; } catch { return null; } }
