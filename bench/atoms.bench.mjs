// Measured benchmarks for the atomic architecture. Run: node bench/atoms.bench.mjs
// Prints real timings from this machine; nothing here is estimated.
import { performance } from 'node:perf_hooks';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { interpret, Discourse } from '../lib/atoms/language.mjs';
import { InMemoryTransport, PreservationEngine } from '../lib/atoms/preservation.mjs';
import { encode, pack } from '../lib/atoms/codec.mjs';

const t = (fn, n = 1) => { const s = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - s) / n; };
const at = async (fn) => { const s = performance.now(); await fn(); return performance.now() - s; };
const out = {};
const seedMs = t(() => new AtomRegistry()); const r = new AtomRegistry();
out.genesisSeedMs = +seedMs.toFixed(1); out.genesisAtoms = r.manifests.size;
out.lookupUs = +(t(i => r.get(i % 2 ? 'lex:en:learning' : 'lex:en:bank'), 200000) * 1000).toFixed(3);
out.creationUs = +(t(i => r.discover('benchword' + i, { lang: 'en' }), 20000) * 1000).toFixed(2);
out.atomsAfterCreation = r.manifests.size;
out.lookupAt20kUs = +(t(i => r.get('lex:en:benchword' + (i % 20000)), 200000) * 1000).toFixed(3);
const sentences = ['I am learning.', 'I deposited money in the bank.', 'How can I protect it?', 'I am learning because I need to improve.', 'Can I use it on Windows?'];
const d = new Discourse(); out.interpretMs = +t(i => interpret(sentences[i % sentences.length], { registry: r, discourse: d }), 2000).toFixed(3);
const before = { ...r.stats }; for (let i = 0; i < 2000; i++) interpret(sentences[i % 5], { registry: r });
out.cacheHitRatio = +((r.stats.reused - before.reused) / ((r.stats.reused - before.reused) + (r.stats.created - before.created))).toFixed(4);
// Relationship traversal: every inflected form → its lemma → its senses.
const lex = [...r.manifests.values()].filter(m => m.type === 'lexical').map(m => m.id);
out.traversalUs = +(t(i => { const a = r.get(lex[i % lex.length]); const lemma = a.relational.find(x => x.type === 'FORM_OF')?.target; const base = lemma ? r.get(lemma) : a; for (const s of base?.semantic?.senses || []) r.get(s); }, 100000) * 1000).toFixed(3);
// Knowledge update propagation between registries (merge of 500 atoms).
const a = new AtomRegistry({ node: 'A' }), b = new AtomRegistry({ node: 'B' }); for (let i = 0; i < 500; i++) a.discover('propword' + i, { lang: 'en' });
const exp = a.exportAtoms([...a.manifests.keys()].filter(k => k.includes('propword'))); out.propagate500Ms = +t(() => b.merge(exp), 1).toFixed(2);
// Serialization.
const recs = [...r.manifests.values()].slice(0, 1000).map(m => r.revisions.get(m.head));
out.bytesJson1000 = Buffer.byteLength(JSON.stringify(recs)); out.bytesMsgpack1000 = encode(recs).length; out.bytesPacked1000 = pack(recs).length;
// Distributed storage: commit throughput, retrieval latency, recovery time (in-memory transport, 8 nodes).
let clock = 0; const T = new InMemoryTransport(); for (let i = 0; i < 8; i++) T.add('N' + i, 'd' + i);
const E = id => new PreservationEngine({ self: id, transport: T, now: () => clock }), A = E('N0'); await A.heartbeat();
const all = [...r.manifests.values()].map(m => ({ id: m.id, rev: m.head, dna: r.revisions.get(m.head) }));
let segs = 0; out.commitMs = +(await at(async () => { for (let i = 0; i < all.length; i += 200) { await A.commit(all.slice(i, i + 200)); segs++; } })).toFixed(1); out.atomsCommitted = all.length; out.segments = segs;
out.metaOpsPerSec = Math.round(500 / ((await at(async () => { for (let i = 0; i < 500; i++) await A.metaRead('idx:' + (i % 256).toString(16).padStart(2, '0'), { quiet: true }); })) / 1000));
const B = E('N4'); out.retrieveMs = +((await at(async () => { for (let i = 0; i < 200; i++) await B.getAtom(all[(i * 97) % all.length].id); })) / 200).toFixed(3);
let phys = 0, meta = 0; for (const n of T.nodes.values()) { phys += n.store.bytes(); meta += n.store.metaBytes(); }
out.logicalJsonBytes = Buffer.byteLength(JSON.stringify(all.map(x => x.dna))); out.physicalBytes = phys; out.metadataBytes = meta; out.fullReplicationBytes = out.logicalJsonBytes * 8;
T.kill('N1'); T.kill('N2'); clock += 120000; const R = E('N3'); out.segmentsRepaired = 0; out.repairRuns = 0;
out.recoveryMs = +(await at(async () => { for (let k = 0; k < 5; k++) { const rep = await R.repair(); out.repairRuns++; if (k === 0) out.segmentsDegraded = rep.degraded; out.segmentsRepaired += rep.results.filter(x => x.outcome === 'restored').length; if (!rep.deferred) break; } })).toFixed(1); // bounded runs (backpressure: ≤64 repairs per run)
const after = await R.repair(); out.degradedAfterRecovery = after.degraded;
// Reasoning: IS_A classification over the concept taxonomy.
const { classify } = await import('../lib/atoms/reasoning.mjs'); out.classifyUs = +(t(i => classify(r, i % 2 ? 'python' : 'bank', i % 2 ? 'animal' : 'organization'), 5000) * 1000).toFixed(2);
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, ...out }, null, 2));
