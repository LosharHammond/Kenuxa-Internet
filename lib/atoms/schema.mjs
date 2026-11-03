// KENUXA Atomic DNA — formal schema (kenuxa-atomic-dna/1).
// Six DNA categories: identity · linguistic · semantic · functional · relational · epistemic.
// Fields are type-specific and optional where inapplicable; shared knowledge (grammar rules, senses,
// concepts) is referenced by atom id, never copied into every atom.
export const DNA_SCHEMA = 'kenuxa-atomic-dna/1';
export const ATOM_TYPES = ['symbol', 'lexical', 'sense', 'relationship', 'rule', 'phrase', 'sentence', 'concept'];
export const VALIDATION = ['curated', 'verified', 'corroborated', 'provisional', 'disputed', 'quarantined'];
export const TRUST_RANK = { curated: 5, verified: 4, corroborated: 3, provisional: 2, disputed: 1, quarantined: 0 };
export const DURABILITY = ['PROVISIONAL', 'VALIDATING', 'PENDING_DURABILITY', 'COMMITTED', 'DEGRADED', 'REPAIRING', 'QUARANTINED'];

// Relationship types: defined semantics, directionality and endpoint validation.
export const RELATIONS = {
  IS_A: { directed: true, transitive: true, from: ['sense', 'concept', 'lexical'], to: ['sense', 'concept', 'lexical'], meaning: 'source is a kind of target' },
  INSTANCE_OF: { directed: true, from: ['sense', 'concept', 'lexical'], to: ['sense', 'concept'], meaning: 'source is a particular instance of target' },
  FORM_OF: { directed: true, from: ['lexical'], to: ['lexical'], meaning: 'source is an inflected form of target lemma' },
  PART_OF: { directed: true, transitive: true, from: ['sense', 'concept', 'phrase'], to: ['sense', 'concept', 'phrase', 'sentence'], meaning: 'source is a component of target' },
  SYNONYM_OF: { directed: false, from: ['sense', 'lexical'], to: ['sense', 'lexical'], meaning: 'same meaning in some context' },
  ANTONYM_OF: { directed: false, from: ['sense', 'lexical'], to: ['sense', 'lexical'], meaning: 'opposite meaning' },
  REQUIRES: { directed: true, from: ['lexical', 'sense', 'rule'], to: ['lexical', 'sense', 'rule'], meaning: 'source cannot be used correctly without target' },
  MODIFIES: { directed: true, from: ['lexical', 'phrase'], to: ['lexical', 'phrase'], meaning: 'source restricts or describes target' },
  REFERS_TO: { directed: true, from: ['lexical', 'phrase', 'sentence'], to: ['sense', 'concept', 'lexical', 'phrase'], meaning: 'source denotes target in context' },
  PRECEDES: { directed: true, from: ['lexical', 'phrase', 'symbol'], to: ['lexical', 'phrase', 'symbol'], meaning: 'source occurs before target' },
  COMPOSES_WITH: { directed: false, from: ['lexical', 'phrase'], to: ['lexical', 'phrase'], meaning: 'source combines grammatically with target' },
  DERIVED_FROM: { directed: true, from: ['lexical', 'sense'], to: ['lexical', 'sense'], meaning: 'source was formed from target' },
  RELATED_TO: { directed: false, from: ATOM_TYPES, to: ATOM_TYPES, meaning: 'associated without a more specific relation' },
  SUPPORTED_BY: { directed: true, from: ATOM_TYPES, to: ATOM_TYPES, meaning: 'source claim is supported by target evidence' },
  CONTRADICTS: { directed: false, from: ATOM_TYPES, to: ATOM_TYPES, meaning: 'source and target cannot both hold' },
  SENSE_OF: { directed: true, from: ['sense'], to: ['lexical'], meaning: 'source is one meaning of target word' },
  USES_RULE: { directed: true, from: ['lexical', 'phrase', 'sentence'], to: ['rule'], meaning: 'source follows the shared grammar rule' },
};
export function validateRelation(type, fromType, toType) {
  const r = RELATIONS[type]; if (!r) throw new Error(`Unknown relationship type ${type}`);
  if (!r.from.includes(fromType) || !r.to.includes(toType)) throw new Error(`${type} cannot connect ${fromType} → ${toType}`);
  return r;
}

// Deterministic logical identities: the same word discovered independently on two nodes gets the same
// id, so concurrent creation reconciles to one canonical atom instead of duplicates.
export const norm = s => String(s).normalize('NFC').toLowerCase();
export const ids = {
  symbol: ch => `sym:${[...String(ch)].map(c => c.codePointAt(0).toString(16)).join('-')}`,
  lexical: (lang, form) => `lex:${lang}:${norm(form)}`,
  sense: (lang, lemma, sense) => `sense:${lang}:${norm(lemma)}#${sense}`,
  rule: (lang, name) => `rule:${lang}:${name}`,
  relation: (type, a, b) => `rel:${type}:${a}>${b}`,
  phrase: sig => `phr:${sig}`,
  concept: (lang, label) => `concept:${lang}:${norm(label).replace(/\s+/g, '-')}`,
};
export function blankDNA({ id, type, canonical, language = 'und', normalized, originNode = 'genesis', at = '2026-01-01T00:00:00.000Z' }) {
  return {
    schema: DNA_SCHEMA,
    identity: { id, type, canonical, language, normalized: normalized ?? norm(canonical), createdAt: at, originNode, schemaVersion: 1, knowledgeVersion: 1, validation: 'provisional', provenance: [] },
    linguistic: {}, semantic: { senses: [] }, functional: {}, relational: [],
    epistemic: { evidence: [], verification: 'unverified', confidence: 0, contradictions: [], uncertainty: [], lastValidated: null, limitations: [] },
  };
}
export function checkDNA(d) {
  const errs = [];
  if (d?.schema !== DNA_SCHEMA) errs.push('schema');
  if (!d?.identity?.id || !ATOM_TYPES.includes(d.identity.type)) errs.push('identity');
  if (!VALIDATION.includes(d?.identity?.validation)) errs.push('validation');
  if (!Array.isArray(d?.relational)) errs.push('relational');
  for (const r of d?.relational || []) if (!RELATIONS[r.type]) errs.push('relation:' + r.type);
  if (!d?.epistemic || typeof d.epistemic.confidence !== 'number' || d.epistemic.confidence < 0 || d.epistemic.confidence > 1) errs.push('epistemic');
  if (errs.length) throw new Error('Invalid Atomic DNA: ' + errs.join(', '));
  return d;
}
