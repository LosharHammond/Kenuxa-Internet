// Accounts, sessions and private user memory (zero-cost, no external identity provider).
// • Passphrases are stored only as scrypt hashes. Sessions are signed, revocable tokens in an HttpOnly cookie.
// • A device is never treated as a person: identity comes only from a signed-in session; signing out ends it.
// • User memory (preferences, facts the person asked KENUXA to remember, recurring goals) is private: it is never
//   written to the shared atom network, can be exported, and is erased on request.
// • Nodes that share KENUXA_SESSION_SECRET (and a shared store such as Supabase) recognise the same sessions.
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
const b64u = b => Buffer.from(b).toString('base64url');
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export class Accounts {
  constructor({ state, secret = null, now = () => Date.now(), sessionDays = 30 }) {
    state.users ||= {}; state.identity ||= {};
    this.state = state; this.now = now; this.ttl = sessionDays * 86400000;
    this.secret = secret ? Buffer.from(String(secret)) : Buffer.from(state.identity.sessionSecret ||= b64u(randomBytes(32)));
    this.attempts = new Map();
  }
  get users() { return this.state.users; }
  byName(name) { return Object.values(this.users).find(u => u.username === String(name || '').toLowerCase()) || null; }
  throttle(key) { const t = this.now(), a = (this.attempts.get(key) || []).filter(x => t - x < 60000); a.push(t); this.attempts.set(key, a); if (this.attempts.size > 5000) this.attempts.clear(); return a.length <= 5; }
  hash(pass, salt) { return scryptSync(String(pass).normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64'); }
  create({ username, passphrase }, { ip = '' } = {}) {
    const name = String(username || '').trim().toLowerCase();
    if (!this.throttle('create:' + ip)) throw new Error('Too many attempts. Wait a minute.');
    if (!USERNAME.test(name)) throw new Error('Choose a username of 3–32 letters, numbers, dots, dashes or underscores.');
    if (String(passphrase || '').length < 10) throw new Error('Use a passphrase of at least 10 characters.');
    if (this.byName(name)) throw new Error('That username is taken.');
    const salt = b64u(randomBytes(16)), id = 'u_' + b64u(randomBytes(12));
    this.users[id] = { id, username: name, salt, hash: this.hash(passphrase, salt), createdAt: new Date(this.now()).toISOString(), sessions: [], memory: { facts: [], preferences: {}, goals: [] }, settings: { location: null } };
    return this.issue(this.users[id]);
  }
  login({ username, passphrase }, { ip = '', device = '' } = {}) {
    const name = String(username || '').trim().toLowerCase();
    if (!this.throttle('login:' + ip) || !this.throttle('user:' + name)) throw new Error('Too many attempts. Wait a minute.');
    const u = this.byName(name), ok = u && timingSafeEqual(Buffer.from(this.hash(passphrase, u.salt), 'base64'), Buffer.from(u.hash, 'base64'));
    if (!ok) throw new Error('Wrong username or passphrase.');
    return this.issue(u, device);
  }
  issue(u, device = '') {
    const sid = b64u(randomBytes(12)), exp = this.now() + this.ttl, body = `v1.${u.id}.${exp}.${sid}`;
    u.sessions = [...(u.sessions || []).filter(s => s.exp > this.now()), { sid, exp, device: String(device).slice(0, 60), at: new Date(this.now()).toISOString() }].slice(-10);
    return { token: `${body}.${b64u(createHmac('sha256', this.secret).update(body).digest())}`, user: this.publicUser(u), expires: new Date(exp).toISOString() };
  }
  verify(token) {
    const m = String(token || '').match(/^(v1\.(u_[A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+))\.([A-Za-z0-9_-]+)$/); if (!m) return null;
    const want = createHmac('sha256', this.secret).update(m[1]).digest(), got = Buffer.from(m[5], 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want) || Number(m[3]) < this.now()) return null;
    const u = this.users[m[2]]; if (!u || !(u.sessions || []).some(s => s.sid === m[4])) return null; // revoked or unknown on this node
    return { user: u, sid: m[4] };
  }
  logout(token) { const v = this.verify(token); if (v) v.user.sessions = v.user.sessions.filter(s => s.sid !== v.sid); return !!v; }
  remove(token, passphrase) { const v = this.verify(token); if (!v) throw new Error('Sign in first.'); if (!timingSafeEqual(Buffer.from(this.hash(passphrase, v.user.salt), 'base64'), Buffer.from(v.user.hash, 'base64'))) throw new Error('Wrong passphrase.'); delete this.users[v.user.id]; return true; }
  publicUser(u) { return { id: u.id, username: u.username, createdAt: u.createdAt, memory: { facts: u.memory.facts.length, preferences: Object.keys(u.memory.preferences).length, goals: u.memory.goals.length }, settings: { location: u.settings.location ? { source: u.settings.location.source, accuracy: u.settings.location.accuracy, country: u.settings.location.country || null } : null }, sessions: (u.sessions || []).map(s => ({ device: s.device, at: s.at })) }; }
  exportData(u) { const { hash, salt, ...rest } = u; return { ...rest, exportedAt: new Date(this.now()).toISOString() }; }
}

// "Remember that …" / "Forget that …" / "What do you remember about me?" — explicit memory commands only.
export function memoryCommand(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.{3,240}?)[.!]?$/i); if (m && !/^(when|how|what|who|where|why)\b/i.test(m[1])) return { kind: 'remember', fact: m[1].replace(/^my\b/i, 'Your').replace(/^i\b/i, 'You') };
  m = t.match(/^(?:please\s+)?forget(?:\s+that)?\s+(.{3,240}?)[.!]?$/i); if (m) return { kind: 'forget', fact: m[1] };
  if (/^(what do you (remember|know) about me|show (me )?my memory)\??$/i.test(t)) return { kind: 'recall' };
  if (/^(forget everything( about me)?|clear my memory|delete my memory)[.!]?$/i.test(t)) return { kind: 'forget-all' };
  return null;
}
export function applyMemory(user, cmd, situationOf) {
  const mem = user.memory;
  if (cmd.kind === 'remember') { const fact = { text: cmd.fact.slice(0, 240), at: new Date().toISOString() }; mem.facts = [...mem.facts.filter(f => f.text.toLowerCase() !== fact.text.toLowerCase()), fact].slice(-50); Object.assign(mem.preferences, situationOf ? situationOf(cmd.fact.replace(/^Your\b/, 'my').replace(/^You\b/, 'I')) : {}); return `I’ll remember that ${fact.text.charAt(0).toLowerCase() + fact.text.slice(1)}. This is stored only with your account — it never becomes shared network knowledge — and you can ask me to forget it at any time.`; }
  if (cmd.kind === 'forget') { const k = cmd.fact.toLowerCase().split(/\s+/).filter(w => w.length > 3); const before = mem.facts.length; mem.facts = mem.facts.filter(f => !k.every(w => f.text.toLowerCase().includes(w))); return before > mem.facts.length ? `Done — I’ve forgotten ${before - mem.facts.length} thing${before - mem.facts.length > 1 ? 's' : ''} about that.` : 'I don’t have anything stored about that.'; }
  if (cmd.kind === 'forget-all') { user.memory = { facts: [], preferences: {}, goals: [] }; return 'Done — everything I remembered about you has been erased.'; }
  if (cmd.kind === 'recall') return mem.facts.length ? `Here is what you asked me to remember:\n\n${mem.facts.map(f => `- ${f.text}`).join('\n')}\n\nSay “forget that …” to remove anything.` : 'You haven’t asked me to remember anything yet. Say “remember that …” and I’ll keep it with your account.';
  return null;
}

// Approximate location from consented device signals. Time zone → country is coarse and labelled as such;
// coordinates are rounded to ~11 km before they are stored. Location is never used to identify a person.
const TZ = { 'Africa/Accra': 'Ghana', 'Africa/Lagos': 'Nigeria', 'Africa/Nairobi': 'Kenya', 'Africa/Johannesburg': 'South Africa', 'Africa/Cairo': 'Egypt', 'Africa/Abidjan': 'Côte d’Ivoire', 'Africa/Lome': 'Togo', 'Africa/Ouagadougou': 'Burkina Faso', 'Africa/Dakar': 'Senegal', 'Africa/Kampala': 'Uganda', 'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Kigali': 'Rwanda', 'Africa/Addis_Ababa': 'Ethiopia', 'Africa/Casablanca': 'Morocco', 'Europe/London': 'United Kingdom', 'Europe/Berlin': 'Germany', 'Europe/Paris': 'France', 'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Los_Angeles': 'United States', 'America/Toronto': 'Canada', 'Asia/Kolkata': 'India', 'Asia/Dubai': 'United Arab Emirates', 'Asia/Shanghai': 'China', 'Asia/Tokyo': 'Japan', 'Australia/Sydney': 'Australia' };
export function approximateLocation(input) {
  if (!input || typeof input !== 'object') return null;
  const tz = typeof input.timeZone === 'string' && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(input.timeZone) ? input.timeZone : null;
  const lat = Number(input.lat), lon = Number(input.lon), coords = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 } : null;
  const country = tz ? TZ[tz] || null : null; if (!country && !coords) return null;
  return { country, timeZone: tz, coords, source: coords ? 'device (consented)' : 'time zone', accuracy: coords ? `about ${Math.max(11, Math.round(Number(input.accuracy) / 1000) || 11)} km` : 'country level, from the device time zone (approximate)' };
}
