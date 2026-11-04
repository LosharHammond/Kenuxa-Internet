// Atomic decomposition (PART 2.5): a sentence becomes an event structure — actors, action, inputs, outputs,
// objects, places, purposes, conditions and causes — each slot linked to the atoms it came from.
import { interpret } from '../atoms/language.mjs';
import * as L from '../atoms/lexicon-en.mjs';

const slot = r => r ? { text: r.text || r.referent || r.pronoun || r.quality || null, head: r.head || null, sense: typeof r.sense === 'string' ? r.sense : r.sense?.sense || null, atom: r.head ? `lex:en:${r.head}` : null } : null;
export function decompose(text, registry, { discourse, interpretation = null } = {}) {
  const o = interpretation || interpret(text, { registry, discourse, node: 'decompose' }); // reuse the pipeline's own interpretation when available
  return o.clauses.map((c, i) => {
    const f = c.semantics, verb = L.VERBS[f.predicate] || {}, roles = f.roles || {}, subj = roles[f.subjectRole] || roles.agent || roles.experiencer || roles.theme;
    const out = { clause: c.text, role: c.role, connective: c.connective, type: f.type, action: f.predicate ? { predicate: f.predicate, atom: f.predicateAtom || null, sense: f.predicateSense || null, tense: f.tense, aspect: f.aspect, polarity: f.polarity, mood: f.mood, modality: f.modality || null } : null,
      actors: subj ? [slot(subj)] : [], inputs: [], outputs: [], objects: [], places: [], purposes: [], causes: [], effects: [], properties: [], rules: f.rulesUsed || [] };
    if (verb.transforms) { if (roles.theme) out.inputs.push(slot(roles.theme)); if (roles.goal) out.outputs.push(slot(roles.goal)); out.rules.push('rule:en:transformation-roles'); }
    else if (verb.causal) { out.causes.push(slot(subj)); const eff = roles.theme || roles.goal; if (eff) out.effects.push(slot(eff)); }
    else for (const k of ['theme', 'patient', 'beneficiary', 'recipient', 'theme2']) if (roles[k] && roles[k] !== subj) out.objects.push(slot(roles[k]));
    if (roles.location) out.places.push(slot(roles.location)); if (f.purposeOrComplement) out.purposes.push({ text: [f.purposeOrComplement.verb, f.purposeOrComplement.object].filter(Boolean).join(' ') });
    if (roles.attribute) out.properties.push({ of: subj?.text || null, quality: roles.attribute.quality });
    if (f.type === 'classification') out.properties.push({ of: subj?.text || null, isA: roles.category?.head || null });
    for (const r of o.relations) if (r.from === i && r.type === 'cause') out.causeOf = r.to; else if (r.to === i && r.type === 'cause') out.causedBy = r.from;
    if (c.connective && ['if', 'unless'].includes(c.connective)) out.condition = true;
    return out;
  });
}
