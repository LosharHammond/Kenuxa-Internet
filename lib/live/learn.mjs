// Builders + validators for live learning events (v1.4): new word senses, knowledge corrections.
import { blankDNA, ids, norm } from '../atoms/schema.mjs';

const BAD = /(https?:\/\/|www\.|<\/?[a-z]+|ignore (all|previous|the above)|system prompt|javascript:)/i;
const words = t => new Set(norm(t).split(/\s+/).filter(w => w.length > 2));
const overlap = (a, b) => { const A = words(a), B = words(b); let i = 0; for (const x of A) if (B.has(x)) i++; return { shared: i, jaccard: A.size + B.size ? i / (A.size + B.size - i) : 0 }; };
const slug = s => norm(s).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 30) || 'sense';

// A new sense = a new sense atom + a new revision of the lexical atom listing it. Both activate together.
export function senseWrites(registry, { word, gloss, hypernym = '', domain = '', signals = [], pos = 'noun', lang = 'en', evidence = [], node = 'local', at = new Date().toISOString() }) {
  const lemma = norm(word), lexId = ids.lexical(lang, lemma), cur = registry.get(lexId);
  const sid = ids.sense(lang, lemma, slug(domain || hypernym || 'sense-' + ((cur?.semantic?.senses?.length || 0) + 1)));
  const sense = blankDNA({ id: sid, type: 'sense', canonical: `${lemma}#${sid.split('#')[1]}`, language: lang, originNode: node, at });
  sense.semantic = { definition: String(gloss).trim().slice(0, 300), categories: domain ? [domain] : [], hypernyms: hypernym ? [hypernym] : [], disambiguation: [...new Set(signals.map(norm).filter(Boolean))].slice(0, 16), pos };
  sense.relational = [{ type: 'SENSE_OF', target: lexId, confidence: 0.8 }];
  const origins = new Set(evidence.filter(e => e.kind !== 'teacher').map(e => (e.publisher || e.url || e.source || '').toLowerCase()));
  sense.identity.validation = origins.size >= 2 ? 'corroborated' : 'provisional';
  sense.epistemic = { evidence: evidence.slice(0, 8).map(e => ({ source: e.kind || 'source', url: e.url || null, publisher: e.publisher || null, passage: String(e.passage || '').slice(0, 300), reliability: e.kind === 'teacher' ? 0.3 : 0.7 })), verification: origins.size >= 2 ? 'corroborated' : 'evidence-supported', confidence: origins.size >= 2 ? 0.8 : 0.6, contradictions: [], uncertainty: origins.size >= 2 ? [] : ['single independent source'], lastValidated: at, limitations: [] };
  const lex = cur ? structuredClone(cur) : blankDNA({ id: lexId, type: 'lexical', canonical: lemma, language: lang, originNode: node, at });
  lex.semantic = { ...lex.semantic, senses: [...new Set([...(lex.semantic?.senses || []), sid])] };
  if (!lex.semantic.meaningStatus || lex.semantic.meaningStatus === 'unknown') lex.semantic.meaningStatus = 'evidence-supported';
  lex.identity.knowledgeVersion = (lex.identity.knowledgeVersion || 1) + 1;
  // Inflected forms ("banks") carry their own sense lists: they must gain the new sense in the same atomic change.
  const forms = [];
  for (const m of registry.manifests.values()) {
    if (m.type !== 'lexical' || m.id === lexId) continue; const f = registry.get(m.id);
    if (f && (f.linguistic?.lemma === lemma && f.identity.language === lang) && (f.relational || []).some(e => e.type === 'FORM_OF' && e.target === lexId)) {
      const nf = structuredClone(f); nf.semantic = { ...nf.semantic, senses: [...new Set([...(nf.semantic?.senses || []), sid])] }; nf.identity.knowledgeVersion = (nf.identity.knowledgeVersion || 1) + 1; forms.push({ id: m.id, value: nf, reason: 'form-sense-list' });
    }
  }
  return { senseId: sid, lexId, writes: [{ id: sid, value: sense, reason: 'new-sense' }, { id: lexId, value: lex, reason: 'sense-list' }, ...forms] };
}
export function validateSense(registry, { word, gloss, signals = [], evidence = [] }, { senseId } = {}) {
  const checks = [], lemma = norm(word), forms = new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`, 'i');
  checks.push({ name: 'gloss', ok: typeof gloss === 'string' && gloss.trim().length >= 8 && gloss.length <= 300 && !BAD.test(gloss), detail: 'a short plain-text definition is required' });
  checks.push({ name: 'signals', ok: signals.filter(s => norm(s)).length >= 2, detail: 'at least two context words that indicate this sense' });
  const direct = evidence.filter(e => e.kind !== 'teacher' && forms.test(e.passage || '') && (overlap(e.passage, gloss).shared >= 1 || signals.some(s => new RegExp(`\\b${norm(s)}`, 'i').test(e.passage || ''))));
  checks.push({ name: 'evidence', ok: direct.length >= 1, detail: direct.length ? `${direct.length} passage(s) use the word in this sense` : 'needs at least one non-teacher passage that uses the word in this sense (a teacher alone is not enough)' });
  checks.push({ name: 'safe-evidence', ok: evidence.every(e => !/<\/?script|javascript:/i.test(e.passage || '')), detail: 'evidence contains markup' });
  const existing = (registry.get(ids.lexical('en', lemma))?.semantic?.senses || []).filter(s => s !== senseId).map(id => registry.get(id)).filter(Boolean);
  const dup = existing.find(s => overlap(s.semantic?.definition || '', gloss).jaccard >= 0.6);
  checks.push({ name: 'distinct-sense', ok: !dup, detail: dup ? `duplicates existing sense ${dup.identity.id}` : 'distinct from existing senses' });
  if (senseId && registry.has(senseId)) checks.push({ name: 'new-id', ok: false, conflict: true, detail: `${senseId} already exists — this would change an existing sense; propose a correction instead` });
  return checks;
}
// Knowledge (M-atom) correction: validated like any claim — a correction needs evidence, not just a different opinion.
export function validateCorrection(atom, { answer, evidence = [], reason = '' }) {
  return [
    { name: 'target', ok: !!atom, detail: 'knowledge atom not found' },
    { name: 'answer', ok: typeof answer === 'string' && answer.trim().length >= 3 && answer.length <= 4000 && !BAD.test(answer), detail: 'a plain-text corrected answer is required' },
    { name: 'changed', ok: !!atom && String(answer).trim() !== String(atom.answer).trim(), detail: 'the correction is identical to the current answer' },
    { name: 'evidence', ok: evidence.some(e => e.kind !== 'teacher' && (e.url || e.passage)) || /owner-verified/.test(reason), detail: 'a correction needs a non-teacher source or an explicit owner verification' },
  ];
}
