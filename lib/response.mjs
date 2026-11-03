// The mandatory 7-part KENUXA response:
// 1 Direct answer · 2 Meaning graph · 3 Outcomes · 4 Capabilities · 5 Action layer · 6 Evidence · 7 Evolution
import { features } from './model.mjs';

const uniq = a => [...new Set(a.filter(Boolean))];

export function graphFor(state, ids, question) {
  const atoms = state.atoms, terms = new Set(features(question));
  const byId = id => atoms.find(a => a.id === id);
  // Internal graph search first: atoms named in the question plus atoms the answer used.
  const named = atoms.filter(a => a.status === 'approved' && features(a.title).some(t => terms.has(t)) && features(a.title).filter(t => terms.has(t)).length / Math.max(1, features(a.title).length) >= 0.5).map(a => a.id);
  const core = uniq([...ids, ...named]).filter(byId).slice(0, 8);
  const entities = new Map(), relationships = [];
  const add = (e, role) => { if (e && !entities.has(e.id)) entities.set(e.id, { id: e.id, label: e.title, kind: e.type || e.dna?.identity?.type || 'atom', role, status: e.status || 'approved', stage: e.dna?.evolution?.stage, revision: e.dna?.evolution?.revision, trust: e.dna?.trust?.status }); };
  for (const id of core) {
    const a = byId(id); add(a, 'core');
    for (const r of (a.dna?.relationships || []).slice(0, 6)) { const b = byId(r.target); if (b) { add(b, 'related'); relationships.push({ from: a.id, to: b.id, type: r.predicate, score: r.score ?? null }); } }
  }
  for (const m of state.organism?.molecules || []) if (m.atomIds.some(id => core.includes(id))) { add(m, 'molecule'); for (const id of m.memberIds.filter(id => core.includes(id))) relationships.push({ from: id, to: m.id, type: 'part-of' }); }
  for (const c of state.organism?.cells || []) if (c.atomIds.some(id => core.includes(id))) { add(c, 'cell'); for (const id of c.memberIds.filter(id => entities.has(id))) relationships.push({ from: id, to: c.id, type: 'part-of' }); }
  return { entities: [...entities.values()].slice(0, 30), relationships: relationships.slice(0, 60), core };
}

export function compose({ question, result, state, transformer, publicUrl }) {
  const evidenceAtomIds = (result.evidence || []).map(e => e.id).filter(id => state.atoms.some(a => a.id === id));
  const graph = graphFor(state, uniq([...evidenceAtomIds, result.atomId]), question);
  const find = id => [...state.atoms, ...(state.organism?.molecules || []), ...(state.organism?.cells || [])].find(e => e.id === id);
  const coreEntities = graph.entities.filter(e => ['core', 'molecule', 'cell'].includes(e.role)).map(e => find(e.id)).filter(Boolean);

  // 3 Outcomes: evidence-backed confidence, recorded real-world feedback, and the expected result of acting.
  const feedback = (state.outcomes || []).filter(o => o.type === 'feedback' && graph.core.some(id => (o.entityIds || []).includes(id)));
  const helpful = feedback.filter(o => /^Helpful/.test(o.detail)).length;
  const sources = (result.evidence || []).filter(e => e.url).length;
  const outcomes = {
    expected: result.answer && !/^I (do not|could not|cannot)/.test(result.answer) ? 'You can act on this answer; verify cited sources before high-stakes decisions.' : 'No reliable answer yet; research or teaching is required.',
    observed: { ratings: feedback.length, helpful, needsWork: feedback.length - helpful },
    confidence: result.confidence ?? (sources ? Math.min(80, 30 + sources * 15) : 0),
    validation: result.selfReview?.supported === false ? 'citation check failed' : (result.reviewStatus || (sources ? 'source excerpts; needs human review' : result.engine === 'KENUXA own model' ? 'owner-approved lesson' : 'unvalidated')),
    prediction: graph.core.length ? `Asking related questions about ${find(graph.core[0])?.title || 'this topic'} will reuse this knowledge without a teacher call.` : 'A new atom will be proposed from researched evidence.',
  };

  // 4 Capabilities: executable graph nodes discovered on the entities involved.
  const capabilities = [];
  for (const e of coreEntities) for (const skill of uniq(e.dna?.capabilities || []).slice(0, 8)) capabilities.push({ entity: e.id, entityLabel: e.title, level: e.dna?.agent?.level || 'basic', skill: skill.split('/').pop(), id: skill, execute: { method: 'POST', path: '/api/agents/run', body: { id: e.id, skill, task: question } } });

  // 5 Action layer: what the person can do next.
  const pending = graph.core.map(find).filter(a => a?.status === 'pending');
  const actions = [
    ...pending.map(a => ({ action: 'review-atom', label: `Review and approve “${a.title.slice(0, 80)}” so KENUXA learns it`, target: a.id })),
    ...(capabilities.find(c => c.skill === 'grounded-plan') ? [{ action: 'run-capability', label: 'Generate a grounded plan with the native agent', target: capabilities.find(c => c.skill === 'grounded-plan').entity, skill: 'grounded-plan' }] : []),
    { action: 'research-further', label: 'Research further for fresher evidence' },
    { action: 'rate-answer', label: 'Rate this answer (Helpful / Needs work) — ratings become observed outcomes' },
    { action: 'save-goal', label: 'Save this as a goal to track' },
  ];

  // 6 Evidence: external sources and internal validation.
  const evidence = {
    external: (result.evidence || []).filter(e => e.url).map(e => ({ title: e.title, url: e.url, quote: e.quote, retrievedAt: e.retrievedAt, citation: e.citation })),
    internal: (result.evidence || []).filter(e => !e.url).map(e => ({ id: e.id, title: e.title, source: e.source, trust: find(e.id)?.dna?.trust?.status })),
    checks: result.selfReview?.checks || [], gaps: result.selfReview?.gaps || [],
  };

  // 7 Evolution: what the system learned in this interaction.
  const learned = [];
  if (result.atomId && result.newAtom) learned.push(`Created atom ${result.atomId} with captured evidence (pending review).`);
  if (result.methodId) learned.push(result.teacherUsed ? `Teacher taught a reusable method (${result.methodId}).` : `Reused learned method ${result.methodId} — no teacher call.`);
  if (result.reused) learned.push('Answer memory reused; the same question is never sent to a teacher twice.');
  if (result.selfReview?.changed) learned.push('Self-review produced a revised answer; the previous version is retained.');
  if (result.kernelGrown) learned.push(`Atom kernel grew (${result.kernelGrown}).`);
  learned.push('Conversation stored in memory; outcomes and graph updated.');
  const evolution = { learned, trace: result.trace || [], transformer: transformer ? { steps: transformer.step, loss: transformer.loss } : null, node: publicUrl || null };

  return {
    format: 'kenuxa-response/7',
    sections: {
      directAnswer: { text: result.answer, engine: result.engine, confidence: result.confidence ?? null, transformerDraft: result.transformerDraft || null },
      meaningGraph: { entities: graph.entities, relationships: graph.relationships },
      outcomes, capabilities: capabilities.slice(0, 16), actions, evidence, evolution,
    },
  };
}
