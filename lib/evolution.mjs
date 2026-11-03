// Evolution Kernel — the autonomous loop that lets every node keep creating, modifying and growing
// its own atoms, molecules, cells, agents and experts without a person in the loop:
//   frontier → crawl → inspect → lifecycle → kernels/embeddings → semantic links → federation → train
// Long-running hosts call tick() on a timer; serverless hosts call it from a scheduled cron route.
import { cosine, b64ToVec } from './transformer/index.mjs';
import { features } from './model.mjs';

export class EvolutionKernel {
  constructor(ctx) { this.ctx = ctx; this.busy = false; ctx.state.evolution ??= { log: [], frontier: [], lastTick: null, ticks: 0 }; }
  get state() { return this.ctx.state; }
  // Grow the crawl frontier from what the graph already knows: topics of approved atoms become new sources.
  async expandFrontier(log) {
    const { state, discovery } = this.ctx, c = state.crawler, ev = state.evolution;
    if (!c?.enabled || c.sources.length >= 20) return;
    const explored = new Set(ev.frontier.map(f => f.topic));
    const topics = [...new Set(state.atoms.filter(a => a.status === 'approved').flatMap(a => [...a.tags, a.dna?.identity?.type === 'domain-atom' ? a.title.toLowerCase() : null]))]
      .filter(t => t && t.length > 2 && !['researched', 'explanation', 'procedure', 'comparison', 'web-learning'].includes(t) && !explored.has(t));
    const topic = topics[0]; if (!topic) return;
    ev.frontier.push({ topic, at: new Date().toISOString() }); ev.frontier = ev.frontier.slice(-200);
    try {
      const hit = (await discovery.search(topic))[0];
      if (hit && !c.sources.some(s => s.url === hit.url)) { c.sources.push({ url: hit.url, lastHash: null, lastFetched: null, error: null, discoveredFrom: topic }); log.push(`Frontier: “${topic}” → ${hit.url}`); }
    } catch (e) { log.push(`Frontier search for “${topic}” failed: ${e.message}`); }
  }
  semanticLinks(log) {
    const { state, transformer, env } = this.ctx; const min = Number(env.TRANSFORMER_MIN_STEPS_FOR_LINKS || 2000);
    if (!transformer || transformer.step < min) return; // embeddings of an untrained model are not meaningful
    const atoms = state.atoms.filter(a => a.status === 'approved' && a.dna?.embedding?.vector), vecs = atoms.map(a => b64ToVec(a.dna.embedding.vector));
    let made = 0;
    atoms.forEach((a, i) => {
      const scored = atoms.map((b, j) => ({ b, s: i === j ? -1 : cosine(vecs[i], vecs[j]) })).sort((x, y) => y.s - x.s).slice(0, 3).filter(x => x.s > 0.8);
      a.dna.semanticLinks = scored.map(x => ({ predicate: 'similar-meaning', target: x.b.id, score: Math.round(x.s * 1000) / 1000, by: transformer.status().profile + '@' + transformer.step })); made += scored.length;
    });
    if (made) log.push(`Semantic layer: ${made} similar-meaning links from transformer embeddings`);
  }
  async growKernels(log, max) {
    const { state, transformer } = this.ctx; if (!transformer?.enabled || max <= 0) return;
    const due = state.atoms.filter(a => a.status === 'approved' && (!a.dna.kernel?.prefix || a.dna.kernel.dnaRevision !== a.dna.evolution.revision))
      .sort((x, y) => (x.dna.kernel?.grownAt || '').localeCompare(y.dna.kernel?.grownAt || '')).slice(0, max);
    for (const a of due) { await transformer.growKernel(a, { steps: 4 }); a.dna.kernel.dnaRevision = a.dna.evolution.revision; log.push(`${a.title}: kernel and embedding grew from DNA r${a.dna.evolution.revision}`); }
  }
  async tick({ serverless = false, budgetMs = serverless ? 8000 : 60000 } = {}) {
    if (this.busy) return { busy: true }; this.busy = true;
    const { state, crawler, sync, discoverPeers, transformer, save, event } = this.ctx, log = [], start = Date.now(), left = () => budgetMs - (Date.now() - start);
    try {
      await this.expandFrontier(log);
      const c = state.crawler, due = c?.enabled && !crawler.busy && (serverless || Date.now() >= new Date(c.nextRun || 0).getTime());
      if (due && left() > 4000) { const prev = c.maxPagesPerCycle; if (serverless) c.maxPagesPerCycle = 1; try { const r = await crawler.cycle(); log.push(`Crawl: ${(r.results || []).map(x => x.status || x.error || 'done').join(', ') || 'no sources due'}`); } finally { c.maxPagesPerCycle = prev; } }
      if (left() > 3000) await this.growKernels(log, serverless ? 0 : 1);
      this.semanticLinks(log);
      if (left() > 3000) { try { const d = await discoverPeers(); if (d.added) log.push(`Discovery: ${d.added} new peer(s)`); } catch (e) { log.push('Discovery failed: ' + e.message); } }
      if (left() > 3000) { const s = await sync(); if (s.peers) log.push(`Federation: ${s.peers.filter(p => p.ok).length}/${s.peers.length} peers synced, ${s.peers.reduce((n, p) => n + (p.imported || 0), 0)} atoms received`); }
      if (transformer?.enabled) { if (serverless && left() > 4000 && process.env.TRANSFORMER_SERVERLESS_TRAINING === 'true') { const t = await transformer.trainSync(state, 1); log.push(`Transformer step ${t?.step}`); } else transformer.mergeComposites(state); }
      const counts = { atoms: state.atoms.length, approved: state.atoms.filter(a => a.status === 'approved').length, molecules: state.organism?.molecules?.length || 0, cells: state.organism?.cells?.length || 0, stages: state.atoms.reduce((m, a) => (m[a.dna?.evolution?.stage || 'local'] = (m[a.dna?.evolution?.stage || 'local'] || 0) + 1, m), {}) };
      const entry = { at: new Date().toISOString(), ms: Date.now() - start, actions: log, counts };
      state.evolution.log.unshift(entry); state.evolution.log = state.evolution.log.slice(0, 100); state.evolution.lastTick = entry.at; state.evolution.ticks++;
      if (log.length) event('evolution', log.slice(0, 3).join(' · '));
      await save(); return entry;
    } finally { this.busy = false; }
  }
}
export function topicTerms(text) { return features(text); }
