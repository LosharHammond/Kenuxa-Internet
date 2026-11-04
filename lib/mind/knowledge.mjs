// Declarative cognitive seeds are versioned foundation data. Runtime validation and execution remain code.
import {loadCore} from '../foundation/data.mjs';
export const {ACTIONS,CAUSAL,MODELS,PHONE_ASSUMPTIONS,RULES,STRATEGY}=loadCore('cognitive-seeds.json');
const src = ref => [{ kind: 'source', ref }];
export function seedAtoms() {
  return [
    ...CAUSAL.map(c => ({ id: c.id, category: 'causal', label: `${c.cause} → ${c.effect}`, status: 'validated', confidence: 0.8, body: c, evidence: src('common electrical troubleshooting practice (equipment manuals; multimeter diagnosis)'), provenance: { source: 'core seed (v1.7)' } })),
    ...ACTIONS.map(a => ({ id: a.id, category: 'action', label: a.name, status: 'validated', confidence: 0.7, body: a, evidence: src('manufacturer battery guidance (iOS Low Power Mode, Android Battery Saver); ranges are assumptions'), provenance: { source: 'core seed (v1.7)' } })),
    ...RULES.map(r => ({ id: r.id, category: 'rule', label: r.note, status: 'validated', confidence: 0.95, body: r, evidence: src('KENUXA protocol design / physics'), provenance: { source: 'core seed (v1.7)' } })),
    STRATEGY,
  ];
}
