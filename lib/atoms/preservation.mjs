// Distributed atom preservation: content-addressed segments, adaptive replication / Reed–Solomon
// erasure coding, quorum-replicated metadata, explicit durability lifecycle, failure detection and
// automatic repair. Transport-agnostic: an in-memory transport for tests and fault injection, and a
// signed MTP transport for real nodes on any host.
import { createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { pack, unpack, hashBytes, contentHash, encode as msgEncode } from './codec.mjs';
import * as RS from './erasure.mjs';

export const DEFAULT_POLICY = { ecMinBytes: 4096, k: 4, m: 2, ecCommitShards: 5, replicas: 3, commitReplicas: 2, metaReplicas: 3, metaWrite: 2, metaRead: 2, suspectMs: 15000, deadMs: 60000, repairConcurrency: 2, segmentMaxBytes: 256 * 1024, dedupDomain: 'public', maxPending: 50, retryBaseMs: 30000, retryMaxMs: 3600000, maxRepairsPerRun: 64, gcGraceMs: 6 * 3600000,
  // Adaptive stripe width: wider codes on larger networks (same 1.5× overhead, more failures tolerated); 'critical' data gets one extra parity.
  stripes: [{ minNodes: 12, k: 8, m: 4 }, { minNodes: 6, k: 4, m: 2 }], domainKeys: {} };
export const bucketOf = id => 'idx:' + createHash('sha256').update(id).digest('hex').slice(0, 2); // 256 index buckets
const score = (key, node) => createHash('sha256').update(key + '|' + node).digest().readUInt32BE(0);

// ---------- storage of one node (chunks + versioned metadata) ----------
export class LocalStore {
  constructor({ quotaBytes = 512 * 1024 * 1024, blobs = null, meta = null } = {}) { this.chunks = new Map(); this.sizes = new Map(); this.meta = meta || new Map(); this.quota = quotaBytes; this.used = 0; this.blobs = blobs; }
  // Durable hosts keep chunks as blobs; a small index (key → size) survives restarts so quota, listing and GC stay correct.
  async load() { if (!this.blobs) return this; try { const b = await this.blobs.read('chunk-index.json'); if (b?.length) for (const [k, n] of Object.entries(JSON.parse(b.toString()))) { this.sizes.set(k, n); } this.used = [...this.sizes.values()].reduce((a, b) => a + b, 0); } catch { /* start empty */ } return this; }
  async saveIndex() { if (this.blobs) await this.blobs.write('chunk-index.json', Buffer.from(JSON.stringify(Object.fromEntries(this.sizes)))); }
  blobName(key) { return 'chunk-' + key.replace(/[^a-z0-9-]/gi, '_'); }
  async putChunk(key, bytes) {
    if (hashBytes(bytes) !== key.split(':').pop()) throw new Error('chunk hash mismatch'); // integrity at write
    if (this.sizes.has(key)) return true; if (this.used + bytes.length > this.quota) throw new Error('storage quota exceeded');
    this.chunks.set(key, Buffer.from(bytes)); this.sizes.set(key, bytes.length); this.used += bytes.length;
    if (this.blobs) { await this.blobs.write(this.blobName(key), bytes); await this.saveIndex(); } return true;
  }
  async getChunk(key) { let b = this.chunks.get(key); if (!b && this.blobs && this.sizes.has(key)) { b = await this.blobs.read(this.blobName(key)); if (b?.length) this.chunks.set(key, b); else b = null; } if (b && hashBytes(b) !== key.split(':').pop()) throw new Error('chunk corrupted'); return b || null; }
  hasChunk(key) { return this.sizes.has(key); }
  chunkKeys() { return [...this.sizes.keys()]; }
  async dropChunk(key) { const n = this.sizes.get(key); if (n == null) return; this.used -= n; this.sizes.delete(key); this.chunks.delete(key); if (this.blobs) { await this.blobs.write(this.blobName(key), Buffer.alloc(0)); await this.saveIndex(); } }
  metaPut(key, rec) { const cur = this.meta.get(key); if (!cur || newer(rec.version, cur.version)) { this.meta.set(key, rec); return true; } return false; }
  metaGet(key) { return this.meta.get(key) || null; }
  metaKeys(prefix) { return [...this.meta.keys()].filter(k => k.startsWith(prefix)); }
  bytes() { let n = 0; for (const b of this.sizes.values()) n += b; return n; }
  metaBytes() { let n = 0; for (const v of this.meta.values()) n += msgEncode(v).length; return n; }
}
// Compact bucket format: { s: [segmentHash …], a: { atomId: [segmentIndex, rev16, at] } } — a grow-only map merged on read.
export const mergeIndex = (a, b) => { const out = { s: [...(a.s || [])], a: { ...(a.a || {}) } }; for (const [id, [si, rev, at]] of Object.entries(b.a || {})) { const seg = b.s[si]; let k = out.s.indexOf(seg); if (k < 0) { out.s.push(seg); k = out.s.length - 1; } const cur = out.a[id]; if (!cur || at > cur[2] || (at === cur[2] && seg > out.s[cur[0]])) out.a[id] = [k, rev, at]; } return out; };
export const indexEntry = (bucket, id) => { const e = bucket?.a?.[id]; return e ? { segment: bucket.s[e[0]], rev16: e[1], at: e[2] } : null; };
// Index buckets travel and rest compressed (msgpack + deflate, base64 so they survive JSON transports).
const wire = rec => rec && rec.key?.startsWith('idx:') && rec.value && !rec.value.z ? { ...rec, value: { z: pack(rec.value).toString('base64') } } : rec;
const unwire = rec => rec && rec.value?.z ? { ...rec, value: unpack(Buffer.from(rec.value.z, 'base64')) } : rec;
// Private domains: segments are sealed with AES-256-GCM before coding. The nonce is derived from the plaintext
// (HMAC), so identical payloads still deduplicate inside the domain but nothing is readable or linkable outside it.
export function seal(key, plain) { const nonce = createHmac('sha256', key).update(plain).digest().subarray(0, 12), c = createCipheriv('aes-256-gcm', key, nonce), ct = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([Buffer.from('KXE1'), nonce, c.getAuthTag(), ct]); }
export function unseal(key, box) { if (box.subarray(0, 4).toString() !== 'KXE1') throw new Error('not a sealed segment'); const d = createDecipheriv('aes-256-gcm', key, box.subarray(4, 16)); d.setAuthTag(box.subarray(16, 32)); return Buffer.concat([d.update(box.subarray(32)), d.final()]); }
// Index keys in a private domain are keyed hashes of the atom id, so peers cannot even see which atoms exist.
export const privateId = (key, id) => 'h:' + createHmac('sha256', key).update('id|' + id).digest('hex').slice(0, 32);
const newer = (a, b) => !b || a.n > b.n || (a.n === b.n && String(a.by) > String(b.by));

// ---------- in-memory network for tests / fault injection ----------
export class InMemoryTransport {
  constructor() { this.nodes = new Map(); this.groups = null; this.calls = 0; }
  add(id, domain = id, opts = {}) { this.nodes.set(id, { id, domain, store: new LocalStore(opts), alive: true }); return this; }
  kill(id) { this.nodes.get(id).alive = false; } revive(id) { this.nodes.get(id).alive = true; }
  wipe(id) { const n = this.nodes.get(id); n.store = new LocalStore(); }
  partition(...groups) { this.groups = groups.map(g => new Set(g)); } heal() { this.groups = null; }
  reach(from, to) { const n = this.nodes.get(to); if (!n || !n.alive) throw new Error(`node ${to} unreachable`); if (this.groups && !this.groups.some(g => g.has(from) && g.has(to))) throw new Error(`partition between ${from} and ${to}`); this.calls++; return n.store; }
  members() { return [...this.nodes.values()].map(n => ({ id: n.id, domain: n.domain })); }
  async put(from, to, key, b) { return this.reach(from, to).putChunk(key, b); }
  async get(from, to, key) { return this.reach(from, to).getChunk(key); }
  async has(from, to, key) { return this.reach(from, to).hasChunk(key); }
  async metaPut(from, to, key, rec) { return this.reach(from, to).metaPut(key, rec); }
  async metaGet(from, to, key) { return this.reach(from, to).metaGet(key); }
  async metaKeys(from, to, prefix) { return this.reach(from, to).metaKeys(prefix); }
  async ping(from, to) { this.reach(from, to); return true; }
}

// ---------- the engine that runs on every node ----------
export class PreservationEngine {
  constructor({ self, transport, members = () => transport.members(), policy = {}, now = () => Date.now(), log = () => {}, local = null }) {
    Object.assign(this, { self, transport, members, now, log, local }); this.alerts = [];
    if ((policy.k || policy.m) && !policy.stripes) policy = { ...policy, stripes: null }; /* an explicit k/m means a fixed code */ this.orphans = new Map(); this.policy = { ...DEFAULT_POLICY, ...policy };
    this.health = new Map(); this.pending = []; this.audit = []; this.locks = new Set(); this.counters = { commits: 0, pendingCommits: 0, repairs: 0, reconstructions: 0, lostSegments: 0, backpressure: 0, rebalanced: 0, collected: 0 };
  }
  // Failure detection: alive → suspect → dead (confirmed) using heartbeat age.
  async heartbeat() { for (const m of this.members()) { if (m.id === this.self) { this.health.set(m.id, { lastSeen: this.now() }); continue; } try { await this.transport.ping(this.self, m.id); this.health.set(m.id, { lastSeen: this.now() }); } catch { if (!this.health.has(m.id)) this.health.set(m.id, { lastSeen: this.now() - this.policy.deadMs - 1 }); } } }
  status(id) { if (id === this.self) return 'alive'; const h = this.health.get(id); if (!h) return 'unknown'; const age = this.now() - h.lastSeen; return age > this.policy.deadMs ? 'dead' : age > this.policy.suspectMs ? 'suspect' : 'alive'; }
  usable() { return this.members().filter(m => this.status(m.id) !== 'dead'); }
  // Rendezvous (HRW) placement, spreading across failure domains first.
  place(key, count, exclude = []) {
    const ranked = this.usable().filter(m => !exclude.includes(m.id)).sort((a, b) => score(key, b.id) - score(key, a.id)), out = [], domains = new Set();
    for (const m of ranked) if (out.length < count && !domains.has(m.domain)) { out.push(m.id); domains.add(m.domain); }
    for (const m of ranked) if (out.length < count && !out.includes(m.id)) out.push(m.id);
    return out;
  }
  // ---------- metadata: quorum-replicated, versioned (no single point of failure) ----------
  async metaWrite(key, value, { version } = {}) {
    const cur = await this.metaRead(key, { quiet: true }).catch(() => null);
    const rec = { key, value, version: version || { n: (cur?.version.n || 0) + 1, by: this.self }, at: new Date(this.now()).toISOString() };
    const targets = this.place('meta:' + key, this.policy.metaReplicas); let acks = 0;
    const sent = wire(rec); await Promise.all(targets.map(async t => { try { await this.transport.metaPut(this.self, t, key, sent); acks++; } catch { /* counted below */ } }));
    if (acks < this.policy.metaWrite) throw new Error(`metadata quorum not reached for ${key} (${acks}/${this.policy.metaWrite})`);
    return rec;
  }
  async metaRead(key, { quiet = false } = {}) {
    const targets = this.place('meta:' + key, this.policy.metaReplicas + 2); const recs = [];
    await Promise.all(targets.map(async t => { try { const r = unwire(await this.transport.metaGet(this.self, t, key)); recs.push({ t, r }); } catch { /* unreachable */ } }));
    if (recs.length < this.policy.metaRead && !quiet) throw new Error(`metadata read quorum not reached for ${key}`);
    const home = new Set(targets.slice(0, this.policy.metaReplicas));
    const best = recs.map(x => x.r).filter(Boolean).sort((a, b) => newer(a.version, b.version) ? -1 : 1)[0] || null;
    if (best && key.startsWith('idx:')) { let merged = { s: [], a: {} }; const horizon = this.now() + 300000; /* future-dated pointers (clock abuse) are ignored */ for (const { r } of recs) if (r) merged = mergeIndex(merged, { s: r.value.s, a: Object.fromEntries(Object.entries(r.value.a || {}).filter(([, e]) => e[2] <= horizon)) }); if (JSON.stringify(merged) !== JSON.stringify(best.value)) { const fused = { ...best, value: merged, version: { n: best.version.n + 1, by: this.self } }; const w = wire(fused); for (const { t } of recs.filter(x => home.has(x.t))) this.transport.metaPut(this.self, t, key, w).catch(() => {}); return fused; } }
    if (best) for (const { t, r } of recs) if (home.has(t) && (!r || newer(best.version, r.version))) this.transport.metaPut(this.self, t, key, wire(best)).catch(() => {}); // read repair (home replicas only)
    return best;
  }
  // ---------- commit ----------
  async commit(records, { importance = 'normal', domain = this.policy.dedupDomain } = {}) {
    // Backpressure: when too many commits are already waiting for durability, do not pile more onto a struggling network.
    if (this.pending.length >= this.policy.maxPending) { this.counters.backpressure++; return { segment: null, durability: 'PENDING_DURABILITY', acks: 0, needed: null, backpressure: true, reason: `Backpressure: ${this.pending.length} commits are already waiting for durable storage; these atoms stay local (PROVISIONAL) and will be retried.` }; }
    // The deduplication domain is part of the content address: identical payloads dedupe within a domain, never across (tenant boundary).
    const key = domain !== 'public' ? this.policy.domainKeys?.[domain] : null, plain = pack({ v: 1, ...(domain === 'public' ? {} : { domain }), records: records.map(r => ({ id: r.id, rev: r.rev, dna: r.dna })) });
    const bytes = key ? seal(key, plain) : plain, hash = hashBytes(bytes), idOf = id => key ? privateId(key, id) : id;
    const existing = await this.metaRead('seg:' + hash, { quiet: true }).catch(() => null);
    let manifest = existing?.value, report;
    if (!manifest) {
      const nodes = this.usable().length, P = this.policy, st = this.stripe(nodes, importance), ec = bytes.length >= P.ecMinBytes && !!st;
      manifest = { hash, size: bytes.length, scheme: ec ? 'rs' : 'replica', k: ec ? st.k : 1, m: ec ? st.m : Math.min(P.replicas + (importance === 'critical' ? 1 : 0), nodes) - 1, createdBy: this.self, at: new Date(this.now()).toISOString(), atomCount: records.length, sampleAtom: key ? null : records[0]?.id, importance, fragments: [], ...(key ? { encrypted: 'aes-256-gcm', domain } : domain !== 'public' ? { domain } : {}) };
      if (ec) {
        manifest.commitShards = st.k + Math.ceil(st.m / 2);
        const enc = RS.encode(bytes, st.k, st.m); manifest.shardSize = enc.shardSize; const used = [];
        for (let i = 0; i < enc.shards.length; i++) { const key = `${hash}:${i}:${hashBytes(enc.shards[i])}`, [t] = this.place(key, 1, used); used.push(t); manifest.fragments.push({ index: i, key, nodes: t ? [t] : [] }); }
        report = await this.storeFragments(manifest, i => enc.shards[i]);
      } else { const rk = `${hash}:r:${hash}`; manifest.fragments.push({ index: 0, key: rk, nodes: this.place(rk, manifest.m + 1) }); report = await this.storeFragments(manifest, () => bytes); }
      this.recordHosts(manifest);
    } else report = { acks: this.countAvailable(manifest), deduplicated: true };
    const needed = manifest.scheme === 'rs' ? (manifest.commitShards ?? (manifest.k === 4 && manifest.m === 2 ? this.policy.ecCommitShards : manifest.k + Math.ceil(manifest.m / 2))) : this.policy.commitReplicas;
    let durability = report.acks >= needed ? 'COMMITTED' : 'PENDING_DURABILITY', metaError = null;
    if (durability === 'COMMITTED') {
      try {
        await this.metaWrite('seg:' + hash, manifest);
        // Atom → segment index lives in 256 shared buckets (grow-only maps merged on read), not one record per atom.
        const byBucket = new Map(); for (const r of records) { const ix = idOf(r.id), b = bucketOf(ix); if (!byBucket.has(b)) byBucket.set(b, { s: [hash], a: {} }); byBucket.get(b).a[ix] = [0, r.rev.slice(0, 16), this.now()]; }
        for (const [b, entries] of byBucket) { const cur = await this.metaRead(b, { quiet: true }).catch(() => null); await this.metaWrite(b, mergeIndex(cur?.value || { s: [], a: {} }, entries), { version: { n: (cur?.version.n || 0) + 1, by: this.self } }); }
      }
      catch (e) { durability = 'PENDING_DURABILITY'; metaError = e.message; }
    }
    if (durability === 'COMMITTED') this.counters.commits++; else { this.counters.pendingCommits++; this.pending.push({ records, domain, at: this.now(), attempts: 0, nextAt: this.now() + this.policy.retryBaseMs, reason: metaError || `${report.acks}/${needed} durable acknowledgements` }); }
    this.audit.push({ at: new Date(this.now()).toISOString(), op: 'commit', segment: hash, atoms: records.length, durability, acks: report.acks, needed, reason: metaError });
    return { segment: hash, durability, acks: report.acks, needed, scheme: manifest.scheme, deduplicated: !!report.deduplicated, reason: durability === 'COMMITTED' ? null : (metaError || `Only ${report.acks} of ${needed} required copies reached durable storage; loss is possible until this commit completes.`) };
  }
  recordHosts(m) { if (!this.transport.urlOf) return; const hosts = {}; for (const f of m.fragments) for (const n of f.nodes) { const u = this.transport.urlOf(n); if (u) hosts[n] = u; } m.hosts = hosts; }
  stripe(nodes, importance = 'normal') {
    const list = this.policy.stripes?.length ? this.policy.stripes : [{ minNodes: this.policy.k + this.policy.m, k: this.policy.k, m: this.policy.m }];
    for (const s of [...list].sort((a, b) => b.minNodes - a.minNodes)) { if (nodes < Math.max(s.minNodes, s.k + s.m)) continue; const extra = importance === 'critical' && nodes >= s.k + s.m + 1 ? 1 : 0; return { k: s.k, m: s.m + extra }; }
    return null;
  }
  async storeFragments(manifest, dataOf) {
    let acks = 0;
    await Promise.all(manifest.fragments.map(async f => { const data = dataOf(f.index), ok = []; for (const n of f.nodes) { try { await this.transport.put(this.self, n, f.key, data); ok.push(n); } catch { /* unreachable */ } } f.nodes = ok; acks += manifest.scheme === 'rs' ? (ok.length ? 1 : 0) : ok.length; }));
    return { acks };
  }
  countAvailable(manifest) { return manifest.fragments.reduce((s, f) => s + (manifest.scheme === 'rs' ? (f.nodes.some(n => this.status(n) !== 'dead') ? 1 : 0) : f.nodes.filter(n => this.status(n) !== 'dead').length), 0); }
  // Retry policy: exponential backoff per pending commit (30 s, 60 s, … capped at 1 h); only due entries are retried.
  async retryPending({ force = false } = {}) {
    const due = [], wait = []; for (const p of this.pending) (force || p.nextAt <= this.now() ? due : wait).push(p); this.pending = wait; const out = [];
    for (const p of due) { const r = await this.commit(p.records, { domain: p.domain }); out.push(r); if (r.durability !== 'COMMITTED') { const q = this.pending.at(-1); if (q && q.records === p.records) { q.attempts = (p.attempts || 0) + 1; q.nextAt = this.now() + Math.min(this.policy.retryMaxMs, this.policy.retryBaseMs * 2 ** q.attempts); } } }
    return out;
  }
  // ---------- retrieval (works without the creator) ----------
  async fetchSegment(manifest) {
    if (manifest.hosts && this.transport.hint) this.transport.hint(manifest.hosts);
    if (manifest.scheme === 'replica') { for (const n of manifest.fragments[0].nodes) { try { const b = await this.transport.get(this.self, n, manifest.fragments[0].key); if (b && hashBytes(b) === manifest.hash) return b; } catch { /* next */ } } throw new Error('no replica reachable'); }
    const got = [];
    for (const f of manifest.fragments) { if (got.length >= manifest.k) break; for (const n of f.nodes) { try { const b = await this.transport.get(this.self, n, f.key); if (b && hashBytes(b) === f.key.split(':').pop()) { got.push({ index: f.index, data: b }); break; } } catch { /* try next */ } } }
    const data = RS.decode(got, { k: manifest.k, m: manifest.m, length: manifest.size, shardSize: manifest.shardSize });
    if (hashBytes(data) !== manifest.hash) throw new Error('reconstructed segment failed checksum'); return data;
  }
  // Reads look in this node's own (possibly private) domain first, then in the public network.
  async getAtom(id, { domain = null } = {}) {
    if (domain) return this.getAtomIn(id, domain);
    const own = this.policy.dedupDomain; if (own && own !== 'public') { const r = await this.getAtomIn(id, own).catch(() => null); if (r) return r; }
    return this.getAtomIn(id, 'public');
  }
  async getAtomIn(id, domain = 'public') {
    const key = domain !== 'public' ? this.policy.domainKeys?.[domain] : null; if (domain !== 'public' && !key && this.policy.domainKeys && Object.keys(this.policy.domainKeys).length) throw new Error('no key for domain ' + domain);
    const ixId = key ? privateId(key, id) : id, bucket = await this.metaRead(bucketOf(ixId)), e = indexEntry(bucket?.value, ixId); if (!e) return null; const ix = { value: e };
    const seg = await this.metaRead('seg:' + ix.value.segment); if (!seg) throw new Error('segment metadata missing');
    let raw = await this.fetchSegment(seg.value);
    if (seg.value.encrypted) { const k = this.policy.domainKeys?.[seg.value.domain]; if (!k) throw new Error('segment is encrypted for a private domain this node has no key for'); raw = unseal(k, raw); }
    const rec = unpack(raw).records.find(r => r.id === id);
    if (!rec || contentHash(rec.dna) !== rec.rev || !rec.rev.startsWith(e.rev16)) throw new Error('atom failed integrity verification');
    return { ...rec, segment: e.segment, createdBy: seg.value.createdBy };
  }
  // ---------- automatic recovery ----------
  async listSegments() { const keys = new Set(); for (const m of this.usable()) { try { for (const k of await this.transport.metaKeys(this.self, m.id, 'seg:')) keys.add(k.slice(4)); } catch { /* unreachable */ } } return [...keys]; }
  async repair() {
    await this.heartbeat(); const segs = await this.listSegments(), work = [];
    for (const h of segs) {
      const rec = await this.metaRead('seg:' + h, { quiet: true }).catch(() => null); if (!rec) continue; const m = rec.value;
      const target = m.scheme === 'rs' ? m.k + m.m : m.m + 1, avail = this.countAvailable(m), floor = m.scheme === 'rs' ? m.k : 1;
      if (avail >= target) continue;
      work.push({ h, m, rec, margin: avail - floor, avail, target });
    }
    work.sort((a, b) => a.margin - b.margin); // most endangered first
    for (const w of work) this.alert(w.margin < 0 ? 'critical' : w.margin === 0 ? 'high' : 'warning', w.h, `${w.avail}/${w.target} ${w.m.scheme === 'rs' ? 'fragments' : 'replicas'} available (margin ${w.margin})`);
    const batch = work.slice(0, this.policy.maxRepairsPerRun), results = []; // backpressure against recovery storms
    for (let i = 0; i < batch.length; i += this.policy.repairConcurrency) results.push(...await Promise.all(batch.slice(i, i + this.policy.repairConcurrency).map(w => this.repairOne(w))));
    const meta = await this.metaRepair();
    return { scanned: segs.length, degraded: work.length, deferred: work.length - batch.length, results, meta };
  }
  async repairOne({ h, m, rec, avail, target }) {
    if (this.locks.has(h)) return { segment: h, skipped: 'repair already running' }; this.locks.add(h);
    try {
      if (avail < (m.scheme === 'rs' ? m.k : 1)) { this.counters.lostSegments++; this.alert('critical', h, 'unrecoverable: fewer surviving fragments than needed to reconstruct'); this.audit.push({ at: new Date(this.now()).toISOString(), op: 'repair', segment: h, outcome: 'unrecoverable', avail }); return { segment: h, outcome: 'unrecoverable', state: 'LOST' }; }
      const data = await this.fetchSegment(m); this.counters.reconstructions++;
      const next = structuredClone(m), shards = m.scheme === 'rs' ? RS.encode(data, m.k, m.m).shards : null;
      for (const f of next.fragments) {
        const alive = f.nodes.filter(n => this.status(n) !== 'dead');
        const want = m.scheme === 'rs' ? 1 : target;
        if (alive.length >= want) { f.nodes = alive; continue; }
        const holders = next.fragments.flatMap(x => x.nodes.filter(n => this.status(n) !== 'dead'));
        const fresh = this.place(f.key + ':repair', want - alive.length, m.scheme === 'rs' ? holders : alive);
        const payload = m.scheme === 'rs' ? shards[f.index] : data;
        if (hashBytes(payload) !== f.key.split(':').pop()) throw new Error('rebuilt fragment checksum mismatch');
        const placed = []; for (const n of fresh) { try { await this.transport.put(this.self, n, f.key, payload); placed.push(n); } catch { /* try others later */ } }
        f.nodes = [...alive, ...placed];
      }
      this.recordHosts(next); await this.metaWrite('seg:' + h, next, { version: { n: rec.version.n + 1, by: this.self } });
      const restored = this.countAvailable(next); this.counters.repairs++;
      this.audit.push({ at: new Date(this.now()).toISOString(), op: 'repair', segment: h, before: avail, after: restored, target });
      return { segment: h, outcome: restored >= target ? 'restored' : 'partially-restored', before: avail, after: restored, target, state: restored >= target ? 'COMMITTED' : 'DEGRADED' };
    } finally { this.locks.delete(h); }
  }
  // Metadata recovery: make sure every manifest/index record lives on its current placement targets.
  async metaRepair(prefixes = ['seg:', 'idx:']) {
    let fixed = 0; const keys = new Set();
    for (const m of this.usable()) for (const p of prefixes) { try { for (const k of await this.transport.metaKeys(this.self, m.id, p)) keys.add(k); } catch { /* unreachable */ } }
    for (const key of keys) {
      const best = await this.metaRead(key, { quiet: true }).catch(() => null); if (!best) continue;
      for (const t of this.place('meta:' + key, this.policy.metaReplicas)) { try { const r = await this.transport.metaGet(this.self, t, key); if (!r || newer(best.version, r.version)) { await this.transport.metaPut(this.self, t, key, wire(best)); fixed++; } } catch { /* unreachable */ } }
    }
    if (fixed) this.audit.push({ at: new Date(this.now()).toISOString(), op: 'meta-repair', fixed, keys: keys.size });
    return { keys: keys.size, fixed };
  }
  alert(level, segment, message) { const last = this.alerts.at(-1); if (last?.segment === segment && last.message === message) return; this.alerts.push({ at: new Date(this.now()).toISOString(), level, segment, message }); this.alerts = this.alerts.slice(-50); this.log(`[preservation ${level}] ${segment?.slice(0, 12)} ${message}`); }
  // Rebalancing: when new independent failure domains join, move fragments that share a domain onto them.
  async rebalance({ max = 20 } = {}) {
    await this.heartbeat(); const moved = [], domainOf = new Map(this.members().map(m => [m.id, m.domain]));
    for (const h of await this.listSegments()) {
      if (moved.length >= max) break; if (this.locks.has(h)) continue;
      const rec = await this.metaRead('seg:' + h, { quiet: true }).catch(() => null); if (!rec || rec.value.scheme !== 'rs') continue;
      const m = rec.value, holders = m.fragments.map(f => f.nodes.find(n => this.status(n) !== 'dead')), used = new Map();
      for (const n of holders) if (n) used.set(domainOf.get(n), (used.get(domainOf.get(n)) || 0) + 1);
      const free = this.usable().filter(x => !used.has(x.domain) && !holders.includes(x.id)); if (!free.length) continue;
      const crowded = m.fragments.find((f, i) => holders[i] && used.get(domainOf.get(holders[i])) > 1); if (!crowded) continue;
      this.locks.add(h);
      try {
        const from = crowded.nodes.find(n => this.status(n) !== 'dead'), data = await this.transport.get(this.self, from, crowded.key);
        if (!data || hashBytes(data) !== crowded.key.split(':').pop()) continue;
        const freeIds = new Set(free.map(x => x.id)), [to] = this.place(crowded.key + ':rebalance', 1, this.usable().filter(x => !freeIds.has(x.id)).map(x => x.id)); if (!to) continue;
        await this.transport.put(this.self, to, crowded.key, data);
        const next = structuredClone(m); next.fragments[crowded.index].nodes = [to]; this.recordHosts(next); // the old copy becomes an orphan and is collected by its holder after a grace period
        await this.metaWrite('seg:' + h, next, { version: { n: rec.version.n + 1, by: this.self } });
        this.counters.rebalanced++; moved.push({ segment: h, fragment: crowded.index, from, to, fromDomain: domainOf.get(from), toDomain: domainOf.get(to) });
        this.audit.push({ at: new Date(this.now()).toISOString(), op: 'rebalance', segment: h, fragment: crowded.index, from, to });
      } finally { this.locks.delete(h); }
    }
    return { moved };
  }
  // Garbage collection of chunks this node holds but no current manifest assigns to it (after rebalancing/repair).
  // Decided by the holder itself from quorum metadata — peers can never delete each other's data.
  async gc() {
    if (!this.local) return { checked: 0, dropped: 0 }; let checked = 0, dropped = 0;
    for (const key of this.local.chunkKeys()) {
      checked++; const seg = key.split(':')[0], rec = await this.metaRead('seg:' + seg, { quiet: true }).catch(() => null);
      if (!rec) continue; // metadata unreachable or unknown: never delete on uncertainty
      const assigned = rec.value.fragments.some(f => f.key === key && f.nodes.includes(this.self));
      if (assigned) { this.orphans.delete(key); continue; }
      const since = this.orphans.get(key) ?? this.now(); this.orphans.set(key, since);
      if (this.now() - since >= this.policy.gcGraceMs) { await this.local.dropChunk(key); this.orphans.delete(key); dropped++; this.counters.collected++; }
    }
    return { checked, dropped, waiting: this.orphans.size };
  }
  report() { return { counters: this.counters, pending: this.pending.length, oldestPending: this.pending[0]?.at ? new Date(this.pending[0].at).toISOString() : null, alerts: this.alerts.slice(-10), repairing: [...this.locks].map(h => h.slice(0, 16)) }; }
  // Durability state of one atom as the network sees it now.
  async durability(id, { domain = this.policy.dedupDomain || 'public' } = {}) {
    const key = domain !== 'public' ? this.policy.domainKeys?.[domain] : null, ixId = key ? privateId(key, id) : id;
    const bk = await this.metaRead(bucketOf(ixId), { quiet: true }).catch(() => null), e = indexEntry(bk?.value, ixId), ix = e ? { value: e } : null;
    if (!ix) return this.pending.some(p => p.records.some(r => r.id === id)) ? 'PENDING_DURABILITY' : 'PROVISIONAL';
    if (this.locks.has(ix.value.segment)) return 'REPAIRING';
    const seg = await this.metaRead('seg:' + ix.value.segment, { quiet: true }); const m = seg.value, a = this.countAvailable(m), target = m.scheme === 'rs' ? m.k + m.m : m.m + 1;
    return a >= target ? 'COMMITTED' : a >= (m.scheme === 'rs' ? m.k : 1) ? 'DEGRADED' : 'LOST';
  }
}
