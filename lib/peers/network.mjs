// KENUXA Universal Node Participation Protocol (KUNPP) v2 — core-node side.
// Volunteer peers — browser tabs (Type B), installed agents (Type C) and peers with verified specialised capabilities
// (Type D) — register with explicit consent (plus a small proof-of-work against mass registration), advertise
// capabilities, lease bounded tasks from a fixed vocabulary (lib/peers/tasks.mjs) and submit results. The core never
// trusts a result: reported issues are re-checked on the core, clean results are confirmed by an independent replica
// on another network or a core spot-check, specialised capabilities must first pass a probe with a known answer, and
// storage peers must answer fresh storage-proof challenges. Peers never write canonical knowledge; a verified restore
// can only bring back a revision whose content hash the core already knows.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { runTask, storageProof, encodeCanonical, sha256hex, TASK_VOCABULARY, TASK_KINDS, TASK_SPECS } from './tasks.mjs';

export const KUNPP = 'KUNPP/2';
export const CONSENT_VERSION = 'compute-consent/1';
const sha = s => createHash('sha256').update(s).digest('hex');
export const PROFILES = {
  light: { batch: 40, concurrency: 1, minIntervalMs: 10000, leaseMs: 60000, maxTasksPerHour: 120 },
  balanced: { batch: 120, concurrency: 1, minIntervalMs: 2000, leaseMs: 45000, maxTasksPerHour: 900 },
  custom: { batch: 120, concurrency: 1, minIntervalMs: 2000, leaseMs: 45000, maxTasksPerHour: 600 },
  dedicated: { batch: 300, concurrency: 2, minIntervalMs: 500, leaseMs: 120000, maxTasksPerHour: 6000 },
};
const ATOM_KINDS = ['atom-validate/1', 'relation-check/1', 'lexical-consistency/1', 'graph-metrics/1'];
const DEFAULT_MIX = { 'atom-validate/1': 4, 'relation-check/1': 2, 'lexical-consistency/1': 1, 'graph-metrics/1': 1, 'claim-consistency/1': 1 };
const IRREGULAR = ['men', 'women', 'children', 'people', 'feet', 'teeth', 'mice', 'geese', 'oxen', 'data', 'went', 'saw', 'ran', 'ate', 'took', 'gave', 'came', 'made', 'said', 'did', 'had', 'was', 'were', 'got', 'knew', 'thought', 'bought', 'brought', 'taught', 'sat', 'met', 'put', 'cut', 'let', 'set', 'hit', 'read', 'began', 'drank', 'sang', 'swam', 'wrote', 'rode', 'spoke', 'broke', 'chose', 'froze', 'drove', 'flew', 'grew', 'threw', 'drew', 'held', 'stood', 'understood', 'told', 'sold', 'felt', 'left', 'kept', 'slept', 'built', 'sent', 'spent', 'lost', 'found', 'won', 'heard', 'paid', 'laid', 'meant', 'fell', 'fought', 'caught', 'sought', 'became', 'forgot', 'hid', 'lit', 'shot', 'bled', 'fed', 'led', 'sped', 'fled'];
const cpuNow = () => { const u = process.cpuUsage(); return u.user + u.system; };
const leadingZeroBits = hex => { let n = 0; for (const ch of hex) { const v = parseInt(ch, 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; } return n; };

export class ComputeNetwork {
  constructor({ state, registry, rules, isPublic = () => true, claimsSource = () => [], procedureSource = () => [], onProcedureResults = null, onRestore = null, coordinators = () => [], now = () => Date.now(), random = Math.random, secret = randomBytes(32).toString('hex'), options = {} }) {
    this.S = state.compute ??= {}; for (const k of ['peers', 'tasks', 'findings', 'replicas', 'graph']) this.S[k] ??= {}; this.S.queue ??= []; this.S.cursor ??= 0; this.S.claimCursor ??= 0; this.S.registrations ??= []; this.S.kindTurn ??= 0;
    this.S.metrics ??= {}; for (const k of ['registered', 'created', 'leased', 'accepted', 'rejected', 'expired', 'reassigned', 'replicated', 'spotChecks', 'arbitrations', 'coreFallback', 'coreAtoms', 'peerAtoms', 'bytesOut', 'bytesIn', 'schedulerCpuUs', 'verifyCpuUs', 'coreTaskCpuUs', 'coreTaskAtoms', 'powRejected', 'probesPassed', 'probesFailed', 'replicasStored', 'proofsPassed', 'proofsFailed', 'restored', 'p2pPairs', 'p2pBytesAvoided', 'p2pFallbacks', 'p2pFallbackBytes', 'cancelled']) this.S.metrics[k] ??= 0; this.S.metrics.latenciesMs ??= [];
    Object.assign(this, { registry, rules: { ...rules, irregular: IRREGULAR }, isPublic, claimsSource, procedureSource, onProcedureResults, onRestore, coordinators, now, random, secret });
    this.o = { maxPeers: 5000, maxQueue: 400, batch: 120, replicate: 0.25, spotCheck: 0.1, newPeerTasks: 3, maxAttempts: 3, registrationsPerIpHour: 20, registrationsPerHour: 2000, offlineMs: 90000, powBits: 0, distinctNetworks: true, mix: DEFAULT_MIX, p2p: true, replicaTarget: 2, storageMaxMB: 2048, ...options };
    this.leases = new Map(); this.usedChallenges = new Map(); this.pairs = new Map(); this.mail = new Map();
  }
  // A signed ATP server is a compute worker only after its key is verified
  // by the existing Mesh handshake. It never receives a browser credential
  // or gains permission to write canonical/private data.
  trustedNode(who){
    if(!who||!/^kx[0-9a-f]{30}$/.test(who.fingerprint||'')||!who.publicKey)
      throw Object.assign(new Error('unverified node identity'),{status:401});
    const id='node_'+who.fingerprint;
    let p=this.S.peers[id];
    if(p && p.publicKey && p.publicKey!==who.publicKey)
      throw Object.assign(new Error('node key changed without verified rotation'),{status:403});
    const now=this.now();
    if(!p){
      p={id,publicKey:who.publicKey,tokenHash:null,type:'dedicated',profile:'dedicated',
        limits:{...PROFILES.dedicated,batch:50,concurrency:1,minIntervalMs:2000,maxTasksPerHour:240},
        caps:sanitizeCaps({workers:true,subtleCrypto:true,agent:'node',cores:1}),
        verified:[],probes:{},ipKey:'signed-atp:'+who.fingerprint,userKey:null,
        registeredAt:now,lastSeen:now,lastLease:0,leases:0,tasksHour:[],
        reputation:0.45,done:0,accepted:0,rejected:0,atoms:0,
        state:'active',bytesOut:0,bytesIn:0,cache:[]};
      this.S.peers[id]=p;this.S.metrics.registered++;
    }
    p.lastSeen=now;if(p.state==='offline')p.state='active';
    if(p.state==='revoked'||p.state==='left')
      throw Object.assign(new Error('node compute participation revoked'),{status:403});
    return p;
  }
  // ---------- protocol description (public) ----------
  protocol() { return { protocol: KUNPP, consentVersion: CONSENT_VERSION, taskVocabulary: TASK_VOCABULARY, tasks: Object.fromEntries(TASK_KINDS.map(k => [k, TASK_SPECS[k]])), profiles: PROFILES, powBits: this.powBits(), coordinators: this.coordinators().slice(0, 8), p2p: this.o.p2p ? { transport: 'WebRTC DataChannel, signalled through this coordinator; HTTPS fallback always available', iceServers: this.o.iceServers || [] } : null, data: 'public atoms and public claims only — never conversations, accounts, tokens or private knowledge', trust: 'results are verified by the core (flag re-check, independent replicas, spot-checks, probes, storage proofs); peers never write canonical knowledge' }; }
  // ---------- anti-Sybil proof of work ----------
  powBits() { const t = this.now(), recent = this.S.registrations.filter(r => t - r.at < 3600000).length; return this.o.powBits ? this.o.powBits + Math.floor(Math.max(0, recent - 100) / 100) : 0; }
  challenge() { const exp = this.now() + 300000, r = randomBytes(12).toString('hex'), body = `${exp}.${r}.${this.powBits()}`; return { challenge: `${body}.${createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32)}`, bits: this.powBits(), expiresAt: exp }; }
  checkPow(pow) {
    if (!this.o.powBits) return true;
    const [exp, r, bits, mac] = String(pow?.challenge || '').split('.'), body = `${exp}.${r}.${bits}`;
    if (!mac || createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32) !== mac || Number(exp) < this.now() || this.usedChallenges.has(mac)) return false;
    if (leadingZeroBits(sha(`${pow.challenge}:${pow.nonce}`)) < Number(bits)) return false;
    this.usedChallenges.set(mac, Number(exp)); for (const [k, e] of this.usedChallenges) if (e < this.now()) this.usedChallenges.delete(k); return true;
  }
  // ---------- registration & identity ----------
  // versioned credential hashing (v1.9): 'sha256' (legacy, unprefixed) or 'sha512:<hex>' — evolvable by security policy
  hashToken(token, alg = this.o.tokenHash || 'sha256') { return alg === 'sha256' ? sha(token) : alg + ':' + createHash(alg).update(String(token)).digest('hex'); }
  register({ consent, consentVersion, capabilities = {}, profile = 'light', custom = {}, ipKey = 'unknown', userKey = null, pow = null }) {
    if (consent !== true || consentVersion !== CONSENT_VERSION) throw Object.assign(new Error('explicit consent is required before a device can process network tasks'), { status: 403 });
    if (!this.checkPow(pow)) { this.S.metrics.powRejected++; throw Object.assign(new Error('a valid proof-of-work for a fresh challenge is required (GET /peer/challenge)'), { status: 428 }); }
    const t = this.now(); this.S.registrations = this.S.registrations.filter(r => t - r.at < 3600000);
    if (this.S.registrations.length >= this.o.registrationsPerHour) throw Object.assign(new Error('registration limit reached; try later'), { status: 429 });
    if (this.S.registrations.filter(r => r.ip === ipKey).length >= this.o.registrationsPerIpHour) throw Object.assign(new Error('too many registrations from this network; try later'), { status: 429 });
    if (userKey && Object.values(this.S.peers).filter(p => p.userKey === userKey && p.state === 'active').length >= 10) throw Object.assign(new Error('too many active devices for this account'), { status: 429 });
    this.prune(); if (Object.keys(this.S.peers).length >= this.o.maxPeers) throw Object.assign(new Error('peer capacity reached'), { status: 503 });
    const caps = sanitizeCaps(capabilities); if (!caps.workers || !caps.subtleCrypto) throw Object.assign(new Error('this device cannot run KUNPP tasks (needs Web Workers and WebCrypto)'), { status: 400 });
    const dedicated = caps.agent === 'node', prof = dedicated && profile === 'dedicated' ? 'dedicated' : PROFILES[profile] && profile !== 'dedicated' ? profile : 'light', limits = { ...PROFILES[prof] };
    if (prof === 'custom') { limits.maxTasksPerHour = clamp(custom.maxTasksPerHour, 10, 1200, 300); limits.batch = clamp(custom.batch, 10, 300, 80); limits.minIntervalMs = clamp(custom.minIntervalMs, 1000, 60000, 3000); }
    if (caps.mobile || caps.saveData || (caps.memoryGB && caps.memoryGB < 2)) { limits.batch = Math.min(limits.batch, 40); limits.minIntervalMs = Math.max(limits.minIntervalMs, 8000); }
    const peerId = 'p_' + randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
    this.S.peers[peerId] = { id: peerId, tokenHash: this.hashToken(token), type: dedicated ? (caps.specialized.length ? 'specialized' : 'dedicated') : 'browser', profile: prof, limits, caps, verified: [], probes: {}, ipKey, userKey, registeredAt: t, lastSeen: t, lastLease: 0, leases: 0, tasksHour: [], reputation: 0.3, done: 0, accepted: 0, rejected: 0, atoms: 0, state: 'active', bytesOut: 0, bytesIn: 0, cache: [] };
    this.S.registrations.push({ at: t, ip: ipKey }); this.S.metrics.registered++;
    return { peerId, token, profile: prof, limits, protocol: KUNPP, heartbeatMs: this.heartbeatMs(), claimed: { specialized: caps.specialized, storageMB: caps.storageMB }, note: caps.specialized.length || caps.storageMB ? 'claimed capabilities are used only after the core has verified them (probe task / storage proof)' : undefined };
  }
  auth(peerId, token) {
    const p = this.S.peers[String(peerId)]; if (!p || p.state === 'revoked' || typeof token !== 'string' || token.length !== 64) throw Object.assign(new Error('unknown or revoked peer'), { status: 401 });
    const stored = String(p.tokenHash), alg = stored.includes(':') ? stored.split(':')[0] : 'sha256', a = Buffer.from(this.hashToken(token, alg)), b = Buffer.from(stored); if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('invalid peer token'), { status: 401 });
    if (alg !== (this.o.tokenHash || 'sha256')) p.tokenHash = this.hashToken(token); /* credential migration: re-hash with the current algorithm on successful use */
    p.lastSeen = this.now(); if (p.state === 'offline') p.state = 'active'; return p;
  }
  updateCapabilities(p, capabilities = {}) { const c = sanitizeCaps({ ...p.caps, ...capabilities, agent: p.caps.agent }); p.caps = { ...c, specialized: c.specialized.filter(x => p.caps.specialized.includes(x) || p.type !== 'browser') }; p.verified = p.verified.filter(v => v === 'storage' ? c.storageMB > 0 : c.specialized.includes(v)); return { caps: p.caps, verified: p.verified }; }
  heartbeat(p, { paused = false } = {}) { p.state = paused ? 'paused' : 'active'; return { ok: true, state: p.state, heartbeatMs: this.heartbeatMs(), verified: p.verified }; }
  leave(p) { for (const [lid, l] of this.leases) if (l.peerId === p.id) this.release(lid, 'peer left'); p.state = 'left'; return { ok: true }; }
  cancel(p, leaseId) { const l = this.leases.get(String(leaseId)); if (!l || l.peerId !== p.id) return { ok: false }; this.release(leaseId, 'cancelled by the peer'); this.S.metrics.cancelled++; return { ok: true }; }
  revoke(peerId, reason = 'revoked by owner') { const p = this.S.peers[peerId]; if (!p) return null; this.leave(p); p.state = 'revoked'; p.revokedReason = reason; for (const h of Object.keys(this.S.replicas)) this.S.replicas[h] = this.S.replicas[h].filter(r => r.peer !== peerId); return p; }
  heartbeatMs() { return Math.min(600000, Math.max(30000, this.countActive * 20)); }
  idleRetryMs() { return Math.min(600000, Math.max(15000, this.countActive * 50)); }
  get countActive() { const t = this.now(), off = this.o.offlineMs; let n = 0; for (const p of Object.values(this.S.peers)) if (p.state === 'active' && t - p.lastSeen < off) n++; return n; }
  activePeers() { const t = this.now(), off = Math.max(this.o.offlineMs, 3 * Math.min(600000, Math.max(30000, Object.keys(this.S.peers).length * 20))); return Object.values(this.S.peers).filter(p => p.state === 'active' && t - p.lastSeen < off); }
  prune() { const t = this.now(); for (const [id, p] of Object.entries(this.S.peers)) { if (p.state === 'active' && t - p.lastSeen > this.o.offlineMs) p.state = 'offline'; if (['offline', 'left'].includes(p.state) && t - p.lastSeen > 24 * 3600000) delete this.S.peers[id]; } }
  // ---------- task creation (security check: public data only) ----------
  newTask(kind, atomIds, extra = {}) {
    const heads = kind === 'procedure-test/1' ? atomIds.map(id => sha(JSON.stringify(this.procedureSource().find(x => x.id === id) || null)).slice(0, 16)) : ['restore/1', 'storage-proof/1'].includes(kind) ? [...atomIds] /* these kinds are addressed by revision hash already */ : kind === 'claim-consistency/1' ? atomIds.map(id => sha(JSON.stringify(this.claimsSource().find(c => c.id === id) || null)).slice(0, 16)) : atomIds.map(id => this.registry.manifest(id)?.head || null);
    const id = 'task_' + sha(JSON.stringify([kind, atomIds, heads, extra.salt || ''])).slice(0, 24);
    if (this.S.tasks[id]) return null;
    this.S.tasks[id] = { id, kind, atomIds, heads, state: 'queued', createdAt: this.now(), attempts: 0, results: {}, replicasNeeded: 1, requires: TASK_SPECS[kind].needs, classification: { sensitivity: 'public', deterministic: true, units: atomIds.length, estimatedBytes: atomIds.length * (kind === 'claim-consistency/1' ? 600 : 1500), verification: TASK_SPECS[kind].verify, priority: kind === 'restore/1' ? 9 : kind === 'storage-proof/1' ? 6 : kind === 'replicate/1' ? 5 : TASK_SPECS[kind].needs ? 4 : 3, retry: this.o.maxAttempts }, ...extra };
    this.S.queue.push(id); this.S.metrics.created++; return this.S.tasks[id];
  }
  nextKind() { const mix = Object.entries(this.o.mix).flatMap(([k, n]) => Array(n).fill(k)); const k = mix[this.S.kindTurn % mix.length]; this.S.kindTurn++; return k; }
  fill() {
    const t0 = cpuNow(), open = () => this.S.queue.filter(id => this.S.tasks[id] && !['accepted', 'fallback-core'].includes(this.S.tasks[id].state)).length;
    let made = 0, guard = 0; const ids = [...this.registry.manifests.keys()];
    while (open() < this.o.maxQueue && guard++ < 200) {
      const kind = this.nextKind();
      if (kind === 'claim-consistency/1') { const claims = this.claimsSource(); if (!claims.length) continue; if (this.S.claimCursor >= claims.length) this.S.claimCursor = 0; const sl = claims.slice(this.S.claimCursor, this.S.claimCursor + 60).map(c => c.id); this.S.claimCursor += sl.length; if (this.newTask(kind, sl)) made++; continue; }
      if (!ids.length) break; if (this.S.cursor >= ids.length) { this.S.cursor = 0; if (made === 0 && guard > Object.keys(this.o.mix).length * 3) break; }
      const slice = ids.slice(this.S.cursor, this.S.cursor + this.o.batch); this.S.cursor += slice.length;
      const pub = slice.filter(id => this.isPublic(id)); if (pub.length && this.newTask(kind, pub)) made++;
      if (this.S.cursor >= ids.length && made === 0 && guard > 20) break;
    }
    // specialised work only exists when a peer has proven it can do it
    if (this.activePeers().some(p => p.verified.includes('symbolic-reasoning'))) { const withIsa = ids.filter(id => this.isPublic(id) && (this.registry.get(id)?.relational || []).some(e => e.type === 'IS_A')); for (let i = 0; i < 2 && withIsa.length; i++) { const start = Math.floor(this.random() * withIsa.length); if (this.newTask('isa-closure/1', withIsa.slice(start, start + 40))) made++; } }
    // cognitive candidates: public, declarative procedures whose test cases peers re-run (distributed regression)
    const procs = this.procedureSource(); for (let i = 0; i < procs.length; i += 10) if (this.newTask('procedure-test/1', procs.slice(i, i + 10).map(x => x.id))) made++;
    this.planStorage(); this.S.metrics.schedulerCpuUs += cpuNow() - t0; return made;
  }
  // replicated public knowledge on dedicated volunteer nodes: keep replicaTarget proven copies of public revisions
  planStorage() {
    const holders = this.activePeers().filter(p => p.type !== 'browser' && p.caps.storageMB > 0); if (!holders.length) return;
    const need = [...this.registry.manifests.values()].filter(m => this.isPublic(m.id) && (this.S.replicas[m.head] || []).filter(r => this.S.peers[r.peer]?.state === 'active').length < this.o.replicaTarget /* only reachable holders count: a peer that left or was revoked triggers re-replication elsewhere */).slice(0, 300).map(m => m.id);
    for (let i = 0; i < need.length; i += 150) { const slice = need.slice(i, i + 150), holders = slice.map(id => (this.S.replicas[this.registry.manifest(id)?.head] || []).map(r => r.peer + ':' + (this.S.peers[r.peer]?.state || 'gone')).sort().join(',')); this.newTask('replicate/1', slice, { salt: sha(JSON.stringify(holders)).slice(0, 12) }); } /* identity includes the holders and their states: same situation → same task (deduplicated); a holder leaving → new work */
    for (const p of holders) { const mine = Object.entries(this.S.replicas).filter(([, rs]) => rs.some(r => r.peer === p.id)).map(([h]) => h); if (mine.length && !Object.values(this.S.tasks).some(t => t.kind === 'storage-proof/1' && t.only === p.id && t.state !== 'accepted')) { const pick = Array.from({ length: Math.min(8, mine.length) }, () => mine[Math.floor(this.random() * mine.length)]); this.newTask('storage-proof/1', [...new Set(pick)], { only: p.id, salt: randomBytes(4).toString('hex'), nonces: Object.fromEntries([...new Set(pick)].map(h => [h, randomBytes(8).toString('hex')])) }); } }
  }
  // Recovery path: the core asks a storage peer for revisions it lost; only content matching the known hash is accepted.
  requestRestore(heads) { const holders = new Set(heads.flatMap(h => (this.S.replicas[h] || []).filter(r => r.proven).map(r => r.peer))); if (!holders.size) return null; return this.newTask('restore/1', heads.slice(0, 200), { salt: randomBytes(4).toString('hex'), holders: [...holders] }); }
  payloadFor(task) {
    const kind = task.kind || 'atom-validate/1';
    if (kind === 'procedure-test/1') { const want = new Set(task.atomIds); return { procedures: this.procedureSource().filter(x => want.has(x.id)) }; }
    if (kind === 'claim-consistency/1') { const want = new Set(task.atomIds); return { claims: this.claimsSource().filter(c => want.has(c.id)), now: this.now() }; }
    if (kind === 'storage-proof/1') return { challenges: task.atomIds.map(h => ({ head: h, nonce: task.nonces[h] })) };
    if (kind === 'restore/1') return { heads: task.atomIds };
    const atoms = [], targets = {}, isa = {}, canonical = {};
    const isaOf = id => { if (isa[id]) return; const d = this.registry.get(id); if (d) isa[id] = (d.relational || []).filter(e => e.type === 'IS_A').map(e => e.target); };
    for (const id of task.atomIds) { const m = this.registry.manifest(id); if (!m) continue; const dna = this.registry.revisions.get(m.head); atoms.push({ id, head: m.head, dna });
      for (const e of dna?.relational || []) { const t = this.registry.get(e.target); if (t) { targets[e.target] = t.identity.type; if (e.type === 'FORM_OF') canonical[e.target] = t.identity.canonical; } }
      for (const s of dna?.semantic?.senses || []) { const t = this.registry.get(s); if (t) targets[s] = t.identity.type; } }
    if (kind === 'atom-validate/1' || kind === 'replicate/1') return { atoms, rules: this.rules, targets };
    if (kind === 'lexical-consistency/1') return { atoms, canonical, irregular: this.rules.irregular };
    // IS_A neighbourhood up to 6 levels for cycle checks, metrics and closure
    let frontier = atoms.map(a => a.id); for (let d = 0; d < 6 && frontier.length; d++) { const next = []; for (const id of frontier) { isaOf(id); for (const t of isa[id] || []) if (!isa[t]) next.push(t); } frontier = next.slice(0, 2000); }
    if (kind === 'isa-closure/1') { const queries = []; for (const a of atoms) { const up = isa[a.id] || []; if (!up.length) continue; const anc = (isa[up[0]] || [])[0] || up[0]; queries.push([a.id, anc]); const other = atoms[(atoms.indexOf(a) + 7) % atoms.length]?.id; if (other && other !== a.id) queries.push([a.id, other]); } return { isa, queries }; }
    return { atoms, rules: this.rules, targets, isa };
  }
  eligible(task, p) {
    if (task.only && task.only !== p.id) return false;
    if (task.kind === 'restore/1') return (task.holders || []).includes(p.id);
    if (task.requires === 'storage') return p.type !== 'browser' && p.caps.storageMB > 0;
    if (task.requires === 'symbolic-reasoning') return p.verified.includes('symbolic-reasoning');
    return task.atomIds.length <= p.limits.batch * 2;
  }
  // ---------- leasing with capability matching, probes, backpressure, replica placement and P2P pairing ----------
  lease(p) {
    const t0 = cpuNow(), t = this.now(); let issuedKind = null;
    try {
      this.expire();
      if (p.state !== 'active') return { task: null, reason: 'peer is ' + p.state };
      const mine = [...this.leases.values()].filter(l => l.peerId === p.id).length;
      if (mine >= p.limits.concurrency) return { task: null, retryAfterMs: 2000, reason: 'concurrency limit' };
      if (t - p.lastLease < p.limits.minIntervalMs) return { task: null, retryAfterMs: p.limits.minIntervalMs - (t - p.lastLease), reason: 'profile interval' };
      p.tasksHour = p.tasksHour.filter(x => t - x < 3600000); if (p.tasksHour.length >= p.limits.maxTasksPerHour) return { task: null, retryAfterMs: 60000, reason: 'hourly limit for this profile' };
      const probe = this.probeFor(p); if (probe) return this.issue(p, probe, t);
      const worth = this.offloadWorthwhile(); /* the cost gate covers compute only: replication, proofs and restore cannot be done by the core itself */
      if (this.S.queue.length < 5) this.fill();
      if (p.type !== 'browser' && p.caps.storageMB > 0 && t - (this.S.lastStoragePlan || 0) > 3000) { this.S.lastStoragePlan = t; this.planStorage(); } /* storage work is planned when a storage peer asks, not only when the atom queue runs dry */
      // v1.9 routing policy (evolvable): a weighted score of priority, waiting time, locality (a replica whose data a
      // paired peer can serve), peer reliability and payload cost; the default weights reproduce priority order
      const route = this.o.routing ? this.o.routing(p.id) : null, rp = route?.value || null;
      const score = task => rp ? rp.priorityWeight * (task.classification?.priority || 0) + rp.ageWeight * Math.log1p(Math.max(0, (t - task.createdAt) / 1000)) + rp.localityWeight * (task.state === 'awaiting-replica' && this.o.p2p ? 1 : 0) + rp.reliabilityWeight * p.reputation - rp.costWeight * ((task.classification?.estimatedBytes || 0) / 102400) : (task.classification?.priority || 0);
      const queue = this.S.queue.map(id => this.S.tasks[id]).filter(Boolean).sort((a, b) => score(b) - score(a));
      if (route) p.routeArm = route.arm;
      // shadow evaluation: on baseline decisions, also compute what the candidate policy WOULD pick (not used), so a
      // routing change is compared on real leases before it decides anything
      const shadow = route?.arm === 'baseline' && this.o.routingShadow ? this.o.routingShadow() : null;
      if (shadow) { const sc = task => shadow.priorityWeight * (task.classification?.priority || 0) + shadow.ageWeight * Math.log1p(Math.max(0, (t - task.createdAt) / 1000)) + shadow.localityWeight * (task.state === 'awaiting-replica' && this.o.p2p ? 1 : 0) + shadow.reliabilityWeight * p.reputation - shadow.costWeight * ((task.classification?.estimatedBytes || 0) / 102400);
        const open = queue.filter(task => ['queued', 'awaiting-replica'].includes(task.state) && this.eligible(task, p)); if (open.length) { const a = open[0], b = [...open].sort((x, y) => sc(y) - sc(x))[0], m = (this.S.metrics.shadowRouting ||= { decisions: 0, agree: 0, candidateBytes: 0, baselineBytes: 0, candidateWaitS: 0, baselineWaitS: 0 });
          m.decisions++; if (a.id === b.id) m.agree++; m.baselineBytes += a.classification?.estimatedBytes || 0; m.candidateBytes += b.classification?.estimatedBytes || 0; m.baselineWaitS += (t - a.createdAt) / 1000; m.candidateWaitS += (t - b.createdAt) / 1000; } }
      const sameNet = pid => this.o.distinctNetworks && this.S.peers[pid]?.ipKey === p.ipKey; // replicas must come from different networks (Sybil resistance); a LAN/test deployment may relax this
      const pick = queue.find(task => (task.requires === 'storage' || (worth && this.worthKind(task.kind))) && ['queued', 'awaiting-replica'].includes(task.state) && this.eligible(task, p) && !task.results[p.id] && ![...this.leases.values()].some(l => l.taskId === task.id && (l.peerId === p.id || sameNet(l.peerId))) && !Object.keys(task.results).some(sameNet));
      if (!pick && !worth) return { task: null, retryAfterMs: 60000, reason: 'core is currently cheaper than delegating (measured)' };
      if (!pick) return { task: null, retryAfterMs: this.idleRetryMs(), heartbeatMs: this.heartbeatMs(), reason: 'no eligible work right now' };
      if (ATOM_KINDS.includes(pick.kind) && pick.atomIds.some((id, i) => this.registry.manifest(id)?.head !== pick.heads[i])) { pick.heads = pick.atomIds.map(id => this.registry.manifest(id)?.head || null); pick.results = {}; }
      const isNew = p.done < this.o.newPeerTasks || p.reputation < 0.5, spec = TASK_SPECS[pick.kind];
      if (pick.state === 'queued' && spec.verify.includes('replica') && (isNew || this.random() < this.o.replicate) && this.activePeers().some(x => x.id !== p.id && (!this.o.distinctNetworks || x.ipKey !== p.ipKey) && this.eligible(pick, x))) pick.replicasNeeded = 2;
      issuedKind = pick.kind; return this.issue(p, pick, t);
    } finally { const us = cpuNow() - t0; this.S.metrics.schedulerCpuUs += us; if (issuedKind) this.kindCost(issuedKind).overheadUs += us; }
  }
  issue(p, task, t) {
    const leaseId = 'l_' + randomBytes(12).toString('hex'), payload = this.payloadFor(task), deadline = t + p.limits.leaseMs;
    this.leases.set(leaseId, { taskId: task.id, peerId: p.id, expiresAt: deadline, issuedAt: t });
    task.state = 'leased'; task.attempts++; p.lastLease = t; p.leases++; p.tasksHour.push(t); this.S.metrics.leased++;
    let p2p = null;
    // P2P: a replica of an atom task whose first result came from a browser that still caches those atoms → send
    // references only; the requester fetches the DNA over a WebRTC DataChannel and verifies every content hash.
    if (this.o.p2p && p.caps.webrtc && p.type === 'browser' && ['atom-validate/1', 'relation-check/1', 'lexical-consistency/1', 'graph-metrics/1'].includes(task.kind) && payload.atoms) {
      const source = Object.keys(task.results).map(pid => this.S.peers[pid]).find(x => x && x.id !== p.id && x.state === 'active' && x.caps.webrtc && x.type === 'browser' && x.cache.includes(task.id));
      if (source) { const pairId = 'pair_' + randomBytes(9).toString('hex'), full = JSON.stringify(payload.atoms).length; this.pairs.set(pairId, { pairId, a: p.id, b: source.id, taskId: task.id, leaseId, expires: t + 60000 }); payload.atoms = payload.atoms.map(({ id, head }) => ({ id, head })); payload.dnaVia = 'p2p'; p2p = { pairId, source: source.id, initiator: true }; this.deliver(source.id, { pairId, from: p.id, type: 'pair', taskId: task.id, heads: payload.atoms.map(a => a.head) }); this.S.metrics.p2pPairs++; this.S.metrics.p2pBytesAvoided += full; this.leases.get(leaseId).p2pBytes = full; }
    }
    const bytes = JSON.stringify(payload).length; p.bytesOut += bytes; this.S.metrics.bytesOut += bytes;
    return { task: { leaseId, taskId: task.id, kind: task.kind, deadline, budgetMs: Math.min(p.limits.leaseMs - 5000, 60000), payload, probe: !!task.probe, p2p } };
  }
  // full payload on request (P2P fallback): never refused, counted so the benefit is measured honestly
  fullPayload(p, leaseId) { const l = this.leases.get(String(leaseId)); if (!l || l.peerId !== p.id) return null; const task = this.S.tasks[l.taskId], payload = this.payloadFor(task), bytes = JSON.stringify(payload).length; this.S.metrics.p2pFallbacks++; this.S.metrics.p2pFallbackBytes += bytes; this.S.metrics.bytesOut += bytes; p.bytesOut += bytes; if (l.p2pBytes) { this.S.metrics.p2pBytesAvoided -= l.p2pBytes; l.p2pBytes = 0; } return payload; }
  // signalling relay for paired peers only (offer / answer / ICE candidates); bounded mailboxes, 60 s TTL
  deliver(to, msg) { const box = this.mail.get(to) || []; box.push({ ...msg, at: this.now() }); this.mail.set(to, box.filter(m => this.now() - m.at < 60000).slice(-50)); }
  signal(p, { pairId, data } = {}) { const pr = this.pairs.get(String(pairId)); if (!pr || pr.expires < this.now() || ![pr.a, pr.b].includes(p.id)) return { ok: false, reason: 'unknown or expired pairing' }; if (JSON.stringify(data || {}).length > 16000) return { ok: false, reason: 'signal too large' }; this.deliver(p.id === pr.a ? pr.b : pr.a, { pairId, from: p.id, type: 'signal', data }); return { ok: true }; }
  poll(p) { const box = (this.mail.get(p.id) || []).filter(m => this.now() - m.at < 60000); this.mail.delete(p.id); for (const [k, pr] of this.pairs) if (pr.expires < this.now()) this.pairs.delete(k); return { messages: box }; }
  // ---------- capability probes (Type D): a task whose answer the core already knows ----------
  probeFor(p) {
    for (const cap of p.caps.specialized) {
      if (p.verified.includes(cap) || (p.probes[cap]?.state === 'failed' && this.now() - p.probes[cap].at < 3600000) || [...this.leases.values()].some(l => l.peerId === p.id && this.S.tasks[l.taskId]?.probe)) continue;
      if (cap === 'symbolic-reasoning') { const ids = [...this.registry.manifests.keys()].filter(id => this.isPublic(id) && (this.registry.get(id)?.relational || []).some(e => e.type === 'IS_A')); if (!ids.length) continue; const s = Math.floor(this.random() * Math.max(1, ids.length - 30)); const task = this.newTask('isa-closure/1', ids.slice(s, s + 30), { probe: cap, only: p.id, salt: randomBytes(4).toString('hex') }); if (task) { p.probes[cap] = { state: 'issued', at: this.now(), task: task.id }; return task; } }
    }
    return null;
  }
  release(leaseId, why) { const l = this.leases.get(leaseId); if (!l) return; this.leases.delete(leaseId); const task = this.S.tasks[l.taskId]; if (task && task.state === 'leased' && ![...this.leases.values()].some(x => x.taskId === task.id)) { task.state = Object.keys(task.results).length ? 'awaiting-replica' : 'queued'; this.S.metrics.reassigned++; task.lastRelease = why; } }
  expire() {
    const t = this.now();
    for (const [lid, l] of this.leases) if (l.expiresAt < t) { this.leases.delete(lid); this.S.metrics.expired++; const task = this.S.tasks[l.taskId], p = this.S.peers[l.peerId]; if (p) p.reputation = Math.max(0, p.reputation - 0.02);
      if (task && task.state !== 'accepted') { task.state = task.attempts >= this.o.maxAttempts ? (ATOM_KINDS.includes(task.kind) || task.kind === 'claim-consistency/1' ? 'fallback-core' : 'accepted') : Object.keys(task.results).length ? 'awaiting-replica' : 'queued'; this.S.metrics.reassigned++; } }
  }
  // ---------- result submission and verification ----------
  async submit(p, { leaseId, taskId, result } = {}) {
    const t0 = cpuNow();
    try {
      const prior = Object.values(this.S.tasks).find(x => x.results?.[p.id]?.leaseId === leaseId); if (prior) return { status: prior.results[p.id].outcome || 'recorded', duplicate: true };
      const l = this.leases.get(String(leaseId)); if (!l || l.peerId !== p.id || l.taskId !== taskId) return { status: 'rejected', reason: 'unknown, expired or foreign lease' };
      this.leases.delete(leaseId); const task = this.S.tasks[taskId], spec = TASK_SPECS[task.kind];
      const bytes = JSON.stringify(result || {}).length; p.bytesIn += bytes; this.S.metrics.bytesIn += bytes;
      const latency = this.now() - l.issuedAt; this.S.metrics.latenciesMs.push(latency); if (this.S.metrics.latenciesMs.length > 2000) this.S.metrics.latenciesMs.splice(0, 1000);
      if (spec.verify === 'hash' || spec.verify === 'expected') return await this.verifyStorage(p, task, l, result);
      if (!validShape(result, task)) return this.reject(p, task, 'malformed result');
      task.results[p.id] = { leaseId, digest: result.digest, issues: (result.issues || []).slice(0, 500), checked: result.checked, metrics: result.metrics || null, answers: result.answers || null, results: task.kind === 'procedure-test/1' && Array.isArray(result.results) ? result.results.slice(0, 50) : undefined, at: this.now() }; p.done++; p.atoms += task.atomIds.length;
      if (ATOM_KINDS.includes(task.kind)) { p.cache.push(task.id); if (p.cache.length > 50) p.cache.shift(); }
      if (task.probe) { const core = await this.coreRun(task, task.atomIds); const ok = core.digest === result.digest; p.probes[task.probe] = { state: ok ? 'passed' : 'failed', at: this.now() }; if (ok) { p.verified.push(task.probe); this.S.metrics.probesPassed++; return this.accept(task, [p.id], `capability ${task.probe} verified by probe`); } this.S.metrics.probesFailed++; this.penalize(p, task, `probe for ${task.probe} failed`); return this.acceptCore(task, core, `capability ${task.probe} not verified`); }
      // 1 · every reported issue is re-checked on the core (only the flagged items: cheap)
      if (spec.verify.startsWith('flags')) { const flagged = [...new Set(result.issues.map(i => i.id))].filter(id => task.atomIds.includes(id));
        if (flagged.length) { const core = await this.coreRun(task, task.kind === 'relation-check/1' ? task.atomIds : flagged); /* relation checks depend on the whole shard (reverse edges), so they are re-run in full */ const want = byAtom(core.issues), got = byAtom(result.issues); for (const id of flagged) if (key(want[id]) !== key(got[id])) return this.reject(p, task, `reported issue on ${id} not confirmed by the core`); } }
      // 2 · the rest needs an independent replica or a spot-check
      const digests = Object.entries(task.results).filter(([, r]) => r.digest);
      if (task.replicasNeeded > 1 && digests.length < task.replicasNeeded) { task.state = 'awaiting-replica'; task.results[p.id].outcome = 'awaiting-replica'; this.S.metrics.replicated++; return { status: 'awaiting-replica' }; }
      if (digests.length >= 2) {
        if (new Set(digests.map(([, r]) => r.digest)).size === 1) {
          // v1.10: agreement only counts as evidence between ESTABLISHED peers — two new or low-reputation peers that
          // return the same result may be colluding (or one Sybil), so the core checks before accepting
          const untrusted = digests.some(([pid]) => { const q = this.S.peers[pid]; return !q || q.done <= this.o.newPeerTasks * 2 || q.reputation < 0.6; });
          if (untrusted) { const core = await this.coreRun(task, task.atomIds); this.S.metrics.spotChecks++; if (core.digest !== digests[0][1].digest) { for (const [pid] of digests) this.penalize(this.S.peers[pid], task, 'agreeing replicas from untrusted peers were wrong'); return this.acceptCore(task, core, 'agreeing replicas from untrusted peers were wrong; core result used'); } }
          return this.accept(task, digests.map(([pid]) => pid), untrusted ? 'replicas agree and the core confirmed them (peers not yet established)' : 'independent replicas agree');
        }
        this.S.metrics.arbitrations++; const core = await this.coreRun(task, task.atomIds);
        const good = digests.filter(([, r]) => r.digest === core.digest).map(([pid]) => pid), bad = digests.filter(([, r]) => r.digest !== core.digest).map(([pid]) => pid);
        for (const pid of bad) this.penalize(this.S.peers[pid], task, 'result disagreed with core arbitration');
        return good.length ? this.accept(task, good, 'core arbitration between disagreeing replicas', core) : this.acceptCore(task, core, 'all replicas wrong; core result used');
      }
      if (this.random() < this.o.spotCheck) { this.S.metrics.spotChecks++; const core = await this.coreRun(task, task.atomIds); if (core.digest !== result.digest) { this.penalize(p, task, 'spot-check mismatch'); return this.acceptCore(task, core, 'spot-check caught a wrong result'); } }
      return this.accept(task, [p.id], 'flagged issues confirmed; single result accepted after sampling');
    } finally { const us = cpuNow() - t0; this.S.metrics.verifyCpuUs += us; const kind = this.S.tasks[taskId]?.kind; if (kind) this.kindCost(kind).overheadUs += us; }
  }
  async verifyStorage(p, task, l, result) {
    if (task.kind === 'replicate/1') {
      const stored = Array.isArray(result?.stored) ? result.stored : [], want = new Set(task.heads), ok = stored.length && stored.every(h => want.has(h));
      if (!ok) return this.reject(p, task, 'replica report does not match the issued revisions');
      for (const h of stored) { const rs = this.S.replicas[h] ||= []; if (!rs.some(r => r.peer === p.id)) rs.push({ peer: p.id, at: this.now(), proven: false }); }
      this.S.metrics.replicasStored += stored.length; p.done++; return this.finishStorage(task, p, `stored ${stored.length} revisions (unproven until a storage proof)`);
    }
    if (task.kind === 'storage-proof/1') {
      const proofs = result?.proofs || {}; let good = 0, bad = 0;
      for (const h of task.atomIds) { const dna = this.registry.revisions.get(h); if (!dna) continue; const expect = await storageProof(dna, task.nonces[h]); const r = (this.S.replicas[h] || []).find(x => x.peer === p.id); if (proofs[h] === expect) { good++; if (r) { r.proven = true; r.provenAt = this.now(); } } else { bad++; if (r) r.proven = false; } }
      if (bad) { this.S.metrics.proofsFailed++; for (const h of task.atomIds) this.S.replicas[h] = (this.S.replicas[h] || []).filter(r => r.peer !== p.id || r.proven); this.penalize(p, task, `${bad} storage proof(s) wrong`); task.state = 'accepted'; return { status: 'rejected', reason: 'storage proof failed' }; }
      this.S.metrics.proofsPassed++; if (!p.verified.includes('storage')) p.verified.push('storage'); p.done++; return this.finishStorage(task, p, `${good} storage proofs correct`);
    }
    if (task.kind === 'restore/1') {
      const atoms = Array.isArray(result?.atoms) ? result.atoms.slice(0, 200) : [], restored = [];
      for (const a of atoms) { if (!task.heads.includes(a.head) || !a.dna) continue; const h = await sha256hex(encodeCanonical(a.dna)); if (h !== a.head) { this.penalize(p, task, 'restored content does not match its hash'); continue; } if (this.onRestore && this.onRestore(a.head, a.dna)) restored.push(a.head); }
      this.S.metrics.restored += restored.length; p.done++; return this.finishStorage(task, p, `restored ${restored.length} revisions after hash verification`, { restored });
    }
    return this.reject(p, task, 'unknown storage task');
  }
  finishStorage(task, p, why, extra = {}) { task.state = 'accepted'; task.acceptedAt = this.now(); task.acceptedBy = [p.id]; task.why = why; p.accepted++; p.reputation = Math.min(1, p.reputation + 0.03); this.S.metrics.accepted++; return { status: 'accepted', why, ...extra }; }
  accept(task, peerIds, why, core = null) {
    task.state = 'accepted'; task.acceptedAt = this.now(); task.acceptedBy = peerIds; task.why = why;
    const r0 = task.results[peerIds[0]] || {}, out = core || r0; this.record(task, out.issues || []);
    if (task.kind === 'graph-metrics/1') this.S.graph[task.id] = { at: this.now(), metrics: core?.metrics || r0.metrics };
    if (task.kind === 'procedure-test/1' && this.onProcedureResults) { try { this.onProcedureResults((r0.results?.length ? r0 : core || r0).results || [], { task: task.id, by: peerIds, why }); /* the core re-check may cover only flagged items */ } catch {} }
    if (task.kind === 'isa-closure/1' && !task.probe) this.S.graph['closure:' + task.id] = { at: this.now(), answers: (core?.answers || r0.answers || []).slice(0, 100) };
    const gk = Object.keys(this.S.graph); if (gk.length > 200) for (const k of gk.slice(0, gk.length - 200)) delete this.S.graph[k];
    for (const pid of peerIds) { const p0 = this.S.peers[pid]; if (p0?.routeArm && this.o.onRouteOutcome) this.o.onRouteOutcome(p0.routeArm, true); }
    for (const pid of peerIds) { const p = this.S.peers[pid]; if (p) { p.accepted++; p.reputation = Math.min(1, p.reputation + 0.05); if (task.results[pid]) task.results[pid].outcome = 'accepted'; } }
    this.S.metrics.accepted++; this.S.metrics.peerAtoms += task.atomIds.length; this.kindCost(task.kind).peerAtoms += task.atomIds.length; return { status: 'accepted', why };
  }
  acceptCore(task, core, why) { task.state = 'accepted'; task.acceptedAt = this.now(); task.acceptedBy = ['core']; task.why = why; this.record(task, core.issues || []); this.S.metrics.accepted++; return { status: 'rejected', reason: why }; }
  reject(p, task, why) { this.penalize(p, task, why); if (task && task.state !== 'accepted') task.state = task.attempts >= this.o.maxAttempts ? (ATOM_KINDS.includes(task.kind) || task.kind === 'claim-consistency/1' ? 'fallback-core' : 'accepted') : 'queued'; if (task?.results?.[p.id]) { task.results[p.id].outcome = 'rejected'; task.results[p.id].digest = null; } return { status: 'rejected', reason: why }; }
  penalize(p, task, why) { if (!p) return; if (p.routeArm && this.o.onRouteOutcome) this.o.onRouteOutcome(p.routeArm, false); p.rejected++; p.reputation = Math.max(0, p.reputation - 0.25); p.lastRejection = why; this.S.metrics.rejected++; if (p.rejected >= 5 && p.rejected > p.accepted) { p.state = 'revoked'; p.revokedReason = 'too many rejected results'; } }
  record(task, issues) { if (!['atom-validate/1', 'relation-check/1', 'lexical-consistency/1', 'claim-consistency/1'].includes(task.kind)) return; for (const id of task.atomIds) this.S.findings[id] = (this.S.findings[id] || []).filter(f => f.taskKind !== task.kind); for (const i of issues) (this.S.findings[i.id] ||= []).push({ kind: i.kind, detail: i.detail, task: task.id, taskKind: task.kind }); for (const id of task.atomIds) if (!this.S.findings[id]?.length) delete this.S.findings[id]; const keys = Object.keys(this.S.findings); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete this.S.findings[k]; }
  // ---------- the core's own execution (verification, fallback, no-peer mode) ----------
  async coreRun(task, ids) { const t0 = cpuNow(), sub = { ...task, atomIds: ids }, out = await runTask(task.kind, this.payloadFor(sub)); const us = cpuNow() - t0; this.S.metrics.coreTaskCpuUs += us; this.S.metrics.coreTaskAtoms += ids.length; const k = this.kindCost(task.kind); k.coreUs += us; k.coreAtoms += ids.length; return out; }
  kindCost(kind) { return ((this.S.metrics.kindCost ||= {})[kind] ||= { coreUs: 0, coreAtoms: 0, overheadUs: 0, peerAtoms: 0 }); }
  // per kind: delegate only while the measured core overhead per delegated atom stays below the core's own cost for that kind
  worthKind(kind) { if (TASK_SPECS[kind]?.needs === 'storage') return true; const k = this.kindCost(kind); if (k.peerAtoms < 500 || k.coreAtoms < 50) return true; return k.overheadUs / k.peerAtoms < 0.9 * k.coreUs / k.coreAtoms; }
  async coreTick({ budgetMs = 2000 } = {}) {
    const t0 = this.now(), out = { ran: 0 }; this.expire();
    const noPeers = !this.activePeers().length;
    for (const id of this.S.queue) { const task = this.S.tasks[id]; if (!task) continue; if (this.now() - t0 > budgetMs) break;
      const coreCan = ATOM_KINDS.includes(task.kind) || task.kind === 'claim-consistency/1' || task.kind === 'procedure-test/1' || (task.kind === 'isa-closure/1' && !task.probe);
      const cheaper = coreCan && ['queued', 'awaiting-replica'].includes(task.state) && !this.worthKind(task.kind); /* a half-replicated task of a kind no longer delegated is finished by the core */
      if (coreCan && (task.state === 'fallback-core' || (noPeers && task.state === 'queued') || cheaper)) { const core = await this.coreRun(task, task.atomIds); this.accept(task, [], noPeers ? 'no peers: core executed it' : cheaper ? 'core is cheaper for this kind (measured): core executed it' : 'fallback after repeated failures', core); task.acceptedBy = ['core']; this.S.metrics.peerAtoms -= task.atomIds.length; this.kindCost(task.kind).peerAtoms -= task.atomIds.length; this.S.metrics.coreFallback++; this.S.metrics.coreAtoms += task.atomIds.length; out.ran++; }
      else if (!coreCan && noPeers && task.state === 'queued') { task.state = 'accepted'; task.why = 'dropped: no storage or specialised peer online'; } }
    this.S.queue = this.S.queue.filter(id => this.S.tasks[id] && this.S.tasks[id].state !== 'accepted'); const done = Object.keys(this.S.tasks).filter(id => this.S.tasks[id].state === 'accepted'); if (done.length > 2000) for (const id of done.slice(0, done.length - 2000)) delete this.S.tasks[id];
    return out;
  }
  offloadWorthwhile() {
    const m = this.S.metrics, kinds = new Set([...Object.keys(m.kindCost || {}), ...this.S.queue.map(id => this.S.tasks[id]?.kind).filter(Boolean)]); /* queued kinds without a record yet get measured */
    if (m.kindCost && [...kinds].some(k => TASK_SPECS[k]?.needs !== 'storage' && this.worthKind(k))) return true; if (m.peerAtoms < 500 || m.coreTaskAtoms < 50) return true;
    const corePerAtom = m.coreTaskCpuUs / m.coreTaskAtoms, overheadPerAtom = (m.schedulerCpuUs + m.verifyCpuUs) / Math.max(1, m.peerAtoms);
    return overheadPerAtom < corePerAtom * 0.9;
  }
  storageStatus() { const heads = Object.keys(this.S.replicas), proven = heads.filter(h => this.S.replicas[h].some(r => r.proven)).length, atTarget = heads.filter(h => this.S.replicas[h].filter(r => r.proven).length >= this.o.replicaTarget).length; return { tiers: { canonical: `${this.registry.manifests.size} atoms on the core (durable store; authoritative)`, replicatedPublic: `${heads.length} public revisions held by dedicated peers · ${proven} with a passed storage proof · ${atTarget} at the target of ${this.o.replicaTarget}`, temporaryCache: 'browser peers keep processed public atoms in memory/IndexedDB only for P2P serving; never counted as durable', proposed: `${Object.values(this.S.tasks).filter(t => ['leased', 'awaiting-replica'].includes(t.state)).length} peer results awaiting verification`, private: 'never leaves the core (private atoms, conversations, accounts, private claims)' } }; }
  status() {
    const m = this.S.metrics, lat = [...m.latenciesMs].sort((a, b) => a - b), q = f => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * f))] : null, peers = Object.values(this.S.peers), by = {}, types = {};
    for (const p of peers) { by[p.state] = (by[p.state] || 0) + 1; types[p.type] = (types[p.type] || 0) + 1; }
    const corePerAtom = m.coreTaskAtoms ? m.coreTaskCpuUs / m.coreTaskAtoms : null, overheadPerAtom = m.peerAtoms ? (m.schedulerCpuUs + m.verifyCpuUs) / m.peerAtoms : null, kinds = {};
    for (const t of Object.values(this.S.tasks)) { const k = kinds[t.kind] ||= { queued: 0, leased: 0, accepted: 0 }; if (['queued', 'awaiting-replica'].includes(t.state)) k.queued++; else if (t.state === 'leased') k.leased++; else if (t.state === 'accepted') k.accepted++; }
    return { protocol: KUNPP, peers: { total: peers.length, active: this.activePeers().length, byState: by, byType: types, browser: types.browser || 0, dedicated: (types.dedicated || 0) + (types.specialized || 0), verifiedCapabilities: peers.reduce((a, p) => { for (const v of p.verified) a[v] = (a[v] || 0) + 1; return a; }, {}) },
      tasks: { queued: this.S.queue.filter(id => ['queued', 'awaiting-replica'].includes(this.S.tasks[id]?.state)).length, leased: this.leases.size, fallback: this.S.queue.filter(id => this.S.tasks[id]?.state === 'fallback-core').length, byKind: kinds },
      metrics: { ...m, latenciesMs: undefined, p50LatencyMs: q(0.5), p95LatencyMs: q(0.95) },
      offload: { corePerAtomUs: corePerAtom && +corePerAtom.toFixed(1), overheadPerDelegatedAtomUs: overheadPerAtom && +overheadPerAtom.toFixed(1), worthwhile: this.offloadWorthwhile(), byKind: Object.fromEntries(Object.entries(m.kindCost || {}).map(([k, v]) => [k, { corePerAtomUs: v.coreAtoms ? +(v.coreUs / v.coreAtoms).toFixed(1) : null, overheadPerDelegatedAtomUs: v.peerAtoms ? +(v.overheadUs / v.peerAtoms).toFixed(1) : null, delegated: this.worthKind(k) }])), savedCoreCpuMs: corePerAtom && overheadPerAtom ? Math.round(m.peerAtoms * (corePerAtom - overheadPerAtom) / 1000) : null },
      p2p: { pairs: m.p2pPairs, bytesAvoided: m.p2pBytesAvoided, fallbacks: m.p2pFallbacks, fallbackBytes: m.p2pFallbackBytes, netSavedBytes: m.p2pBytesAvoided },
      storage: this.storageStatus(), graph: Object.values(this.S.graph).slice(-3), powBits: this.powBits(), findings: Object.keys(this.S.findings).length };
  }
  peerView(p) { return { peerId: p.id, type: p.type, state: p.state, profile: p.profile, limits: p.limits, verified: p.verified, done: p.done, accepted: p.accepted, rejected: p.rejected, atoms: p.atoms, reputation: +p.reputation.toFixed(2), bytesOut: p.bytesOut, bytesIn: p.bytesIn }; }
}
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
const SPECIALIZED = ['symbolic-reasoning'];
function sanitizeCaps(c) {
  return { workers: c.workers === true, wasm: c.wasm === true, subtleCrypto: c.subtleCrypto === true, indexedDB: c.indexedDB === true, webrtc: c.webrtc === true, cores: clamp(c.cores, 1, 64, 1), memoryGB: c.memoryGB ? clamp(c.memoryGB, 0, 64, 0) : null, mobile: c.mobile === true, saveData: c.saveData === true, agent: c.agent === 'node' ? 'node' : 'browser',
    storageMB: c.agent === 'node' ? clamp(c.storageMB, 0, 1e6, 0) : 0, specialized: (Array.isArray(c.specialized) ? c.specialized : []).filter(x => SPECIALIZED.includes(x)).slice(0, 4), reported: true };
}
function validShape(r, task) {
  return !!r && typeof r === 'object' && r.kind === task?.kind && typeof r.digest === 'string' && /^[0-9a-f]{64}$/.test(r.digest) && Array.isArray(r.issues) && r.issues.length <= 500 && r.issues.every(i => i && typeof i.id === 'string' && typeof i.kind === 'string' && i.kind.length < 40) && Number.isInteger(r.checked) && (task.kind === 'isa-closure/1' ? true : r.checked === task.atomIds.length || r.checked <= task.atomIds.length);
}
const byAtom = issues => { const m = {}; for (const i of issues) (m[i.id] ||= new Set()).add(i.kind); return m; };
const key = s => [...(s || [])].sort().join(',');
