import test from 'node:test';
import assert from 'node:assert/strict';
import { seeds } from '../lib/seed.mjs';
import { hydrateAtom, rebuildOrganism } from '../lib/organism.mjs';
import { extractFrame, conceptLabel, validateEnrichment } from '../lib/meaning.mjs';
import { comprehend, construct, constraintsOf } from '../lib/comprehension.mjs';

function world() {
  const extra = [
    ['shoe', 'Shoe', 'Shoes are footwear designed to protect and comfort the feet.', ['fashion', 'footwear']],
    ['dress', 'Dress', 'A dress is a garment consisting of a skirt with an attached bodice.', ['fashion', 'clothing']],
    ['solar', 'What is solar energy?', 'Solar energy is radiant energy from the Sun, used to generate electricity and heat, such as photovoltaics and solar water heating.', ['energy', 'solar']],
  ].map(([id, title, answer, tags]) => ({ id: 't:' + id, title, answer, questions: [], tags, status: 'approved', visibility: 'public', origin: 't', createdAt: new Date().toISOString() }));
  const state = { atoms: [...seeds(), ...extra].map(hydrateAtom), formations: { molecules: [], cells: [] } }; rebuildOrganism(state); return state;
}

test('every atom carries an explicit meaning frame derived from its own DNA', () => {
  const s = world();
  for (const a of s.atoms) { const f = a.dna.meaning.frame; assert.equal(f.schema, 'kenuxa-meaning/1'); assert.ok(f.label && f.essence && f.kind); assert.ok(f.depth > 0); }
  const solar = s.atoms.find(a => a.id === 't:solar').dna.meaning.frame;
  assert.equal(solar.label, 'solar energy'); assert.equal(solar.genus, 'radiant energy'); assert.ok(solar.purposes.some(p => /generate electricity/.test(p))); assert.ok(solar.examples.includes('photovoltaics'));
  const dress = s.atoms.find(a => a.id === 't:dress').dna.meaning.frame; assert.equal(dress.kind, 'artifact'); assert.equal(dress.genus, 'garment'); assert.ok(dress.parts.length);
  assert.equal(s.atoms.find(a => a.title === 'What is the capital of Ghana?').dna.meaning.frame.value, 'Accra');
  assert.equal(conceptLabel('What does Photosynthesis explain?'), 'Photosynthesis');
  assert.ok(s.organism.molecules.every(m => m.dna.meaning.frame.members.length >= 2));
  assert.throws(() => validateEnrichment({ examples: Array(20).fill('x') }));
  const shoe = s.atoms.find(a => a.id === 't:shoe'); shoe.dna.meaning.enrichment = { frame: validateEnrichment({ examples: ['sneaker', 'sandal'] }), source: 'test' };
  assert.ok(extractFrame(shoe).examples.includes('sandal'));
});

test('comprehension recognises intent, underlying goal, focus, constraints and linked atoms', () => {
  const s = world(), u = comprehend('How do I start a solar company in Ghana with $5000?', { atoms: s.atoms });
  assert.equal(u.intent.type, 'plan'); assert.equal(u.action, 'start'); assert.equal(u.focus, 'solar company');
  assert.deepEqual(u.constraints, { location: 'Ghana', budget: '$5000' }); assert.match(u.goal.statement, /start a solar company in Ghana/);
  assert.ok(u.concepts.some(c => c.atomId === 't:solar')); assert.match(u.searchQuery, /solar company Ghana/);
  const c = comprehend('Compare shoe and dress', { atoms: s.atoms }); assert.deepEqual(c.sides, ['shoe', 'dress']); assert.equal(c.answerType, 'comparison');
  assert.equal(comprehend('Why is the sky blue?', { atoms: s.atoms }).intent.type, 'cause');
  assert.equal(comprehend('Hello there', { atoms: s.atoms }).intent.type, 'greeting');
  assert.equal(comprehend('Is water wet?', { atoms: s.atoms }).answerType, 'yes-no');
  assert.equal(comprehend('Where is Accra?', { atoms: s.atoms }).concepts[0].match, 'value');
  assert.deepEqual(constraintsOf('Explain it briefly for beginners in 2026'), { time: 'in 2026', audience: 'beginners', format: 'briefly' });
  const follow = comprehend('Tell me more about it', { atoms: s.atoms, memory: [{ entityIds: ['t:dress'] }] });
  assert.equal(follow.references[0].to, 'Dress'); assert.equal(follow.concepts[0].atomId, 't:dress');
  assert.ok(comprehend('What is quantum chromodynamics?', { atoms: s.atoms }).understood < 1);
});

test('construction answers from understanding and never invents facts', () => {
  const s = world(), ask = q => construct(comprehend(q, { atoms: s.atoms }), { result: { answer: '', evidence: [] }, atoms: s.atoms });
  const cmp = ask('Compare shoe and dress'); assert.match(cmp.text, /footwear/); assert.match(cmp.text, /garment/); assert.equal(cmp.structure, 'comparison');
  const def = ask('What is solar energy?'); assert.match(def.text, /radiant energy/); assert.ok(def.grounded);
  const plan = ask('How do I start a solar company in Ghana with $5000?'); assert.match(plan.text, /1\. /); assert.match(plan.text, /Ghana/); assert.match(plan.text, /\$5000/); assert.ok(plan.framework);
  const unknown = ask('What is quantum chromodynamics?'); assert.equal(unknown.grounded, false); assert.match(unknown.text, /won't guess/);
  const list = ask('What are examples of solar energy?'); assert.match(list.text, /photovoltaics/i);
});
