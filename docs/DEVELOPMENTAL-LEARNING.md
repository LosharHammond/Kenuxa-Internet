# Developmental learning experiment (v1)

This is a deliberately bounded research module, **not** general comprehension or autonomous AGI.

- `lib/mind/developmental.mjs` learns deterministic state/action/outcome transitions from opaque identifiers (not words).
- Two consistent observations produce a *candidate*, never a validated fact.
- Conflicting observations suspend prediction. Independent verified held-out trials are required for promotion.
- No pretrained models, teacher API, GPU, arbitrary generated code, or network calls.
- Caller owns persistence by passing a serializable `state` object. This module is **not yet wired into public chat or background scheduling**.

Run: `node --test tests/developmental.test.mjs`.

Next research steps: structured state representations; factorized/compositional transitions; active experimentation in sandbox environments; curriculum advancement with unseen tasks; persistence and audit integration; broader language grounding. Do not treat repeating the same observation as independent evidence or self-generated predictions as ground truth. The current validation API trusts the caller's verified-test label; production integration must authenticate that provenance.
