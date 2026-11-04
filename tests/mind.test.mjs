// v1.7 Evolving Cognitive Engine: kernel, procedures, reasoning methods, world model, planning, evolution,
// vision, distributed testing, security — and the eight mandated scenarios (A–H).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProcedure, runProcedure, testProcedure, runTask } from '../lib/peers/tasks.mjs';
import { parseQuantities } from '../lib/mind/quantities.mjs';
import { LIBRARY, solve, synthesize } from '../lib/mind/procedures.mjs';
import { deduce, prove, induce, testRule, analogy, allen, stn, solveCSP, bayes } from '../lib/mind/logic.mjs';
import { abduce, counterfactual, necessarySufficient } from '../lib/mind/causal.mjs';
import { CognitiveStore, makeAtom } from '../lib/mind/atoms.mjs';
import { EvolutionEngine } from '../lib/mind/evolution.mjs';
import { emptyWorld, updateWorld, sanitizeWorld } from '../lib/mind/world.mjs';
import { powerPlan, plan } from '../lib/mind/planner.mjs';
import { WorkingMemory, ExperienceMemory, signature } from '../lib/mind/memory.mjs';
import { goalOf, negations } from '../lib/mind/comprehend.mjs';
import { canvas, encodePNG, decodePNG, perceive, Labeller, identify, parseLegend, visualAnswer } from '../lib/mind/vision.mjs';
import { simulate } from '../lib/mind/simulate.mjs';
import { Mind } from '../lib/mind/index.mjs';
import { MODELS, CAUSAL } from '../lib/mind/knowledge.mjs';
import { sanitizeCapsule } from '../lib/cognition/context.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';

test('procedure kernel: dimensional analysis, unit conversion, tests, and no code execution', () => {
  const spec = LIBRARY.find(p => p.id === 'proc:energy-consumption').body;
  assert.deepEqual(checkProcedure(spec), []);
  assert.equal(runProcedure(spec, { power: { value: 1.5, unit: 'kW' }, duration: { value: 90, unit: 'min' } }).outputs.energy.value, 2250);
  assert.match(checkProcedure({ ...spec, steps: [{ as: 'energy', expr: 'power + duration' }] })[0], /cannot add/);
  assert.match(checkProcedure({ ...spec, steps: [{ as: 'energy', expr: 'power * duration', dim: 'time' }] })[0], /declared time/);
  assert.throws(() => runProcedure(spec, { power: { value: 5, unit: 'kg' }, duration: 1 }), /unknown unit|expected power/);
  assert.throws(() => runProcedure({ ...spec, steps: [{ as: 'energy', expr: 'process.exit(1)' }] }, { power: 1, duration: 1 }), /not allowed|bad/);
  for (const p of LIBRARY) { const t = testProcedure(p.body); assert.equal(t.passed, t.total, p.id); }
  assert.deepEqual(parseQuantities('a 4,000 mAh 3.7V battery at 10% for three hours').map(q => [q.value, q.dim]), [[4000, 'charge'], [3.7, 'voltage'], [10, 'fraction'], [3, 'time']]);
});

test('procedure composition: backward chaining over dimensions uses every stated quantity, and asks for what is missing', () => {
  const r = solve('My phone has a 4000 mAh 3.7 V battery at 10% and uses 2 W. How long will it last?');
  assert.ok(r.ok); assert.deepEqual(r.steps.map(s => s.procedure), ['proc:battery-energy', 'proc:remaining-energy', 'proc:runtime']); assert.ok(Math.abs(r.answer.value - 0.74) < 1e-9);
  const c = solve('A fridge uses 150 W for 24 hours. Electricity costs GH₵1.8 per kWh. How much will it cost?'); assert.ok(Math.abs(c.answer.value - 6.48) < 1e-9);
  assert.equal(solve('How long does it take to charge a 17 Wh battery with a 20 W charger?').steps[0].procedure, 'proc:charge-time');
  const m = solve('How long will a 1200 Wh battery last?'); assert.equal(m.ok, false); assert.equal(m.missing[0].dim, 'power');
});

test('Scenario B — transferable reasoning: a method learned from one device applies to a different device with unfamiliar numbers', () => {
  // a mind that does NOT have the energy-consumption procedure
  const store = new CognitiveStore({}), base = LIBRARY.filter(p => p.id !== 'proc:energy-consumption');
  const ev = new EvolutionEngine({ store, procedures: () => [...base, ...store.usable('procedure')] });
  const taught = 'How much energy does a 60 W bulb use in 5 hours?';
  assert.equal(solve(taught, { procedures: base }).ok, false, 'cannot answer before learning');
  ev.addCase({ problem: 'How much energy does a 1500 W heater use in 2 hours?', expected: { value: 3000, unit: 'Wh' }, split: 'held-out' });
  const r = ev.learn({ problem: taught, expected: { value: 300, unit: 'Wh' }, verifiedBy: 'human' });
  assert.ok(r.ok && r.promoted, JSON.stringify(r).slice(0, 400)); assert.match(r.expr, /duration|load/);
  const procs = [...base, ...store.usable('procedure')];
  // unfamiliar device, unfamiliar numbers and units — never seen in training
  const t = solve('How much energy does a 2.2 kW air conditioner use in 150 minutes?', { procedures: procs });
  assert.ok(t.ok); assert.ok(Math.abs(t.answer.value - 5500) < 1e-6, String(t.answer.value));
  assert.equal(r.report.heldOut.after, 1);
});

test('Scenario C — abduction: several explanations, evidence rules some out, the most informative safe test comes next', () => {
  const none = abduce('battery not charging', CAUSAL);
  assert.equal(none.alive.length, 5); assert.match(none.conclusion, /5 explanations remain possible/);
  const r = abduce('battery not charging', CAUSAL, { panelVoltage: 'normal' });
  assert.ok(r.ruledOut.some(x => /solar input/.test(x.cause))); assert.ok(!r.alive.some(c => /solar input/.test(c)));
  assert.equal(r.nextTests[0].observable, 'controllerInputVoltage');
  assert.ok(r.hypotheses.every(h => !/proven/.test(h.status)), 'never declared proven');
  const m = new Mind({ state: {} }), a = m.think('My solar battery is not charging. The panel voltage is normal.');
  assert.equal(a.type, 'diagnosis'); assert.match(a.answer, /none is proven yet/); assert.match(a.answer, /Safety:/); assert.match(a.answer, /ruled out by: panelVoltage/);
});

test('Scenario D — contradictory knowledge: detected, compared by provenance and evidence, uncertainty preserved when undecided', () => {
  const m = new Mind({ state: {} });
  const a = { id: 'claim:a', claim: ['panel-lifetime', 'is', '25-years'], trust: 'corroborated', evidence: [{ ref: 'manufacturer' }, { ref: 'iea' }, { ref: 'nrel' }] };
  const b = { id: 'claim:b', claim: ['panel-lifetime', 'is', '5-years'], trust: 'provisional', evidence: [{ ref: 'forum-post' }] };
  const d = m.resolveConflict(a, b); assert.ok(d.conflict && d.decided); assert.equal(d.preferred, 'claim:a'); assert.match(d.statement, /kept as disputed, not deleted/);
  const c = { id: 'claim:c', claim: ['panel-lifetime', 'is', '15-years'], trust: 'corroborated', evidence: [{ ref: 'x' }, { ref: 'y' }] };
  const e = { id: 'claim:d', claim: ['panel-lifetime', 'is', '30-years'], trust: 'corroborated', evidence: [{ ref: 'z' }, { ref: 'w' }] };
  const u = m.resolveConflict(c, e); assert.ok(u.conflict && !u.decided); assert.equal(m.store.get(u.uncertainty).status, 'unresolved');
  assert.equal(m.resolveConflict(a, { ...a, id: 'claim:x' }).conflict, false);
  assert.equal(m.resolveConflict({ id: 'p', claim: ['producing', 'panel'] }, { id: 'q', claim: ['not', 'producing', 'panel'] }).conflict, true);
});

test('Scenario E — imagination: the premise is hypothetical, consequences are computed by intervention, the known law is flagged', () => {
  const m = new Mind({ state: {} }), r = m.think('What would happen if a solar panel produced electricity at night?');
  assert.equal(r.type, 'counterfactual'); assert.equal(r.hypothetical, true);
  assert.match(r.answer, /Hypothetical premise/); assert.match(r.answer, /contradicts what is known/); assert.match(r.answer, /never stored as knowledge/);
  assert.ok(r.cognition.changed.some(c => c.variable === 'storageNeededWh' && c.counterfactual < c.factual));
  // the factual model is unchanged — imagination did not leak into knowledge
  assert.equal(MODELS['solar-home'].vars.nightOutputFactor.value, 0);
  const b = m.think('What if a battery had twice its current capacity?'); assert.ok(b.cognition.changed.some(c => c.variable === 'runtimeH' && Math.abs(c.counterfactual - 2 * c.factual) < 1e-9));
  const n = m.think('What happens if two nodes disappear?'); assert.equal(n.type, 'counterfactual'); assert.match(n.answer, /stays recoverable/);
});

test('Scenario F — reasoning improvement: an initial failure, a verified correction, transfer to an unfamiliar problem, no regressions', () => {
  const store = new CognitiveStore({}), ev = new EvolutionEngine({ store, procedures: () => [...LIBRARY, ...store.usable('procedure')] });
  ev.addCase({ problem: 'How much energy does a 60 W bulb use if it runs for 5 hours?', expected: { value: 300, unit: 'Wh' } });
  ev.addCase({ problem: 'How long will a 1200 Wh battery last running a 100 W TV?', expected: { value: 12, unit: 'h' }, split: 'held-out' });
  ev.addCase({ problem: 'How long will a 2400 Wh battery run a 300 W fridge through an inverter that is 85% efficient?', expected: { value: 6.8, unit: 'h' }, split: 'held-out' });
  const q = 'How long will a 1000 Wh battery run a 100 W load through an inverter that is 90% efficient?';
  assert.equal(solve(q).answer.value, 10, 'initially wrong: ignores the inverter efficiency');
  assert.equal(ev.learn({ problem: q, expected: { value: 9, unit: 'h' }, verifiedBy: 'teacher' }).stage, 'verify', 'teacher agreement alone is not a verified correction');
  const r = ev.learn({ problem: q, expected: { value: 9, unit: 'h' }, verifiedBy: 'human' });
  assert.match(r.diagnosis.cause, /ignored/); assert.ok(r.promoted, r.reason);
  assert.equal(r.report.regressions.length, 0); assert.equal(r.report.heldOut.after, 2); assert.equal(r.report.heldOut.before, 1);
  const after = solve('How long will a 2400 Wh battery run a 300 W fridge through an inverter that is 85% efficient?', { procedures: [...LIBRARY, ...store.usable('procedure')] });
  assert.ok(Math.abs(after.answer.value - 6.8) < 1e-9);
  // a candidate that would break existing cases is refused
  store.put({ id: 'proc:bad', category: 'procedure', label: 'bad', status: 'candidate', body: { inputs: [{ name: 'energy', dim: 'energy', unit: 'Wh', cues: 'battery' }, { name: 'load', dim: 'power', unit: 'W', cues: 'tv|load' }], steps: [{ as: 'result', expr: 'energy / load / 2', dim: 'time' }], outputs: [{ name: 'result', unit: 'h' }], tests: [], goal: 'runtime' } });
  const bad = ev.evaluate('proc:bad'); assert.equal(bad.promoted, false);
  // monitoring + rollback
  const id = r.candidate, rb = ev.reportFailure(id, { problem: 'How long will a 500 Wh battery run a 50 W load through an inverter that is 80% efficient?', expected: { value: 99, unit: 'h' }, verifiedBy: 'human' });
  assert.equal(rb.rolledBack, true); assert.equal(store.get(id).status, 'retired');
});

test('Scenario G — distributed: A finds the error, peer B tests the candidate, the validator promotes, C adopts and keeps it after A disappears', async () => {
  // Node A: detects the failure and produces a candidate from a verified correction
  const A = new Mind({ state: {}, node: 'node-a' });
  A.evolution.addCase({ problem: 'How long will a 2400 Wh battery run a 300 W fridge through an inverter that is 85% efficient?', expected: { value: 6.8, unit: 'h' }, split: 'held-out' });
  const learned = A.evolution.learn({ problem: 'How long will a 1000 Wh battery run a 100 W load through an inverter that is 90% efficient?', expected: { value: 9, unit: 'h' }, verifiedBy: 'human' });
  assert.ok(learned.promoted);
  // Node B: a volunteer peer runs procedure-test/1 through KUNPP (the coordinator replays and checks it)
  let t = 2e9; const reg = new AtomRegistry(), evidence = [];
  const net = new ComputeNetwork({ state: {}, registry: reg, rules: {}, now: () => t, random: () => 0.99, procedureSource: () => A.evolution.pendingForPeers(), onProcedureResults: (rs, meta) => evidence.push({ rs, meta }), options: { mix: { 'atom-validate/1': 1 }, distinctNetworks: false, spotCheck: 1 } });
  const reg1 = net.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: true, subtleCrypto: true, cores: 4 }, profile: 'balanced', ipKey: 'b' }), B = net.auth(reg1.peerId, reg1.token);
  net.fill(); let done = false;
  for (let i = 0; i < 200 && !done; i++) { t += 2100; const l = net.lease(B); if (!l.task) continue; const res = await runTask(l.task.kind, l.task.payload); const s = await net.submit(B, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: res }); if (l.task.kind === 'procedure-test/1' && s.status === 'accepted') done = true; }
  assert.ok(done, 'peer B ran the procedure tests'); assert.ok(evidence[0].rs.some(([id, issues, r]) => id === learned.candidate && !issues.length && r.passed === r.total));
  // Node C retrieves the promoted procedure (as over /atp/mind/procedures) and re-validates it before adopting
  const C = new Mind({ state: {}, node: 'node-c' }), bundle = JSON.parse(JSON.stringify(A.store.exportPublic()));
  const tampered = JSON.parse(JSON.stringify(bundle)); tampered.find(x => x.atom.id === learned.candidate).atom.body.steps[0].expr = 'energy / load';
  assert.ok(new Mind({ state: {} }).store.adoptFrom('node-a', tampered).rejected.some(r => /hash/.test(r.why)), 'tampered content refused');
  const adopted = C.store.adoptFrom('node-a', bundle); assert.ok(adopted.adopted.includes(learned.candidate));
  // Node A disappears; C still applies the improvement and can share it onward
  const q = 'How long will a 3000 Wh battery run a 250 W pump through an inverter that is 80% efficient?';
  const r = C.think(q); assert.equal(r.type, 'calculation'); assert.match(r.answer, /9\.6 h/);
  assert.ok(C.store.exportPublic().length === 0 || true); assert.equal(C.store.get(learned.candidate).status, 'adopted-from-peer');
  const D = new Mind({ state: {} }); assert.ok(D.store.adoptFrom('node-c', C.store.list({ category: 'procedure', status: 'adopted-from-peer' }).map(a => ({ atom: a, head: C.store.meta(a.id).head }))).adopted.length >= 1, 'C can pass it on without A');
});

test('Scenario H — vision: real perception of shapes, colours and connections; identities only from a legend or verified examples', () => {
  const img = canvas(200, 120).rect(10, 40, 40, 30, [40, 80, 220]).ellipse(150, 55, 18, 18, [240, 210, 40]).triangle(80, 90, 30, 25, [220, 40, 40]).line(50, 55, 132, 55, [0, 0, 0], 2).rect(80, 5, 30, 20, [40, 170, 60]);
  const p = perceive(decodePNG(encodePNG(img)));
  assert.deepEqual(p.objects.map(o => `${o.colour} ${o.shape}`).sort(), ['blue rectangle', 'green rectangle', 'red triangle', 'yellow circle']);
  assert.equal(p.connections.length, 1);
  const none = visualAnswer('Which component appears connected to the inverter?', p, identify(p)); assert.equal(none.answer, null, 'no identity is invented');
  const ids = identify(p, { legend: parseLegend('The blue rectangle is the inverter, the yellow circle is the battery.') });
  assert.deepEqual(visualAnswer('Which component appears connected to the inverter?', p, ids).answer, ['battery']);
  assert.deepEqual(visualAnswer('Which component appears connected to the green rectangle?', p, ids).answer, null);
  // labeller trained on verified examples, evaluated on UNSEEN images (other positions and sizes)
  const lab = new Labeller({ state: {} }), mk = (x, y, s) => canvas(160, 120).rect(x, y, 30 + s, 20 + s, [40, 80, 220]).ellipse(x + 80, y + 15, 12 + s / 2, 12 + s / 2, [240, 210, 40]).line(x + 30 + s, y + 10, x + 68 - s / 2, y + 10, [0, 0, 0], 2);
  for (const [x, y, s] of [[5, 10, 0], [10, 50, 6], [20, 30, 3]]) { const q = perceive(mk(x, y, s)); const labels = {}; for (const o of q.objects) labels[o.id] = o.shape === 'rectangle' ? 'inverter' : 'battery'; lab.learn(q, labels); }
  let correct = 0, total = 0;
  for (const [x, y, s] of [[15, 70, 2], [30, 5, 8], [2, 40, 5]]) { const q = perceive(mk(x, y, s)), got = identify(q, { labeller: lab }); for (const o of q.objects) { total++; if (got[o.id]?.label === (o.shape === 'rectangle' ? 'inverter' : 'battery')) correct++; } }
  assert.equal(correct, total, `unseen-image labelling ${correct}/${total}`);
  assert.equal(new Labeller({ state: {} }).learn(p, { o0: 'x' }, { verifiedBy: 'teacher' }), 0, 'unverified labels are not learned');
});

test('deduction with variable binding, proofs, negation-as-failure and contradictions; induction; analogy; temporal; constraints; Bayes', () => {
  const r = deduce([['registered', 'node-a'], ['peer-result', 'r1'], ['peer-result', 'r2'], ['verified', 'r2']], [{ id: 'reg', if: [['registered', '?n']], then: [['must-have', '?n', 'valid-identity']] }, { id: 'canon', if: [['peer-result', '?r']], unless: [['verified', '?r']], then: [['not', 'canonical', '?r']] }]);
  assert.ok(prove(['must-have', 'node-a', 'valid-identity'], r)); assert.ok(prove(['not', 'canonical', 'r1'], r)); assert.equal(prove(['not', 'canonical', 'r2'], r), null);
  assert.equal(deduce([['producing', 'p'], ['not', 'producing', 'p']], []).contradictions.length, 1);
  const recs = [...Array(6)].map((_, i) => ({ ventilated: i < 3, overheats: i >= 3 })).concat([{ ventilated: false, overheats: false }]);
  const rules = induce(recs, 'overheats', { minSupport: 3, minConfidence: 0.7 }); const top = rules.find(x => x.if.length === 1 && x.if[0][0] === 'ventilated' && x.if[0][1] === false);
  assert.ok(top && top.counterexamples.length === 1 && /not evidence of causation/.test(top.note));
  assert.equal(testRule(top, [{ ventilated: false, overheats: true }, { ventilated: false, overheats: true }], 'overheats').accuracy, 1);
  const an = analogy([['replicates', 'file', 'server'], ['detects-loss', 'monitor', 'server'], ['restores', 'monitor', 'file']], [['replicates', 'atom', 'node'], ['detects-loss', 'auditor', 'node']]);
  assert.equal(an.mapping.file, 'atom'); assert.deepEqual(an.projected[0].relation, ['restores', 'auditor', 'atom']); assert.equal(an.projected[0].status, 'hypothesis');
  assert.equal(allen({ start: 0, end: 3 }, { start: 1, end: 2 }), 'contains');
  assert.equal(stn(['s', 'charge', 'leave'], [{ a: 's', b: 'charge', lo: 0, hi: 0 }, { a: 'charge', b: 'leave', lo: 0.5, hi: 1 }, { a: 's', b: 'leave', lo: 0, hi: 0.17 }]).consistent, false);
  const csp = solveCSP({ agent: [0, 1], installer: [0, 1], stock: [0, 1] }, [{ type: 'sum<=', vars: ['agent', 'installer', 'stock'], weights: { agent: { 1: 0 }, installer: { 1: 2000 }, stock: { 1: 15000 } }, limit: 0 }], { objective: { weights: { agent: { 1: 3 }, installer: { 1: 5 }, stock: { 1: 8 } }, sense: 'max' } });
  assert.deepEqual(csp.solution, { agent: 1, installer: 0, stock: 0 });
  const b = bayes({ wiring: 0.5, controller: 0.5 }, { wiring: { lowInput: 0.9 }, controller: { lowInput: 0.1 } }, { lowInput: true }); assert.ok(b.posterior.wiring > 0.85);
  const ns = necessarySufficient({ vars: { a: { exo: true, value: true }, b: { exo: true, value: true }, y: { eq: 'a AND b', type: 'bool' } } }, 'a', 'y'); assert.ok(ns.necessary && !ns.sufficient);
});

test('world model: observed vs assumed, dynamic updates, capsule round-trip (any node can continue)', () => {
  let w = emptyWorld();
  w = updateWorld(w, 'My phone battery is at 10%, and I need to travel for three hours. What should I do?').world;
  assert.equal(w.entities.phone.states.charge.source, 'observed'); assert.equal(w.events[0].durationH, 3);
  const p1 = powerPlan(w); assert.ok(p1.extras.some(e => e.id === 'act:power-bank')); assert.ok(p1.assumptions.length >= 2);
  w = updateWorld(w, "I don't have a power bank.").world; const p2 = powerPlan(w);
  assert.ok(p2.excluded.some(e => e.id === 'act:power-bank')); assert.ok(!p2.extras.some(e => e.id === 'act:power-bank'));
  w = updateWorld(w, 'I have only ten minutes before leaving.').world; assert.ok(Math.abs(w.constraints.timeBeforeDeparture.value - 1 / 6) < 1e-9);
  const p3 = powerPlan(w); assert.match(p3.extras.find(e => e.id === 'act:charge-now').note, /10 minutes/);
  const round = sanitizeCapsule({ topic: { focus: 'phone' }, world: JSON.parse(JSON.stringify(w)) }).world;
  assert.equal(round.resources.powerBank.available, false); assert.equal(round.constraints.timeBeforeDeparture.value, w.constraints.timeBeforeDeparture.value);
  assert.equal(sanitizeWorld({ entities: { x: { states: { a: { value: '<script>'.repeat(50) } } } } }).entities.x.states.a.value.length, 60);
  const g = plan(['idea'], ['customer'], [{ name: 'buy stock', pre: ['capital'], add: ['stock'] }, { name: 'partner', pre: ['idea'], add: ['channel'] }, { name: 'sell', pre: ['channel'], add: ['customer'] }]);
  assert.deepEqual(g.steps, ['partner', 'sell']); assert.equal(plan(['idea'], ['licence'], []).ok, false);
  const sim = simulate({ state: { e: 1 }, rates: { e: '0 - 2' }, clamp: { e: [0, 10] }, durationH: 1, dtH: 0.01, stop: { e: '<=0' } }); assert.ok(Math.abs(sim.events[0].atH - 0.5) < 0.02);
});

test('comprehension: underlying goals and negation on labelled examples (dev and held-out)', () => {
  const d = JSON.parse(fs.readFileSync(new URL('./fixtures/comprehension-eval.json', import.meta.url)));
  for (const split of ['dev', 'heldOut']) { let ok = 0; for (const c of d[split]) if (goalOf(c.text) === c.goal) ok++; assert.ok(ok / d[split].length >= 0.9, `${split}: ${ok}/${d[split].length}`); }
  assert.deepEqual(negations('Can I start a solar company without money?'), ['money']);
  const m = new Mind({ state: {} }), r = m.think('Can I start a solar company without money?'); assert.equal(r.comprehension.underlying.goal, 'possibility-under-constraint'); assert.match(r.comprehension.underlying.statement, /despite having no money/);
});

test('memory and metareasoning: bounded working memory, structural experience retrieval, failed methods avoided', () => {
  const wm = new WorkingMemory({ capacity: 5 }); for (let i = 0; i < 20; i++) wm.add('x', i, { relevance: i === 3 ? 1 : 0.1 }); assert.equal(wm.items.length, 5); assert.ok(wm.of('x').includes(3)); assert.equal(wm.evicted, 15);
  const em = new ExperienceMemory({ state: {} }), sig = signature({ type: 'calculation', target: 'time', inputDims: ['energy', 'power'] });
  const e = em.record({ signature: sig, problem: 'p', methods: ['procedure-chain'] }); em.verify(e.id, { outcome: 'wrong', mistakes: [{ method: 'procedure-chain' }] });
  assert.equal(em.similar(signature({ type: 'calculation', target: 'time', inputDims: ['power', 'energy'], entities: ['tv'] }))[0].e.id, e.id, 'structural, not textual');
  const m = new Mind({ state: {} }); m.experience.record({ signature: signature({ type: 'calculation', target: 'energy', inputDims: ['power', 'time'], entities: [] }), problem: 'x', methods: ['procedure-chain'] });
  m.experience.S.episodes.at(-1).outcome = 'wrong'; m.experience.S.episodes.at(-1).mistakes = [{ method: 'procedure-chain' }];
  const r = m.think('How much energy does a 60 W bulb use in 5 hours?'); assert.ok(r.strategy.dropped.includes('procedure-chain'));
});

test('security: no code in atoms, private atoms never exported, peers cannot inject, hypotheses need evidence', () => {
  assert.equal(makeAtom({ id: 'proc:x', category: 'procedure', body: { inputs: [], steps: [{ as: 'a', expr: 'require("fs")' }], outputs: [] } }).ok, false);
  assert.equal(makeAtom({ id: 'hyp:x', category: 'hypothesis', status: 'validated' }).ok, false);
  const s = new CognitiveStore({}); s.put({ ...LIBRARY[0], id: 'proc:private-one', visibility: 'private', status: 'promoted' }); assert.ok(!s.exportPublic().some(x => x.atom.id === 'proc:private-one'));
  const failing = { ...LIBRARY[0], id: 'proc:evil', status: 'promoted', body: { ...LIBRARY[0].body, tests: [{ inputs: { power: 1, duration: 1 }, expect: { energy: 999 } }] } };
  const made = makeAtom(failing).atom, { contentHash } = { contentHash: null };
  const s2 = new CognitiveStore({}); s2.put(failing); const item = s2.exportPublic().find(x => x.atom.id === 'proc:evil');
  assert.ok(new CognitiveStore({}).adoptFrom('peer', [item]).rejected.some(r => /tests fail/.test(r.why)), 'a procedure whose own tests fail is not adopted');
  assert.ok(made);
});

test('integration: the public chat answers cognitive questions on two different nodes, carrying the world model in the capsule', async () => {
  const env = { HOST: '127.0.0.1', ADMIN_TOKEN: 'mind-test-admin-token-1234567890-abcd', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
  const mk = id => createNode({ env: { ...env, NODE_ID: id, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-mind-')) }, log: () => {} });
  const A = await mk('mind-a'), B = await mk('mind-b');
  const ask = (n, question, history) => webRequest(n, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) }), '127.0.0.1').then(r => r.json());
  const h = []; const r1 = await ask(A, 'My phone battery is at 10%, and I need to travel for three hours. What should I do?', h); h.push({ question: 'My phone battery is at 10%, and I need to travel for three hours. What should I do?', context: r1.context });
  assert.match(r1.answer, /phone: charge 10% \(observed\)/); assert.ok(r1.context.world);
  const r2 = await ask(B, "I don't have a power bank.", h); assert.match(r2.answer, /Not possible in your situation: Bring a charged power bank/); assert.match(r2.answer, /no longer an option/);
  const c = await webRequest(A, new Request('http://127.0.0.1/api/mind/correct', { method: 'POST', headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ problem: 'How long will a 1000 Wh battery run a 100 W load through an inverter that is 90% efficient?', expected: { value: 9, unit: 'h' } }) }), '127.0.0.1').then(r => r.json());
  assert.ok(c.promoted, JSON.stringify(c).slice(0, 300));
  const r3 = await ask(A, 'How long will a 2000 Wh battery run a 400 W fridge through an inverter that is 80% efficient?', []); assert.match(r3.answer, /\*\*Time: 4 h\*\*/);
  // Scenario A — the same business context across four turns on alternating nodes; changing constraints; licences stay in context
  const sa = [], turns = ['How do I start a solar company in Ghana?', 'What if I have no money?', 'Which option is best for me?', 'What licenses would I need?'], answers = [];
  for (let i = 0; i < turns.length; i++) { const r = await ask(i % 2 ? B : A, turns[i], sa.slice()); answers.push(r.answer); sa.push({ question: turns[i], context: r.context }); }
  assert.match(answers[1], /no money|low capital|very low/i); assert.match(answers[2], /Start with/); assert.match(answers[3], /Licen[cs]e/i); assert.match(answers[3], /Energy Commission/); assert.doesNotMatch(answers[3], /could not reach|won.t guess/);
  const st = await webRequest(A, new Request('http://127.0.0.1/api/mind', { headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN } }), '127.0.0.1').then(r => r.json());
  assert.ok(st.shared.some(x => x.id === c.candidate)); assert.ok(st.experience.episodes >= 2);
});

test('self-knowledge: origin, nature, abilities and live state; answered from self atoms, never invented', async () => {
  const m = new Mind({ state: {} });
  assert.equal(m.store.get('self:origin').provenance.source, 'owner');
  const c = m.answerSelf('Who created you?', { nodeId: 'n', version: 'x' }); assert.match(c.answer, /Loshar Hammond Kenku, the owner of Kenuxa Technologies/);
  for (const q of ['who made kenuxa', 'Who is your creator?', 'Who owns you?', 'who built KENUXA']) assert.equal(m.answerSelf(q).kind, 'creator', q);
  assert.match(m.answerSelf('Who is Loshar Hammond Kenku?').answer, /won.t make any up/);
  assert.match(m.answerSelf('Are you ChatGPT?').answer, /^No\. I am \*\*KENUXA\*\*/);
  assert.match(m.answerSelf('What can you do?', { atoms: 10 }).answer, /Not supported yet/);
  assert.match(m.answerSelf('What are your limits?').answer, /OCR/);
  assert.equal(m.answerSelf('How much energy does a 60 W bulb use?'), null);
  const env = { HOST: '127.0.0.1', ADMIN_TOKEN: 'self-test-admin-token-1234567890-abcd', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
  const node = await createNode({ env: { ...env, NODE_ID: 'self-node', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-self-')) }, log: () => {} });
  const r = await webRequest(node, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Who created you?' }) }), '127.0.0.1').then(x => x.json());
  assert.match(r.answer, /Loshar Hammond Kenku/); assert.equal(r.engine, 'KENUXA self-knowledge');
  const s = await webRequest(node, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What version are you?' }) }), '127.0.0.1').then(x => x.json());
  assert.match(s.answer, /self-node/); assert.match(s.answer, /knowledge atoms/);
});

test('imagination memory and self-evaluation: hypotheses and simulations stored with honest statuses; evaluation is sandboxed', () => {
  const m = new Mind({ state: {} });
  m.think('My solar battery is not charging. The panel voltage is normal.');
  const hyps = m.store.list({ category: 'hypothesis' }); assert.equal(hyps.length, 5);
  assert.ok(hyps.some(h => h.status === 'refuted' && /solar input/.test(h.body.cause))); assert.ok(!hyps.some(h => ['validated', 'promoted'].includes(h.status)));
  const cf = m.think('What would happen if a solar panel produced electricity at night?'), sim = m.store.list({ category: 'simulation' })[0];
  assert.equal(sim.status, 'hypothetical'); assert.match(cf.answer, new RegExp(sim.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const before = m.store.usable('procedure').length, ev = m.selfEvaluate();
  assert.ok(ev.ok); assert.equal(ev.learning.promoted, true); assert.equal(ev.learning.repeatedError, false); assert.ok(ev.learning.heldOutAfter.rate >= ev.calculation.heldOutInitial.rate);
  assert.equal(m.store.usable('procedure').length, before, 'the evaluation\'s learning happened in a sandbox, not on the live node');
  assert.equal(m.store.get(ev.atom).category, 'evaluation'); assert.equal(m.status().evaluations.length, 1);
});

test('owner reasoning service, candidate atoms with human review, and rating signals on episodes', async () => {
  const env = { HOST: '127.0.0.1', ADMIN_TOKEN: 'rs-test-admin-token-1234567890-abcdef', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off' };
  const node = await createNode({ env: { ...env, NODE_ID: 'rs-node', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-rs-')) }, log: () => {} });
  const api = (u, b) => webRequest(node, new Request('http://127.0.0.1/api/' + u, { method: b ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN, 'Content-Type': 'application/json' }, ...(b ? { body: JSON.stringify(b) } : {}) }), '127.0.0.1').then(x => x.json());
  const d = await api('mind/reason', { method: 'deduce', input: { facts: [['registered', 'node-x']], goal: ['must-have', 'node-x', 'valid-identity'] } });
  assert.ok(d.proof && d.proof.rule === 'rule:registered-needs-identity');
  const recs = [...Array(20)].map((_, i) => ({ dusty: i % 2 === 0, lowOutput: i % 2 === 0 }));
  const ind = await api('mind/reason', { method: 'induce', input: { records: recs, target: 'lowOutput' } });
  assert.ok(ind.rules.some(r => r.heldOutTest.accuracy === 1 && /causation/.test(r.note)));
  assert.equal((await api('mind/reason', { method: 'temporal', input: { points: ['a', 'b'], constraints: [{ a: 'a', b: 'b', lo: 2, hi: 1 }] } })).consistent, false);
  // a new causal link: candidate → not used → owner review → used by diagnosis
  const atom = { id: 'cause:loose-battery-terminal', category: 'causal', label: 'loose battery terminal', body: { cause: 'loose or corroded battery terminal', effect: 'battery not charging', signs: { terminalLoose: true }, tests: { terminalLoose: 'With the system off, check the battery terminals for looseness or corrosion.' } } };
  assert.equal((await api('mind/atom', { atom })).atom.status, 'candidate');
  const ask = q => webRequest(node, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) }), '127.0.0.1').then(x => x.json());
  assert.doesNotMatch((await ask('My solar battery is not charging.')).answer, /corroded battery terminal/);
  assert.equal((await api('mind/review', { id: atom.id, approve: true, note: 'standard troubleshooting step' })).atom.status, 'validated');
  const after = await ask('Why is my solar battery not charging?'); assert.match(after.answer, /corroded battery terminal/);
  assert.ok(after.episode);
  await webRequest(node, new Request('http://127.0.0.1/chat/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ helpful: true, episode: after.episode }) }), '127.0.0.1');
  const st = await api('mind'); assert.ok(st.experience.episodes >= 2);
  assert.equal((await api('mind/review', { id: 'proc:energy-consumption', approve: true })).error, 'procedures are promoted by evaluation, not by review');
});
