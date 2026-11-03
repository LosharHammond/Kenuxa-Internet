// KENUXA language pipeline:
// input → tokenization (Unicode/ICU, language-aware) → atom resolution (reuse or discovery) →
// tagging → syntactic analysis → semantic composition → sense disambiguation → discourse/coreference.
// Rule-based and transparent. It builds structure from atoms + grammar; it does not claim full
// human-level understanding, and anything unresolved is reported as ambiguity or unknown.
import { ids, norm } from './schema.mjs';
import { contentHash } from './codec.mjs';
import * as L from './lexicon-en.mjs';

// ---------- language identification & tokenization ----------
const SCRIPTS = [['zh', /\p{Script=Han}/u], ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['th', /\p{Script=Thai}/u], ['ar', /\p{Script=Arabic}/u], ['ru', /\p{Script=Cyrillic}/u], ['ko', /\p{Script=Hangul}/u], ['hi', /\p{Script=Devanagari}/u], ['el', /\p{Script=Greek}/u], ['he', /\p{Script=Hebrew}/u]];
export function detectLanguage(text, registry) {
  const counts = {}; for (const ch of text) for (const [lang, re] of SCRIPTS) if (re.test(ch)) counts[lang] = (counts[lang] || 0) + 1;
  if (counts.ja) return 'ja'; const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; if (best) return best[0];
  const words = text.toLowerCase().match(/\p{L}+/gu) || []; if (!words.length) return 'und';
  const known = registry ? words.filter(w => registry.has(ids.lexical('en', w))).length : 0;
  const FUNCTION = /^(the|a|an|is|are|was|were|am|be|of|and|or|to|in|on|i|you|he|she|it|we|they|this|that|not|do|does|did|have|has|what|how|why|who)$/;
  return !registry || known / words.length >= 0.3 || words.length <= 2 || words.some(w => FUNCTION.test(w)) ? 'en' : 'und-Latn';
}
const PUNCT_FUNCTION = { '.': 'declarative-terminator', '?': 'interrogative-terminator', '!': 'exclamative-terminator', ',': 'separator', ';': 'clause-separator', ':': 'introducer', '"': 'quotation', "'": 'quotation|apostrophe', '(': 'open-parenthesis', ')': 'close-parenthesis', '-': 'hyphen|minus', '—': 'dash', '…': 'ellipsis', '。': 'declarative-terminator', '？': 'interrogative-terminator', '！': 'exclamative-terminator', '，': 'separator', '+': 'plus-operator', '=': 'equals-operator', '*': 'multiply-operator', '/': 'divide-operator|slash', '%': 'percent', '&': 'ampersand', '@': 'at-sign', '#': 'number-sign', '$': 'currency', '€': 'currency', '£': 'currency', '₵': 'currency' };
export function tokenize(text, lang = 'en') {
  const seg = new Intl.Segmenter(lang.split('-')[0] === 'und' ? 'en' : lang, { granularity: 'word' }), out = [];
  for (const s of seg.segment(String(text).normalize('NFC'))) {
    if (/^\s+$/u.test(s.segment)) continue;
    const t = s.segment;
    if (/^\p{N}[\p{N}.,]*$/u.test(t)) { out.push({ text: t, norm: t.replace(/,/g, ''), kind: 'number', index: s.index }); continue; }
    if (!s.isWordLike) { for (const ch of t) out.push({ text: ch, norm: ch, kind: /\p{P}/u.test(ch) ? 'punctuation' : 'symbol', index: s.index }); continue; }
    const low = norm(t);
    if (lang === 'en' && L.CONTRACTIONS[low] && Array.isArray(L.CONTRACTIONS[low])) { for (const p of L.CONTRACTIONS[low]) out.push({ text: p === low ? t : p, surface: t, norm: p, kind: 'word', index: s.index, contraction: true }); continue; }
    const m = lang === 'en' && low.match(/^(.+?)('m|'re|'s|'ve|'d|'ll|n't)$/);
    if (m) { out.push({ text: m[1], norm: m[1], kind: 'word', index: s.index, surface: t }); out.push({ text: m[2], norm: L.CONTRACTIONS[m[2]], kind: 'word', index: s.index, surface: t, contraction: true }); continue; }
    out.push({ text: t, norm: low, kind: 'word', index: s.index });
  }
  return out;
}
// ---------- morphology (English) ----------
export function analyzeMorphology(word, registry) {
  const has = w => registry.has(ids.lexical('en', w)), pos = w => registry.get(ids.lexical('en', w))?.linguistic?.pos;
  const tries = [[/ies$/, 'y', { number: 'pl' }, 'noun'], [/ied$/, 'y', { tense: 'past' }, 'verb'], [/ing$/, '', { form: 'present-participle' }, 'verb'], [/ing$/, 'e', { form: 'present-participle' }, 'verb'], [/([b-df-hj-np-tv-z])\1ing$/, '$1', { form: 'present-participle' }, 'verb'], [/ed$/, '', { tense: 'past' }, 'verb'], [/ed$/, 'e', { tense: 'past' }, 'verb'], [/d$/, '', { tense: 'past' }, 'verb'], [/es$/, '', { number: 'pl|3sg' }, null], [/s$/, '', { number: 'pl|3sg' }, null], [/ly$/, '', { derivation: 'adverb-from-adjective' }, 'adverb'], [/er$/, '', { degree: 'comparative' }, 'adjective'], [/est$/, '', { degree: 'superlative' }, 'adjective'], [/ness$/, '', { derivation: 'noun-from-adjective' }, 'noun']];
  for (const [re, rep, morphology, p] of tries) { if (!re.test(word)) continue; const lemma = word.replace(re, rep); if (lemma.length >= 2 && has(lemma)) return { lemma, morphology, pos: p || (pos(lemma) === 'verb' ? 'verb' : 'noun') }; }
  // Unknown stem: guess part of speech from suffix only (flagged as a guess).
  if (/ing$/.test(word)) return { lemma: null, pos: 'verb', morphology: { form: 'present-participle' } };
  if (/ed$/.test(word)) return { lemma: null, pos: 'verb', morphology: { tense: 'past' } };
  if (/ly$/.test(word)) return { lemma: null, pos: 'adverb', morphology: {} };
  if (/(tion|ment|ness|ity|ism|er|or|ist)s?$/.test(word)) return { lemma: null, pos: 'noun', morphology: {} };
  if (/(ous|ful|able|ible|ive|al|ic|less)$/.test(word)) return { lemma: null, pos: 'adjective', morphology: {} };
  return null;
}
// ---------- atom resolution ----------
export function resolveAtoms(tokens, registry, { lang = 'en', node = 'local', text = '' } = {}) {
  let reused = 0, created = 0;
  const resolved = tokens.map(t => {
    if (t.kind === 'punctuation' || t.kind === 'symbol') {
      const id = ids.symbol(t.text);
      if (registry.has(id)) registry.stats.reused++;
      if (!registry.has(id)) { registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'symbol', canonical: t.text, language: 'zxx', normalized: t.text, createdAt: '2026-01-01T00:00:00.000Z', originNode: 'genesis', schemaVersion: 1, knowledgeVersion: 1, validation: PUNCT_FUNCTION[t.text] ? 'curated' : 'provisional', provenance: [] }, linguistic: { pos: t.kind, codePoints: [...t.text].map(c => c.codePointAt(0)) }, semantic: { senses: [], function: PUNCT_FUNCTION[t.text] || 'unknown' }, functional: {}, relational: [], epistemic: { evidence: [], verification: PUNCT_FUNCTION[t.text] ? 'curated' : 'unverified', confidence: PUNCT_FUNCTION[t.text] ? 0.95 : 0.1, contradictions: [], uncertainty: PUNCT_FUNCTION[t.text] ? [] : ['function unknown'], lastValidated: null, limitations: [] } }, { node, reason: 'symbol' }); created++; } else reused++;
      return { ...t, atomId: id, pos: t.kind, function: registry.get(id).semantic.function };
    }
    if (t.kind === 'number') return { ...t, atomId: `num:${t.norm}`, pos: 'numeral', derived: true, value: Number(t.norm) }; // numbers are derived compositionally from digit symbols
    const wl = lang.startsWith('und') ? 'und' : lang, id = ids.lexical(wl, t.norm);
    if (registry.has(id)) { reused++; registry.stats.reused++; const d = registry.get(id); return { ...t, atomId: id, pos: d.linguistic.pos || 'unknown', lemma: d.linguistic.lemma || t.norm, morph: d.linguistic.morphology || {}, dna: d }; }
    const guess = wl === 'en' ? analyzeMorphology(t.norm, registry) : null;
    const { dna } = registry.discover(t.norm, { lang: wl, guess, node, context: text }); created++;
    return { ...t, atomId: id, pos: guess?.pos || (/^\p{Lu}/u.test(t.text) && t.index > 0 ? 'proper-noun' : 'unknown'), lemma: guess?.lemma || t.norm, morph: guess?.morphology || {}, dna, discovered: true };
  });
  return { tokens: resolved, reused, created };
}
// ---------- tagging refinements (context) ----------
function retag(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
    if (t.kind !== 'word') continue;
    if (t.norm === 'that' && next && ['pronoun', 'article', 'determiner', 'proper-noun', 'noun'].includes(next.pos) && prev?.pos === 'verb') t.pos = 'complementizer';
    if (t.norm === 'her' && next && ['noun', 'adjective', 'unknown'].includes(next.pos)) t.pos = 'determiner';
    if (t.norm === 'like' && prev && ['pronoun', 'noun', 'proper-noun'].includes(prev.pos) && !['verb'].includes(tokens[i - 1]?.pos)) t.pos = 'verb';
    if (t.norm === 'to' && next && next.pos === 'verb' && next.morph?.form !== 'present-participle') t.pos = 'infinitive-marker';
    if (t.pos === 'unknown' && prev && ['article', 'determiner'].includes(prev.pos)) t.pos = 'noun';
    if (t.pos === 'verb' && !isAux(t) && prev && ['article', 'determiner'].includes(prev.pos) && t.dna?.semantic?.senses?.length === 0) t.pos = 'noun';
    if (t.pos === 'verb' && !isAux(t) && prev && ['article'].includes(prev.pos) && t.morph?.form !== 'present-participle') t.pos = 'noun';
    if (t.pos === 'unknown' && /^\p{Lu}/u.test(t.text)) t.pos = 'proper-noun';
  }
  return tokens;
}
const isAux = t => t?.pos === 'verb' && ['auxiliary', 'modal'].includes(t.dna?.linguistic?.subtype);
const isNPstart = t => t && ['pronoun', 'article', 'determiner', 'noun', 'proper-noun', 'adjective', 'numeral', 'unknown'].includes(t.pos);
function readNP(ws, i) {
  const start = i, parts = []; while (i < ws.length && ['article', 'determiner'].includes(ws[i].pos)) parts.push(ws[i++]);
  if (i < ws.length && ws[i].pos === 'pronoun' && !parts.length) return { np: { kind: 'pronoun', tokens: [ws[i]], head: ws[i] }, next: i + 1 };
  while (i < ws.length && ['adjective', 'numeral', 'adverb'].includes(ws[i].pos) && ws[i + 1] && ['adjective', 'noun', 'proper-noun', 'unknown', 'numeral'].includes(ws[i + 1].pos)) parts.push(ws[i++]);
  let head = null; while (i < ws.length && ['noun', 'proper-noun', 'unknown'].includes(ws[i].pos)) { head = ws[i]; parts.push(ws[i++]); }
  if (!head) return { np: null, next: start };
  const det = parts.find(p => ['article', 'determiner'].includes(p.pos));
  return { np: { kind: head.pos === 'proper-noun' ? 'name' : 'noun-phrase', tokens: parts, head, determiner: det?.norm || null, definite: det ? ['the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their'].includes(det.norm) : head.pos === 'proper-noun', modifiers: parts.filter(p => p.pos === 'adjective').map(p => p.lemma) }, next: i };
}
// ---------- sense disambiguation ----------
export function disambiguate(token, contextLemmas, registry) {
  const senses = (token.dna?.semantic?.senses || []).map(id => registry.get(id)).filter(Boolean);
  if (senses.length <= 1) return senses[0] ? { sense: senses[0].identity.id, confidence: senses[0].epistemic.confidence, alternatives: [] } : null;
  const scored = senses.map(s => ({ id: s.identity.id, score: (s.semantic.disambiguation || []).filter(sig => contextLemmas.has(sig)).length })).sort((a, b) => b.score - a.score);
  const top = scored[0], ambiguous = top.score === 0 || top.score === scored[1].score;
  return { sense: ambiguous ? null : top.id, confidence: ambiguous ? 0 : Math.min(0.95, 0.5 + 0.15 * top.score), alternatives: scored, ambiguous };
}
// ---------- discourse state (entities, speakers, coreference) ----------
export class Discourse {
  constructor({ speaker = 'current-speaker', addressee = 'kenuxa' } = {}) { this.speaker = speaker; this.addressee = addressee; this.entities = []; this.turn = 0; }
  mention(np, sense) { const e = { id: `ent${this.entities.length + 1}`, head: np.head.lemma || np.head.norm, text: np.tokens.map(t => t.text).join(' '), number: np.head.morph?.number === 'pl' ? 'pl' : 'sg', human: /person|people|developer|teacher|friend/.test(np.head.lemma || '') || np.kind === 'name' && !sense, sense, turn: this.turn }; this.entities.push(e); return e; }
  resolve(pron) {
    const p = pron.norm, number = pron.dna?.linguistic?.morphology?.number;
    if (['i', 'me', 'my', 'myself', 'mine'].includes(p)) return { kind: 'speaker', referent: this.speaker };
    if (['we', 'us', 'our', 'ourselves'].includes(p)) return { kind: 'speaker-group', referent: this.speaker + '+others' };
    if (['you', 'your', 'yourself', 'yours'].includes(p)) return { kind: 'addressee', referent: this.addressee };
    const wantHuman = ['he', 'him', 'his', 'she', 'her', 'hers'].includes(p), wantPl = ['they', 'them', 'their'].includes(p) || number === 'pl';
    const cand = [...this.entities].reverse().find(e => (wantHuman ? e.human : !e.human || wantPl) && (wantPl ? true : e.number === 'sg'));
    return cand ? { kind: 'anaphora', referent: cand.text, entity: cand.id, head: cand.head, sense: cand.sense, fromTurn: cand.turn } : { kind: 'unresolved', referent: null };
  }
}
// ---------- clause analysis & composition ----------
function analyzeClause(ws, registry, discourse, ctx) {
  const res = { mood: 'declarative', wh: null, subject: null, auxiliaries: [], negated: false, verb: null, complement: null, objects: [], modifiers: [], infinitive: null, issues: [] };
  let i = 0;
  // “So am I.” / “Neither can she.” — additive inversion: so/neither/nor + auxiliary + subject.
  if (['so', 'neither', 'nor'].includes(ws[0]?.norm) && isAux(ws[1]) && isNPstart(ws[2])) { const { np, next } = readNP(ws, 2); if (np) { res.additive = ws[0].norm === 'so' ? 'positive' : 'negative'; res.auxiliaries.push(ws[1]); res.subject = np; res.negated = res.additive === 'negative'; i = next; } }
  if (!res.additive) {
  if (ws[i]?.pos === 'wh-word') { res.wh = ws[i]; i++; res.mood = 'interrogative-wh'; }
  if (isAux(ws[i]) && (res.wh || i === 0) && isNPstart(ws[i + 1])) { res.auxiliaries.push(ws[i++]); if (!res.wh) res.mood = 'interrogative-yn'; else res.mood = 'interrogative-wh'; }
  if (!res.wh || res.auxiliaries.length) { const { np, next } = readNP(ws, i); if (np) { res.subject = np; i = next; } }
  else if (res.wh && ['who', 'what'].includes(res.wh.norm)) res.subject = { kind: 'wh', tokens: [res.wh], head: res.wh };
  while (i < ws.length && (isAux(ws[i]) || ws[i].dna?.semantic?.polarity === 'negative' && ws[i].pos === 'adverb' || ws[i].pos === 'adverb' && isAux(ws[i + 1]))) { if (ws[i].dna?.semantic?.polarity === 'negative') res.negated = true; else if (isAux(ws[i])) res.auxiliaries.push(ws[i]); i++; }
  while (i < ws.length && ws[i].pos === 'adverb') { if (ws[i].dna?.semantic?.polarity === 'negative') res.negated = true; else res.modifiers.push({ type: 'adverb', lemma: ws[i].lemma }); i++; }
  if (!res.subject && !res.wh && ws[0]?.pos === 'verb' && !isAux(ws[0])) res.mood = 'imperative';
  if (i < ws.length && ws[i].pos === 'verb' && !isAux(ws[i])) res.verb = ws[i++];
  else if (!res.subject && res.mood === 'imperative') res.verb = ws[i++];
  }
  // Remaining material: objects, complements, prepositional phrases, infinitives.
  while (i < ws.length) {
    const t = ws[i];
    if (t.pos === 'infinitive-marker') { res.infinitive = { verb: ws[i + 1], rest: ws.slice(i + 2) }; break; }
    if (t.pos === 'preposition') { const { np, next } = readNP(ws, i + 1); res.modifiers.push({ type: 'prepositional', prep: t.norm, relation: t.dna?.semantic?.relations?.[0] || 'related', object: np }); i = np ? next : i + 1; continue; }
    if (t.pos === 'adjective' && !res.verb) { res.complement = { kind: 'adjective', tokens: [t], head: t }; i++; continue; }
    const { np, next } = readNP(ws, i); if (np) { if (res.verb || res.complement) res.objects.push(np); else res.complement = np; i = next; continue; }
    if (t.pos === 'verb' && !res.verb) { res.verb = t; i++; continue; }
    res.modifiers.push({ type: 'unattached', text: t.text, pos: t.pos }); i++;
  }
  return res;
}
function semantics(c, registry, discourse, contextLemmas) {
  const finite = c.auxiliaries[0] || c.verb, auxLemmas = c.auxiliaries.map(a => a.lemma), last = c.auxiliaries.at(-1);
  const modal = c.auxiliaries.find(a => a.dna?.linguistic?.subtype === 'modal');
  const tense = modal ? 'modal-' + (['could', 'would', 'might', 'should'].includes(modal.norm) ? 'past-form' : 'present') : finite?.morph?.tense || (finite?.morph?.form === 'base' ? 'present' : 'unspecified');
  const progressive = !!(c.verb?.morph?.form === 'present-participle' && last?.lemma === 'be');
  const perfect = auxLemmas.includes('have') && c.verb && (String(c.verb.morph?.form || '').includes('past-participle'));
  const passive = last?.lemma === 'be' && c.verb && (String(c.verb.morph?.form || '').includes('past-participle')) && !progressive;
  const subjRef = c.subject ? (c.subject.kind === 'pronoun' ? null : c.subject.kind === 'wh' ? { kind: 'questioned', referent: '?' } : null) : null;
  const agreement = (() => { if (!c.subject?.head || !finite || c.subject.kind === 'wh') return null; const sm = c.subject.head.dna?.linguistic?.morphology || {}, vm = finite.dna?.linguistic?.morphology || finite.morph || {}; if (vm.person == null || modal) return { ok: true, note: 'no agreement marking' }; const sp = String(sm.person ?? 3), sn = String(sm.number ?? (c.subject.head.morph?.number || 'sg')); const ok = String(vm.person).split('|').includes(sp) || (String(vm.number).includes('pl') && sn.includes('pl')) || (String(vm.number).includes('sg2') && sp === '2') || (String(vm.number).includes('sg12') && ['1', '2'].includes(sp)); return { ok, subject: { person: sp, number: sn }, verb: { person: vm.person, number: vm.number }, rule: ids.rule('en', 'subject-verb-agreement') }; })();
  const frame = { tense, aspect: progressive ? 'progressive' : perfect ? 'perfect' : 'simple', voice: passive ? 'passive' : 'active', polarity: c.negated ? 'negative' : 'positive', mood: c.mood, modality: modal ? modal.dna?.semantic?.modality || [modal.norm] : null, roles: {}, rulesUsed: [] };
  const anaphor = (pron) => { const r = discourse.resolve(pron); if (r.kind === 'anaphora' && r.head) { const lexAtom = registry.get(ids.lexical('en', r.head)); if (lexAtom) { const d = disambiguate({ dna: lexAtom }, contextLemmas, registry); if (d?.sense) r.sense = d.sense; } } return r; };
  const role = (np) => np ? (np.kind === 'pronoun' ? { pronoun: np.head.norm, ...anaphor(np.head) } : { text: np.tokens.map(t => t.text).join(' '), head: np.head.lemma, sense: disambiguate(np.head, contextLemmas, registry), entity: discourse.mention(np, disambiguate(np.head, contextLemmas, registry)?.sense)?.id, definite: np.definite }) : null;
  if (agreement) frame.rulesUsed.push(ids.rule('en', 'subject-verb-agreement'));
  // Verb-phrase ellipsis: an auxiliary with no predicate of its own recovers it from the discourse.
  const elliptical = !c.wh && c.auxiliaries.length && !c.verb && !c.complement && !c.objects.length && !c.infinitive && !c.modifiers.some(m => m.type === 'prepositional');
  if (elliptical && discourse.lastFrame) {
    frame.rulesUsed.push(ids.rule('en', 'verb-phrase-ellipsis')); if (c.additive) frame.rulesUsed.push(ids.rule('en', 'additive-inversion'));
    const last = discourse.lastFrame, subj = role(c.subject);
    {
      Object.assign(frame, { type: last.type, construction: last.construction, predicate: last.predicate, predicateAtom: last.predicateAtom, predicateSense: last.predicateSense, subjectRole: last.subjectRole });
      for (const [k, v] of Object.entries(last.roles || {})) if (k !== last.subjectRole) frame.roles[k] = v;
      frame.roles[last.subjectRole || 'agent'] = subj;
      if (last.aspect === 'progressive' && auxLemmas.includes('be')) frame.aspect = 'progressive'; else if (last.aspect === 'perfect' && auxLemmas.includes('have')) frame.aspect = 'perfect';
      frame.ellipsis = { kind: c.additive ? 'additive-inversion' : 'verb-phrase', recovered: true, predicate: last.predicate, fromTurn: last.turn, ...(c.additive ? { polarity: c.additive } : {}) };
    }
    if (agreement) frame.agreement = agreement; if (c.wh) frame.questionFocus = { word: c.wh.norm, asksFor: c.wh.dna?.semantic?.asksFor };
    return frame;
  }
  if (c.mood === 'interrogative-yn') frame.rulesUsed.push(ids.rule('en', 'subject-aux-inversion'));
  if (c.verb && !isAux(c.verb)) {
    const frameRoles = c.verb.dna?.semantic?.roles || ['agent', 'theme?'], first = frameRoles[0];
    frame.type = 'event'; frame.predicate = c.verb.lemma; frame.predicateAtom = c.verb.dna?.relational?.find(r => r.type === 'FORM_OF')?.target || c.verb.atomId;
    frame.predicateSense = c.verb.dna?.semantic?.senses?.[0] || null;
    if (passive) { frame.roles.patient = subjRef || role(c.subject); frame.subjectRole = 'patient'; } else { frame.roles[first] = subjRef ? { pronoun: c.subject.head.norm, ...subjRef } : role(c.subject); frame.subjectRole = first; }
    const objRole = frameRoles.slice(1).some(r => r.replace('?', '') === 'theme') ? 'theme' : (frameRoles[1]?.replace('?', '') || 'theme');
    if (c.objects[0]) frame.roles[objRole === frame.subjectRole ? 'theme2' : objRole] = role(c.objects[0]);
    if (progressive) frame.rulesUsed.push(ids.rule('en', 'progressive-aspect')); if (perfect) frame.rulesUsed.push(ids.rule('en', 'perfect-aspect')); if (passive) frame.rulesUsed.push(ids.rule('en', 'passive-voice'));
    if (c.auxiliaries.some(a => a.lemma === 'do')) frame.rulesUsed.push(ids.rule('en', 'do-support')); if (modal) frame.rulesUsed.push(ids.rule('en', 'modal-base'));
    if (c.verb.discovered) frame.unknownPredicate = true;
  } else if (c.auxiliaries.some(a => a.lemma === 'be') || c.verb?.lemma === 'be') {
    frame.rulesUsed.push(ids.rule('en', 'copula-complement')); frame.subjectRole = 'theme';
    const comp = c.complement || c.objects[0];
    if (comp?.kind === 'adjective') { frame.type = 'state'; frame.construction = 'copular-attributive'; frame.predicate = comp.head.lemma; frame.predicateSense = comp.head.dna?.semantic?.senses?.[0] || null; frame.roles.theme = subjRef ? { pronoun: c.subject.head.norm, ...subjRef } : role(c.subject); frame.roles.attribute = { quality: comp.head.lemma }; }
    else if (comp && comp.head) { const indefinite = ['a', 'an'].includes(comp.determiner); frame.type = indefinite || !comp.determiner && comp.kind !== 'name' ? 'classification' : 'identity'; frame.construction = indefinite ? 'copular-nominal-classification' : 'copular-nominal-identity'; frame.predicate = comp.head.lemma; const s = disambiguate(comp.head, contextLemmas, registry); frame.predicateSense = s?.sense || null; frame.roles.theme = subjRef ? { pronoun: c.subject.head.norm, ...subjRef } : role(c.subject); frame.roles.category = { text: comp.tokens.map(t => t.text).join(' '), head: comp.head.lemma, sense: s }; }
    else if (c.wh) { frame.type = 'identity-question'; frame.construction = 'copular-wh'; frame.predicate = 'be'; frame.roles.theme = role(c.subject); frame.asks = c.wh.dna?.semantic?.asksFor === 'thing' ? 'definition-or-category' : c.wh.dna?.semantic?.asksFor; }
    else { const loc = c.modifiers.find(m => m.type === 'prepositional'); frame.type = loc ? 'location' : 'existence'; frame.construction = loc ? 'copular-locative' : 'copular-incomplete'; frame.predicate = 'be'; frame.roles.theme = subjRef ? { pronoun: c.subject?.head.norm, ...subjRef } : role(c.subject); if (!loc) frame.incomplete = 'The meaning depends on what follows “' + [c.subject?.head.text, ...c.auxiliaries.map(a => a.text)].filter(Boolean).join(' ') + '”.'; }
  } else { frame.type = c.subject ? 'fragment' : 'unknown'; frame.roles.theme = role(c.subject); }
  for (const m of c.modifiers.filter(m => m.type === 'prepositional' && m.object)) frame.roles[m.relation.split('|')[0] === 'location' ? 'location' : m.relation.split('|')[0]] = { prep: m.prep, ...role(m.object) };
  if (c.infinitive?.verb) frame.purposeOrComplement = { verb: c.infinitive.verb.lemma, object: c.infinitive.rest.length ? c.infinitive.rest.map(t => t.text).join(' ') : null };
  if (c.wh) frame.questionFocus = { word: c.wh.norm, asksFor: c.wh.dna?.semantic?.asksFor };
  if (agreement) frame.agreement = agreement;
  return frame;
}
const SUBORDINATORS = new Set(['because', 'although', 'though', 'if', 'unless', 'while', 'whereas', 'since', 'until']);
export function interpret(text, { registry, discourse = new Discourse(), node = 'local', materializeAt = 3 } = {}) {
  const lang = detectLanguage(text, registry), toks = tokenize(text, lang), { tokens, reused, created } = resolveAtoms(toks, registry, { lang, node, text });
  discourse.turn++;
  const out = { language: lang, tokens: tokens.map(({ dna, ...t }) => t), atoms: { reused, created, discovered: tokens.filter(t => t.discovered).map(t => t.atomId) }, clauses: [], relations: [], phrases: [], ambiguities: [] };
  if (lang !== 'en') { out.note = 'Tokenized and atomized with language-aware segmentation; grammatical analysis is currently implemented for English.'; return out; }
  retag(tokens);
  const words = tokens.filter(t => t.kind === 'word' || t.kind === 'number'), terminal = tokens.filter(t => t.kind === 'punctuation').at(-1)?.text;
  const contextLemmas = new Set([...words.map(w => w.lemma), ...discourse.entities.slice(-6).map(e => e.head)]);
  // Clause segmentation at subordinating conjunctions.
  const parts = [], rels = []; let cur = [];
  for (const w of words) { if (SUBORDINATORS.has(w.norm) && cur.length) { parts.push(cur); rels.push(w.norm); cur = []; } else cur.push(w); }
  parts.push(cur);
  const idioms = findIdioms(words, registry); out.idioms = idioms.map(({ tokens: _t, ...m }) => m);
  parts.forEach((ws, k) => { if (!ws.length) return; const c = analyzeClause(ws, registry, discourse, contextLemmas); const sem = semantics(c, registry, discourse, contextLemmas); for (const m of idioms) if (m.tokens.every(t => ws.includes(t))) applyIdiom(sem, m, out, discourse); if (k === 0 && terminal === '?' && sem.mood === 'declarative') sem.mood = 'interrogative'; out.clauses.push({ role: k === 0 ? 'main' : 'subordinate', connective: k ? rels[k - 1] : null, text: ws.map(w => w.text).join(' '), semantics: sem }); });
  // Discourse memory of the last complete predicate (used to recover ellipsis in later turns).
  const lastFull = [...out.clauses].reverse().find(c => ['event', 'state', 'classification', 'identity'].includes(c.semantics.type) && c.semantics.ellipsis?.recovered !== false);
  if (lastFull) discourse.lastFrame = { ...lastFull.semantics, turn: discourse.turn };
  rels.forEach((r, k) => out.relations.push({ type: L.CONJUNCTIONS[r]?.[1] || r, connective: r, from: k + 1, to: 0, meaning: r === 'because' ? 'clause ' + (k + 2) + ' gives the reason for clause 1' : r }));
  // Phrase compositions (on-demand; materialized only when reused often enough).
  const main = out.clauses[0], c0 = parts[0] && parts[0].length ? parts[0] : [];
  const sig = (kind, toks) => ({ kind, signature: kind + ':' + toks.map(t => t.atomId).join('+') });
  if (c0.length >= 2) {
    const subjEnd = c0.findIndex(t => isAux(t) || (t.pos === 'verb')); if (subjEnd > 0) out.phrases.push({ ...sig('subject-predicate-head', c0.slice(0, subjEnd + 1)), text: c0.slice(0, subjEnd + 1).map(t => t.text).join(' '), grammatical: main.semantics.agreement?.ok !== false });
    const vp = c0.slice(Math.max(0, subjEnd)); if (vp.length >= 2) out.phrases.push({ ...sig('verb-phrase', vp), text: vp.map(t => t.text).join(' ') });
  }
  out.phrases.push({ ...sig('sentence', words), text: words.map(t => t.text).join(' ') });
  for (const p of out.phrases) { p.id = ids.phrase(contentHash(p.signature).slice(0, 24)); registry.compositions ??= new Map(); const n = (registry.compositions.get(p.id) || 0) + 1; registry.compositions.set(p.id, n); p.uses = n; p.materialized = n >= materializeAt && p.kind !== 'sentence'; if (p.materialized && !registry.has(p.id)) registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id: p.id, type: 'phrase', canonical: p.text.toLowerCase(), language: 'en', normalized: p.text.toLowerCase(), createdAt: new Date().toISOString(), originNode: node, schemaVersion: 1, knowledgeVersion: 1, validation: 'provisional', provenance: [{ source: 'frequency-materialization', uses: n }] }, linguistic: { kind: p.kind }, semantic: { senses: [] }, functional: {}, relational: p.signature.split(':')[1].split('+').filter(x => x.startsWith('lex:')).map(t => ({ type: 'RELATED_TO', target: t, confidence: 1 })), epistemic: { evidence: [{ source: 'usage-frequency', uses: n }], verification: 'unverified', confidence: 0.5, contradictions: [], uncertainty: [], lastValidated: null, limitations: [] } }, { node, reason: 'materialized-composition' }); }
  for (const t of words) { const d = disambiguate(t, contextLemmas, registry); if (d?.ambiguous) out.ambiguities.push({ word: t.text, candidates: d.alternatives.map(a => a.id) }); }
  out.coreference = out.clauses.flatMap(c => Object.values(c.semantics.roles || {}).filter(r => r?.kind === 'anaphora').map(r => ({ pronoun: r.pronoun, antecedent: r.referent, sense: r.sense })));
  out.summary = describe(out); return out;
}
// ---------- idioms (multi-word expressions) ----------
export function findIdioms(words, registry) {
  const found = [];
  for (const d of registry.idioms || []) {
    const w = d.linguistic.words, first = new Set(d.linguistic.firstWordForms);
    for (let i = 0; i + w.length <= words.length; i++) {
      if (!first.has(words[i].norm) || !w.slice(1).every((x, j) => words[i + 1 + j].norm === x || (x === 'bean' && words[i + 1 + j].norm === 'beans'))) continue;
      const after = words[i + w.length], literalCue = after && (after.norm === 'of' || after.pos === 'preposition' && ['across', 'into', 'onto', 'down', 'over'].includes(after.norm));
      found.push({ id: d.identity.id, text: words.slice(i, i + w.length).map(t => t.text).join(' '), meaning: d.semantic.meaning, predicate: d.semantic.predicate, kind: d.semantic.kind, reading: literalCue ? 'literal-preferred' : 'idiomatic-preferred', tokens: words.slice(i, i + w.length) });
    }
  }
  return found;
}
function applyIdiom(f, m, out, discourse) {
  const inside = r => r?.text && m.text.toLowerCase().includes(String(r.text).toLowerCase());
  const literal = { type: f.type, predicate: f.predicate, roles: { ...f.roles } };
  out.ambiguities.push({ word: m.text, kind: 'idiomatic-vs-literal', candidates: [m.id, 'literal-composition'], preferred: m.reading });
  if (m.reading === 'literal-preferred') { f.idiom = { id: m.id, meaning: m.meaning, used: false, reason: 'the continuation suggests a literal reading' }; return; }
  for (const [k, v] of Object.entries(f.roles)) if (k !== f.subjectRole && inside(v)) { if (v.entity && discourse) discourse.entities = discourse.entities.filter(e => e.id !== v.entity); delete f.roles[k]; } // idiom-internal words are not discourse referents
  if (m.kind === 'adverbial') { f.frequency = m.predicate; }
  else if (m.kind === 'state') { const subj = f.roles[f.subjectRole] || f.roles.theme || f.roles.agent; f.type = 'state'; f.construction = 'idiomatic-state'; f.predicate = m.predicate; f.predicateSense = null; f.roles = { theme: subj, attribute: { quality: m.predicate, idiom: m.id } }; f.subjectRole = 'theme'; }
  else { f.type = 'event'; f.predicate = m.predicate; f.predicateAtom = 'lex:en:' + m.predicate; f.predicateSense = null; }
  f.idiom = { id: m.id, text: m.text, meaning: m.meaning, used: true, literal }; f.rulesUsed = [...(f.rulesUsed || []), ids.rule('en', 'idiomatic-composition')];
}
function describe(o) {
  const c = o.clauses[0]?.semantics; if (!c) return '';
  const who = r => !r ? '?' : r.kind === 'speaker' ? 'the speaker' : r.kind === 'addressee' ? 'the addressee' : r.kind === 'anaphora' ? `“${r.referent}”` : r.text || r.referent || '?';
  const subj = c.roles.agent || c.roles.experiencer || c.roles.theme || c.roles.patient;
  const asp = `${c.polarity === 'negative' ? 'negated ' : ''}${c.tense} ${c.aspect}${c.voice === 'passive' ? ' passive' : ''}`;
  const core = c.type === 'state' ? `${who(subj)} is in the state “${c.predicate}”` : c.type === 'classification' ? `${who(subj)} is classified as ${/^[aeiou]/.test(c.predicate) ? 'an' : 'a'} ${c.predicate}` : c.type === 'identity' ? `${who(subj)} is identified as ${c.roles.category?.text}` : c.type === 'identity-question' ? `what ${who(subj)} is` : c.type === 'event' ? `${who(subj)} performs “${c.predicate}”${c.roles.theme ? ` on ${who(c.roles.theme)}` : ''}` : c.incomplete || c.type;
  const notes = [c.ellipsis?.recovered ? `predicate “${c.predicate}” recovered from the earlier turn (${c.ellipsis.kind} ellipsis)` : null, c.idiom?.used ? `idiom “${c.idiom.text}” = ${c.idiom.meaning}` : null, c.frequency ? `frequency: ${c.frequency}` : null].filter(Boolean);
  return `${c.mood.startsWith('interrogative') ? 'Question: ' : ''}${core} (${asp}).${notes.length ? ' ' + notes.join('; ') + '.' : ''}${o.relations.length ? ' ' + o.relations.map(r => r.meaning).join('; ') + '.' : ''}`;
}
