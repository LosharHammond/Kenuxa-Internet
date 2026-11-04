// Wiring of the Universal Evolution Engine into the running node: the components KENUXA is made of, the
// evaluator each policy is measured with, the applier that puts an active policy version into effect, the dynamic
// capability providers (volunteer peers, mesh nodes), and the extension point for new atom categories.
import { createHash } from 'node:crypto';
import { ComponentRegistry } from './registry.mjs';
import { EvolutionEngineUniversal } from './engine.mjs';
import { evaluateRetrieval, retrieve, simulateRouting, evaluateLearning } from './strategies.mjs';
import { negotiate, TRANSPORTS } from './protocols.mjs';
import { AuditChain, rotateIdentity } from './security.mjs';
import { registerPolicyKind, unregisterPolicyKind } from './policies.mjs';
import { registerCategory, unregisterCategory, COGNITIVE_CATEGORIES } from '../mind/atoms.mjs';

export function createEvolution({ state, node, mind = null, compute = null, mesh = null, comprehend = null, shareable = () => [], env = {}, Mind = null, version = '?', identity = null }) {
  const registry = new ComponentRegistry({ state: (state.registry ||= {}) });
  const audit = new AuditChain({ state: (state.audit ||= {}) });
  const kuee = new EvolutionEngineUniversal({ state: (state.engine ||= {}), node, registry, audit });
  const P = k => kuee.policies.get(k);
  const C = (id, type, capabilities, extra = {}) => registry.define({ id, type, version, capabilities, ...extra });
  // ---------- components (the same contract for every subsystem) ----------
  C('atoms', 'knowledge', ['knowledge-storage', 'atom-dna', 'content-addressing'], { dependencies: ['storage'], extensionPoints: ['atom types (schema)', 'relation vocabulary', 'cognitive categories (atom-category extension)'], risk: 'low', health: () => ({ atoms: shareable().length }) });
  C('language', 'comprehension', ['tokenisation', 'grammar', 'sense-disambiguation', 'coreference'], { dependencies: ['atoms'], extensionPoints: ['lexicon atoms (live senses)', 'grammar rules via the live ledger'], risk: 'medium' });
  C('cognition', 'reasoning', ['reasoning', 'planning', 'simulation', 'diagnosis', 'counterfactual', 'self-knowledge'], { dependencies: ['atoms'], policy: 'memory', extensionPoints: ['procedure atoms', 'causal atoms', 'action atoms', 'rule atoms', 'strategy atoms'], implementations: { 'mind/1': 'lib/mind' }, active: 'mind/1', risk: 'medium', health: () => mind ? { atoms: mind.store.status().atoms, episodes: mind.experience.stats().episodes } : null });
  C('learning', 'evolution', ['procedure-learning', 'correction-diagnosis'], { dependencies: ['cognition'], policy: 'learning', risk: 'medium' });
  C('retrieval', 'search', ['retrieval', 'knowledge-retrieval', 'indexing'], { dependencies: ['atoms'], policy: 'retrieval', implementations: { lexical: 'term overlap', 'concept-lexical': 'linked concept atoms, then term overlap (v1 behaviour)', 'concept-lexical-graph': 'as concept-lexical, plus spreading to tag/relationship neighbours', 'indexed-concept-lexical': 'inverted term index → candidates → concept-lexical (scales to large stores)' }, get active() { return P('retrieval').strategy; }, risk: 'low' });
  C('storage', 'storage', ['storage', 'replication', 'recovery', 'integrity-verification'], { policy: 'replication', extensionPoints: ['storage backends via lib/store.mjs adapters', 'erasure-coding parameters'], risk: 'medium' });
  C('discovery', 'network', ['peer-discovery', 'routing', 'node-identity'], { policy: 'protocols', extensionPoints: ['seed lists', 'directory', 'protocol versions'], risk: 'high', health: () => mesh ? { enabled: mesh.enabled, peers: mesh.goodPeers(100).length } : null });
  C('kunpp', 'distributed-compute', ['task-execution', 'task-scheduling', 'validation'], { dependencies: ['atoms'], policy: 'routing', extensionPoints: ['task kinds (kunpp-tasks vocabulary)', 'profiles', 'routing policy'], risk: 'medium', health: () => compute ? { active: compute.activePeers().length } : null });
  C('memory', 'memory', ['working-memory', 'experience-memory', 'conversation-capsules'], { policy: 'memory', risk: 'medium' });
  C('security', 'security', ['authentication', 'authorization', 'credential-hashing', 'proof-of-work', 'rate-limits', 'audit'], { policy: 'security', risk: 'high', rollback: 'previous policy version; credentials are migrated on use, old hashes stay valid' });
  C('ui', 'interface', ['chat-presentation'], { policy: 'ui', extensionPoints: ['declarative chat presentation policy (no executable content)'], risk: 'medium' });
  C('transports', 'protocol', ['transport-selection'], { implementations: Object.fromEntries(Object.entries(TRANSPORTS).map(([k, v]) => [k, (v.available ? '' : '(not implemented) ') + v.note])), risk: 'high' });
  C('evolution', 'meta', ['evolution', 'experimentation', 'rollback'], { policy: 'evolution', risk: 'high' });
  // dynamic providers: volunteer peers and mesh nodes advertise what they can do
  const refresh = () => {
    const active = new Set((compute?.activePeers?.() || []).map(p => 'peer:' + p.id)); for (const id of [...registry.providers.keys()]) if (id.startsWith('peer:') && !active.has(id)) registry.withdraw(id);
    for (const p of compute?.activePeers?.() || []) registry.advertise('peer:' + p.id, { kind: 'volunteer-' + p.type, capabilities: ['task-execution', ...(p.verified || []), ...(p.caps?.storageMB > 0 && p.type !== 'browser' ? ['storage-replica'] : [])], roles: p.type === 'browser' ? ['compute'] : ['compute', 'storage'], ttlMs: 120000 });
    for (const m of mesh?.goodPeers?.(50) || []) registry.advertise('node:' + m.fingerprint, { kind: 'node', capabilities: m.capabilities?.length ? m.capabilities : ['knowledge-retrieval', 'storage', 'validation'], meta: { url: m.url, protocols: m.protocols || null }, ttlMs: 30 * 60000 });
  };
  // ---------- evaluators: measured comparisons, never assumed ----------
  const ctx = { comprehend };
  kuee.evaluator('retrieval', (b, c) => { const atoms = shareable(); const B = evaluateRetrieval(atoms, b, ctx), X = evaluateRetrieval(atoms, c, ctx); if (!B.cases) return { notWorse: true, better: false, detail: 'no labelled queries yet (no approved lessons with alternate questions); validation only' }; const tol = P('evolution').retrievalRecallTolerance ?? 0, faster = X.msPerQuery <= B.msPerQuery * 0.5; return { notWorse: X.recallAtK >= B.recallAtK - 0.005 - (faster ? tol : 0) && X.recallAt1 >= B.recallAt1 - 0.005 - (faster ? tol : 0), better: X.recallAtK > B.recallAtK || X.recallAt1 > B.recallAt1, baseline: B, candidate: X, detail: `recall@${B.k} ${B.recallAtK} → ${X.recallAtK}; recall@1 ${B.recallAt1} → ${X.recallAt1}; ${B.msPerQuery} → ${X.msPerQuery} ms/query` }; });
  kuee.evaluator('routing', (b, c) => { const seeds = [7, 11, 23, 41], avg = pol => { const r = seeds.map(seed => simulateRouting(pol, { seed })); const m = k => r.reduce((s, x) => s + x[k], 0) / r.length; return { wait: m('priorityWeightedWait'), failures: m('failures'), kb: m('kbTransferred'), makespan: m('makespan') }; }; const B = avg(b), X = avg(c);
    return { notWorse: X.wait <= B.wait * 1.02 && X.failures <= B.failures * 1.05 + 1 && X.kb <= B.kb * 1.1, better: X.wait < B.wait * 0.98 || X.kb < B.kb * 0.9, baseline: B, candidate: X, detail: `priority-weighted wait ${B.wait.toFixed(0)} → ${X.wait.toFixed(0)}, failures ${B.failures.toFixed(1)} → ${X.failures.toFixed(1)}, KB ${B.kb.toFixed(0)} → ${X.kb.toFixed(0)} (simulation, 4 seeds)` }; });
  // replication: loss probability of a revision between proofs, if each holder fails independently with p per day (assumption 0.05)
  kuee.evaluator('replication', (b, c) => { const pf = 0.05, loss = v => Math.pow(pf * v.proofEveryHours / 24, v.replicaTarget), B = loss(b), X = loss(c); return { notWorse: X <= Math.max(B, 1e-4), better: X < B, baseline: { loss: B, copies: b.replicaTarget }, candidate: { loss: X, copies: c.replicaTarget }, detail: `loss probability per proof window ${B.toExponential(2)} → ${X.toExponential(2)} with ${b.replicaTarget} → ${c.replicaTarget} copies (assumes independent holder failure 5%/day)` }; });
  // memory: the same scenarios must give the same answers with the candidate bounds
  kuee.evaluator('memory', (b, c) => { if (!Mind) return { notWorse: true, detail: 'validation only' }; const qs = ['My phone battery is at 10%, and I need to travel for three hours. What should I do?', 'My solar battery is not charging. The panel voltage is normal.', 'How much energy does a 60 W bulb use in 5 hours?']; const run = pol => { const m = new Mind({ state: {} }); m.setPolicies({ memory: pol }); return qs.map(q => m.think(q)).map(r => ({ a: r.answer, ev: r.workingMemory?.evicted || 0 })); }; const B = run(b), X = run(c); const same = B.every((x, i) => x.a === X[i].a); return { notWorse: same, better: same && c.workingMemoryItems < b.workingMemoryItems, detail: `answers ${same ? 'identical' : 'DIFFER'}; evictions ${B.reduce((s, x) => s + x.ev, 0)} → ${X.reduce((s, x) => s + x.ev, 0)}` }; });
  // learning: corrections fixed / transferred and search effort, on fixed synthesis problems
  const L = { names: ['energy', 'load', 'efficiency'], dims: { energy: 'energy', load: 'power', efficiency: 'fraction' }, outDim: 'time', outUnit: 'h' }, pc = v => ({ value: v, unit: '%' });
  const learningCases = [
    { problem: { ...L, train: [{ inputs: { energy: 1000, load: 100, efficiency: pc(90) }, output: { value: 9 } }], heldOut: [{ inputs: { energy: 2400, load: 300, efficiency: pc(85) }, output: { value: 6.8 } }] } },
    { problem: { names: ['load', 'duration'], dims: { load: 'power', duration: 'time' }, outDim: 'energy', outUnit: 'Wh', train: [{ inputs: { load: 60, duration: 5 }, output: { value: 300 } }], heldOut: [{ inputs: { load: { value: 2, unit: 'kW' }, duration: 3 }, output: { value: 6000 } }] } },
    { problem: { names: ['energy', 'tariff'], dims: { energy: 'energy', tariff: 'price-per-energy' }, outDim: 'money', outUnit: 'money', train: [{ inputs: { energy: { value: 1, unit: 'kWh' }, tariff: 1.8 }, output: { value: 1.8 } }], heldOut: [{ inputs: { energy: 300, tariff: 2 }, output: { value: 0.6 } }] } },
  ];
  kuee.evaluator('learning', (b, c) => { const B = evaluateLearning(b, learningCases), X = evaluateLearning(c, learningCases); return { notWorse: X.fixed >= B.fixed && X.transfer >= B.transfer, better: X.fixed > B.fixed || X.transfer > B.transfer || (X.fixed === B.fixed && X.expressionsTried < B.expressionsTried * 0.9), baseline: B, candidate: X, detail: `fixed ${B.fixed} → ${X.fixed}/${B.cases}, held-out transfer ${B.transfer} → ${X.transfer}, expressions searched ${B.expressionsTried} → ${X.expressionsTried}` }; });
  // security: a stronger puzzle must still be solvable on a slow device (estimated from this CPU's measured hash rate, browser ≈ 5× slower)
  kuee.evaluator('security', (b, c) => { const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 30) { createHash('sha256').update('x' + n++).digest(); } const rate = n / 0.03 / 5, est = bits => Math.pow(2, bits) / rate; return { notWorse: est(c.powBitsMin) <= 3, better: c.powBitsMin > b.powBitsMin || c.tokenHash === 'sha512' && b.tokenHash === 'sha256', detail: `estimated median puzzle time on a slow browser: ${est(b.powBitsMin).toFixed(2)} s → ${est(c.powBitsMin).toFixed(2)} s; token hash ${b.tokenHash} → ${c.tokenHash}` }; });
  // protocols: no currently compatible peer may become incompatible (unless its version was already deprecated)
  kuee.evaluator('protocols', (b, c) => { const peers = (mesh?.goodPeers?.(100) || []).filter(p => p.protocols?.atp); const broken = peers.filter(p => negotiate(b.atp, p.protocols.atp).ok && !negotiate(c.atp, p.protocols.atp).ok && !(b.deprecated || []).includes(negotiate(b.atp, p.protocols.atp).version)); return { notWorse: !broken.length, better: false, detail: `${peers.length} known peers checked; ${broken.length} would lose compatibility` }; });
  // ---------- appliers ----------
  kuee.applier('replication', v => { if (compute && env.COMPUTE_REPLICAS === undefined) compute.o.replicaTarget = v.replicaTarget; });
  kuee.applier('memory', v => mind?.setPolicies({ memory: v }));
  kuee.applier('learning', v => mind?.setPolicies({ learning: v }));
  kuee.applier('security', v => { if (!compute) return; if (env.COMPUTE_POW_BITS === undefined) compute.o.powBits = v.powBitsMin; if (env.COMPUTE_REG_PER_NET_HOUR === undefined) compute.o.registrationsPerIpHour = v.registrationsPerNetHour; compute.o.tokenHash = v.tokenHash; });
  for (const k of ['replication', 'memory', 'learning', 'security']) try { kuee.appliers[k](P(k)); } catch {}
  if (compute) { compute.o.routing = key => kuee.effective('routing', key); compute.o.onRouteOutcome = (arm, ok) => kuee.observe('routing', arm, ok); compute.o.routingShadow = () => { const m = kuee.S.monitors.routing; return m ? kuee.policies.valueOf('routing', m.candidate) : null; }; }
  // ---------- extension point: new cognitive atom categories ----------
  kuee.extension('atom-category', { risk: 'low', validate: v => { if (!v || typeof v !== 'object') return { ok: false, issues: ['value must be { name, description, requires }'] }; if (COGNITIVE_CATEGORIES[v.name]) return { ok: false, issues: ['category already exists'] }; if (!/^[a-z][a-z-]{2,30}$/.test(String(v.name || ''))) return { ok: false, issues: ['name must be a lower-case slug'] }; return { ok: true }; }, apply: v => registerCategory(v), revert: v => unregisterCategory(v.name) });
  // ---------- extension point: new policy kinds (data-only schemas with declarative invariants) ----------
  kuee.extension('policy-kind', { risk: 'medium', validate: v => { if (!v || typeof v !== 'object') return { ok: false, issues: ['value must be { name, risk, fields, defaults, invariants }'] }; const r0 = registerPolicyKind(v); if (r0.ok) unregisterPolicyKind(v.name); return r0; }, apply: v => { registerPolicyKind(v); registry.record('evolution', { event: 'policy-kind-added', kind: v.name }); }, revert: v => unregisterPolicyKind(v.name) });
  // ---------- extension point: node identity key rotation (high risk: explicit owner authorization) ----------
  kuee.extension('key-rotation', { risk: 'high', replay: false, validate: v => identity ? { ok: v && typeof v === 'object' && typeof v.reason === 'string' && v.reason.length > 3, issues: ['give a reason for the rotation'] } : { ok: false, issues: ['no identity to rotate'] },
    apply: () => { const { identity: next, certificate } = rotateIdentity(identity); Object.assign(identity, next); audit.append('security:key-rotated', { from: certificate.from, to: certificate.to }); registry.record('security', { event: 'key-rotated', to: certificate.to }); }, revert: () => { /* a rotation cannot be undone safely; rotate again instead */ } });
  return {
    registry, kuee, refresh, audit,
    retrieve: (q, atoms) => { const { value, arm } = kuee.effective('retrieval', q); const out = retrieve(q, atoms, value, ctx); kuee.observe('retrieval', arm, out.length > 0); return out; },
    protocols: () => P('protocols'), ui: () => P('ui'),
    status: () => { refresh(); return { ...kuee.status(), components: registry.list(), capabilities: registry.capabilities(), providers: Object.fromEntries(['task-execution', 'storage-replica', 'knowledge-retrieval', 'reasoning'].map(c => [c, registry.discover(c).length])) }; },
  };
}
