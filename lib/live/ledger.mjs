// Live knowledge ledger (v1.4): KENUXA learns while it runs, without redeploys and without touching neural weights.
//
// Every knowledge change is a LEARNING EVENT that moves through an explicit lifecycle:
//   observed → provisional → investigated → validated → committed → indexed → active
// with explicit side states: disputed, rejected, superseded, revoked, failed.
// "committed" means the new revisions are durably persisted (not merely in memory); "active" means they are visible
// to requests that start afterwards. Semantic validation (is it justified?) and durability (is it stored?) are separate
// fields, never one "verified" flag.
//
// Consistency: a request takes a snapshot (a sequence number) when it starts and reads revisions as of that snapshot,
// so it never sees a half-activated change set. Activation of all writes in an event happens in one synchronous step
// under one new sequence number. Updates are idempotent (same content → same event), concurrent corrections against
// a stale base revision are detected (event becomes disputed), interrupted commits are recovered after restart, and
// any activation can be revoked (the previous revisions are re-activated, history is kept).
import { createHash } from 'node:crypto';

const h = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const iso = t => new Date(t).toISOString();
export const STATES = ['observed', 'provisional', 'investigated', 'validated', 'committed', 'indexed', 'active', 'disputed', 'rejected', 'superseded', 'revoked', 'failed'];
const NEXT = {
  observed: ['provisional', 'rejected'], provisional: ['investigated', 'validated', 'rejected', 'disputed'], investigated: ['validated', 'rejected', 'disputed'],
  disputed: ['investigated', 'validated', 'rejected'], validated: ['committed', 'failed', 'disputed'], committed: ['indexed', 'failed'], indexed: ['active', 'failed'],
  active: ['superseded', 'revoked'], failed: ['validated', 'rejected'], superseded: ['revoked'], rejected: [], revoked: [],
};
// timestamps and counters do not change what an update means: they are excluded from the idempotency key
const meaningOf = v => JSON.parse(JSON.stringify(v, (k, x) => (['createdAt', 'at', 'lastValidated', 'knowledgeVersion', 'updatedAt'].includes(k) ? undefined : x)));

export class KnowledgeLedger {
  constructor({ registry, state, node = 'local', persist = async () => {}, appliers = {}, onChange = () => {}, now = () => Date.now(), maxEvents = 2000 } = {}) {
    this.registry = registry; this.node = node; this.persist = persist; this.onChange = onChange; this.now = now; this.maxEvents = maxEvents;
    this.L = state.live ??= {}; this.L.seq ??= 0; this.L.events ??= {}; this.L.order ??= []; this.L.activations ??= {}; this.L.deps ??= {}; this.L.answers ??= {}; this.L.metrics ??= { proposed: 0, duplicates: 0, activated: 0, rejected: 0, disputed: 0, failed: 0, revoked: 0, recovered: 0, invalidated: 0 };
    this.appliers = { registry: this.registryApplier(), ...appliers }; this.locks = new Set();
  }
  // ---------- appliers: how a write is staged / activated / reverted in a particular store ----------
  registryApplier() {
    const r = () => this.registry;
    return {
      base: id => r().manifest(id)?.head || null,
      stage: w => r().stage(w.value),
      activate: (w, rev) => r().activate(w.id, rev, { node: this.node, reason: 'live:' + w.reason }),
      revert: (w, prev) => { if (prev) r().activate(w.id, prev, { node: this.node, reason: 'live:revert' }); else { const m = r().manifest(w.id); if (m) m.revoked = true; } },
      staged: rev => r().revisions.has(rev),
    };
  }
  // ---------- lifecycle ----------
  event(id) { return this.L.events[id] || null; }
  move(e, to, reason, extra = {}) {
    if (!(NEXT[e.state] || []).includes(to)) throw new Error(`illegal transition ${e.state} → ${to}`);
    e.state = to; e.updatedAt = iso(this.now()); Object.assign(e, extra); e.history.push({ state: to, at: e.updatedAt, reason: String(reason || '').slice(0, 300) }); if (e.history.length > 40) e.history.splice(1, e.history.length - 40);
    if (to === 'rejected') this.L.metrics.rejected++; if (to === 'disputed') this.L.metrics.disputed++; if (to === 'failed') this.L.metrics.failed++;
    return e;
  }
  propose({ kind, writes, evidence = [], dependencies = [], scope = 'public', privacy = 'public', source = 'unknown', reason = '', summary = '' }) {
    if (!kind || !Array.isArray(writes) || !writes.length) throw new Error('propose: kind and writes are required');
    if (!['public', 'private'].includes(privacy)) throw new Error('propose: privacy must be public or private');
    const ws = writes.map(w => ({ store: w.store || 'registry', id: String(w.id), value: w.value, reason: w.reason || kind }));
    for (const w of ws) if (!this.appliers[w.store]) throw new Error('propose: unknown store ' + w.store);
    const key = h({ kind, writes: ws.map(w => [w.store, w.id, meaningOf(w.value)]) }), id = 'le:' + key.slice(0, 24);
    const existing = this.L.events[id];
    if (existing && !['rejected', 'failed', 'revoked', 'superseded'].includes(existing.state)) { this.L.metrics.duplicates++; return { event: existing, duplicate: true }; }
    const at = iso(this.now());
    const e = { id, key, kind, state: 'observed', createdAt: at, updatedAt: at, node: this.node, source, reason: String(reason).slice(0, 500), summary: String(summary || kind).slice(0, 300), scope, privacy,
      writes: ws.map(w => ({ ...w, baseRev: this.appliers[w.store].base(w.id), rev: null })), evidence: evidence.slice(0, 20), dependencies: [...new Set(dependencies)].slice(0, 50),
      validation: null, persistence: 'not-started', indexing: 'not-started', activation: null, history: [{ state: 'observed', at, reason: 'proposed' }] };
    this.L.events[id] = e; this.L.order.push(id); this.trim(); this.L.metrics.proposed++;
    this.move(e, 'provisional', 'recorded as provisional knowledge; not yet usable');
    return { event: e, duplicate: false };
  }
  investigate(id, findings) { const e = this.event(id); this.move(e, 'investigated', findings?.summary || 'investigated', { investigation: { ...findings, at: iso(this.now()) } }); return e; }
  // checks: [{name, ok, detail}] — produced by the caller's validators (evidence, schema, privacy, conflicts).
  validate(id, checks = []) {
    const e = this.event(id), failed = checks.filter(c => !c.ok), conflict = checks.find(c => !c.ok && c.conflict);
    e.validation = { at: iso(this.now()), checks, passed: !failed.length };
    if (conflict) return this.move(e, 'disputed', conflict.detail || conflict.name);
    if (failed.length) return this.move(e, 'rejected', failed.map(c => c.name + (c.detail ? ': ' + c.detail : '')).join('; '));
    return this.move(e, 'validated', 'all validation checks passed');
  }
  // validated → committed (durable) → indexed → active. Returns the event; never reports success on a failed write.
  async commit(id) {
    const e = this.event(id); if (!e) throw new Error('unknown event'); if (e.state !== 'validated') throw new Error(`commit: event is ${e.state}, not validated`);
    const ids = e.writes.map(w => w.store + ':' + w.id); if (ids.some(x => this.locks.has(x))) { this.move(e, 'disputed', 'another update to the same atom is being committed; re-validate after it finishes'); return e; }
    // Concurrent correction: the atom changed since this event was validated → do not overwrite it blindly.
    const stale = e.writes.find(w => this.appliers[w.store].base(w.id) !== w.baseRev);
    if (stale) { this.move(e, 'disputed', `concurrent change: ${stale.id} moved from ${String(stale.baseRev).slice(0, 12)} to ${String(this.appliers[stale.store].base(stale.id)).slice(0, 12)}; re-validate against the current revision`); return e; }
    ids.forEach(x => this.locks.add(x));
    try {
      e.persistence = 'writing'; await this.persist('intent', e);
      for (const w of e.writes) w.rev = this.appliers[w.store].stage(w);
      await this.persist('revisions', e);
      e.persistence = 'ok'; this.move(e, 'committed', 'revisions durably persisted');
      await this.persist('journal', e);
    } catch (err) {
      e.persistence = 'failed'; this.move(e, 'failed', 'persistence failed: ' + err.message + ' — nothing was activated');
      try { await this.persist('journal', e); } catch { /* the journal itself is unavailable; recovery treats "writing" as failed */ }
      ids.forEach(x => this.locks.delete(x)); return e;
    }
    try {
      for (const w of e.writes) if (this.appliers[w.store].staged && !this.appliers[w.store].staged(w.rev)) throw new Error('staged revision missing for ' + w.id);
      e.indexing = 'prepared'; this.move(e, 'indexed', 'index entries prepared');
      this.activate(e, 'validated, persisted and indexed');
      try { await this.persist('journal', e); } catch (err) { e.journalWarning = 'activation journal write failed (' + err.message + '); restart recovery will roll it forward from the committed state'; }
    } finally { ids.forEach(x => this.locks.delete(x)); }
    return e;
  }
  // One synchronous step: every write of the event becomes visible under ONE new sequence number.
  activate(e, reason) {
    const seq = ++this.L.seq, at = iso(this.now()), changed = [];
    for (const w of e.writes) {
      const prev = this.appliers[w.store].activate(w, w.rev);
      (this.L.activations[w.store + ':' + w.id] ||= []).push({ seq, rev: w.rev, prev: prev ?? w.baseRev, event: e.id, at }); changed.push(w.id);
      const acts = this.L.activations[w.store + ':' + w.id]; if (acts.length > 50) acts.splice(0, acts.length - 50);
    }
    e.indexing = 'applied'; this.move(e, 'active', reason, { activation: { seq, at } }); this.L.metrics.activated++;
    // older active events on the same atoms are superseded (their revisions stay in history)
    for (const other of Object.values(this.L.events)) if (other !== e && other.state === 'active' && other.writes.some(w => changed.includes(w.id) && e.writes.some(x => x.id === w.id && x.store === w.store))) this.move(other, 'superseded', `superseded by ${e.id}`);
    const invalidated = this.invalidate(changed, { cause: e.id });
    try { this.onChange({ event: e, changed, invalidated, seq }); } catch (err) { e.propagationError = err.message; }
    return e;
  }
  async revoke(id, reason = 'revoked by owner') {
    const e = this.event(id); if (!e || !['active', 'superseded'].includes(e.state)) throw new Error('only an active or superseded event can be revoked');
    const blocked = e.writes.find(w => this.appliers[w.store].base(w.id) !== w.rev && e.state === 'active');
    if (blocked) throw new Error(`cannot revoke: ${blocked.id} has changed since this event; revoke the newer event first`);
    const seq = ++this.L.seq, at = iso(this.now()), changed = [];
    for (const w of e.writes) { if (e.state === 'active') { const act = (this.L.activations[w.store + ':' + w.id] || []).filter(a => a.event === e.id).pop(); this.appliers[w.store].revert(w, act?.prev ?? w.baseRev); (this.L.activations[w.store + ':' + w.id] ||= []).push({ seq, rev: act?.prev ?? w.baseRev, prev: w.rev, event: e.id, revert: true, at }); changed.push(w.id); } }
    this.move(e, 'revoked', reason); this.L.metrics.revoked++;
    const invalidated = this.invalidate(changed, { cause: e.id + ' (revoked)' });
    try { this.onChange({ event: e, changed, invalidated, seq, revoked: true }); } catch (err) { e.propagationError = err.message; }
    try { await this.persist('journal', e); } catch (err) { e.journalWarning = err.message; }
    return e;
  }
  // ---------- snapshots: consistent reads for the lifetime of one request ----------
  snapshot() { return { seq: this.L.seq }; }
  revisionAt(store, id, seq) {
    const acts = this.L.activations[store + ':' + id];
    if (!acts?.length || acts[acts.length - 1].seq <= seq) return undefined; // nothing activated after the snapshot: current head is right
    for (let i = acts.length - 1; i >= 0; i--) if (acts[i].seq <= seq) return acts[i].rev;
    return acts[0].prev ?? null; // the snapshot predates every recorded activation
  }
  // A registry view pinned to a snapshot. Reads go through the snapshot; writes (discovery, usage) go to the registry.
  view(snap = this.snapshot()) {
    const reg = this.registry, self = this;
    const get = id => { const rev = self.revisionAt('registry', id, snap.seq); return rev === undefined ? reg.get(id) : rev ? reg.revisions.get(rev) : null; };
    return new Proxy(reg, { get(t, p, recv) { if (p === 'get') return get; if (p === 'snapshotSeq') return snap.seq; const v = Reflect.get(t, p, recv); return typeof v === 'function' ? v.bind(recv) : v; } });
  }
  // ---------- dependencies: conclusions derived from atoms/claims ----------
  depend(conclusionId, sources, { kind = 'conclusion', label = '' } = {}) {
    this.L.deps[conclusionId] = { sources: [...new Set(sources)].slice(0, 100), kind, label: String(label).slice(0, 200), status: 'valid', at: iso(this.now()) };
    const keys = Object.keys(this.L.deps); if (keys.length > 20000) delete this.L.deps[keys[0]];
  }
  dependentsOf(ids) { const want = new Set(ids); return Object.entries(this.L.deps).filter(([, d]) => d.sources.some(s => want.has(s))).map(([k]) => k); }
  invalidate(ids, { cause }) {
    const out = [], seen = new Set(ids); let frontier = [...ids];
    while (frontier.length) {
      const next = [];
      for (const c of this.dependentsOf(frontier)) { if (seen.has(c)) continue; seen.add(c); const d = this.L.deps[c]; d.status = 'needs-reevaluation'; d.invalidatedBy = cause; d.invalidatedAt = iso(this.now()); out.push({ id: c, kind: d.kind, label: d.label }); next.push(c); }
      frontier = next;
    }
    // answer caches built on any changed or invalidated item are dropped — an old answer can never bypass a correction
    const dead = new Set([...seen]);
    for (const [k, a] of Object.entries(this.L.answers)) if (a.cache && a.cache.deps.some(x => dead.has(x))) { a.cache = null; a.invalidatedBy = cause; out.push({ id: 'answer:' + k, kind: 'answer-cache', label: a.label || '' }); }
    this.L.metrics.invalidated += out.length; return out;
  }
  // ---------- answer cache + answer history (self-review over time) ----------
  cachedAnswer(qkey) { const a = this.L.answers[qkey]; return a?.cache && a.cache.seq <= this.L.seq ? a.cache : null; }
  recordAnswer(qkey, { answer, deps = [], checks = [], label = '', cacheable = false, keepText = true }) {
    const text = typeof answer === 'string' ? answer : String(answer?.answer ?? ''), a = this.L.answers[qkey] ||= { label: String(label).slice(0, 120), revisions: [] }, digest = h(text).slice(0, 16), last = a.revisions[a.revisions.length - 1];
    const passed = checks.filter(c => c.ok).length, entry = { at: iso(this.now()), digest, seq: this.L.seq, passed, total: checks.length, ...(keepText ? { answer: text.slice(0, 4000) } : {}) };
    let change = null;
    if (!last) change = { kind: 'first' };
    else if (last.digest === digest) change = { kind: 'stable', note: 'no justified change: same knowledge, same answer' };
    else change = { kind: 'revised', previous: last.digest, justification: a.invalidatedBy || 'knowledge revision ' + this.L.seq, checksBefore: `${last.passed}/${last.total}`, checksAfter: `${passed}/${checks.length}`, improved: passed > last.passed ? 'more checks passed' : passed === last.passed ? 'same check results; content changed with the knowledge it depends on' : 'fewer checks passed — review recommended' };
    if (change.kind !== 'stable') { a.revisions.push({ ...entry, change }); if (a.revisions.length > 10) a.revisions.shift(); } else last.confirmedAt = entry.at;
    a.invalidatedBy = null; a.cache = cacheable ? { answer, deps: [...new Set(deps)], seq: this.L.seq, at: entry.at } : null;
    const keys = Object.keys(this.L.answers); if (keys.length > 2000) delete this.L.answers[keys[0]];
    return change;
  }
  // ---------- restart recovery ----------
  recover() {
    const report = { rolledForward: [], failed: [], verified: 0 };
    for (const id of this.L.order) {
      const e = this.L.events[id]; if (!e) continue;
      if (e.persistence === 'writing' || (['validated'].includes(e.state) && e.persistence === 'writing')) { e.persistence = 'failed'; e.state = 'validated'; this.move(e, 'failed', 'interrupted during persistence before it was durable; nothing was activated'); report.failed.push(id); continue; }
      if (['committed', 'indexed'].includes(e.state)) {
        const missing = e.writes.find(w => this.appliers[w.store].staged && !this.appliers[w.store].staged(w.rev));
        if (missing) { e.state = 'indexed'; this.move(e, 'failed', `recovery: revision for ${missing.id} not found in durable storage`); report.failed.push(id); continue; }
        if (e.state === 'committed') this.move(e, 'indexed', 'recovery: index rebuilt');
        // a newer change may have happened in the meantime; only roll forward if the base still matches
        const stale = e.writes.find(w => { const b = this.appliers[w.store].base(w.id); return b !== w.baseRev && b !== w.rev; });
        if (stale) { e.state = 'validated'; e.history.push({ state: 'validated', at: iso(this.now()), reason: 'recovery: base changed' }); this.move(e, 'disputed', 'recovery: atom changed while this event was interrupted; re-validate'); report.failed.push(id); continue; }
        this.activate(e, 'recovered after restart: committed revisions rolled forward'); this.L.metrics.recovered++; report.rolledForward.push(id); continue;
      }
      if (e.state === 'active') { // registry heads may predate the activation if the registry blob was saved earlier
        for (const w of e.writes) { const b = this.appliers[w.store].base(w.id); if (b !== w.rev && !(this.L.activations[w.store + ':' + w.id] || []).some(a => a.seq > e.activation.seq)) { if (this.appliers[w.store].staged?.(w.rev) === false) continue; this.appliers[w.store].activate(w, w.rev); } }
        report.verified++;
      }
    }
    return report;
  }
  trim() { while (this.L.order.length > this.maxEvents) { const old = this.L.order.shift(), e = this.L.events[old]; if (e && ['active', 'committed', 'indexed', 'validated'].includes(e.state)) { this.L.order.push(old); break; } delete this.L.events[old]; } }
  list({ state = null, limit = 50 } = {}) { return this.L.order.slice().reverse().map(id => this.L.events[id]).filter(e => e && (!state || e.state === state)).slice(0, limit); }
  status() { const by = {}; for (const e of Object.values(this.L.events)) by[e.state] = (by[e.state] || 0) + 1; return { seq: this.L.seq, events: Object.keys(this.L.events).length, byState: by, metrics: this.L.metrics, dependencies: Object.keys(this.L.deps).length, needsReevaluation: Object.values(this.L.deps).filter(d => d.status === 'needs-reevaluation').length }; }
}
