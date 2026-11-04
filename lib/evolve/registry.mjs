// Universal component registry: every major subsystem declares the same evolution contract — identity, type,
// version, capabilities, dependencies, resources, compatibility, configuration (policy kind), extension points,
// alternative implementations, metrics, health, history, validation and deployment requirements, rollback.
// Callers ask for a CAPABILITY ("retrieval", "task-execution") and get the providers that currently offer it —
// local components and remote nodes that advertised it — instead of relying on a fixed list.

export const RISK = { low: 'automated tests', medium: 'automated evaluation + canary rollout + monitoring', high: 'automated checks + explicit owner authorization + canary + monitoring' };

export class ComponentRegistry {
  constructor({ state = {}, now = () => Date.now() } = {}) { this.S = state; this.S.history ||= {}; this.now = now; this.components = new Map(); this.providers = new Map(); }
  // def: { id, type, version, capabilities[], dependencies[], resources, compatibility, policy, extensionPoints[], implementations: {name: description}, active, metrics: () => {}, health: () => {}, risk, rollback }
  define(def) {
    for (const k of ['id', 'type', 'version']) if (!def[k]) throw new Error('component needs ' + k);
    const c = { capabilities: [], dependencies: [], extensionPoints: [], implementations: {}, risk: 'medium', rollback: 'previous policy version', ...def };
    this.components.set(c.id, c); (this.S.history[c.id] ||= []).length || this.S.history[c.id].push({ at: this.now(), version: c.version, event: 'registered' });
    return c;
  }
  get(id) { return this.components.get(id) || null; }
  record(id, event) { (this.S.history[id] ||= []).push({ at: this.now(), ...event }); if (this.S.history[id].length > 100) this.S.history[id].shift(); }
  // dynamic providers (remote nodes, volunteer peers); expire when not refreshed
  advertise(providerId, { capabilities = [], kind = 'node', roles = [], ttlMs = 15 * 60000, meta = {} }) {
    this.providers.set(providerId, { id: providerId, kind, capabilities: [...new Set(capabilities)].slice(0, 40), roles, meta, expires: this.now() + ttlMs, at: this.now() });
    return this.providers.get(providerId);
  }
  withdraw(providerId) { return this.providers.delete(providerId); }
  discover(capability) {
    const now = this.now(); for (const [k, p] of this.providers) if (p.expires < now) this.providers.delete(k);
    return [...[...this.components.values()].filter(c => c.capabilities.includes(capability)).map(c => ({ id: c.id, kind: 'local-component', version: c.version, implementation: c.active || null, health: safe(c.health) })),
      ...[...this.providers.values()].filter(p => p.capabilities.includes(capability)).map(p => ({ id: p.id, kind: p.kind, roles: p.roles, meta: p.meta }))];
  }
  capabilities() { const s = new Set(); for (const c of this.components.values()) c.capabilities.forEach(x => s.add(x)); for (const p of this.providers.values()) p.capabilities.forEach(x => s.add(x)); return [...s].sort(); }
  describe(id) { const c = this.get(id); if (!c) return null; return { id: c.id, type: c.type, version: c.version, capabilities: c.capabilities, dependencies: c.dependencies, resources: c.resources || null, compatibility: c.compatibility || null, policy: c.policy || null, extensionPoints: c.extensionPoints, implementations: c.implementations, active: c.active || null, risk: c.risk, validation: RISK[c.risk], rollback: c.rollback, health: safe(c.health), metrics: safe(c.metrics), history: (this.S.history[c.id] || []).slice(-10) }; }
  list() { return [...this.components.keys()].map(id => this.describe(id)); }
}
function safe(f) { try { return typeof f === 'function' ? f() : null; } catch (e) { return { error: e.message }; } }
