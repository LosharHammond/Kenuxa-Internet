# KENUXA Evolving Cognitive Engine (v1.7–v1.8)

This version adds a cognitive layer on top of the atomic knowledge network. It changes how KENUXA *applies* knowledge, not how much it stores. Everything described as implemented here runs on a CPU, with no model, GPU or paid service. It is covered by tests (`tests/mind.test.mjs`) and measured by `bench/mind.bench.mjs`. Anything that is not implemented is listed as such in §12.

## 1. Repository audit (Phase 1)

The audit reads the v1.6 code before any change.

| Area | What existed | Status before v1.7 |
|---|---|---|
| Atomic DNA | Six-section DNA for word, sense, concept and phrase atoms. Content-addressed revisions, manifests and history (`lib/atoms/registry.mjs`, `schema.mjs`, `codec.mjs`). | Works. Covers *knowledge* atoms only: no procedures, rules, experiences, hypotheses or strategies. |
| Language | Tokens become lexical atoms, plus grammar roles, part-of-speech-aware senses, discourse, coreference, ellipsis and idioms (`lib/atoms/language.mjs`). | Works. Reused unchanged. |
| Reasoning | IS_A closure and classification. CAUSES chains learned from statements (`lib/atoms/reasoning.mjs`). Evidence-assessed claims (`lib/live/claims.mjs`). | Works, but narrow: only "is X a Y" and "what causes X". There was no deduction with variables, abduction with evidence, counterfactuals, planning or constraints. |
| Methods | `lib/live/methods.mjs`: a restricted interpreter for price comparison. | Works, for one family only, with no units and no dimensional checks. |
| Context and memory | Client-held context capsules (`cognition/context.mjs`). Signed-in user memory. Tone readings (`cognition/tone.mjs`). | Works. There was no structured situation model. |
| Response | A priority cascade in `node.mjs answerQuestion`: memory, statement learning, IS_A reasoning, knowledge packs, emotion, own atoms, network, web, then teacher composition. A `verifyAnswer` step and a response plan. | Works. The cognitive engine is inserted *into* this cascade, not beside it. |
| Teacher | Grok/xAI and others in `providers.mjs`. A student-first `learnCycle` with dissection and root causes (`learning/curriculum.mjs`, `learning/dissect.mjs`). | Works. Root causes did not cover calculation, assumption, strategy or simulation errors. |
| Distribution | The ATP mesh, live consensus, preservation, and KUNPP/2 volunteer computing (`lib/peers/*`). | Works. It had no cognitive task kind and no way to share methods between nodes. |
| Tests | 137 passing tests across 20 files. | — |

**Defects found while building v1.7 (all fixed):**

- **Wrong follow-up handling.** "What licences would I need?" after the solar-company conversation fell through to web research and lost the Ghana context. This broke Scenario A. A single-word definition question ("What is a kente?") was also treated as a follow-up and answered with the previous topic.
- **KUNPP cost gate.** The global gate only knew kinds that already had cost records, so a new task kind could never be leased.
- **Procedure-test verification.** The core's partial re-check replaced the peer's full results.
- **Role binding.** A solar procedure was applied to a light bulb, because one input had a default value and the role words were ignored.
- **Phrasing gaps.** "how many 400 W panels" and "why does my phone die so fast" were not recognised (both found by the held-out set; see §10).

## 2. Architecture

```
message ─► language.mjs (lexical atoms, senses, grammar) ─► comprehension.mjs + context.mjs (intent, capsule)
                │
                ▼
   lib/mind/index.mjs  Mind.think()
     ├─ world.mjs        Atomic World Model: entities/states, events, goals, constraints, resources, unknowns
     │                   (observed / inferred / assumed), updated per message, carried in the capsule
     ├─ comprehend.mjs   underlying goal vs literal question, negation scope, missing information, pragmatics
     ├─ controller.mjs   problem features → strategy route → ordered methods (measured records, avoided failures)
     │                   → metareasoning after each attempt: stop / try next / ask / give up
     ├─ methods          procedures.mjs (dimension-checked procedure chains)   causal.mjs (abduction, SCM,
     │                   counterfactuals, necessary/sufficient)   planner.mjs (STRIPS A*, interval power planner)
     │                   simulate.mjs (bounded time-step simulation, recombination)   logic.mjs (deduction,
     │                   induction, analogy, temporal STN, CSP, Bayes)   vision.mjs (perception)
     ├─ memory.mjs       bounded Working Memory per episode · Experience Memory (structural retrieval)
     └─ atoms.mjs        CognitiveStore: versioned, content-addressed cognitive atoms
   evolution.mjs       verified correction → diagnosis → synthesis → held-out + regression test → promote / refute
                       → version → monitor → rollback
   KUNPP procedure-test/1   volunteer peers re-run candidate procedures' tests (public, declarative)
   ATP /atp/mind/procedures promoted public atoms, signed; adopted by other nodes only after local re-validation
```

**Where it runs.** In `answerQuestion` the engine runs after the private-memory, statement-learning, IS_A and method stages. It runs before knowledge packs, except for knowledge-pack follow-ups, which keep their own path.

**When it answers.** It answers only when it recognises a problem type it can compute: calculation, diagnosis, counterfactual or situation. Otherwise the existing cascade continues unchanged. `COGNITIVE_ENGINE=off` disables it.

**What the response plan records.** Every answer's plan carries `cognition`:

- the comprehension result
- the strategy chosen and why
- each attempt, with its time
- the working-memory size and evictions
- the episode id
- the structured result

## 3. Cognitive DNA (Phase 2) — `lib/mind/atoms.mjs`

**Shared base.** Every cognitive atom has:

- `id` and `category`
- `label` and `semantics`
- `relations`
- `preconditions`, `contexts` and `goals`
- `body` (the type-specific extension)
- `evidence` and `provenance`
- `status` and `confidence`
- `uncertainty`, `tests`, `failures` and `experiences`
- `visibility`
- `createdAt` and `updatedAt`

Fields that do not apply to a category are omitted.

**Categories:**

- rule
- procedure
- experience
- goal
- constraint
- hypothesis
- simulation
- perception
- evaluation
- strategy
- uncertainty
- causal
- action

Lexical, meaning, concept and relationship atoms remain the existing registry atoms.

**Statuses:**

- hypothetical
- candidate
- tested
- validated
- promoted
- refuted
- retired
- unresolved
- adopted-from-peer

**Storage.**

- Each revision is `sha256(canonical MessagePack)` using the same codec as knowledge atoms.
- History keeps 20 revisions, and `rollback()` restores the previous one.
- The store lives in the node state, so it shares the configured durable store and its preservation.

**Validation rules:**

- A procedure must pass the dimensional check.
- A rule needs `if` and `then`.
- A hypothesis cannot be marked validated without evidence.
- Atoms containing code or markup are refused.

### Executable procedure atoms

The kernel is shared verbatim by core and peers in `lib/peers/tasks.mjs`. A procedure is data: typed inputs with a physical dimension and a unit, steps, outputs, and test cases.

**Expressions.** Allowed: numbers, names, `+ - * / ^`, parentheses, and `min max abs round ceil floor`. There is no eval and no code.

**Dimensional analysis.** Base dimensions are E, T, Q, M, L and N.

- Adding watts to hours is refused.
- A step declared as energy that computes a time is refused.
- An output unit that does not match its dimension is refused.

**Units.** Wh/kWh/J, W/kW, h/min/s/day, Ah/mAh, V, A/mA, %, m/m², and currencies (no conversion between currencies). They are converted to base units.

**Library.** Eight procedures, each with hand-computed tests:

- energy consumption
- energy cost
- battery energy
- remaining energy
- runtime
- charging time
- daily solar energy
- panels needed

**Composition.** `solve()` chains procedures backwards from the requested dimension, for example runtime ← remaining energy ← battery energy.

- It binds stated quantities to inputs by dimension, then by role words, then by order.
- A procedure whose bound inputs match none of its role words is not applicable.
- It keeps every complete chain, and prefers the one that uses the most stated quantities, then the most role-word matches, then the fewest defaults.
- If an input is missing, it says which one and does not assume it.

## 4. World model, comprehension, memory (Phases 3, 5, 6)

**World model** (`world.mjs`).

- **Entities** have observed states, such as battery charge 10%, capacity and draw.
- **Events** are things like a journey with a duration.
- **Goals** are inferred, with success conditions.
- **Constraints** include the time before departure.
- **Resources** are recorded as available or unavailable, e.g. "I don't have a power bank" makes it unavailable.
- **Unknowns** list what the planner needs but nobody said.
- **Each item records its source:** observed, inferred or assumed.
- **Updates.** Every message is applied as an update and the changes are listed.
- **Continuity.** The model is sanitised into the capsule (`context.world`), so the next turn can be answered by a different node (tested with two nodes).

**Deep comprehension** (`comprehend.mjs`).

- **Underlying goal.** Ten goal types: possibility-under-constraint, procedure, decision, explanation, diagnosis, hypothetical, calculation, comparison, information, emotional.
- **Example.** "Can I start a solar company without money?" is read as literal: confirm a possibility; underlying: *find a realistic way despite having no money*.
- **Negation scope:** what the person lacks.
- **Missing information** for the problem at hand.
- **Ambiguities and references** come from `language.mjs`.
- **Pragmatic readings.** "I'm fine." / "I'm fine..." / "Oh, I'm FINE!" get several weighted readings from `tone.mjs`, never a certainty.

**Working memory.** It is bounded at 64 items, ranked by relevance and recency, and it counts evictions. It holds observations, goals, experience hits, procedures, hypotheses, simulations and conclusions. It lives for one episode only, and is never user memory.

**Experience memory.** Each episode is a structured record:

- the signature: problem type, target dimension, input dimensions and entities
- the methods and operations used
- the answer and outcome
- mistakes, corrections and lessons

Retrieval is by structural similarity, not by text. Methods with verified failures on structurally similar episodes (similarity ≥ 0.7) are dropped by the controller (tested).

## 5. Reasoning engine (Phase 4) — `logic.mjs`, `causal.mjs`, `controller.mjs`

| Method | Implementation | Test |
|---|---|---|
| Deduction | Forward chaining with variable binding, stratified negation-as-failure (`unless`), proof trees, and contradiction detection (`not`, exclusive relations) | "registered node ⇒ must have a valid identity"; unverified peer result ⇒ not canonical |
| Abduction | Hypotheses from causal atoms, including one level of chaining. Signs are compared with explicit evidence: agree, disagree or unknown. The next test is chosen by how evenly it splits the surviving hypotheses. Bayes is used **only** when every hypothesis carries priors and likelihoods. | Scenario C |
| Induction | Single- and two-condition rules with support, confidence and counterexamples. Labelled as correlations, with a held-out `testRule` | overheating example |
| Analogy | Structure mapping by relation names (branch and bound). Projected relations are hypotheses, and `applicable` needs ≥ 2 matched relations and ≥ 50% coverage. | file replication → atom preservation |
| Causal | Structural causal models (boolean and numeric equations), `do()` interventions, counterfactuals against the factual run, and necessary/sufficient checks by enumerating background conditions | Scenario E, `necessarySufficient` |
| Constraints | Backtracking CSP with bounds pruning and branch-and-bound optimisation (`sum<=`, `sum>=`, requires, excludes, neq, eq) | zero-budget business option |
| Temporal | Allen interval relations, and a simple temporal network (Floyd–Warshall) that detects an infeasible schedule | 10-minute charge versus departure |
| Metareasoning | The controller orders methods by Laplace-smoothed verified success on this problem type, drops methods that failed on similar problems, and after each attempt decides to stop, try the next method, ask, or give up | memory and metareasoning test |

## 6. Hypotheses, simulation, planning (Phases 9, 15)

**Counterfactuals.** Premises are matched to a causal model's variables, then the model is intervened on and compared with the factual run.

- **Models:** a solar home system, a battery, and atom storage (k-of-n).
- **Labelling.** The answer is labelled hypothetical. It states which known law the premise contradicts, and the assumption that was needed (for example, "at night the panel delivers 20%").
- **No leakage.** The model's factual values are unchanged afterwards (tested).

**Simulation.** Euler time steps over explicit rate expressions, with clamps and stop conditions; used for battery timelines.

**Recombination.** `recombine()` pools the properties and uses of two concepts' DNA and lists conflicts. The result is always a hypothesis.

**Planning:**

- **General planner.** STRIPS-style A* with deadline and budget limits. When it fails, it explains why (for example, nothing can produce a licence).
- **Power planner.** Uses interval arithmetic: every assumption (capacity, average draw, effect of each action) is a range.
  - A plan is "sufficient" only if it works at the pessimistic end.
  - The core plan uses only certainly-possible actions.
  - Actions that depend on unknown resources are listed separately, with their computed gain.
  - Excluded actions are listed with the reason.
  - The plan is recomputed every turn and compared with the previous one.
- **Action safety.** Plans are advice. Nothing is executed.

## 7. Evolution (Phases 7, 8) — `evolution.mjs`

**Cycle:**

1. Attempt.
2. Verify against an **independent** correction: `human`, `test`, `reference` or `measurement`. A teacher alone is refused (tested).
3. Diagnose:
   - an ignored quantity (invalid assumption)
   - no applicable procedure
   - a faulty procedure
4. Synthesise candidates. The search enumerates expressions with ≤ 3 operands, pruned by dimensional analysis, over all verified *dev* cases with the same input dimensions.
5. Store the candidate.
6. Evaluate:
   - its own tests
   - the full case bank before and after
   - the failing case must be fixed
   - there must be **no regressions**
   - held-out must not get worse
   - **contamination check:** held-out cases must not be among the training cases
7. Promote or refute, with versioning.
8. Monitor with `reportFailure`: a verified failure after promotion retires the atom (rollback).

**What evolves live.** Only declarative atoms (procedures, rules, causal links, strategy records). Executable code never changes at run time.

**Teacher dissection** (`learning/dissect.mjs`). Root causes now include:

- `calculation-error`
- `invalid-assumption`
- `poor-strategy-selection`
- `simulation-error`
- `unverified-evidence`

Each cause maps to the PART 12.3 taxonomy (`errorClass`). A disagreement with the teacher is queued for verification (`/api/mind` → `review`). It is never learned from directly.

## 8. Vision (Phase 10) — `vision.mjs`

**Implemented** (pure JavaScript, CPU only):

- PNG decoding (8-bit, all filters and colour types) and encoding
- background estimation
- colour segmentation into 4-connected components
- shape by fill ratio and elongation: rectangle, circle/ellipse, triangle, line
- line-contact connections between objects
- spatial relations: left-of, above, inside
- perception atoms carrying the measurements and the image hash

**Object identity is never invented.** It comes from either:

- a legend for the image ("the blue rectangle is the inverter"), or
- a nearest-neighbour labeller trained on *verified* labelled examples and evaluated on unseen images (tested).

Unverified labels are refused.

**Visual questions.** `visualAnswer` answers connection and count questions only from detected structure. When the needed identity is unknown it says so.

**Not implemented (optional future components):**

- OCR (tesseract.js is CPU-only but needs ~10 MB of language data per language)
- photographs of real scenes
- learned object detectors (ONNX models on CPU are possible but too slow and large for a free Render instance)

Images go through `/api/mind/see` (owner only, within the 64 KB request limit).

## 9. Distribution (Phase 11)

- **KUNPP kind `procedure-test/1`.** Volunteer peers (browsers or agents) re-run the test cases of public candidate and promoted procedures in the same kernel.
  - Verification is by replica or core spot-check.
  - Accepted results are attached as `peer-test` evidence. Peer evidence never promotes anything by itself.
  - Private atoms are never sent.
- **Sharing between nodes.** `GET /atp/mind/procedures` returns promoted public atoms, signed by the node.
  - `mindSync` runs in every mesh tick. It pulls from up to 3 good peers, verifies the signature, and **re-validates locally** before adopting: content hash, schema, and the atom's own tests in this node's kernel.
  - Tampered or failing atoms are refused (tested).
- **Durability.** An adopted atom keeps working, and can be passed on, after the origin node disappears (Scenario G).

## 10. Evaluation (Phase 12)

**Tests.**

- `npm test` runs the full repository suite.
- `tests/mind.test.mjs` has 15 tests: the kernel, composition, Scenarios A–H, the reasoning methods, the world model, comprehension, memory and metareasoning, security, and two-node chat integration.

**Benchmark.** `node bench/mind.bench.mjs` was measured on this sandbox (single CPU).

| Category | Result |
|---|---|
| Comprehension: underlying goal (dev / held-out) | 20/20 · 20/20 |
| Comprehension: negation scope (dev / held-out) | 20/20 · 20/20 |
| Calculation, dev | 7/7 |
| Calculation, held-out, before learning | first run 7/10; 8/10 after the phrasing fix below |
| After **one** verified correction (inverter efficiency) | **10/10** (first run 9/10). Promoted with 0 regressions. The two held-out problems with an efficiency stage, never seen in training, now pass. |
| Repeated error on the corrected problem | none |
| Diagnosis (abduction) | first run 4/5; 5/5 after the fix below |
| Counterfactuals: expected variables change, law flagged | 3/3 |
| Planning adaptation over 3 turns | 3/3 |
| Vision: detection on 12 generated scenes / connection questions | 36/36 · 12/12 |
| Time per episode (median / p90) | calculation 0.27 / 0.83 ms · diagnosis 0.27 / 0.83 ms · counterfactual 0.32 / 1.3 ms · situation 0.96 / 3.1 ms |
| Heap growth over 120 episodes | ≈ 2.3 MB |

**The phrasing fixes.** The first held-out run failed on "How many **400 W** panels…" and "Why does my phone **die so fast**?". Both patterns were fixed after seeing the failures. The held-out set is therefore no longer untouched for those two phrasings, and the second-run numbers should be read with that in mind.

**Limits of the evaluation sets.** They are small and written by the same author as the code, so independence is limited. They show that the mechanisms work. They do **not** establish general comprehension or reasoning ability.

## 11. Security review

| Risk | Control |
|---|---|
| Code execution through atoms | Procedures are data. The expression parser accepts only numbers, names, operators and six maths functions, and atoms with code or markup are refused (tested). |
| Peers corrupting knowledge | Peer results are evidence only. Promotion needs the core's own evaluation. Adopted atoms are re-hashed and re-tested locally. Imported atoms get status `adopted-from-peer`, never `promoted`. |
| Self-reinforcing errors | Corrections need an independent verifier. A teacher answer alone is refused. Held-out cases used in training block promotion. A verified post-promotion failure triggers rollback. |
| Imagination leaking into facts | Counterfactuals run on a copy with interventions and are labelled hypothetical. A hypothesis cannot be validated without evidence. |
| Private data | The world model lives in the client capsule (sanitised and size-bounded). Cognitive atoms default to public only for library or learned methods; perception atoms are private. `exportPublic()` never exports private atoms. |
| Capsule tampering | `sanitizeWorld` bounds every field (lengths, counts, types). A forged capsule can only change the person's own situation description. |
| Resource use | Bounded searches: synthesis ≤ 60,000 expressions, CSP ≤ 200,000 nodes, planner ≤ 50,000 nodes, simulation ≤ 20,000 steps, working memory 64 items, experience store 2,000 episodes. |

## 12. Deployment, limitations, roadmap

**Deployment.**

- No new dependencies, environment variables or migrations are required.
- `state.mind` is created on first start, and older state files are untouched.
- Settings:
  - `COGNITIVE_ENGINE=off` disables the engine in answers.
  - The ATP sharing route follows `KENUXA_NETWORK`.
- Owner routes:
  - `GET /api/mind`
  - `POST /api/mind/correct`, `/case`, `/failure`, `/rollback`, `/conflict`, `/see`, `/label`
- **Nothing is deployed to production by this change.**

**Demonstrated:**

- procedure execution and composition with units
- abduction with evidence and test selection
- counterfactuals on explicit models
- multi-turn situation planning across nodes
- verified-correction learning with held-out transfer and rollback
- structural experience retrieval
- distributed procedure testing and sharing
- CPU perception of synthetic diagrams

**Experimental:**

- goal classification and negation reading (pattern rules, small evaluation set)
- evidence reading for diagnosis (explicit statements only)
- typical-value assumption ranges for phones

**Not supported:**

- OCR and real photographs
- open-domain planning beyond the action atoms that exist
- causal models other than the three listed
- probabilistic answers without an explicit model
- learning from corrections whose answer is not a single number

**Roadmap:**

1. Let the evolution engine also propose rule, causal and action atoms from verified corrections. Today it synthesises procedures only.
2. Move goal and evidence readers from patterns to the grammar layer's roles.
3. Add an optional OCR worker as a dedicated-agent capability with a probe (KUNPP Type D).
4. Gossip experience *lessons* (not private episodes) between nodes.
5. Run a larger evaluation set written by someone other than the code's author.

## 13. What v1.8 completed

**Self-knowledge** (`lib/mind/self.mjs`).

- **Origin.** KENUXA knows it was **created by Loshar Hammond Kenku, the owner of Kenuxa Technologies**. This is stored as the self atom `self:origin`, with owner provenance.
- **Facts about itself:**
  - its name
  - that it is not a large language model
  - how it uses a teacher
- **Questions it recognises:** who created, made, owns or built it; who Loshar Hammond Kenku is; what Kenuxa Technologies is; who or what it is; "Are you ChatGPT, Grok or a human?"; what it can do; its limits; how it works; its version and status.
- **Where the answers come from:** these atoms, plus **live** node state (version, node id, atom count, procedures and learned procedures, experience episodes, trusted peers, volunteers, teacher).
- **Honest capability list:** demonstrated, experimental, not supported.
- **No invented biography.** Asked about the creator or the company beyond the origin record, it says it holds no further details.
- **Priority.** Self answers take priority in the chat cascade, so neither cached answers nor teacher composition can change them.
- **Seed lesson replaced.** The outdated "small answer-selection model" seed lesson now carries the same origin.
- **Migration.** Existing nodes receive the self atoms through a non-destructive migration (`selfSeeded`).

**Imagination memory, done properly.** v1.7's counterfactual answers *said* they were recorded but stored nothing; this is now fixed.

- Every diagnosis stores one hypothesis atom per explanation. Its status follows the evidence (hypothetical, tested, supported, refuted) and never becomes validated by itself. Each hypothesis atom carries:
  - assumptions
  - supporting and contradicting signs
  - expected consequences
  - validation steps
  - uncertainty
- Every counterfactual stores a simulation atom (`sim:…`, status hypothetical). The answer quotes its id.

**Self-evaluation engine** (`lib/mind/evaluate.mjs`).

- `POST /api/mind/evaluate` (and the Studio button) runs the labelled evaluation sets against a **sandbox copy** of the live procedures, so the learning test never changes the live node.
- The result is stored as an evaluation atom, plus a history of the last 20 runs with the trend.
- Each run measures:
  - comprehension
  - calculation (dev, and held-out before and after learning)
  - the repeated-error rate
  - diagnosis, counterfactuals, planning and vision
  - time per episode, CPU, heap
  - verification reliability
- `bench/mind.bench.mjs` now runs the same code.

**Evolution beyond procedures:**

- `POST /api/mind/atom` adds a candidate rule, causal link, action or strategy. Candidates are not used.
- `POST /api/mind/review` lets the owner approve or refute it, recorded as human evidence.
- Approved causal links are used by diagnosis immediately. This is tested: a new "loose battery terminal" cause appears in answers only after review.
- Approved actions are used by the planner.
- Procedures still require evaluation, not review.

**Reasoning service.** `POST /api/mind/reason` exposes these methods to the owner and to other components:

- deduction, using the validated rule atoms plus ad-hoc rules, with proofs
- induction, with a 70/30 held-out test of each candidate rule
- analogy
- constraints
- temporal networks
- Bayes

**Ratings.** Chat answers return their episode id. A 👍/👎 is stored on the episode as a **signal**, explicitly not as verification of correctness.

**Studio → Cognitive engine:**

- cognitive atoms by category and status
- experience
- evolution events
- self-evaluation history
- the verification queue for teacher disagreements
- procedures shared with other nodes
- a form for verified corrections

**Tests.** `tests/mind.test.mjs` now has 18 tests.

## 14. v1.9

The cognitive engine is now one component of the Universal Evolution Engine (`docs/EVOLUTION.md`). Its memory bounds and learning search settings are versioned policies, and new cognitive atom categories can be added through the `atom-category` extension point. A synthesis bug found by the learning evaluator is fixed: inputs whose dimension has no factor-1 unit, such as a tariff per kWh, could not be learned before.
