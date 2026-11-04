// Evolvable security mechanisms (v1.10).
// 1) Tamper-evident audit chain: every security- or evolution-relevant event is appended with the hash of the previous
//    entry; editing or deleting any past entry breaks verification from that point on.
// 2) Node key rotation: a node can replace its Ed25519 identity. The OLD key signs a rotation certificate naming the
//    NEW key, so peers can move trust (reputation, history) to the new fingerprint without a man-in-the-middle being
//    able to claim it. The old key is retired; certificates cannot be replayed for a different new key.
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { fingerprintOf } from '../mesh.mjs';

const sha = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

export class AuditChain {
  constructor({ state = {}, now = () => Date.now(), max = 5000 } = {}) { this.S = state; this.S.entries ||= []; this.S.dropped ||= { count: 0, lastHash: '0'.repeat(64) }; this.now = now; this.max = max; }
  append(kind, data = {}) {
    const prev = this.S.entries.at(-1)?.hash || this.S.dropped.lastHash, entry = { seq: (this.S.entries.at(-1)?.seq ?? this.S.dropped.count - 1) + 1, at: this.now(), kind: String(kind).slice(0, 40), data: JSON.parse(JSON.stringify(data ?? {}).slice(0, 2000) || '{}'), prev };
    entry.hash = sha([entry.seq, entry.at, entry.kind, entry.data, entry.prev]); this.S.entries.push(entry);
    // bounded: old entries are summarised by the hash of the last dropped one, so the chain stays verifiable
    if (this.S.entries.length > this.max) { const cut = this.S.entries.splice(0, this.S.entries.length - this.max); this.S.dropped = { count: this.S.dropped.count + cut.length, lastHash: cut.at(-1).hash }; }
    return entry;
  }
  verify() {
    let prev = this.S.dropped.lastHash;
    for (const e of this.S.entries) { if (e.prev !== prev) return { ok: false, brokenAt: e.seq, why: 'previous-hash link broken (an entry was removed or reordered)' }; if (sha([e.seq, e.at, e.kind, e.data, e.prev]) !== e.hash) return { ok: false, brokenAt: e.seq, why: 'entry content changed' }; prev = e.hash; }
    return { ok: true, entries: this.S.entries.length, head: prev };
  }
  tail(n = 50) { return this.S.entries.slice(-n); }
}

const CERT = 'kenuxa-key-rotation/1';
export function rotateIdentity(identity, { now = Date.now() } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const next = { publicKey: pub, privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), fingerprint: fingerprintOf(pub), createdAt: new Date(now).toISOString() };
  const body = { type: CERT, from: identity.fingerprint, fromKey: identity.publicKey, to: next.fingerprint, toKey: next.publicKey, at: now };
  const msg = Buffer.from(JSON.stringify(body)), oldKey = createPrivateKey({ key: Buffer.from(identity.privateKey, 'base64'), format: 'der', type: 'pkcs8' }), newKey = createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' });
  // signed by BOTH keys: the old one authorises the move, the new one proves possession
  const certificate = { ...body, sigOld: sign(null, msg, oldKey).toString('base64'), sigNew: sign(null, msg, newKey).toString('base64') };
  return { identity: { ...next, previous: [{ fingerprint: identity.fingerprint, publicKey: identity.publicKey, retiredAt: new Date(now).toISOString() }, ...(identity.previous || [])].slice(0, 5), rotation: certificate }, certificate };
}
// returns { ok, from, to } — the peer record for `from` may be moved to `to`
export function verifyRotation(cert, { knownKey = null, maxAgeMs = 30 * 86400000, now = Date.now() } = {}) {
  try {
    if (!cert || cert.type !== CERT) return { ok: false, why: 'not a rotation certificate' };
    if (fingerprintOf(cert.fromKey) !== cert.from || fingerprintOf(cert.toKey) !== cert.to) return { ok: false, why: 'fingerprints do not match keys' };
    if (knownKey && knownKey !== cert.fromKey) return { ok: false, why: 'certificate is not from the key we know for this node' };
    if (now - cert.at > maxAgeMs || cert.at > now + 120000) return { ok: false, why: 'certificate expired or from the future' };
    const msg = Buffer.from(JSON.stringify({ type: cert.type, from: cert.from, fromKey: cert.fromKey, to: cert.to, toKey: cert.toKey, at: cert.at }));
    const k = b => createPublicKey({ key: Buffer.from(b, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, msg, k(cert.fromKey), Buffer.from(cert.sigOld, 'base64'))) return { ok: false, why: 'old-key signature invalid' };
    if (!verify(null, msg, k(cert.toKey), Buffer.from(cert.sigNew, 'base64'))) return { ok: false, why: 'new-key signature invalid' };
    return { ok: true, from: cert.from, to: cert.to };
  } catch (e) { return { ok: false, why: 'malformed certificate' }; }
}
