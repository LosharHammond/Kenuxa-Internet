// Curated knowledge packs: small sets of claims that were checked against the cited source by a person
// (or, for KENUXA itself, against its own implementation). Every claim names its sources and its status:
//   source-checked  — the cited page says this (as of `accessed`)
//   check-current   — said by the source but likely to change (fees, thresholds, rates) or secondary-sourced
//   derived         — KENUXA's own reasoning from source-checked claims (marked as such in answers)
// Packs are loaded as atoms (claims → 'sentence' atoms, options → 'concept' atoms) so they are preserved,
// shared and versioned like all other knowledge. Nothing here is an answer template: composers select claims.
import {loadCore} from '../foundation/data.mjs';
export const PACKS=loadCore('knowledge-packs.json');
const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
export function matchPack(text, { location = null, packId = null } = {}) {
  if (packId) { const p = PACKS.find(x => x.id === packId); if (p) return p; }
  const w = new Set(words(text + ' ' + (location || '')));
  return PACKS.find(p => p.match.all.every(group => group.some(t => w.has(t))) && (!p.match.location || p.match.location.some(l => w.has(l)))) || null;
}

// Load a pack as atoms (idempotent). Claims carry their evidence; options are concepts.
export function loadPack(registry, pack, { node = 'genesis' } = {}) {
  const AT = `${pack.accessed}T00:00:00.000Z`; let added = 0;
  for (const c of pack.claims) {
    const id = `fact:${pack.id}:${c.id}`; if (registry.has(id)) continue;
    registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'sentence', canonical: c.text, language: 'en', normalized: c.text.toLowerCase(), createdAt: AT, originNode: node, schemaVersion: 1, knowledgeVersion: pack.version, validation: c.status === 'source-checked' ? 'verified' : 'provisional', provenance: [{ source: `pack:${pack.id}@${pack.version}` }] },
      linguistic: {}, semantic: { senses: [], claim: c.text, pack: pack.id, tags: c.tags, appliesTo: c.appliesTo, status: c.status }, functional: {}, relational: c.appliesTo.filter(a => a !== 'all').map(a => ({ type: 'REFERS_TO', target: `concept:en:${pack.id}-${a}`, confidence: 1 })),
      epistemic: { evidence: c.sources.map(s => ({ source: pack.sources[s].url, title: pack.sources[s].title, accessed: pack.accessed, reliability: c.status === 'source-checked' ? 0.85 : 0.6 })), verification: c.status === 'source-checked' ? 'verified' : 'unverified', confidence: c.status === 'source-checked' ? 0.85 : c.status === 'derived' ? 0.6 : 0.55, contradictions: [], uncertainty: c.status === 'check-current' ? ['may have changed since ' + pack.accessed] : c.status === 'derived' ? ['KENUXA’s own inference from the cited sources'] : [], lastValidated: AT, limitations: [] } }, { node, reason: 'knowledge-pack' });
    added++;
  }
  for (const o of pack.options) { const id = `concept:en:${pack.id}-${o.id}`; if (registry.has(id)) continue; registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'concept', canonical: o.label, language: 'en', normalized: o.label.toLowerCase(), createdAt: AT, originNode: node, schemaVersion: 1, knowledgeVersion: pack.version, validation: 'verified', provenance: [{ source: `pack:${pack.id}@${pack.version}` }] }, linguistic: {}, semantic: { senses: [], label: o.label, capital: o.capital, needsTechnician: o.needsTechnician, licence: o.licence, description: o.what }, functional: {}, relational: [], epistemic: { evidence: [], verification: 'verified', confidence: 0.8, contradictions: [], uncertainty: [], lastValidated: AT, limitations: ['option list is not exhaustive'] } }, { node, reason: 'knowledge-pack' }); added++; }
  return added;
}
