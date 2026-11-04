// Atom registry: stable logical ids → versioned manifests → immutable, content-addressed DNA revisions.
// Reuse is guaranteed by deterministic ids; history is never destroyed; untrusted contributions cannot
// overwrite curated or verified knowledge (they are quarantined or kept as disputed alternatives).
import { blankDNA, checkDNA, ids, norm, TRUST_RANK, validateRelation } from './schema.mjs';
import { contentHash, pack, unpack } from './codec.mjs';
import * as L from './lexicon-en.mjs';

const GENESIS = '2026-01-01T00:00:00.000Z', GENESIS_VERSION = 4;
const slug = s => String(s).toLowerCase().replace(/\s+/g, '-');
const clone = x => structuredClone(x);

// English inflection (regular rules + irregular table).
export function inflect(lemma) {
  const irr = L.IRREGULAR[lemma], vowel = /[aeiou]/, cvc = /^[^aeiou]*[aeiou][^aeiouwxy]$/;
  const ing = lemma.endsWith('ie') ? lemma.slice(0, -2) + 'ying' : /[^e]e$/.test(lemma) && lemma !== 'be' ? lemma.slice(0, -1) + 'ing' : cvc.test(lemma) && lemma.length <= 4 ? lemma + lemma.at(-1) + 'ing' : lemma + 'ing';
  const s = /(s|sh|ch|x|z|o)$/.test(lemma) ? lemma + 'es' : /[^aeiou]y$/.test(lemma) ? lemma.slice(0, -1) + 'ies' : lemma + 's';
  const ed = lemma.endsWith('e') ? lemma + 'd' : /[^aeiou]y$/.test(lemma) ? lemma.slice(0, -1) + 'ied' : cvc.test(lemma) && lemma.length <= 4 && vowel.test(lemma) ? lemma + lemma.at(-1) + 'ed' : lemma + 'ed';
  return { base: lemma, thirdSingular: s, presentParticiple: ing, past: irr ? irr[0].split('|')[0] : ed, pastParticiple: irr ? irr[1].split('|')[0] : ed };
}
export const pluralOf = n => /(s|sh|ch|x|z)$/.test(n) ? n + 'es' : /[^aeiou]y$/.test(n) ? n.slice(0, -1) + 'ies' : n + 's';

export class AtomRegistry {
  constructor({ node = 'local', seed = true } = {}) {
    this.node = node; this.manifests = new Map(); this.revisions = new Map(); this.formIndex = new Map(); this.audit = []; this.stats = { created: 0, reused: 0, quarantined: 0, revisions: 0 }; this.genesisVersion = 0; this.idioms = []; this.usage = new Map(); this.ngrams = new Map(); this.ngramTotal = 0; this.checkedNgrams = new Set();
    if (seed) this.seedEnglish();
  }
  // ---------- core storage ----------
  put(dna, { node = this.node, reason = 'create', trust = dna.identity.validation } = {}) {
    checkDNA(dna); const id = dna.identity.id, rev = contentHash(dna);
    if (!this.revisions.has(rev)) { this.revisions.set(rev, dna); this.stats.revisions++; }
    let m = this.manifests.get(id);
    if (!m) { m = { id, type: dna.identity.type, head: rev, history: [rev], createdBy: node, createdAt: dna.identity.createdAt, durability: 'PROVISIONAL', quarantined: [], alternatives: [] }; this.manifests.set(id, m); this.stats.created++; this.index(dna); }
    else if (m.head !== rev && !m.history.includes(rev)) { m.history.push(rev); m.head = rev; if (m.durability === 'COMMITTED') m.durability = 'PENDING_DURABILITY'; }
    this._seeding?.add(id);
    this.audit.push({ at: new Date().toISOString(), id, rev, node, reason, trust }); if (this.audit.length > 2000) this.audit.splice(0, 500);
    return { id, rev };
  }
  // Live learning (v1.4): a revision can be STAGED (stored, content-addressed, durable with the registry) without
  // becoming visible, then ACTIVATED atomically by the knowledge ledger after validation, persistence and indexing.
  stage(dna) { checkDNA(dna); const rev = contentHash(dna); if (!this.revisions.has(rev)) { this.revisions.set(rev, dna); this.stats.revisions++; } return rev; }
  activate(id, rev, { node = this.node, reason = 'live-activation', trust = null } = {}) {
    const dna = this.revisions.get(rev); if (!dna || dna.identity.id !== id) throw new Error('activate: revision not staged for ' + id);
    let m = this.manifests.get(id), prev = m?.head || null;
    if (!m) { m = { id, type: dna.identity.type, head: rev, history: [rev], createdBy: node, createdAt: dna.identity.createdAt, durability: 'PROVISIONAL', quarantined: [], alternatives: [] }; this.manifests.set(id, m); this.stats.created++; }
    else { if (!m.history.includes(rev)) m.history.push(rev); m.head = rev; if (m.durability === 'COMMITTED' || m.durability === 'COMMITTED-GENESIS') m.durability = 'PENDING_DURABILITY'; }
    this.index(dna); if (dna.identity.type === 'phrase' || dna.identity.type === 'sentence') this.indexIdioms();
    this.audit.push({ at: new Date().toISOString(), id, rev, node, reason, trust: trust || dna.identity.validation }); if (this.audit.length > 2000) this.audit.splice(0, 500);
    return prev;
  }
  index(dna) { const f = dna.identity.normalized, k = `${dna.identity.language}:${f}`; if (dna.identity.type === 'lexical') { if (!this.formIndex.has(k)) this.formIndex.set(k, new Set()); this.formIndex.get(k).add(dna.identity.id); } }
  has(id) { return this.manifests.has(id); }
  get(id) { const m = this.manifests.get(id); return m ? this.revisions.get(m.head) : null; }
  manifest(id) { return this.manifests.get(id) || null; }
  history(id) { return (this.manifests.get(id)?.history || []).map(r => ({ rev: r, dna: this.revisions.get(r) })); }
  lookup(form, lang = 'en') { return [...(this.formIndex.get(`${lang}:${norm(form)}`) || [])].map(id => this.get(id)); }
  // ---------- creation & discovery ----------
  ensure(dna, opts) { if (this.manifests.has(dna.identity.id)) { this.stats.reused++; return this.get(dna.identity.id); } this.put(dna, opts); return dna; }
  // An unknown word becomes a provisional atom: recognised form, NO invented meaning.
  discover(form, { lang = 'und', guess = null, node = this.node, context = null } = {}) {
    const id = ids.lexical(lang, form);
    if (this.manifests.has(id)) { this.stats.reused++; return { dna: this.get(id), created: false }; }
    const d = blankDNA({ id, type: 'lexical', canonical: form, language: lang, originNode: node, at: new Date().toISOString() });
    d.linguistic = guess ? { pos: guess.pos, posSource: 'morphological-guess', lemma: guess.lemma, morphology: guess.morphology || {} } : {};
    d.semantic = { senses: [], meaningStatus: 'unknown' };
    d.epistemic = { evidence: context ? [{ source: 'observed-usage', example: String(context).slice(0, 200), at: new Date().toISOString(), reliability: 0.3 }] : [], verification: 'unverified', confidence: 0.05, contradictions: [], uncertainty: ['meaning unknown', ...(guess ? ['part of speech guessed from morphology'] : ['part of speech unknown'])], lastValidated: null, limitations: ['Newly discovered word; no verified meaning yet.'] };
    if (guess?.lemma && guess.lemma !== norm(form)) { const t = ids.lexical(lang, guess.lemma); if (this.manifests.has(t)) d.relational.push({ type: 'FORM_OF', target: t, confidence: 0.6, source: 'morphology' }); }
    this.put(d, { node, reason: 'discovered' }); return { dna: d, created: true };
  }
  // ---------- evolution with validation ----------
  propose(id, patch, { node = this.node, trust = 'provisional', source = 'unknown', evidence = [] } = {}) {
    const head = this.get(id); if (!head) throw new Error('Unknown atom ' + id);
    const next = clone(head), headRank = TRUST_RANK[head.identity.validation] ?? 0, rank = TRUST_RANK[trust] ?? 0;
    const changesMeaning = patch.semantic && (JSON.stringify(patch.semantic.senses || head.semantic.senses) !== JSON.stringify(head.semantic.senses) || patch.semantic.definitions) || (patch.linguistic?.pos && head.linguistic.pos && patch.linguistic.pos !== head.linguistic.pos && head.linguistic.posSource !== 'morphological-guess');
    // Poisoning resistance: lower-trust sources may enrich, but never rewrite established meaning.
    if (changesMeaning && headRank >= TRUST_RANK.corroborated && rank < headRank) {
      const alt = { patch, node, source, trust, at: new Date().toISOString(), status: 'quarantined', reason: `Conflicts with ${head.identity.validation} meaning; submitted by ${trust} source` };
      const m = this.manifests.get(id); m.quarantined.push(alt); m.quarantined = m.quarantined.slice(-50); this.stats.quarantined++;
      this.audit.push({ at: alt.at, id, node, reason: 'quarantined-contribution', trust }); return { status: 'quarantined', reason: alt.reason };
    }
    for (const k of ['linguistic', 'semantic', 'functional']) if (patch[k]) next[k] = { ...next[k], ...patch[k] };
    if (patch.relational) for (const r of patch.relational) { validateRelation(r.type, head.identity.type, r.targetType || 'sense'); if (!next.relational.some(x => x.type === r.type && x.target === r.target)) next.relational.push({ type: r.type, target: r.target, confidence: r.confidence ?? 0.5, source }); }
    next.epistemic.evidence = [...next.epistemic.evidence, ...evidence.map(e => ({ ...e, node, at: new Date().toISOString() }))].slice(-40);
    if (changesMeaning && headRank > rank) { next.epistemic.contradictions.push({ by: node, source, at: new Date().toISOString() }); }
    if (rank > headRank) { next.identity.validation = trust; next.epistemic.verification = trust; }
    next.epistemic.confidence = Math.min(1, Math.max(next.epistemic.confidence, { curated: 0.95, verified: 0.85, corroborated: 0.7, provisional: 0.35 }[trust] || 0.1));
    next.identity.knowledgeVersion = (head.identity.knowledgeVersion || 1) + 1; next.identity.provenance = [...head.identity.provenance, { node, source, trust, at: new Date().toISOString() }].slice(-40);
    const r = this.put(next, { node, reason: 'evolved', trust }); return { status: 'accepted', ...r };
  }
  // ---------- corroboration (multi-source validation) ----------
  // A provisional meaning becomes CORROBORATED only when enough independent nodes agree on it
  // (part of speech, lemma and the broader categories of its senses); persistent disagreement makes it DISPUTED.
  meaningSummary(dna) {
    if (!dna) return null; const sem = dna.semantic || {}, hyp = new Set();
    for (const sid of sem.senses || []) { const sd = this.get(sid); for (const h of sd?.semantic?.hypernyms || []) if (h) hyp.add(norm(h)); }
    for (const h of sem.hypernyms || []) if (h) hyp.add(norm(h));
    return { pos: dna.linguistic?.pos || null, lemma: norm(dna.linguistic?.lemma || dna.identity.canonical), hypernyms: [...hyp].sort(), known: !!(sem.senses?.length || sem.definition) };
  }
  static agree(a, b) { if (!a?.known || !b?.known) return false; if (a.pos && b.pos && a.pos !== b.pos) return false; if (a.lemma !== b.lemma) return false; return !a.hypernyms.length || !b.hypernyms.length || a.hypernyms.some(h => b.hypernyms.includes(h)); }
  endorse(id, { from, agrees, quorum = 2, evidence = null } = {}) {
    const m = this.manifests.get(id), head = this.get(id); if (!m || !head || !from) return { status: 'unknown-atom' };
    const c = m.corroboration ||= { agree: [], disagree: [] }, origin = head.identity.originNode;
    if (!c.agree.length && origin && origin !== 'genesis') c.agree.push(origin); // the proposer counts once
    const list = agrees ? c.agree : c.disagree; if (!list.includes(from)) list.push(from); if (agrees) c.disagree = c.disagree.filter(x => x !== from); else c.agree = c.agree.filter(x => x !== from || x === origin);
    if (evidence) (c.evidence ||= []).push({ from, agrees, ...evidence, at: new Date().toISOString() }); if (c.evidence) c.evidence = c.evidence.slice(-20);
    const rank = TRUST_RANK[head.identity.validation] ?? 0;
    if (c.agree.length >= quorum && c.agree.length > c.disagree.length && rank < TRUST_RANK.corroborated) {
      const next = clone(head); next.identity.validation = 'corroborated'; next.epistemic.verification = 'corroborated'; next.epistemic.confidence = Math.max(next.epistemic.confidence, 0.7);
      next.epistemic.corroboratedBy = [...c.agree].sort(); next.identity.knowledgeVersion = (head.identity.knowledgeVersion || 1) + 1; next.identity.provenance = [...head.identity.provenance, { source: 'corroboration', nodes: [...c.agree].sort() }].slice(-40);
      this.put(next, { node: this.node, reason: 'corroborated', trust: 'corroborated' }); return { status: 'corroborated', agree: c.agree.length, disagree: c.disagree.length };
    }
    if (c.disagree.length >= quorum && c.disagree.length >= c.agree.length && rank <= TRUST_RANK.provisional && head.identity.validation !== 'disputed') {
      const next = clone(head); next.identity.validation = 'disputed'; next.epistemic.verification = 'disputed'; next.epistemic.confidence = Math.min(next.epistemic.confidence, 0.2);
      next.epistemic.contradictions = [...next.epistemic.contradictions, { by: [...c.disagree].sort(), reason: 'independent sources disagree' }].slice(-20); next.identity.knowledgeVersion = (head.identity.knowledgeVersion || 1) + 1;
      this.put(next, { node: this.node, reason: 'disputed', trust: 'disputed' }); return { status: 'disputed', agree: c.agree.length, disagree: c.disagree.length };
    }
    return { status: 'recorded', agree: c.agree.length, disagree: c.disagree.length };
  }
  // ---------- observed usage (evolving, evidence-based DNA without inventing meaning) ----------
  // Every encounter of a word records where and how it was used: example contexts, grammatical roles, neighbouring
  // words and surface forms. This lives in a light mutable layer and is consolidated into a NEW DNA revision when the
  // evidence grows (2, 5, 10, 25, 50, 100, … uses), so history stays meaningful and revisions stay bounded.
  observe(id, { context = null, role = null, collocates = [], surface = null, source = 'user' } = {}) {
    if (!this.manifests.has(id)) return null; const now = new Date().toISOString();
    const u = this.usage.get(id) || { count: 0, firstSeen: now, lastSeen: now, contexts: [], roles: {}, collocates: {}, forms: {}, sources: {}, consolidatedAt: 0 };
    u.count++; u.lastSeen = now; if (role) u.roles[role] = (u.roles[role] || 0) + 1; if (surface) u.forms[surface] = (u.forms[surface] || 0) + 1; u.sources[source] = (u.sources[source] || 0) + 1;
    if (context && !u.contexts.includes(context)) { u.contexts.push(String(context).slice(0, 160)); if (u.contexts.length > 8) u.contexts.shift(); }
    for (const c of collocates) if (c && c !== id) u.collocates[c] = (u.collocates[c] || 0) + 1;
    const keys = Object.keys(u.collocates); if (keys.length > 60) for (const k of keys.sort((a, b) => u.collocates[a] - u.collocates[b]).slice(0, keys.length - 40)) delete u.collocates[k];
    this.usage.set(id, u); if (this.usage.size > 60000) this.usage.delete(this.usage.keys().next().value);
    return u;
  }
  static milestone(n) { return [2, 5, 10, 25, 50, 100, 250, 500, 1000].includes(n) || (n > 1000 && n % 1000 === 0); }
  consolidate(id, { node = this.node, force = false } = {}) {
    const u = this.usage.get(id), head = this.get(id); if (!u || !head || (!force && u.count === u.consolidatedAt)) return null;
    const next = clone(head), top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    next.functional = { ...next.functional, observedUsage: { uses: u.count, firstSeen: u.firstSeen, lastSeen: u.lastSeen, roles: Object.fromEntries(top(u.roles, 6)), forms: Object.fromEntries(top(u.forms, 6)), examples: u.contexts.slice(-5), sources: u.sources } };
    // Co-occurrence links: RELATED_TO edges to words that repeatedly appear next to this one (evidence: counts).
    const related = top(u.collocates, 8).filter(([c, n]) => n >= 3 && this.has(c) && c.startsWith('lex:'));
    for (const [c, n] of related) { const conf = +Math.min(0.5, n / Math.max(u.count, 1)).toFixed(2), e = next.relational.find(x => x.type === 'RELATED_TO' && x.target === c); if (e) { e.confidence = conf; e.observed = n; } else next.relational.push({ type: 'RELATED_TO', target: c, confidence: conf, source: 'co-occurrence', observed: n }); }
    next.epistemic = { ...next.epistemic, evidence: [...(next.epistemic.evidence || []).filter(e => e.source !== 'observed-usage'), { source: 'observed-usage', uses: u.count, examples: u.contexts.length, reliability: 0.3 }].slice(-40) };
    next.identity.knowledgeVersion = (head.identity.knowledgeVersion || 1) + 1;
    u.consolidatedAt = u.count; this.put(next, { node, reason: 'usage-consolidation', trust: head.identity.validation }); return next;
  }
  // N-gram statistics for discovering multi-word expressions (compounds, idioms, phrasal verbs, fixed sentences).
  countNgrams(norms, { sentence = null } = {}) {
    const bump = (k, ex) => { const g = this.ngrams.get(k) || { n: 0, ex: null }; g.n++; if (!g.ex && ex) g.ex = String(ex).slice(0, 160); this.ngrams.set(k, g); if (this.ngrams.size > 25000) this.ngrams.delete(this.ngrams.keys().next().value); };
    this.ngramTotal += norms.length;
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= norms.length; i++) bump(norms.slice(i, i + n).join(' '), sentence);
    if (sentence && norms.length >= 3 && norms.length <= 10) bump('S:' + norms.join(' '), sentence);
  }
  expressionCandidates({ min = 2, limit = 20, isContent = () => true } = {}) {
    const uni = w => this.usage.get(`lex:en:${w}`)?.count || 1, N = Math.max(this.ngramTotal, 1), out = [];
    for (const [k, g] of this.ngrams) {
      if (g.n < min || this.checkedNgrams.has(k)) continue;
      const sentence = k.startsWith('S:'), words = (sentence ? k.slice(2) : k).split(' '); if (!words.some(isContent)) continue;
      const pmi = words.length === 2 && !sentence ? Math.log2((N * g.n) / (uni(words[0]) * uni(words[1]))) : null;
      if (!sentence && words.length === 2 && pmi < 3) continue;
      if (!sentence && words.length > 2 && g.n < min + 1) continue;
      out.push({ key: k, phrase: words.join(' '), words, sentence, count: g.n, pmi: pmi == null ? null : +pmi.toFixed(2), example: g.ex });
    }
    return out.sort((a, b) => (b.count + (b.pmi || 0)) - (a.count + (a.pmi || 0))).slice(0, limit);
  }
  rollback(id, rev) { const m = this.manifests.get(id); if (!m?.history.includes(rev)) throw new Error('Unknown revision'); m.head = rev; this.audit.push({ at: new Date().toISOString(), id, rev, reason: 'rollback' }); return this.get(id); }
  // ---------- reconciliation (partitions, concurrent creation) ----------
  exportAtoms(idsList) { const out = []; for (const id of idsList) { const m = this.manifests.get(id); if (m) out.push({ manifest: clone(m), revisions: m.history.map(r => [r, this.revisions.get(r)]) }); } return out; }
  merge(records, { from = 'peer', trust = 'provisional' } = {}) {
    let merged = 0, quarantined = 0;
    for (const { manifest, revisions } of records) {
      for (const [r, dna] of revisions) { try { checkDNA(dna); if (contentHash(dna) !== r) continue; } catch { continue; } if (!this.revisions.has(r)) this.revisions.set(r, dna); }
      const mine = this.manifests.get(manifest.id), theirsHead = this.revisions.get(manifest.head);
      if (!theirsHead) continue;
      if (!mine) {
        // A brand-new atom from an untrusted peer cannot arrive as authoritative.
        const d = (TRUST_RANK[theirsHead.identity.validation] ?? 0) > (TRUST_RANK[trust] ?? 0) && !['curated'].includes(theirsHead.identity.validation) ? { ...clone(theirsHead), identity: { ...theirsHead.identity, validation: trust } } : theirsHead;
        this.put(d, { node: from, reason: 'merged-new' }); merged++; continue;
      }
      const heads = [mine.head, ...manifest.history.filter(r => !mine.history.includes(r) && this.revisions.has(r))];
      for (const r of manifest.history) if (this.revisions.has(r) && !mine.history.includes(r)) mine.history.push(r);
      // Deterministic convergence: highest validation, then knowledge version, then hash.
      const best = heads.map(r => ({ r, d: this.revisions.get(r) })).sort((a, b) => (TRUST_RANK[b.d.identity.validation] - TRUST_RANK[a.d.identity.validation]) || (b.d.identity.knowledgeVersion - a.d.identity.knowledgeVersion) || a.r.localeCompare(b.r))[0];
      if (best.r !== mine.head) { const cur = this.revisions.get(mine.head); if ((TRUST_RANK[cur.identity.validation] ?? 0) >= TRUST_RANK.corroborated && TRUST_RANK[trust] < TRUST_RANK[cur.identity.validation] && JSON.stringify(best.d.semantic) !== JSON.stringify(cur.semantic)) { mine.quarantined.push({ rev: best.r, from, status: 'quarantined', at: new Date().toISOString() }); quarantined++; } else { mine.head = best.r; merged++; } }
    }
    return { merged, quarantined };
  }
  // ---------- persistence ----------
  serialize() { return pack({ v: 1, genesis: this.genesisVersion, usage: [...this.usage.entries()].slice(-50000), ngrams: [...this.ngrams.entries()].slice(-20000), ngramTotal: this.ngramTotal, checked: [...this.checkedNgrams].slice(-20000), node: this.node, manifests: [...this.manifests.values()], revisions: [...this.revisions.entries()], stats: this.stats }); }
  static deserialize(buf, opts = {}) { const d = unpack(buf), r = new AtomRegistry({ ...opts, seed: false }); r.node = opts.node || d.node; for (const [k, v] of d.revisions) r.revisions.set(k, v); for (const m of d.manifests) { r.manifests.set(m.id, m); r.index(r.revisions.get(m.head)); } r.stats = d.stats; r.usage = new Map(d.usage || []); r.ngrams = new Map(d.ngrams || []); r.ngramTotal = d.ngramTotal || 0; r.checkedNgrams = new Set(d.checked || []); r.genesisVersion = d.genesis ?? (r.manifests.has('lex:en:i') ? 1 : 0); r.indexIdioms(); if (opts.seed !== false) r.seedEnglish(); return r; }
  summary() { const by = {}; for (const m of this.manifests.values()) by[m.type] = (by[m.type] || 0) + 1; const dur = {}; for (const m of this.manifests.values()) dur[m.durability] = (dur[m.durability] || 0) + 1; return { atoms: this.manifests.size, revisions: this.revisions.size, byType: by, durability: dur, ...this.stats }; }

  // ---------- genesis: curated English core ----------
  seedEnglish() {
    if (this.genesisVersion >= GENESIS_VERSION) return;
    // Idempotent and incremental: existing atoms are kept (history is never rewritten); new genesis knowledge is
    // added, and earlier discovered-but-unknown words that genesis now knows are upgraded as a new revision.
    this._seeding = new Set(); const reusedBefore = this.stats.reused;
    const src = { source: L.SOURCE.id, reliability: L.SOURCE.reliability, at: GENESIS };
    const lex = (form, ling, sem = {}, fn = {}, rel = []) => { const d = blankDNA({ id: ids.lexical('en', form), type: 'lexical', canonical: form, language: 'en', at: GENESIS }); d.identity.validation = 'curated'; d.identity.provenance = [{ source: L.SOURCE.id }]; d.linguistic = ling; d.semantic = { senses: [], ...sem }; d.functional = fn; d.relational = rel; d.epistemic = { evidence: [src], verification: 'curated', confidence: 0.95, contradictions: [], uncertainty: [], lastValidated: GENESIS, limitations: [] }; const cur = this.get(d.identity.id); if (cur && cur.semantic?.meaningStatus === 'unknown' && cur.identity.validation !== 'curated') this.put(d, { node: 'genesis', reason: 'genesis-knowledge-for-discovered-word', trust: 'curated' }); else this.ensure(d, { node: 'genesis', reason: 'seed' }); return d; };
    const sense = (lemma, s, pos) => { const d = blankDNA({ id: ids.sense('en', lemma, s.id), type: 'sense', canonical: `${lemma}#${s.id}`, language: 'en', at: GENESIS }); d.identity.validation = 'curated'; d.semantic = { definition: s.gloss, categories: [s.domain], hypernyms: [s.hypernym], disambiguation: s.signals || [], pos }; d.relational = [{ type: 'SENSE_OF', target: ids.lexical('en', lemma), confidence: 1 }]; d.epistemic = { evidence: [src], verification: 'curated', confidence: 0.9, contradictions: [], uncertainty: [], lastValidated: GENESIS, limitations: [] }; this.ensure(d, { node: 'genesis', reason: 'seed' }); return d.identity.id; };
    for (const [name, text] of Object.entries(L.RULES)) { const d = blankDNA({ id: ids.rule('en', name), type: 'rule', canonical: name, language: 'en', at: GENESIS }); d.identity.validation = 'curated'; d.semantic = { definition: text }; d.epistemic = { evidence: [src], verification: 'curated', confidence: 0.95, contradictions: [], uncertainty: [], lastValidated: GENESIS, limitations: [] }; this.ensure(d, { node: 'genesis', reason: 'seed' }); }
    const rule = n => ids.rule('en', n);
    for (const [f, person, number, kase, gender] of L.PRONOUNS) lex(f, { pos: 'pronoun', subtype: 'personal', lemma: f, morphology: { person, number, case: kase, ...(gender ? { gender } : {}) }, syntacticFunctions: kase.includes('nom') ? ['subject'] : kase.includes('acc') ? ['object', 'prepositional-object'] : ['determiner-like'] }, { referential: 'deictic-context-dependent', meaning: person === 1 ? (number === 'sg' ? 'the speaker or writer in the current discourse' : 'the speaker together with others') : person === 2 ? 'the addressee(s) in the current discourse' : 'a previously mentioned or contextually salient referent' }, { agreement: { person, number }, constraints: [rule('subject-verb-agreement')], examples: f === 'i' ? ['I am learning.', 'I am happy.'] : [] });
    for (const [f, [person, number]] of Object.entries(L.POSSESSIVE_DETERMINERS)) lex(f, { pos: 'determiner', subtype: 'possessive', lemma: f, morphology: { person, number } }, { referential: 'possessor-context-dependent' }, { constraints: [rule('determiner-noun')] });
    for (const [f, a] of Object.entries(L.AUX)) lex(f, { pos: 'verb', subtype: 'auxiliary', lemma: a.lemma, morphology: { tense: a.tense, person: a.person, number: a.number, form: a.form || 'finite' }, syntacticFunctions: a.lemma === 'be' ? ['copula', 'progressive-auxiliary', 'passive-auxiliary'] : a.lemma === 'have' ? ['perfect-auxiliary', 'main-verb'] : ['do-support', 'main-verb'] }, { senses: a.lemma === 'be' ? [ids.sense('en', 'be', 'exist-identity-state')] : [] }, { agreement: a.person ? { person: a.person, number: a.number } : null, constraints: [rule('subject-verb-agreement'), ...(a.lemma === 'be' ? [rule('copula-complement'), rule('progressive-aspect'), rule('passive-voice')] : a.lemma === 'have' ? [rule('perfect-aspect')] : [rule('do-support')])], examples: a.lemma === 'be' && f === 'am' ? ['I am happy.', 'I am a developer.', 'I am learning.'] : [] }, f !== a.lemma ? [{ type: 'FORM_OF', target: ids.lexical('en', a.lemma), confidence: 1 }] : []);
    sense('be', { id: 'exist-identity-state', gloss: 'to exist, to have an identity, quality or state, or (as auxiliary) to mark progressive or passive', domain: 'grammar', hypernym: 'state verb' }, 'verb');
    for (const [f, m] of Object.entries(L.MODALS)) lex(f, { pos: 'verb', subtype: 'modal', lemma: f, morphology: { form: 'finite' } }, { modality: m.split('|') }, { constraints: [rule('modal-base')] });
    for (const [f, t] of Object.entries(L.DETERMINERS)) lex(f, { pos: f === 'a' || f === 'an' || f === 'the' ? 'article' : 'determiner', subtype: t, lemma: f }, {}, { constraints: [rule('determiner-noun')], ...(f === 'an' ? { restrictions: ['precedes a vowel sound'] } : f === 'a' ? { restrictions: ['precedes a consonant sound'] } : {}) });
    for (const [f, rel] of Object.entries(L.PREPOSITIONS)) lex(f, { pos: 'preposition', lemma: f }, { relations: rel.split('|') }, { patterns: ['PREP NP'] });
    for (const [f, [kind, rel]] of Object.entries(L.CONJUNCTIONS)) if (this.free(f)) lex(f, { pos: kind === 'complementizer' ? 'complementizer' : 'conjunction', subtype: kind, lemma: f }, { relation: rel });
    for (const [f, q] of Object.entries(L.WH)) if (this.free(f)) lex(f, { pos: 'wh-word', lemma: f }, { asksFor: q });
    for (const f of L.NEGATORS) if (this.free(f)) lex(f, { pos: f === 'not' || f === 'never' ? 'adverb' : 'determiner', subtype: 'negation', lemma: f }, { polarity: 'negative' });
    for (const f of L.ADVERBS) if (this.free(f)) lex(f, { pos: 'adverb', lemma: f });
    for (const f of L.INTERJECTIONS) if (this.free(f)) lex(f, { pos: 'interjection', lemma: f });
    for (const [v, info] of Object.entries(L.VERBS)) {
      const forms = inflect(v), sid = sense(v, { id: 'main', gloss: info.gloss, domain: info.category, hypernym: info.category }, 'verb');
      lex(v, { pos: 'verb', lemma: v, morphology: { form: 'base' }, inflections: forms }, { senses: [sid], roles: info.frame }, { patterns: info.frame.some(r => /theme(?!\?)/.test(r)) ? ['SUBJ V OBJ'] : ['SUBJ V', 'SUBJ V OBJ'], constraints: [rule('subject-verb-agreement')] });
      const fm = { [forms.thirdSingular]: { tense: 'present', person: 3, number: 'sg', form: 'finite' }, [forms.presentParticiple]: { form: 'present-participle', aspect: 'progressive' }, [forms.pastParticiple]: { form: 'past-participle' } };
      fm[forms.past] = forms.past === forms.pastParticiple ? { tense: 'past', form: 'finite|past-participle' } : { tense: 'past', form: 'finite' };
      for (const [f, morph] of Object.entries(fm)) { if (f === v) continue; if (!this.free(f)) continue; lex(f, { pos: 'verb', lemma: v, morphology: morph }, { senses: [sid], roles: info.frame }, {}, [{ type: 'FORM_OF', target: ids.lexical('en', v), confidence: 1 }]); }
    }
    for (const [a, gloss] of Object.entries(L.ADJECTIVES)) { const sid = sense(a, { id: 'main', gloss, domain: 'quality', hypernym: 'property' }, 'adjective'); if (this.free(a)) lex(a, { pos: 'adjective', lemma: a }, { senses: [sid] }, { patterns: ['ADJ N', 'be ADJ'] }); }
    for (const [n, senses] of Object.entries(L.NOUNS)) {
      const sids = senses.map(s => sense(n, s, 'noun'));
      if (this.free(n)) lex(n, { pos: 'noun', lemma: n, morphology: { number: n === 'windows' ? 'pl' : 'sg' } }, { senses: sids }, { patterns: ['DET N', 'ADJ N'] });
      const pl = pluralOf(n); if (n !== 'windows' && n !== 'money' && n !== 'water' && this.free(pl)) lex(pl, { pos: 'noun', lemma: n, morphology: { number: 'pl' } }, { senses: sids }, {}, [{ type: 'FORM_OF', target: ids.lexical('en', n), confidence: 1 }]);
    }
    this.genesis2();
    for (const id of this._seeding) { const m = this.manifests.get(id); if (m && (m.createdBy === 'genesis' || m.durability === 'PROVISIONAL' || this.get(id).identity.originNode === 'genesis')) m.durability = 'COMMITTED-GENESIS'; } // rebuilt identically by every node
    this._seeding = null; this.stats.reused = reusedBefore; this.genesisVersion = GENESIS_VERSION; this.indexIdioms();
  }
  // Genesis 2: shared concept atoms (IS_A taxonomy), sense → concept links, idiom atoms.
  genesis2() {
    const src = { source: L.SOURCE.id, reliability: L.SOURCE.reliability, at: GENESIS }, epi = c => ({ evidence: [src], verification: 'curated', confidence: c, contradictions: [], uncertainty: [], lastValidated: GENESIS, limitations: [] });
    for (const [label, parent] of Object.entries(L.CONCEPTS)) {
      const d = blankDNA({ id: ids.concept('en', label), type: 'concept', canonical: label, language: 'en', at: GENESIS }); d.identity.validation = 'curated'; d.identity.provenance = [{ source: L.SOURCE.id }];
      d.semantic = { senses: [], label, lexicalizations: (L.NOUNS[label] || []).map(x => ids.sense('en', label, x.id)) };
      d.relational = parent ? [{ type: 'IS_A', target: ids.concept('en', parent), confidence: 1 }] : []; d.epistemic = epi(0.95); this.ensure(d, { node: 'genesis', reason: 'seed-concept' });
    }
    for (const [n, senses] of Object.entries(L.NOUNS)) for (const s of senses) {
      const id = ids.sense('en', n, s.id), cur = this.get(id); if (!cur || !L.CONCEPTS.hasOwnProperty(s.hypernym) || cur.relational.some(r => r.type === 'IS_A')) continue;
      const next = clone(cur); validateRelation('IS_A', 'sense', 'concept'); next.relational.push({ type: 'IS_A', target: ids.concept('en', s.hypernym), confidence: 1 }); next.identity.knowledgeVersion = Math.max(2, cur.identity.knowledgeVersion + 1);
      this.put(next, { node: 'genesis', reason: 'genesis-2: sense linked to shared concept', trust: 'curated' });
    }
    for (const [phrase, info] of Object.entries(L.IDIOMS)) {
      const words = phrase.split(' '), d = blankDNA({ id: ids.phrase('idiom:en:' + slug(phrase)), type: 'phrase', canonical: phrase, language: 'en', at: GENESIS }); d.identity.validation = 'curated'; d.identity.provenance = [{ source: L.SOURCE.id }];
      const verb = L.VERBS[words[0]] ? inflect(words[0]) : null;
      d.linguistic = { kind: 'idiom', words, firstWordForms: verb ? [...new Set([verb.base, verb.thirdSingular, verb.presentParticiple, verb.past, verb.pastParticiple])] : [words[0]], register: info.register };
      d.semantic = { senses: [], idiomatic: true, meaning: info.meaning, predicate: info.predicate, kind: info.kind || 'event', literalAlternative: true };
      d.functional = { constraints: [ids.rule('en', 'idiomatic-composition')] };
      d.relational = [...new Set(words)].filter(w => this.has(ids.lexical('en', w))).map(w => ({ type: 'RELATED_TO', target: ids.lexical('en', w), confidence: 1 })).concat([{ type: 'USES_RULE', target: ids.rule('en', 'idiomatic-composition'), confidence: 1 }]);
      d.epistemic = epi(0.9); this.ensure(d, { node: 'genesis', reason: 'seed-idiom' });
    }
  }
  free(form) { const d = this.get(ids.lexical('en', form)); return !d || (d.semantic?.meaningStatus === 'unknown' && d.identity.validation !== 'curated'); }
  indexIdioms() { this.idioms = [...this.manifests.values()].filter(m => (m.type === 'phrase' || m.type === 'sentence') && (m.id.startsWith('phr:idiom:') || m.id.startsWith('phr:mwe:'))).map(m => this.get(m.id)).filter(d => ['idiom', 'compound', 'phrasal-verb', 'proverb'].includes(d?.linguistic?.kind) && d.identity.validation !== 'disputed' && !d.semantic?.compositional); }
}
