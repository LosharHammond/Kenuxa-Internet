// KENUXA Evolving Cognitive Engine (v1.7) — the subsystems working as one:
// comprehension → world model → strategy controller → methods (procedures, abduction, causal models, planning,
// simulation, deduction) in a bounded working memory → answer from the actual operations → experience record.
// Evolution, perception and distributed testing share the same cognitive atom store.
import { CognitiveStore } from './atoms.mjs';
import { LIBRARY, solve, targetOf, explainSolution } from './procedures.mjs';
import { parseQuantities } from './quantities.mjs';
import { abduce, counterfactual, evaluateModel } from './causal.mjs';
import { deduce, contradictions } from './logic.mjs';
import { updateWorld, sanitizeWorld, describeWorld, emptyWorld } from './world.mjs';
import { powerPlan, planDiff } from './planner.mjs';
import { WorkingMemory, ExperienceMemory, signature } from './memory.mjs';
import { StrategyController, features } from './controller.mjs';
import { EvolutionEngine } from './evolution.mjs';
import { deepComprehend } from './comprehend.mjs';
import { MODELS, RULES, seedAtoms } from './knowledge.mjs';
import { Labeller, perceive, identify, parseLegend, visualAnswer, perceptionAtoms, decodePNG } from './vision.mjs';
import { TRUST_RANK } from '../atoms/schema.mjs';
import { selfQuestion, selfAnswer, SELF_ATOMS, ORIGIN } from './self.mjs';
import { contentHash } from '../atoms/codec.mjs';
import { runEvaluation } from './evaluate.mjs';

const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en') : +v.toPrecision(3)) : String(v);
const hm = h => h >= 1 ? `${fmt(h)} h` : `${Math.round(h * 60)} min`;
// which observation a diagnosis question is about
const EFFECTS = [{ re: /\b(battery|batteries)\b.*\b(not|isn'?t|won'?t|doesn'?t|stopped|no longer)\b.*\bcharg|\bnot charging\b|\bwon'?t charge\b|\bfails? to charge\b/i, effect: 'battery not charging' }, { re: /\b(phone|battery)\b.*\b(drains?|dies?|dying|runs? out)\b.*\b(fast|quick|quickly|so soon)\b|\bwhy does my phone die\b/i, effect: 'phone battery drains fast' }];
// reading evidence for the causal signs out of what the person said (only explicit statements count)
const SIGN_READERS = {
  panelVoltage: [[/panel (voltage )?(is |reads |shows )?(normal|fine|ok|good|correct)|panel voltage is (normal|fine|ok)/i, 'normal'], [/panel (voltage )?(is |reads |shows )?(low|zero|0 ?v)|no voltage (from|at) the panel/i, 'low']],
  sunny: [[/\b(sunny|full sun|bright sun|clear sky|in the sun)\b/i, true], [/\b(cloudy|overcast|shade|shaded|at night|rainy)\b/i, false]],
  controllerInputVoltage: [[/controller input (voltage )?(is )?(normal|fine|ok)/i, 'normal'], [/controller input (voltage )?(is )?(low|zero)|no voltage at the controller/i, 'low']],
  controllerOutputVoltage: [[/controller output (voltage )?(is )?(normal|fine|ok)/i, 'normal'], [/controller output (voltage )?(is )?(low|zero)/i, 'low']],
  controllerError: [[/\b(error code|fault code|error light|blinking red|flashing red)\b/i, true], [/no error|no fault/i, false]],
  fuseOk: [[/fuse (is )?(fine|ok|good|intact)/i, true], [/(blown|broken) fuse|fuse (is )?(blown|broken)/i, false]],
  batteryHot: [[/battery (is |feels )?(hot|very warm|swollen)/i, true], [/battery (is )?(cool|cold|not hot)/i, false]],
  bmsTripped: [[/\b(bms|protection) (has )?(tripped|triggered|on)\b|protection mode/i, true]],
  batteryVoltage: [[/battery voltage (is )?(very low|below|under|dead)/i, 'very low']],
  screenOnLong: [[/\b(watch|stream|video|games?|screen on|scrolling|tiktok|youtube)\b/i, true]], weakSignal: [[/\b(weak|poor|no) (signal|network|coverage)\b/i, true]],
  batteryHealthLow: [[/\b(old phone|battery health (is )?(low|\d{2}%)|years old)\b/i, true]], backgroundAppsHigh: [[/\b(background|location (is )?on|gps)\b/i, true]],
};
function readEvidence(text, signs) { const ev = {}; for (const s of signs) for (const [re, v] of SIGN_READERS[s] || []) if (re.test(text)) { ev[s] = v; break; } return ev; }

export class Mind {
  constructor({ state = {}, now = () => Date.now(), node = null } = {}) {
    this.S = state; this.S.store ||= {}; this.S.experience ||= {}; this.S.controller ||= {}; this.S.evolution ||= {}; this.S.labeller ||= {};
    this.now = now; this.node = node;
    this.store = new CognitiveStore({ state: this.S.store, now, node });
    if (!this.S.seeded) { for (const a of seedAtoms()) this.store.put(a, { reason: 'seed' }); for (const p of LIBRARY) this.store.put(p, { reason: 'seed library' }); this.S.seeded = 'v1.7'; }
    // non-destructive migration: self-knowledge atoms (origin facts carry owner provenance)
    if (this.S.selfSeeded !== 'v1.8') { for (const a of SELF_ATOMS) this.store.put({ ...a, category: 'self', status: 'validated', confidence: 1, evidence: [{ kind: 'human', ref: 'owner', detail: 'stated by the owner of KENUXA' }], provenance: { source: 'owner' } }, { reason: 'self-knowledge' }); this.S.selfSeeded = 'v1.8'; }
    this.experience = new ExperienceMemory({ state: this.S.experience, now });
    const strategy = this.store.get('strategy:default'); this.controller = new StrategyController({ state: this.S.controller, routes: strategy.body.routes });
    this.evolution = new EvolutionEngine({ store: this.store, state: this.S.evolution, now, procedures: () => this.procedures() });
    this.labeller = new Labeller({ state: this.S.labeller });
  }
  // evolvable policies (lib/evolve): memory bounds and the evolution engine's search settings
  setPolicies({ memory = null, learning = null } = {}) { if (memory) { this.memoryPolicy = memory; this.experience.max = memory.experienceEpisodes; } if (learning) this.evolution.settings = learning; }
  // questions about KENUXA itself, answered from self atoms + live facts supplied by the node
  answerSelf(text, facts = {}) {
    const kind = selfQuestion(text); if (!kind) return null;
    const origin = this.store.get('self:origin');
    return { handled: true, type: 'self', kind, answer: selfAnswer(kind, { ...facts, learned: this.store.usable('procedure').filter(p => String(p.id).startsWith('proc:learned')).length, procedures: this.procedures().length, episodes: this.experience.stats().episodes }), engine: 'KENUXA self-knowledge', confidence: 95, trace: [`Self-knowledge question (${kind}); origin record ${origin ? `${origin.id} v${this.store.meta(origin.id).version} (provenance: ${origin.provenance.source})` : 'missing'}; live state read from this node`] };
  }
  procedures() { const usable = this.store.usable('procedure'); const ids = new Set(usable.map(p => p.id)); return [...usable, ...LIBRARY.filter(p => !ids.has(p.id))].filter(p => this.store.get(p.id)?.status !== 'retired'); }
  causes() { return this.store.usable('causal').map(a => a.body); }

  // ---------------- the main entry ----------------
  think(text, { world: prevWorld = null, understanding = null, interpretation = null, tone = null, context = null, budgetMs = 400 } = {}) {
    const t0 = performance.now(), wm = new WorkingMemory({ capacity: this.memoryPolicy?.workingMemoryItems || 64 }), trace = [];
    const { world, changes } = updateWorld(prevWorld || emptyWorld(), text, { interpretation });
    if (changes.length) { wm.add('observation', changes, { relevance: 0.9 }); trace.push('World model updated: ' + changes.join('; ')); }
    const comp = deepComprehend(text, { understanding, interpretation, tone, world, context });
    wm.add('goal', comp.underlying, { relevance: 1 }); trace.push(`Comprehension: literal intent ${comp.literal.intent || '—'}; underlying goal ${comp.underlying.goal}${comp.negated.length ? '; negated: ' + comp.negated.join(', ') : ''}`);
    const quantities = parseQuantities(text), target = targetOf(text);
    const premise = Object.entries(MODELS).flatMap(([id, m]) => m.premises.filter(p => p.re.test(text)).map(p => ({ model: id, ...p })))[0] || null;
    const f = features(text, { world, quantities, target, causalEffects: EFFECTS, premiseMatch: premise });
    // a world-model follow-up ("I don't have a power bank") continues the situation even without a question
    if (!f.type && prevWorld && changes.some(c => /^(resource|constraint)/.test(c)) && world.events.length) f.type = 'situation';
    if (!f.type) return { handled: false, reason: 'not a problem type the cognitive engine handles', world, comprehension: comp, ms: performance.now() - t0 };
    const sig = signature({ type: f.type, target: target?.dim || null, inputDims: quantities.map(q => q.dim), entities: Object.keys(world.entities) });
    const avoid = this.experience.avoid(sig), choice = this.controller.choose(f.type, { avoid });
    trace.push(`Strategy controller: problem type “${f.type}”; methods ${choice.methods.join(' → ')}${choice.dropped.length ? ` (dropped after verified failures on similar problems: ${choice.dropped.join(', ')})` : ''}`);
    const similar = this.experience.similar(sig, { k: 3 }); if (similar.length) { wm.add('experience', similar.map(x => ({ id: x.e.id, outcome: x.e.outcome, s: +x.s.toFixed(2) })), { relevance: 0.6 }); trace.push(`Experience: ${similar.length} structurally similar episode(s) (best similarity ${similar[0].s.toFixed(2)}; outcomes: ${similar.map(x => x.e.outcome).join(', ')})`); }
    let out = null; const attempts = [];
    for (let i = 0; i < choice.methods.length; i++) {
      const m = choice.methods[i], ts = performance.now(); let a;
      try { a = this.run(m, { text, f, world, prevWorld, quantities, target, premise, comp, wm }); } catch (e) { a = { ok: false, reason: 'error: ' + e.message }; }
      const ms = performance.now() - ts; attempts.push({ method: m, ok: !!a.ok, ms: +ms.toFixed(2), reason: a.reason || null });
      if (a.supporting) { wm.add('conclusion', { method: m, note: a.note }, { relevance: 0.5 }); if (out) { out.notes = [...(out.notes || []), a.note].filter(Boolean); continue; } }
      if (a.ok && !out) out = a;
      const d = this.controller.decide(a, { remaining: choice.methods.slice(i + 1), budgetLeftMs: budgetMs - (performance.now() - t0) });
      trace.push(`Metareasoning after ${m}: ${d.next} — ${d.why}`);
      if (d.next === 'ask') { out = a; break; } if (d.next === 'give-up') break; if (d.next === 'stop' && !choice.methods.slice(i + 1).some(x => ['safety-check', 'rule-consistency', 'simulation'].includes(x))) break;
    }
    for (const a of attempts) this.controller.record(f.type, a.method, { ok: a.ok, ms: a.ms });
    const ms = performance.now() - t0;
    const ep = this.experience.record({ signature: sig, problem: text, methods: attempts.map(a => a.method), operations: (out?.operations || []).slice(0, 20), answer: out?.answerValue ?? null, outcome: out?.ok ? 'unverified' : out?.missing ? 'needs-information' : 'failed', ms: +ms.toFixed(2) });
    if (!out || (!out.ok && !out.missing)) return { handled: false, reason: attempts.map(a => `${a.method}: ${a.reason}`).join('; ') || 'every applicable method was dropped', world, comprehension: comp, trace, strategy: choice, ms };
    world.plan = out.planIds || prevWorld?.plan || undefined;
    return { handled: true, type: f.type, answer: out.text, confidence: out.confidence ?? 70, engine: `KENUXA cognitive engine · ${f.type}`, strategy: choice, attempts, trace: [...trace, ...(out.trace || [])], world, comprehension: comp, episode: ep.id, workingMemory: wm.snapshot(), hypothetical: f.type === 'counterfactual', ms: +ms.toFixed(2), cognition: out.cognition || null };
  }

  // ---------------- methods ----------------
  run(method, ctx) {
    const { text, world, prevWorld, target, premise, wm } = ctx;
    if (method === 'procedure-chain') {
      const r = solve(text, { procedures: this.procedures(), target });
      if (!r.ok) return r.reason === 'missing information' ? { ok: false, missing: r.missing.map(m => `${m.name} (${m.dim})`), critical: true, reason: r.reason, text: `To compute the ${target?.label || 'answer'} I need one more value: **${r.missing.map(m => `${m.name} (${m.dim})`).join(', ')}** — used by “${r.missing[0]?.label}”. I won’t assume it.`, confidence: 60 } : { ok: false, reason: r.reason };
      for (const s of r.steps) wm.add('procedure', { id: s.procedure, output: s.output }, { relevance: 0.8 });
      const cur = parseQuantities(text).find(q => q.currency)?.currency?.toUpperCase();
      const unit = r.answer.unit === 'money' ? (cur || 'currency units') : r.answer.unit;
      const unused = r.unusedQuantities.filter(q => q.dim !== 'number');
      return { ok: true, confidence: unused.length ? 65 : 90, answerValue: r.answer.value, operations: r.steps.map(s => ({ procedure: s.procedure, trace: s.trace })),
        text: `**${target.label[0].toUpperCase() + target.label.slice(1)}: ${fmt(r.answer.value)} ${unit}**${target.dim === 'time' && r.answer.unit === 'h' && r.answer.value < 1 ? ` (${Math.round(r.answer.value * 60)} minutes)` : ''}\n\nHow I computed it (the procedures actually run):\n${explainSolution(r).replace(/ money\*\*/g, ` ${unit}**`)}\n\nInputs I used: ${r.steps.flatMap(s => Object.entries(s.why).map(([k, v]) => `${k} = ${v}`)).join('; ')}.${unused.length ? `\n\n_I did not use: ${unused.map(q => q.raw).join(', ')} — no procedure I have takes it into account. If it matters, the result may be off; a verified correction will teach me._` : ''}`,
        cognition: { method, steps: r.steps.map(s => ({ procedure: s.procedure, output: s.output })) } };
    }
    if (method === 'experience-reuse') return { ok: false, supporting: true, reason: 'supporting method', note: null };
    if (method === 'abduction') {
      const effect = ctx.f.diagnosisTarget, causes = this.causes().filter(c => c.effect === effect); if (!causes.length) return { ok: false, reason: 'no causal knowledge for this observation' };
      const evidence = readEvidence(text, [...new Set(causes.flatMap(c => Object.keys(c.signs || {})))]);
      const r = abduce(effect, causes, evidence);
      // imagination memory: each explanation is a hypothesis atom whose status follows the evidence (never 'validated' by itself)
      for (const h of r.hypotheses) this.store.put({ id: `hyp:${contentHash([effect, h.cause]).slice(0, 12)}`, category: 'hypothesis', label: `${h.cause} explains “${effect}”`, status: h.disagree.length ? 'refuted' : h.agree.length && !h.unknown.length ? 'supported' : h.agree.length ? 'tested' : 'hypothetical', confidence: null, visibility: 'private',
        body: { observation: effect, cause: h.cause, assumptions: ['the observation is reported correctly', 'only one cause is acting'], supporting: h.agree, contradicting: h.disagree, expected: h.signs, validation: h.unknown.map(u => h.tests[u] || u), uncertainty: h.unknown.length ? `${h.unknown.length} sign(s) not yet observed` : 'all known signs checked' }, evidence: Object.entries(evidence).map(([k, v]) => ({ kind: 'observation', ref: k, detail: String(v) })), provenance: { source: 'abduction' } }, { reason: 'diagnosis episode' });
      wm.add('hypothesis', r.hypotheses.map(h => ({ cause: h.cause, status: h.status })), { relevance: 0.9 });
      const lines = r.hypotheses.map(h => `- **${h.cause}** — ${h.status}${h.agree.length ? ` (fits: ${h.agree.join(', ')})` : ''}${h.disagree.length ? ` (ruled out by: ${h.disagree.join(', ')})` : ''}`);
      const tests = r.nextTests.map(x => x.how ? `- ${x.how}${x.splits ? ` _(separates ${Object.values(x.groups).map(g => g.length).join(' / ')} of the remaining explanations)_` : ''}` : null).filter(Boolean);
      const safety = [...new Set(r.hypotheses.filter(h => !h.disagree.length && h.safety).map(h => h.safety))];
      return { ok: true, confidence: 60, operations: [{ abduction: { evidence, alive: r.alive, ruledOut: r.ruledOut.map(x => x.cause) } }],
        text: `**Possible explanations for “${effect}”** (none is proven yet — ${r.conclusion}):\n${lines.join('\n')}\n\n${Object.keys(evidence).length ? `Evidence I used from your message: ${Object.entries(evidence).map(([k, v]) => `${k} = ${v}`).join(', ')}.\n\n` : 'You have not given any measurements yet, so all explanations remain open.\n\n'}**Safest next checks, most informative first:**\n${tests.join('\n') || '- (no further tests known)'}${safety.length ? `\n\n**Safety:** ${safety.join(' ')}` : ''}`,
        cognition: { method, alive: r.alive, ruledOut: r.ruledOut, nextTests: r.nextTests.map(x => x.observable), evidence } };
    }
    if (method === 'causal-tests' || method === 'safety-check' || method === 'rule-consistency' || method === 'simulation' || method === 'uncertainty') return { ok: false, supporting: true, reason: 'supporting method', note: null };
    if (method === 'scm-intervention') {
      const m = MODELS[premise.model], cf = counterfactual(m, premise.interventions, { exogenous: premise.exogenous || {} });
      // which known laws does the premise contradict? (deduction over the rule atoms in a hypothetical world)
      const laws = Object.entries(m.vars).filter(([k, v]) => v.law && k in premise.interventions && evaluateModel(m, { exogenous: premise.exogenous || {} }).values[k] !== premise.interventions[k]).map(([k, v]) => v.law);
      const ded = deduce([['solar-panel', 'p'], ['dark', 'p'], ['hypothesis', 'premise']], RULES.map(r => r.body ? r.body : r));
      const changed = cf.changed.filter(c => !c.intervened);
      wm.add('simulation', { premise: premise.says, changed }, { relevance: 0.9 });
      const simId = `sim:${premise.model}:${contentHash(premise.interventions).slice(0, 10)}`;
      this.store.put({ id: simId, category: 'simulation', label: `what if ${premise.says}`, status: 'hypothetical', visibility: 'private', body: { model: premise.model, premise: premise.says, interventions: premise.interventions, assumptions: [premise.assumption], contradicts: laws, changed: changed.map(c => ({ variable: c.variable, factual: c.factual, counterfactual: c.counterfactual })) }, provenance: { source: 'counterfactual simulation' } }, { reason: 'imagination' });
      const show = v => typeof v === 'boolean' ? (v ? 'yes' : 'no') : fmt(v);
      return { ok: true, confidence: 55, operations: [{ counterfactual: { premise: premise.interventions, changed: changed.map(c => c.variable) } }],
        text: `_Hypothetical premise: ${premise.says}. This is not how things are — I am reasoning inside a “what if” world, not stating a fact._\n\n${laws.length ? `**It contradicts what is known:** ${laws.join('; ')}.\n\n` : ''}**Model used:** ${m.label}. **Assumption:** ${premise.assumption}.\n\n**What changes compared with the real case** (computed by intervening on the model and comparing):\n${changed.map(c => `- ${c.variable}: ${show(c.factual)} → **${show(c.counterfactual)}**`).join('\n') || '- nothing in this model'}\n\n${premise.model === 'solar-home' ? 'So in that world a home system would need less (or no) battery storage for the night and would collect more energy per day; everything else in the model stays as it is.' : premise.model === 'atom-storage' ? `So the atom ${cf.counterfactual.recoverable ? `stays recoverable (${cf.counterfactual.available} of ${m.vars.n.value} fragments left, ${m.vars.k.value} needed; margin ${cf.counterfactual.margin})` : 'can no longer be reconstructed from the remaining fragments'}.` : ''}\n\n_Recorded as simulation atom ${simId} (status: hypothetical) — never stored as knowledge._`,
        cognition: { method, premise: premise.says, changed, laws, deduced: ded.steps.map(s => s.derived) } };
    }
    if (method === 'world-model') return { ok: false, supporting: true, reason: 'supporting method', note: null };
    if (method === 'planning') {
      const p = powerPlan(world, { actions: this.store.usable('action').map(a => a.body) }); if (!p.ok) return { ok: false, reason: p.reason, missing: world.unknowns, critical: false };
      const nowIds = [...p.chosen, ...p.extras].map(c => c.id), prevIds = prevWorld?.plan || null, nameOf = id => this.store.get(id)?.body?.name || id;
      const diff = prevIds ? [...prevIds.filter(id => !nowIds.includes(id)).map(id => { const ex = p.excluded.find(e => e.id === id); return `no longer an option: ${nameOf(id)}${ex ? ` (${ex.why})` : ''}`; }), ...nowIds.filter(id => !prevIds.includes(id)).map(id => `new: ${nameOf(id)}`)] : [];
      const changedNumbers = prevWorld && JSON.stringify(prevWorld.constraints || {}) !== JSON.stringify(world.constraints) ? Object.keys(world.constraints).filter(k => JSON.stringify(prevWorld.constraints?.[k]) !== JSON.stringify(world.constraints[k])).map(k => `recomputed with the new constraint ${k}`) : [];
      diff.push(...changedNumbers);
      const W = describeWorld(world);
      return { ok: true, confidence: 70, planIds: [...p.chosen, ...p.extras].map(c => c.id), operations: [{ plan: p.chosen.map(c => c.id), excluded: p.excluded.map(e => e.id) }],
        text: `**Your situation as I understand it:**\n${W.map(l => '- ' + l).join('\n')}\n\n**Plan (steps you can certainly take):**\n${p.chosen.length ? '' : '- (none of the certain steps changes the outcome)'}${p.chosen.map(c => `- ${c.name}${c.status === 'conditional' ? ` — _only if ${c.needs.map(n => ({ chargerAvailable: 'a charger and socket are available now', chargingEnroute: 'you can charge on the way', powerBank: 'you have a power bank' })[n] || n).join(' and ')}_` : ''}`).join('\n')}${p.extras.length ? `\n\n**If you can, also:**\n${p.extras.map(e => `- ${e.name} — _only if ${e.needs.map(n => ({ chargerAvailable: 'a charger and socket are available now', chargingEnroute: 'you can charge on the way', powerBank: 'you have a power bank' })[n] || n).join(' and ')}_: ${e.note === 'depends on how many minutes you can charge' ? 'how much it adds depends on how many minutes you can charge' : `adds about ${hm(Math.max(0, e.gainPessimisticH))} at the pessimistic end${e.note ? ` (${e.note})` : ''}`}; ${e.makesItLast === 'yes' ? 'enough for the whole journey' : e.makesItLast === 'possibly' ? 'possibly enough' : 'still not enough on its own'}`).join('\n')}` : ''}${p.excluded.length ? `\n\nNot possible in your situation: ${p.excluded.map(e => `${e.name} (${e.why})`).join('; ')}.` : ''}${diff.length ? `\n\n**What changed since my last answer:** ${diff.join('; ')}.` : ''}\n\n**Will it last ${hm(p.needH)}?** ${p.sufficient}. Estimated battery time with this plan: ${hm(p.result.pessimisticH)} (pessimistic) to ${hm(p.result.optimisticH)} (optimistic); without changes: ${hm(p.baseline.pessimisticH)}–${hm(p.baseline.optimisticH)}.${p.simulation.runsOutAtH ? ` At the pessimistic end the battery runs out after about ${hm(p.simulation.runsOutAtH)}.` : ''}\n\n**Assumptions** (tell me the real values and I will recompute): ${p.assumptions.join('; ')}.${world.unknowns.length ? `\n\n**Still unknown:** ${world.unknowns.join('; ')}.` : ''}`,
        cognition: { method, plan: p.chosen, extras: p.extras.map(e => ({ id: e.id, needs: e.needs, gainPessimisticH: e.gainPessimisticH, makesItLast: e.makesItLast, note: e.note })), excluded: p.excluded, result: p.result, assumptions: p.assumptions, diff } };
    }
    if (method === 'provenance-comparison' || method === 'forward-chaining') return { ok: false, reason: 'used through the API' };
    return { ok: false, reason: 'unknown method ' + method };
  }

  // ---------------- contradictory knowledge (Scenario D) ----------------
  // a, b: { id, claim: [subject, relation, object], trust: TRUST_RANK key, evidence: [{ kind, ref, independent? }], at }
  resolveConflict(a, b, { exclusive = true } = {}) {
    const sameSlot = a.claim[0] === b.claim[0] && a.claim[1] === b.claim[1], neg = contradictions([a.claim, b.claim]).length > 0;
    if (!neg && !(sameSlot && exclusive && a.claim[2] !== b.claim[2])) return { conflict: false };
    const score = x => ({ trust: TRUST_RANK[x.trust] ?? 1, independent: new Set((x.evidence || []).filter(e => e.independent !== false).map(e => e.ref)).size, at: x.at || 0 });
    const sa = score(a), sb = score(b), factors = [];
    let lead = 0; if (sa.trust !== sb.trust) { lead += Math.sign(sa.trust - sb.trust) * 2; factors.push(`trust: ${a.trust} vs ${b.trust}`); }
    if (sa.independent !== sb.independent) { lead += Math.sign(sa.independent - sb.independent) * Math.min(2, Math.abs(sa.independent - sb.independent)); factors.push(`independent sources: ${sa.independent} vs ${sb.independent}`); }
    const decided = Math.abs(lead) >= 2, preferred = decided ? (lead > 0 ? a : b) : null;
    const unc = { id: `unc:${a.id}:${b.id}`.toLowerCase().replace(/[^a-z0-9:._-]+/g, '-').slice(0, 120), category: 'uncertainty', label: `conflict between ${a.id} and ${b.id}`, status: decided ? 'validated' : 'unresolved', body: { a: a.claim, b: b.claim, factors, preferred: preferred?.id || null }, evidence: [...(a.evidence || []), ...(b.evidence || [])].slice(0, 20), provenance: { source: 'conflict detection' } };
    this.store.put(unc, { reason: 'contradiction detected' });
    return { conflict: true, decided, preferred: preferred?.id || null, factors, uncertainty: unc.id, statement: decided ? `${preferred.id} is better supported (${factors.join('; ')}); the other claim is kept as disputed, not deleted.` : `The two claims conflict and the evidence does not decide between them (${factors.join('; ') || 'equal trust and support'}); both are kept and the conflict is recorded as unresolved.` };
  }

  // ---------------- perception (Scenario H) ----------------
  see(png, { legend = '', question = null } = {}) {
    const img = decodePNG(png), p = perceive(img), ids = identify(p, { legend: parseLegend(legend), labeller: this.labeller });
    const atoms = perceptionAtoms(p); for (const a of atoms.slice(0, 40)) this.store.put(a, { reason: 'perception' });
    return { perception: p, identities: ids, answer: question ? visualAnswer(question, p, ids) : null, atoms: atoms.map(a => a.id) };
  }
  // Self-evaluation: sandboxed run of the evaluation sets; the result is an evaluation atom plus a history entry
  selfEvaluate() {
    const r = runEvaluation(Mind, { live: this }); if (!r.ok) return r;
    const prev = (this.S.evaluations ||= []).at(-1); this.S.evaluations.push(r); if (this.S.evaluations.length > 20) this.S.evaluations.shift();
    const id = `eval:${r.at.slice(0, 19).replace(/[^0-9]/g, '')}`;
    this.store.put({ id, category: 'evaluation', label: `self-evaluation ${r.at}`, status: 'tested', visibility: 'public', body: r, evidence: [{ kind: 'test', ref: 'tests/fixtures', detail: 'labelled evaluation sets, sandboxed' }], provenance: { source: 'self-evaluation' } }, { reason: 'self-evaluation' });
    const trend = prev ? { calculationHeldOut: [prev.calculation.heldOutInitial.rate, r.calculation.heldOutInitial.rate], diagnosis: [prev.diagnosis.rate, r.diagnosis.rate] } : null;
    return { ...r, atom: id, trend };
  }
  status() { return { evaluations: (this.S.evaluations || []).slice(-5).map(e => ({ at: e.at, calcHeldOut: e.calculation.heldOutInitial.rate, afterLearning: e.learning.heldOutAfter.rate, diagnosis: e.diagnosis.rate, comprehensionHeldOut: e.comprehension.heldOut.goal.rate })), store: this.store.status(), experience: this.experience.stats(), strategies: this.controller.status(), evolution: this.evolution.status(), labeller: { examples: this.S.labeller.examples?.length || 0 } }; }
}
export { sanitizeWorld };
