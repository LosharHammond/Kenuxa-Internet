// Per-key byte budget over a fixed window (used to stop one peer from exhausting a node's storage).
export class ByteWindow {
  constructor(limitBytes, windowMs = 3600000, now = () => Date.now()) { Object.assign(this, { limitBytes, windowMs, now }); this.w = new Map(); }
  allow(key, bytes) {
    const t = this.now(); let e = this.w.get(key); if (!e || e.until < t) { e = { used: 0, until: t + this.windowMs }; this.w.set(key, e); }
    if (this.w.size > 10000) for (const [k, v] of this.w) if (v.until < t) this.w.delete(k);
    if (e.used + bytes > this.limitBytes) return { ok: false, used: e.used, retryAfterMs: e.until - t };
    e.used += bytes; return { ok: true, used: e.used };
  }
}
