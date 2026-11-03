// Level 8–9: conceptual knowledge and reasoning representations over the atom graph.
// Inference is explicit and auditable: every conclusion carries its chain of atoms, the rule it relied
// on, its confidence (product of edge and atom confidences), assumptions and uncertainty. Open world:
// a missing link is reported as "not established", never as "no" — unless a CONTRADICTS edge exists.
import { ids, RELATIONS, norm } from './schema.mjs';

const conf = (registry, id) => registry.get(id)?.epistemic?.confidence ?? 0.5;
const label = (registry, id) => { const d = registry.get(id); if (!d) return id; return d.identity.type === 'sense' ? `${d.identity.canonical.split('#')[0]} (${d.semantic?.definition ? d.identity.canonical.split('#')[1] : ''})`.replace(' ()', '') : d.semantic?.label || d.identity.canonical; };

// Breadth-first closure over one transitive relation (IS_A, PART_OF …), bounded and cycle-safe.
export function closure(registry, start, { relation = 'IS_A', maxDepth = 12 } = {}) {
  if (!RELATIONS[relation]?.transitive) throw new Error(`${relation} is not transitive`);
  const seen = new Map([[start, { depth: 0, confidence: conf(registry, start), via: null }]]), queue = [start];
  while (queue.length) {
    const id = queue.shift(), cur = seen.get(id); if (cur.depth >= maxDepth) continue;
    for (const e of registry.get(id)?.relational || []) {
      if (e.type !== relation || seen.has(e.target) || !registry.has(e.target)) continue;
      seen.set(e.target, { depth: cur.depth + 1, confidence: +(cur.confidence * (e.confidence ?? 1) * conf(registry, e.target)).toFixed(4), via: id, edge: { source: e.source || null, sources: e.sources?.length || null, confidence: e.confidence ?? 1 } }); queue.push(e.target);
    }
  }
  return seen;
}
const chainTo = (seen, target) => { const out = []; for (let x = target; x; x = seen.get(x)?.via) out.unshift(x); return out; };

// Everything a word can denote: its senses, and the shared concept with the same label.
export function denotations(registry, word, lang = 'en') {
  const lex = registry.get(ids.lexical(lang, word)), base = lex?.relational?.find(r => r.type === 'FORM_OF')?.target, lexeme = base ? registry.get(base) : lex;
  const out = [...(lexeme?.semantic?.senses || [])], c = ids.concept(lang, norm(lexeme?.linguistic?.lemma || word)); if (registry.has(c)) out.push(c);
  return out.filter(id => registry.has(id));
}

// "Is X a Y?" — classification entailment through IS_A, considering every reading of X.
export function classify(registry, subjectWord, categoryWord, { preferSense = null, materialize = false, node = 'local' } = {}) {
  const starts = denotations(registry, subjectWord), targets = new Set(denotations(registry, categoryWord));
  for (const t of [...targets]) for (const l of registry.get(t)?.semantic?.lexicalizations || []) targets.add(l);
  const out = { question: { subject: subjectWord, category: categoryWord, relation: 'IS_A' }, rule: ids.rule('en', 'classification-entailment'), readings: [], assumptions: ['IS_A is transitive', 'open world: an absent link is “not established”, not “false”'], uncertainty: [] };
  if (!starts.length) out.uncertainty.push(`no known meaning for “${subjectWord}”`); if (!targets.size) out.uncertainty.push(`no known meaning for “${categoryWord}”`);
  for (const s of starts) {
    const seen = closure(registry, s), hit = [...targets].filter(t => seen.has(t)).sort((a, b) => seen.get(a).depth - seen.get(b).depth)[0];
    const contradiction = [...seen.keys()].some(id => (registry.get(id)?.relational || []).some(e => e.type === 'CONTRADICTS' && targets.has(e.target)));
    const chain = hit ? chainTo(seen, hit) : null;
    const unverified = chain ? chain.map(id => seen.get(id).edge).filter(e => e && (e.source === 'statement' || e.confidence < 0.5)) : [];
    out.readings.push({ sense: s, label: label(registry, s), holds: hit ? true : contradiction ? false : null, disputed: !!(hit && contradiction), unverified: unverified.length ? unverified : null, chain, chainLabels: chain?.map(id => label(registry, id)) || null, confidence: hit ? seen.get(hit).confidence : 0, preferred: s === preferSense });
  }
  const yes = out.readings.filter(r => r.holds), no = out.readings.filter(r => r.holds === false);
  out.answer = !starts.length || !targets.size ? 'unknown-terms' : yes.some(r => r.disputed) && yes.length === 1 ? 'disputed' : yes.length && yes.length === out.readings.length ? 'yes' : yes.length ? (out.readings.find(r => r.preferred)?.holds ? 'yes-in-context' : 'depends-on-sense') : no.length ? 'no' : 'not-established';
  if (out.answer === 'depends-on-sense') out.uncertainty.push(`“${subjectWord}” is ambiguous; the classification holds only for some senses`);
  out.confidence = yes.length ? Math.max(...yes.map(r => r.confidence)) : 0;
  // Level 9 → 10: a proven inference may be materialised as a derived relationship atom (provisional, with its chain as support).
  if (materialize) for (const r of yes) {
    const target = r.chain.at(-1), id = ids.relation('IS_A', r.sense, target);
    if (!registry.has(id) && r.chain.length > 2) registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'relationship', canonical: `${r.label} IS_A ${label(registry, target)}`, language: 'en', normalized: id, createdAt: new Date().toISOString(), originNode: node, schemaVersion: 1, knowledgeVersion: 1, validation: 'provisional', provenance: [{ source: 'inference', rule: out.rule }] },
      linguistic: {}, semantic: { senses: [], relation: 'IS_A', from: r.sense, to: target, derived: true }, functional: {}, relational: r.chain.map(x => ({ type: 'SUPPORTED_BY', target: x, confidence: 1 })),
      epistemic: { evidence: [{ source: 'inference-chain', chain: r.chain }], verification: 'unverified', confidence: Math.min(1, r.confidence), contradictions: [], uncertainty: ['derived by transitive inference; inherits the weakest link'], lastValidated: null, limitations: [] } }, { node, reason: 'derived-inference' });
    r.materialized = id;
  }
  return out;
}

// Hypernym path of a word's readings (used for explanation and for grounding answers).
export function explain(registry, word) {
  return denotations(registry, word).filter(id => id.startsWith('sense:')).map(s => { const seen = closure(registry, s), path = [...seen.keys()].sort((a, b) => seen.get(a).depth - seen.get(b).depth); return { sense: s, definition: registry.get(s)?.semantic?.definition || null, path: path.map(id => label(registry, id)) }; });
}

// Natural-language realisation of a classification result (the reasoning, not a canned answer).
export function verbalizeClassification(c) {
  const art = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w, { subject, category } = c.question;
  const why = r => r.chainLabels.map((l, i, a) => i < a.length - 1 ? `${art(l.replace(/ \(.+\)$/, ''))} is ${art(a[i + 1].replace(/ \(.+\)$/, ''))}` : null).filter(Boolean).join(', ');
  const yes = c.readings.filter(r => r.holds), others = c.readings.filter(r => !r.holds);
  if (c.answer === 'unknown-terms') return null;
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const caveat = rs => rs.some(r => r.unverified) ? `\n\n_Part of this rests on statements KENUXA was told but has not verified (${rs.flatMap(r => r.unverified || []).map(e => `${e.sources || 1} source${(e.sources || 1) > 1 ? 's' : ''}, confidence ${Math.round(100 * e.confidence)}%`).join('; ')})._` : '';
  if (c.answer === 'yes' || c.answer === 'yes-in-context') return `**Yes.** ${cap(why(yes.find(r => r.preferred) || yes[0]))}, so ${art(subject)} is ${art(category)}.${others.length ? `\n\n(Another sense of “${subject}” — ${others.map(r => r.label).join(', ')} — is not shown to be ${art(category)}.)` : ''}${caveat(yes)}`;
  if (c.answer === 'depends-on-sense') return `**It depends on the sense of “${subject}”.**\n\n${yes.map(r => `- **${r.label}:** yes — ${why(r)}.`).join('\n')}\n${others.map(r => `- **${r.label}:** not established from what KENUXA knows.`).join('\n')}${caveat(yes)}`;
  if (c.answer === 'disputed') return `**Disputed.** One chain says ${art(subject)} is ${art(category)} (${why(yes[0])}), but KENUXA also holds a statement that contradicts it.${caveat(yes)}`;
  if (c.answer === 'no') return `**No.** What KENUXA knows about ${art(subject)} contradicts it being ${art(category)}.`;
  return `**Not established.** KENUXA knows ${c.readings.map(r => r.label).join(' and ')}, but no chain of facts links ${art(subject)} to ${art(category)}. That is not proof that it is false.`;
}

// Level 10: learning from what people say. "A kente is a cloth." / "A whale is not a fish."
// Statements become PROVISIONAL relations on shared concept atoms, with provenance per source.
// Confidence grows only with independent sources; curated knowledge is never changed by a statement
// (the claim is held for review instead); contradictions are recorded, not overwritten.
const SOURCE_CONF = n => Math.min(0.6, 0.25 + 0.15 * (n - 1));
export function ensureConcept(registry, lemma, { node = 'local', lang = 'en' } = {}) {
  const id = ids.concept(lang, norm(lemma)); if (registry.has(id)) return id;
  const lex = registry.get(ids.lexical(lang, lemma)), base = lex?.relational?.find(r => r.type === 'FORM_OF')?.target, lexeme = base ? registry.get(base) : lex;
  registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'concept', canonical: norm(lemma), language: lang, normalized: norm(lemma), createdAt: new Date().toISOString(), originNode: node, schemaVersion: 1, knowledgeVersion: 1, validation: 'provisional', provenance: [{ source: 'statement' }] },
    linguistic: {}, semantic: { senses: [], label: norm(lemma), lexicalizations: lexeme?.semantic?.senses || [] }, functional: {}, relational: [], epistemic: { evidence: [], verification: 'unverified', confidence: 0.5, contradictions: [], uncertainty: ['concept introduced by a statement'], lastValidated: null, limitations: [] } }, { node, reason: 'concept-from-statement' });
  return id;
}
export function learnClassification(registry, subjectWord, categoryWord, { negative = false, source = 'anonymous', node = 'local', quoted = '' } = {}) {
  const art = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w, relation = negative ? 'CONTRADICTS' : 'IS_A';
  if (norm(subjectWord) === norm(categoryWord)) return { status: 'ignored', reason: 'tautology' };
  const known = classify(registry, subjectWord, categoryWord);
  if (!negative && known.answer === 'yes' && !known.readings.some(r => r.unverified)) return { status: 'already-known', known, message: `That matches what I already know: ${verbalizeClassification(known).replace(/^\*\*Yes\.\*\* /, '')}` };
  const from = ensureConcept(registry, subjectWord, { node }), to = ensureConcept(registry, categoryWord, { node }), head = registry.get(from);
  if (head.identity.validation === 'curated') {
    const m = registry.manifest(from); m.quarantined.push({ status: 'held-for-review', relation, target: to, source, quoted: String(quoted).slice(0, 200), at: new Date().toISOString() }); m.quarantined = m.quarantined.slice(-50);
    return { status: 'held-for-review', message: `I already have curated knowledge about ${art(norm(subjectWord))}, so I kept your statement for review instead of changing it.` };
  }
  const next = structuredClone(head), conflictType = negative ? 'IS_A' : 'CONTRADICTS';
  const conflict = next.relational.find(e => e.type === conflictType && e.target === to) || (!negative && (known.answer === 'no' || known.answer === 'disputed') ? { known: true } : null);
  let edge = next.relational.find(e => e.type === relation && e.target === to), status;
  if (edge) { if ((edge.sources || []).includes(source)) return { status: 'repeated', message: 'You told me that before; repeating it from the same source does not make it more certain.' }; edge.sources = [...(edge.sources || []), source].slice(-20); edge.confidence = SOURCE_CONF(edge.sources.length); status = 'reinforced'; }
  else { edge = { type: relation, target: to, confidence: SOURCE_CONF(1), source: 'statement', sources: [source] }; next.relational.push(edge); status = 'learned'; }
  if (conflict) next.epistemic.contradictions = [...next.epistemic.contradictions, { relation, target: to, source, at: new Date().toISOString() }].slice(-20);
  next.epistemic.evidence = [...next.epistemic.evidence, { source: 'statement', from: source, quoted: String(quoted).slice(0, 200), at: new Date().toISOString(), reliability: 0.25 }].slice(-40);
  next.identity.knowledgeVersion = (head.identity.knowledgeVersion || 1) + 1; next.identity.provenance = [...head.identity.provenance, { source: 'statement', from: source }].slice(-40);
  registry.put(next, { node, reason: 'statement-' + status, trust: 'provisional' });
  const pct = Math.round(100 * edge.confidence), what = negative ? `${art(norm(subjectWord))} is not ${art(norm(categoryWord))}` : `${art(norm(subjectWord))} is a kind of ${norm(categoryWord)}`;
  return { status, conflict: !!conflict, relation, from, to, confidence: edge.confidence, sources: edge.sources.length,
    message: `${status === 'reinforced' ? 'Another independent source agrees' : 'Noted'}: ${what}. I've stored it as an **unverified** statement (confidence ${pct}%, ${edge.sources.length} source${edge.sources.length > 1 ? 's' : ''}). It grows stronger only if other independent sources agree${conflict ? ', and it **conflicts** with something I already hold, so both are kept and the question is marked disputed' : ''}.` };
}
