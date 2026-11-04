# Developmental learning experiment (v1)

This is a deliberately bounded research module, **not** general comprehension or autonomous AGI.

- `lib/mind/developmental.mjs` learns deterministic state/action/outcome transitions from opaque identifiers (not words).
- Two consistent observations produce a *candidate*, never a validated fact.
- Conflicting observations suspend prediction. Independent verified held-out trials are required for promotion.
- No pretrained models, teacher API, GPU, arbitrary generated code, or network calls.
- Caller owns persistence by passing a serializable `state` object. It is now wired into the existing Mind state and explicit laboratory methods, but **not** into public chat or background scheduling.

Run: `node --test tests/developmental.test.mjs`.

Next research steps: structured state representations; factorized/compositional transitions; active experimentation in sandbox environments; curriculum advancement with unseen tasks; persistence and audit integration; broader language grounding. Do not treat repeating the same observation as independent evidence or self-generated predictions as ground truth. The current validation API trusts the caller's verified-test label; production integration must authenticate that provenance.

## Cognitive engine integration

`Mind` constructs `DevelopmentalLearner` using `state.developmental`, which follows the existing Mind state ownership and can be persisted by the node's normal state serialization when that state is saved. Explicit calls: `developmentalObserve`, `developmentalPredict`, `developmentalValidate`, `developmentalStatus`. These do not expose untrusted HTTP writes or claim that natural-language understanding is solved.

Validation trials require distinct `testId` values. This only checks uniqueness, **not independence or authenticity**. A future trusted experiment runner must generate and authenticate trials before they are accepted as evidence. Do not expose these methods to unauthenticated clients.

## Isolated experimental environment

`lib/mind/developmental-lab.mjs` defines a deterministic bounded `ToyWorld` and `DevelopmentalLab`. The world exposes opaque state/action identifiers; the learner is not given the transition formula. `Mind.developmentalExperiment({ world: { states, actions, seed }, repetitions, maxExperiments })` runs explicit, synchronous experiments. It is intentionally not connected to public chat, HTTP, or a recurring background scheduler. Test with `node --test tests/developmental*.test.mjs`.

**Evaluation limit:** this experiment observes each transition before testing it. It measures acquisition of a deterministic transition table, not compositional generalization. Trial IDs are distinct but tests share the same simulated world, so they are not independent external evidence. For genuine generalization, future benchmarks must withhold states or entire environments, vary symbol encodings, and score only unseen tasks. Autonomous scheduling should be gated by CPU budgets, consent, and regression checks.

## Compositional transfer milestone

`lib/mind/developmental-generalize.mjs` introduces a **bounded modular affine hypothesis search**: given structured examples `{state, action, next}`, it enumerates hypotheses of the form `next = (a*state + b*action + c) mod modulus` and accepts a rule only when the search identifies a unique consistent hypothesis within its budget. `evaluateModularRule` scores separately supplied unseen input combinations. `tests/developmental-generalize.test.mjs` includes withheld state/action combinations and ambiguity/conflict tests.

This is deliberately a separate research module, not an automatic upgrade to all language reasoning. The hypothesis family is developer-defined; KENUXA discovers its coefficients, not the existence of modular arithmetic itself. No independent CI result was available when these changes were authored.
