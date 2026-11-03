// Storage adapters. STORAGE ≠ INTELLIGENCE: the graph in state is the intelligence layer;
// stores only persist it. FileStore suits a single machine with a disk. SupabaseStore suits any
// host (including serverless Vercel/Netlify) and mirrors the graph into relational tables.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function uuidFrom(text) {
  const h = createHash('sha256').update(String(text)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Mapping onto the original KENUXA Internet v1.1 schema CHECK constraints.
const ENTITY_TYPE = { atom: 'Knowledge', 'meaning-atom': 'Knowledge', 'domain-atom': 'Concept', molecule: 'Custom', cell: 'Custom' };
const REL_TYPE = { 'shares-topic': 'CONNECTED_TO', contains: 'PART_OF', 'similar-meaning': 'SIMILAR_TO', requires: 'REQUIRES', uses: 'USES', enables: 'ENABLES', references: 'REFERENCES' };
const clamp01 = x => Math.max(0, Math.min(1, Number(x) || 0));
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);

export class FileStore {
  constructor(dir) { this.kind = 'file'; this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.statePath = path.join(dir, 'state.json'); }
  async init() { return this; }
  async load() { return fs.existsSync(this.statePath) ? JSON.parse(fs.readFileSync(this.statePath, 'utf8')) : null; }
  async save(state) { const tmp = this.statePath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, this.statePath); }
  backup(name, data) { fs.writeFileSync(path.join(this.dir, name), JSON.stringify(data, null, 2)); }
  get blobs() { return { read: async n => { const p = path.join(this.dir, n); return fs.existsSync(p) ? fs.readFileSync(p) : null; }, write: async (n, buf) => { const p = path.join(this.dir, n); fs.writeFileSync(p + '.tmp', buf); fs.renameSync(p + '.tmp', p); } }; }
  status() { return { kind: 'file', location: this.dir, mirror: 'not applicable' }; }
  async registerNode() { return null; }
  async listNodes() { return []; }
}

export class SupabaseStore {
  constructor({ url, key, nodeId, bucket = 'kenuxa', fetcher = fetch }) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || '') && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url || '')) throw new Error('SUPABASE_URL must look like https://<project-ref>.supabase.co');
    if (!key || key.length < 20) throw new Error('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is required for a server node');
    Object.assign(this, { kind: 'supabase', url, key, nodeId, bucket, fetcher }); this.mirrorState = { at: null, error: null, rows: 0 }; this.bucketReady = false;
  }
  headers(extra = {}) { return { apikey: this.key, ...(this.key.startsWith('eyJ') ? { Authorization: `Bearer ${this.key}` } : {}), ...extra }; }
  async rest(method, table, { query = '', body, prefer } = {}) {
    const r = await this.fetcher(`${this.url}/rest/v1/${table}${query ? '?' + query : ''}`, { method, headers: this.headers({ 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`Supabase ${table} ${method} failed (${r.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  async init() { await this.rest('GET', 'kenuxa_node_state', { query: 'select=node_id&limit=1' }); return this; } // fails fast if migration missing
  async load() {
    const rows = await this.rest('GET', 'kenuxa_node_state', { query: `node_id=eq.${encodeURIComponent(this.nodeId)}&select=state` });
    return rows?.[0]?.state || null;
  }
  async save(state) {
    await this.rest('POST', 'kenuxa_node_state', { query: 'on_conflict=node_id', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ node_id: this.nodeId, state, updated_at: new Date().toISOString() }] });
    try { this.mirrorState.rows = await this.mirror(state); this.mirrorState.at = new Date().toISOString(); this.mirrorState.error = null; }
    catch (e) { this.mirrorState.error = e.message; }
  }
  backup() { /* the previous state remains in Supabase point-in-time backups */ }
  async upsert(table, rows, conflict = 'id') {
    for (let i = 0; i < rows.length; i += 200) await this.rest('POST', table, { query: `on_conflict=${conflict}`, prefer: 'resolution=merge-duplicates,return=minimal', body: rows.slice(i, i + 200) });
    return rows.length;
  }
  // Normalised graph mirror into the original KENUXA tables (+ node_id). Only changed rows are sent.
  async mirror(state) {
    const N = this.nodeId, committed = (state._mirror ??= {}), seen = { ...committed }, now = new Date().toISOString(), out = { entities: [], relationships: [], attachments: [], capabilities: [], embeddings: [], agents: [], outcomes: [], memory: [], resolutions: [] };
    const all = [...state.atoms, ...(state.organism?.molecules || []), ...(state.organism?.cells || [])];
    const eid = id => uuidFrom(`${N}|${id}`);
    for (const e of all) {
      const d = e.dna || {}, kind = e.type || (e.dna?.identity?.type === 'domain-atom' ? 'domain-atom' : 'atom');
      const h = digest([d.evolution?.revision, e.status, e.title, e.fingerprint, d.embedding?.model, d.agent?.developmentScore]);
      if (seen[e.id] === h) continue; seen[e.id] = h;
      out.entities.push({ id: eid(e.id), node_id: N, sge_uri: (d.identity?.uri || `${kind === 'cell' ? 'cid' : 'mol'}://${N}/${encodeURIComponent(e.id)}`) + (e.origin && e.origin !== N ? '@' + N : ''), type: ENTITY_TYPE[kind] || 'Custom', label: String(e.title).slice(0, 500), description: e.answer || d.meaning?.definition || '', metadata: { kenuxaId: e.id, kenuxaKind: kind, status: e.status || 'approved', stage: d.evolution?.stage, revision: d.evolution?.revision, trust: d.trust, memberIds: e.memberIds, tags: e.tags }, created_at: d.identity?.bornAt || e.createdAt || now, updated_at: now });
      for (const r of d.relationships || []) {
        const [src, tgt] = r.predicate === 'contains' ? [eid(r.target), eid(e.id)] : [eid(e.id), eid(r.target)], type = REL_TYPE[r.predicate] || 'CUSTOM', score = clamp01(r.score ?? (r.predicate === 'contains' ? 1 : 0.5));
        out.relationships.push({ id: uuidFrom(`${src}|${tgt}|${type}`), node_id: N, source_id: src, target_id: tgt, type, weight: score, confidence: score, label: r.predicate, metadata: r, created_at: now });
      }
      for (const ev of d.evidence || []) out.attachments.push({ id: uuidFrom(`${N}|${e.id}|evidence|${ev.id}`), node_id: N, entity_id: eid(e.id), category: 'Evidence', key: ev.id, value: { url: ev.url || ev.source, title: ev.title, quote: ev.quote || ev.excerpt?.slice(0, 2000), retrievedAt: ev.retrievedAt || ev.capturedAt }, mime_type: 'application/json', created_at: now });
      for (const cap of d.capabilities || []) out.capabilities.push({ id: uuidFrom(`${N}|${e.id}|cap|${cap}`), node_id: N, entity_id: eid(e.id), name: cap.split('/').pop(), description: `Native capability of ${e.title}`, input_schema: { type: 'object', properties: { task: { type: 'string' } } }, output_schema: { type: 'object' }, executor: 'kenuxa-native', created_at: now });
      if (d.embedding?.vector) { const v = decodeHalf(d.embedding.vector); out.embeddings.push({ id: uuidFrom(`${N}|${e.id}|emb`), node_id: N, entity_id: eid(e.id), embedding: v, vec: `[${v.map(x => x.toFixed(5)).join(',')}]`, model: d.embedding.model, created_at: now }); }
      for (const key of ['agent', 'expert']) if (d[key]) out.agents.push({ id: uuidFrom(`${N}|${d[key].id}`), node_id: N, entity_id: eid(e.id), kind: key, level: d[key].level, specialty: d[key].specialty, skills: d[key].skills || [], development_score: d[key].developmentScore || 0, dna_revision: d[key].dnaRevision || 0, updated_at: now });
      for (const c of d.council || []) out.agents.push({ id: uuidFrom(`${N}|${c.id}`), node_id: N, entity_id: eid(e.id), kind: c.kind, level: c.level, specialty: c.specialty, skills: [], development_score: 0, dna_revision: c.dnaRevision || 0, updated_at: now });
    }
    for (const o of (state.outcomes || []).slice(0, 100)) if (!seen['o:' + o.id]) { seen['o:' + o.id] = 1; out.outcomes.push({ id: uuidFrom(`${N}|outcome|${o.id}`), node_id: N, type: o.type, detail: o.detail, observed: o.observed ?? null, expected: o.expected ?? null, confidence: o.confidence ?? null, created_at: o.at }); }
    for (const m of (state.memory || []).slice(0, 100)) if (!seen['m:' + m.id]) { seen['m:' + m.id] = 1; out.memory.push({ id: uuidFrom(`${N}|memory|${m.id}`), node_id: N, kind: 'conversation', content: { question: m.question, answer: m.answer }, created_at: m.at }); out.resolutions.push({ id: uuidFrom(`${N}|res|${m.id}`), node_id: N, goal: m.question, goal_entity_id: null, reasoning: String(m.answer).slice(0, 8000), entity_ids: (m.entityIds || []).map(eid), relationship_ids: [], created_at: m.at }); }
    const entityIds = new Set(all.map(e => eid(e.id)));
    out.relationships = out.relationships.filter(r => entityIds.has(r.target_id) && entityIds.has(r.source_id));
    let n = 0;
    n += await this.upsert('entities', out.entities); // entities first: other tables reference them
    n += await this.upsert('relationships', out.relationships, 'source_id,target_id,type');
    n += await this.upsert('embeddings', out.embeddings, 'entity_id');
    for (const [t, rows] of [['attachments', out.attachments], ['capabilities', out.capabilities], ['agents', out.agents], ['outcomes', out.outcomes], ['memory_logs', out.memory], ['resolutions', out.resolutions]]) n += await this.upsert(t, rows);
    Object.assign(committed, seen); // only after every upsert succeeded
    return n;
  }
  get blobs() {
    const obj = n => `${this.url}/storage/v1/object/${this.bucket}/${encodeURIComponent(this.nodeId)}/${n}`;
    return {
      read: async n => { const r = await this.fetcher(obj(n), { headers: this.headers() }); if (r.status === 404 || r.status === 400) return null; if (!r.ok) throw new Error(`Storage read ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
      write: async (n, buf) => {
        if (!this.bucketReady) { await this.fetcher(`${this.url}/storage/v1/bucket`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }) }).catch(() => {}); this.bucketReady = true; }
        const r = await this.fetcher(obj(n), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }), body: buf });
        if (!r.ok) throw new Error(`Storage write ${r.status}: ${(await r.text()).slice(0, 200)}`);
      },
    };
  }
  // Shared registry: every node using this Supabase project discovers the others automatically.
  async registerNode(info) { await this.upsert('kenuxa_nodes', [{ node_id: this.nodeId, public_url: info.publicUrl || null, platform: info.platform, protocol: info.protocol, last_seen: new Date().toISOString(), capabilities: info.capabilities || [] }], 'node_id'); }
  async listNodes() { const since = new Date(Date.now() - 2 * 86400000).toISOString(); return (await this.rest('GET', 'kenuxa_nodes', { query: `last_seen=gte.${since}&select=node_id,public_url,platform,last_seen` })) || []; }
  status() { return { kind: 'supabase', project: this.url.replace(/^https:\/\//, ''), nodeId: this.nodeId, mirror: this.mirrorState }; }
}
function decodeHalf(b64) {
  const b = Buffer.from(b64, 'base64'), out = []; for (let i = 0; i + 1 < b.length; i += 2) { const h = b.readUInt16LE(i), s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; out.push(e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15)); } return out;
}

export async function createStore({ env = process.env, dataDir, nodeId }) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (url && key) return new SupabaseStore({ url: url.replace(/\/+$/, ''), key, nodeId }).init();
  return new FileStore(dataDir).init();
}
