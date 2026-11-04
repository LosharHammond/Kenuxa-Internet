# KENUXA: one cognitive system (runtime architecture)

## The only runtime truth

`server.mjs` runs `createNode` from `lib/node.mjs`. Do **not** add an independent chatbot, answer server or learning process. The public `/chat/ask` and authenticated `/api/ask` use the same node state, atom registry, and reasoning components. Public fast paths are coordinated by `UnifiedCognition`; owner research routes retain their full structured response-plan contract.

### Shared request pipeline

```text
Incoming question + conversation identity
 -> authenticated account / privacy boundary
 -> UnifiedCognition (contextual premises + validated skills + dictionary ontology)
 -> existing word atomization + grammar + discourse + comprehension
 -> existing Mind strategy controller (procedure / causal / planning / simulation)
 -> existing ledger / sources / peer / teacher fallback
 -> verified/uncertain result with provenance
 -> bounded outcomes and feedback (not automatically factual knowledge)
```

Unresolved questions **fall through** to existing retrieval rather than produce invented answers. Every answer is tagged by the kind of evidence. The `contextualAnswer` and `semanticReasoner` implementations are **adapters**; they must never be separate public entry points.

### Shared developmental pipeline

```text
Existing atom registry + WordNet + Wikidata + verified public knowledge
 -> incremental FoundationTrainingCorpus
 -> morphological and corpus-induced grammar
 -> developmental relation curriculum / provenanced knowledge atoms
 -> DevelopmentalLearning + program-induction search
 -> held-out validation + contradiction / rollback controls
 -> candidate transformer CPU worker
 -> gated held-out and regression evaluation
 -> promoted model version (never promote unverified chat assertions)
```

`UnifiedCognition.tick` controls the active `AutonomousLearningEngine`. The transformer performs genuine numeric gradient updates; the resulting model is experimental and **not** an automatically capable general-language model. A validated learned symbolic skill is not a general-world fact and must not be passed off as such.

## Principles enforced by code

1. **One node, one durable state.** There is no competing writable memory database for the modules. `FileStore` and `SupabaseStore` are storage adapters, not minds.
2. **Every word can be an atom.** Lexicon atoms carry sense IDs and provenance; a missing sense remains *unknown*.
3. **Conversation premises are private and provisional.** Do not publish them to shared peer knowledge. User consent governs personal learning; a user correction is feedback, not authoritative fact.
4. **Meaning is compositional.** Dictionary senses, hypernym paths, lexical morphology, POS grammar and sentence semantics contribute to reasoning. WordNet is not evidence for arbitrary contemporary facts.
5. **Skill discovery is declarative.** `program-induction.mjs` searches a CPU-bounded typed operation grammar, never runs generated JS, shell or network commands, and does not hardcode solutions for individual questions.
6. **Generalization requires evidence.** The same data may not simultaneously train and independently evaluate a new skill. Contradictions invalidate rules. A candidate procedure requires separate held-out predictions, and retraining cannot silently undo retirement.
7. **Training is not truth.** Generated text from teacher or from a transformer is not a verified fact. Candidate weights pass evaluation before promotion; restore is available.
8. **Autonomy is bounded.** Interactive latency takes priority over background work. Every learning loop has a finite limit; no private conversation is automatically added to the shared model training corpus.
9. **Network membership is not consensus about truth.** Signed peers can offer content, but local validators must independently check candidates.
10. **Failures are visible.** CI must check all modules' syntax and integration, not merely tests of individual files. GitHub Actions handles live deployment smoke testing separately.

## Data and integration inventory

- `lib/atoms/registry.mjs`: content-addressed word, lexical and semantic atoms, source preservation
- `lib/foundation/catalog.mjs`: lazily loaded, hash-verified WordNet 3.0
- `lib/mind/unified-cognition.mjs`: common request/learning coordinator and evidence provenance
- `lib/mind/index.mjs`: existing cognitive store, procedural controller, world model and learning experiments
- `lib/mind/developmental-learning-core.mjs`: persistent verified examples and learned programs
- `lib/mind/program-induction.mjs`: general typed, bounded hypothesis language and held-out verifier
- `lib/mind/autonomous-learning.mjs`: scheduled curriculum, vocabulary, morphology, grammar, verified skills, model corpus
- `lib/transformer/index.mjs`: candidate-vs-served model and automatic evaluation/rollback
- `lib/store.mjs`: durable file/Supabase state, graph mirrors and blob checkpoints
- `lib/mesh.mjs` and `lib/peers/network.mjs`: peer trust, compute and federation
- `lib/node.mjs`: the **only** application composition root and HTTP surface

## Rules for changes by Claude or any contributor

1. Before creating a new module, identify its owner above. Prefer extending the existing mechanism or adding a pure internal capability; do not create an independent public answer route.
2. Give every new learned assertion an identity, provenance, scope, and validation status.
3. Wire it into `UnifiedCognition` or its existing specialized component and include an end-to-end public chat test; a unit test by itself is insufficient.
4. Run `npm test` and `node scripts/check-unified-architecture.mjs` and inspect the *actual* GitHub Actions results. Never claim deployment verified merely because files were committed.
5. Do not claim arbitrary full AGI; maintain explicit capability boundaries and measurable held-out generalization.

## Owner visibility

- `GET /api/unified/status`: authenticated unified module + knowledge inventory
- `GET /api/autonomous/status`: authenticated autonomous-learning status
- `POST /api/autonomous/tick`: authenticated bounded learning cycle
- `POST /api/developmental/learn`: authenticated examples, validation, discovery and rollback

Check exact active routing and authentication rules in `lib/node.mjs` when changing endpoint behavior.
