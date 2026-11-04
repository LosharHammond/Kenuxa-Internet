# KENUXA v1.1–v1.2: atom-native cognitive network

This document is the delivery report for the master development directive (context continuity, deep comprehension, verified response construction, emotional context, the teacher–student loop with atomic dissection, background learning, identity and memory, and atomic correctness). It builds on [ATOMIC-ARCHITECTURE.md](ATOMIC-ARCHITECTURE.md), which covers atoms, DNA, storage and recovery.

Every number below was measured on the build machine, offline (no internet, no teacher key), using:

- `npm test`
- `node bench/cognition.eval.mjs`
- `node bench/atoms.bench.mjs`

The status words mean: **Implemented** = working and covered by tests. **Partial** = working with stated limits. **Not implemented** = not built yet.

> **v1.7:** the Evolving Cognitive Engine (world model, procedure atoms, multi-method reasoning, evolution, vision) is documented in [`COGNITIVE-ENGINE.md`](COGNITIVE-ENGINE.md).

## 1. Repository audit (Stage 1)

**Existing system.**

- One Node 22 core (`lib/node.mjs`) runs behind adapters for Render, Railway, Vercel, Netlify and a plain server.
- **Atoms:**
  - word, sense, concept and phrase atoms with six-section DNA: `lib/atoms/registry.mjs`, `schema.mjs`, `lexicon-en.mjs`
  - English grammar interpretation: `lib/atoms/language.mjs`
  - IS_A reasoning and learning from statements: `lib/atoms/reasoning.mjs`
- **Preservation:** erasure-coded or replicated segments, quorum metadata and repair (`lib/atoms/preservation.mjs`, `mesh-transport.mjs`).
- **Answering:** intent and focus comprehension with template construction (`lib/comprehension.mjs`), a teacher registry for Groq, xAI/Grok, OpenAI and others (`lib/providers.mjs`), web research (`lib/learning.mjs`).
- **Transformer:** an optional gated transformer (`lib/transformer/`).
- **Interface:** a public chat (`public/chat.*`) and an admin studio.

**Defects found by running the real system before changing anything.** The baseline is the v1.0 code, measured with `bench/cognition.eval.mjs`. Consecutive turns went to *different* nodes.

| Probe | v1.0 behaviour |
|---|---|
| "How do I start a solar company in Ghana?" | Generic 6-step template ("Define success… Start small… Run a pilot"). No business models, no regulator, no sources. |
| "What if I don't have money?" | Read as a new topic about "don't have money" and sent to web research. Leaked `getaddrinfo ENOTFOUND en.wikipedia.org` to the user. |
| "Which one should I start with?" | Parsed the focus as "one should I start"; template again, with the leaked error inside. |
| "What about the licenses?" | "I don't have reliable knowledge about licenses." The Ghana/solar context was lost. |
| "Explain how atoms survive node failure." → "What happens if two nodes disappear?" | Both answered with an unrelated sentence about signed HTTPS pulls. |

**Root causes:**

- Context was rebuilt only from pronouns, so implicit follow-ups ("what if…", "which one", "what about…") had no topic.
- There was no verified domain knowledge to answer from.
- Raw research errors were passed straight through as answers.
- There was no verification stage, no affect model and no account or memory layer.
- The teacher was only used to *compose* answers; it was never compared or verified.

**Further defects found while upgrading, now fixed:**

- The new atom audit caught 18 invalid `REFERS_TO` relations from claim atoms (`sentence → concept` was not allowed by the schema).
- With erasure coding, a fresh node could not fetch fragments from holders it had not yet met, because manifests carried no holder addresses.
- Signed node-to-node traffic shared the public per-IP rate limit.

## 2. Updated architecture

A request flows through these stages, in order:

1. **Request.** It arrives with conversation capsules (client-held), a session cookie (if signed in) and a location (if consented).
2. **Atomize and interpret** (`language.mjs`): every word becomes an atom; grammar, senses, discourse, ellipsis and idioms are resolved.
3. **Context Continuity Engine** (`cognition/context.mjs`) classifies the message as one of: standalone · continuation · condition · aspect · select-option · return-to-topic. It also accumulates the person's situation (budget, experience) and rewrites the message into a self-contained question.
4. **Comprehend** (`comprehension.mjs`): intent, goal, focus, constraints and ambiguity.
5. **Answer, in priority order:**
   - (a) private memory command
   - (b) learning from a statement
   - (c) IS_A reasoning
   - (d) a verified knowledge pack
   - (e) an emotional-only reply
   - (f) own atoms, then the network, then the web
   - (g) teacher composition (only when nothing above grounds the answer)
6. **Verify** (`cognition/verify.mjs`): leaked errors, citations, repetition, agreement, relevance and uncertainty.
7. **Tone** (`cognition/affect.mjs`): an acknowledgement when wording signals an emotion.
8. **Plan and capsule:** a structured response plan (intent, entities, references, retrieval source, facts, reasoning, uncertainty, context, affect, verification) and the next context capsule.

Background work runs separately:

- **`lexiconTick`:** teacher senses and corroboration.
- **`preserveTick`:** commit, repair, rebalance and GC.
- **`learnTick`:** gap, question, student, teacher, dissection, verification, promotion, dataset.
- **Incremental atom audit.**

All of it goes through a resource-aware scheduler, and interactive requests always come first.

## 3. Atomic DNA and the atom lifecycle

The schema and storage are unchanged; see `ATOMIC-ARCHITECTURE.md` §C. What is new:

- **`sentence` atoms are knowledge claims.** They come from packs and carry evidence URLs, `status` and `appliesTo`.
- **Emotion concept atoms** (genesis 3).
- **`REFERS_TO`** now allows `sentence → concept`.

**Lifecycle of a word or claim:**

1. **Discovered:** provisional, `meaningStatus: unknown`.
2. **Teacher-proposed:** provisional.
3. **Corroborated:** at least 2 independent agreeing sources, or **disputed** if they disagree.
4. **Curated or verified:** genesis, or a pack claim checked against its source.

Every change is a new content-addressed revision, and history is kept. Statements from people enter as provisional relations with per-source confidence (25 %, rising with independent sources to at most 60 %). Curated concepts are never changed by statements.

## 4. Conversation memory design

| Level | Where it lives | Lifetime | Shared? |
|---|---|---|---|
| Immediate | the request: interpretation and plan | one request | no |
| Conversation | **context capsules** returned with every answer and sent back by the client (topic, goal, location, options offered, situation) + node discourse cache (30 min) | the conversation | no (the person's own browser) |
| User | `state.users[id].memory`: facts the person asked KENUXA to remember, and preferences (budget, experience) derived from them | until erased | **never** written to atoms or the network |
| Network | atoms (validated, provenance-aware) | durable | yes |

Because capsules travel with the conversation, **any node continues it**: another Render account, Railway, a laptop, or the same node after a restart. This is tested.

**Identity.** Users have an account with a scrypt-hashed passphrase and sign in with a signed, revocable session in an HttpOnly, SameSite=Strict, Secure cookie.

- A device is never treated as a person.
- Signing out on a shared device ends access to that account's memory (tested).
- Nodes recognise the same sessions when they share `KENUXA_SESSION_SECRET` and the same user store.

**Location.** It is used only when the person turns it on. The browser time zone gives an approximate country; with permission, coordinates are rounded to about 11 km.

- An answer that relies on location says so, for example: "I've assumed you're in Ghana (country level, from the device time zone (approximate))".
- Ghana's rules are not applied to a visitor whose device says Berlin (tested).
- There is no IP geolocation: it needs an external service, which would conflict with the zero-cost and privacy constraints.

## 5. Comprehension, reasoning and response construction

- **Structured interpretation.** It records intent, goal, focus, constraints, ambiguity, context kind, situation and affect (`understanding.*`).
- **Knowledge packs** (`lib/knowledge/packs.mjs`) hold claims a person checked against the cited page. Each claim has a status:
  - `source-checked`
  - `check-current` (fees, thresholds; flagged "may have changed")
  - `derived` (KENUXA's own inference, labelled as such)
- **Composers** (`cognition/compose.mjs`) select and order claims for the interpreted *mode*:
  - overview, low-capital, recommend (ranks options by the remembered situation), licences, explanation
  - condition (picks the claims relevant to, for example, "two nodes disappear")
  - Citations are numbered once per distinct source, in order of first use.
- **Reasoning:**
  - IS_A chains, sense-aware and open-world, with confidence, unverified-link disclosure and disputed detection
  - statement learning
  - deterministic checks in dissection: arithmetic, the atom graph, grammar rules
- **Verification** happens before every delivery. Every check is recorded in `result.verification` and `plan.verification`.

## 6. Teacher–student loop and the Atomic Dissection Engine

**Provider.** The teacher is whichever provider is set as primary (Groq today; xAI Grok via `XAI_API_KEY`). Calls are capped by `TEACHER_MAX_CALLS_PER_HOUR` (default 20).

**The loop** (`lib/learning/curriculum.mjs`):

1. **Find gaps:** unknown or disputed words, statements held for review, failed or unhelpful answers. They are ranked by value × uncertainty.
2. **Generate a targeted question.**
3. **The student answers first, offline:** no web, network or teacher. A test confirms the order and that the offline run makes zero teacher calls.
4. **The teacher answers** as JSON: interpretation, answer, claims, assumptions, uncertainty, sources.
5. **Dissection** (`lib/learning/dissect.mjs`):
   - Both answers are decomposed into atom-level claims (subject, predicate, object, polarity, numbers) through KENUXA's own parser.
   - Claims are aligned: structure, content, contradiction (polarity or number).
   - It reports interpretation, entities, missing and extra claims, assumptions, uncertainty, grammar, completeness and relevance.
6. **Verification:** arithmetic, IS_A against verified graph knowledge, and grammar rules. Everything else stays provisional.
7. **Root causes:** missing-atom · wrong-sense · incomplete-evidence · missing-relationship · incorrect-atom · faulty-inference · grammar-construction · incorrect-intent · failed-context-retrieval · response-planning · storage-retrieval · **teacher-error**.
8. **Promotion:**
   - Teacher claims become **provisional** relations with the teacher as *one* source.
   - Claims refuted by verified knowledge are rejected. For example, "A snake is not an animal" is caught and not promoted (tested).
   - Verified knowledge is never overwritten.
9. **Dataset record** (`kenuxa-learning/1`) plus a regression item. Re-asking the question later measures improvement.
10. **Metrics** are available at `GET /api/learning`. The JSONL export at `GET /api/learning/dataset` **excludes records containing user questions**.

**Tasks** are idempotent (id = hash of type + target) and leased with an expiry. On the open network the lease is written to and read back from quorum metadata, so two nodes do not learn the same item, and an expired lease is taken over (tested).

**Scheduler:** background work is skipped while any interactive request is active, when CPU load exceeds 0.85 per core, when the heap exceeds 85 %, or when the teacher quota is used up. Nothing keeps a sleeping Render service awake; queued tasks persist in state and resume when the node runs again.

## 7. Distributed coordination and recovery

These are unchanged from `ATOMIC-ARCHITECTURE.md`. What is new in v1.1:

- Manifests carry holder URLs, so a node can fetch fragments from holders it has not met yet. Responses are still verified against the holder's key-bound fingerprint.
- Any signed node may read public fragments and manifests; writes still need a trusted peer.
- Node-to-node traffic has its own per-signer rate budget.
- `task:` metadata keys support leases.

## 8. Migration and Render deployment

**No database migration.** New state keys: `learning`, `users`, `identity.sessionSecret`, `atomAudit`. Genesis 3 adds emotion concepts automatically. Knowledge packs load as atoms on boot.

**Settings** (all optional):

| Variable | Purpose |
|---|---|
| `KENUXA_SESSION_SECRET` | Lets your own nodes recognise each other's sessions |
| `TEACHER_MAX_CALLS_PER_HOUR` | Teacher quota per hour (default 20) |
| `TEACHER_LEARNING=false` | Turns off the learning loop |
| `TEACHER_ANALYSIS=false` | Turns off teacher analysis of non-English questions |

**Render free tier.** The disk is ephemeral, so without Supabase configured, node state (accounts, user memory, learning records) is lost on restart or redeploy. Shared atoms survive through peers, and through the repository snapshot:

- `GET /api/atoms/snapshot` exports public, validated atoms only.
- Commit the result as `network/atoms-snapshot.json`; nodes merge it on boot.

Configure the existing Supabase connection for durable accounts and memory.

**Deploying:** push to GitHub; each Render service redeploys. Nothing destructive runs on deploy.

## 9. Tests and measurements

`npm test` runs **87 tests, all passing**. The new suites are:

- `cognition.test.mjs`:
  - the PART 12 solar regression across two nodes
  - a restart test, context kinds, packs, verification and affect
- `learning-loop.test.mjs`:
  - dissection with a teacher error, promotion, student-first, cross-node leases
  - the scheduler and dataset privacy
- `identity.test.mjs`:
  - accounts, sessions, shared-device separation, memory across restart, export and delete, location consent
- `integrity.test.mjs`:
  - the audit (corruption, broken references, contradictions, IS_A cycles) and snapshot privacy

**Before and after** (`node bench/cognition.eval.mjs`, the same 8-turn script, turns alternating between two nodes):

| | v1.0 | v1.1 |
|---|---|---|
| Follow-ups correctly bound to their topic | **0 / 4** | **4 / 4** |
| First turns that meet the expected content | 0 / 4 | 4 / 4 |
| Internal errors leaked to the user | 3 | 0 |
| Duplicate or invalid citations | 0 / 0 | 0 / 0 |
| Median / max latency | 54 / 116 ms | 65 / 133 ms |

**Caveat:** this evaluation set is small and was written together with the changes. It shows that the specified behaviours now work; it is not evidence of general conversational ability.

**Atom benchmark:** lookup 0.025 µs; interpretation 0.092 ms; IS_A classification 27 µs; commit of 20.6k atoms 6.1 s; metadata 0.57 MB against 107 MB for full replication; recovery after 2 of 8 nodes died 145 ms, 99 of 99 segments restored.

## 10. Security review

| Area | Status |
|---|---|
| Secrets | Environment variables only; nothing in the frontend or repository. Teacher keys never leave the server. |
| Passphrases | scrypt (N=16384) with per-user salt; timing-safe comparison; login throttled per IP and per username. |
| Sessions | HMAC-signed, revocable, 30-day expiry; cookie is HttpOnly, SameSite=Strict, Secure (except on localhost). |
| Chat endpoints | Same-origin check, JSON-only, size limits, per-visitor and daily limits. |
| Untrusted text | Teacher and web output is parsed as JSON with validated fields. Teacher claims become provisional only; refuted claims are rejected; questions are passed as data with an explicit "never instructions" clause. |
| Atom injection | Trust ranks, quarantine, corroboration quorum, signed metadata, per-peer storage budgets, future-dated pointers ignored; the audit detects corruption and contradictions. |
| Privacy | User memory is never written to atoms; dataset export excludes user questions; location is consented and coarsened; snapshots exclude users; data export and account deletion are available. |
| HTTP headers | CSP self-only, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (geolocation limited to self). |
| Known gaps | No passphrase recovery (there is no email service at $0). Without Supabase, accounts on Render are per node and lost on restart. Statement learning from public chat is rate-limited and provisional, but a determined spammer can still add low-confidence claims. |

## 11. Limitations

**Partial**

- **Grammar rules are English only.** Other languages go through teacher-assisted analysis when a teacher is available.
- **Domain knowledge is limited to two packs** (Ghana solar business, KENUXA preservation). Other topics fall back to atoms, the network, the web and the teacher, as before.
- **Dissection depends on KENUXA's English parser**, so complex teacher sentences may parse only partly; unparsed claims are compared by content.
- **The affect model is a cue lexicon** with negation and history, not a trained classifier.
- **Teacher and Groq paths are tested with a stand-in provider only**, because the sandbox has no internet.
- **Cross-node accounts** need a shared secret and a shared store.

**Not implemented**

- passphrase recovery
- IP geolocation
- more knowledge packs (each needs source checking)
- task-level held-out benchmarks beyond the regression list

## 12. Roadmap

1. Add knowledge packs for the questions users actually ask most, using `/api/learning` error memory to choose them, each checked against its sources.
2. Durable shared store guidance for Supabase (accounts and learning records).
3. Partial-view metadata lookups for very large networks.
4. Optional fine-tuning export, using the dataset already produced; nothing is trained automatically.

## 13. Demonstration: the PART 12 conversation (turns answered by two different nodes)

1. **"How do I start a solar company in Ghana?"** KENUXA explains that "solar company" can mean six different businesses (referral agent, design, installation, retail, assembly, selling electricity), each with its capital level and licence. It cites the Energy Commission, Act 832, the June 2023 licence guideline, ORC registration and GRA tax. Fees are flagged "may have changed", and it asks for budget, qualification and customers.
2. **"What if I don't have money?"** It answers about the *solar business*: "Yes — you can start a solar business in Ghana with no money, but not every kind…". It ranks referral and agent work first, explains why your own licence can wait (fees), and gives a low-cost plan.
3. **"Which one should I start with?"** "**Start with: Sales agent or referral partner for a licensed installer.** Why, from what you've told me: needs very low start-up capital; the licence and equipment costs are carried by the licensed partner."
4. **"What about the licenses?"** It lists licences and registrations for each business model, what the sources say, and what to check, in the Ghanaian solar context.

## 14. What v1.2 added

| Item | Implementation | Test |
|---|---|---|
| **ATP, the Atom Transfer Protocol** (renamed from MTP) | `lib/mesh.mjs` advertises `ATP/1.0` and signs with `x-atp-*` headers. It also sends `x-mtp-*` mirror headers so v0.7–v1.1 nodes can verify it, and retries a peer's `/mtp/` route when `/atp/` returns 404. `lib/node.mjs` serves `/atp/*` and accepts `/mtp/*` as an alias; signatures always cover the path the caller used. `lib/atoms/mesh-transport.mjs` and the adapters use `/atp/`. | `mesh.test.mjs`: migration in both directions; `v12.test.mjs`: real node |
| **Node advertisement** (PART 11) | `GET /atp/info` returns the protocol, accepted protocols, capabilities and health (uptime, heap, active requests, storage, pending commits, degraded alerts, open learning tasks). No secrets or user data. | `v12` |
| **Causal reasoning** (PART 5.4, 13: causal, multi-step, contradiction) | New `CAUSES` relation (transitive, defeasible; `negated` edges record denials). `learnCausal`, `causalQuery` (chain confidence is the product of edge confidences, discounted per extra step), `causesOf` (reverse, bounded scan), with honest verbalisation. Wired into answering for "X causes Y", "Does X cause Y?", "What causes Y?" and "Why does Y happen?". | `v12` |
| **Decomposition** (PART 2.5) | `lib/cognition/decompose.mjs`: actors, action (tense, aspect, polarity, mood), inputs and outputs for transformation verbs, causes and effects for causal verbs, objects, places, purposes, properties, inter-clause cause links. Reuses the pipeline's own interpretation; attached to every plan as `plan.semantics`. | `v12` |
| **Generic-only learning** (LAW 14) | Statements with possessive or demonstrative subjects (my/your/this…) are never learned as shared knowledge. | `v12` |
| **Cross-device chat history** (PART 4.3) | `/chat/account {action:'chats'}`: private and bounded (50 chats × 60 messages), the newer edit wins, unsafe links are stripped, deletions use tombstones. The client syncs only chats created while signed in, and signing out removes them from the device. | `v12` + a Chromium check (second browser saw the chat; nothing remained after sign-out) |
| **Metadata matches data durability** | `metaN()` uses 5 replicas with majority writes from 12 members (3 below), so the index survives the same 4 losses as 8+4 stripes. | `v12` |
| **Vocabulary for causation and transformation** (genesis 4) | convert, transform, turn, cause, produce, generate, lead, result, happen, occur, expand, absorb, store; nouns heat, expansion, crack, rain, flood, sunlight, panel, electricity; adjectives solar, electrical, hot, cold; rules causal-transitivity and transformation-roles. Parser fixes for noun subjects or objects that are also verbs ("Rain leads to floods", "Does rain cause floods?"). | `v12` |

**Measured (v1.2):**

- **Tests:** 94 pass.
- **Conversation evaluation:** 4 of 4 follow-ups bound, 0 leaked errors, median 89 ms.
- **Atom benchmark:** 697 genesis atoms; lookup 0.029 µs; interpretation 0.10 ms per sentence; metadata 0.57 MB against 108 MB for full replication; recovery 178 ms, 101 of 101 segments restored.

**Migration:** nothing to do. Genesis 4 runs automatically. Old nodes keep interoperating over `/mtp/` until they are upgraded; once every node runs v1.2, the alias can be removed in a future release (planned, not done).


## 15. What v1.3 added: word atoms with complete, evolving DNA

**Pipeline for a new word:**

1. `interpret()` tokenizes the text, and the word resolves to `lex:<lang>:<word>`, which is created on first use.
2. `observeTokens` records the use: count, role, surface form, collocates within ±2 words, and an impersonal example. It also adds the sentence's n-grams to the n-gram statistics.
3. The word joins `state.lexicon.queue`.
4. `lexiconTick` first tries the network, since the same deterministic id resolves network-wide.
5. Otherwise the teacher is called with `LEXICON_INSTRUCTION`.
6. `validateLexicon` checks the reply. On success, `applyLexicon` creates sense atoms (`SENSE_OF`, `IS_A` to a concept), writes the full lexical DNA, and adds `SYNONYM_OF`, `ANTONYM_OF`, `RELATED_TO` and `FORM_OF` links. Any new linked words are queued.
7. `queueVerify` hands the atom to corroboration.

**Evolution.** `AtomRegistry.observe` keeps bounded usage records. `consolidate` runs at usage milestones and writes `functional.observedUsage` and co-occurrence links as a new revision. Usage, n-grams and the set of checked n-grams are serialized with the registry.

**Multi-word meanings.**

- `countNgrams` counts 2–4-grams, plus whole sentences of 3–10 words.
- `expressionCandidates` keeps bigrams with PMI ≥ 3, longer n-grams seen at least 3 times, and repeated sentences.
- The teacher (`EXPRESSION_INSTRUCTION`) classifies each candidate as compound, idiom, phrasal verb, proverb or none.
- `expressionAtom` writes `phr:mwe:en:<slug>` (type phrase, or sentence for proverbs and sentences) and links it to its words.
- `indexIdioms` makes the interpreter recognise the expression. Compounds annotate roles and do not change the predicate.
- Each candidate is checked once (`checkedNgrams`). Without a teacher, candidates seen at least 3 times become atoms with `meaningStatus: unknown`.

**Guards:**

- schema validation
- rejection of URLs, HTML, scripts and injection phrases
- a lemma-plausibility check
- examples must contain the word
- a part-of-speech check against observed roles, which produces uncertainty notes
- provisional status, then corroboration by independent nodes or this node's own teacher
- rejection log and a single retry
- no default cap: optional hourly, per-cycle and daily caps; provider HTTP 429/503 pauses all teacher calls (Retry-After, reset headers, exponential backoff) and keeps the queue intact

**Privacy.** `publicContext()` keeps only impersonal sentences as examples or sentence n-grams.

**Explorer.** Studio → Word atoms (`public/lexicon.js`), built on `/api/atoms/list`, `/api/lexicon/atom` and `/api/atoms/candidates`.

**Limits:**

- Teacher meanings are a model's judgment, not proof. That is why they stay provisional until corroborated.
- PMI needs enough text to separate real expressions from chance pairs, so small nodes discover few expressions.
- Non-English words are atomized and observed, but expression discovery is English-only for now.


## 16. What v1.4 added: live cognitive evolution

Three mechanisms are kept separate:

- **(A) live knowledge learning** happens at run time and is the subject of this section.
- **(B) neural training** still goes only through the gated candidate, evaluation and release pipeline, and is unchanged.
- **(C) software changes** need tests and a deploy.

A knowledge update never touches served weights. The test for demonstration F checks that `trainingSteps` and the live release do not change.

### 16.1 The question path

The request path is: `answerQuestion` → snapshot → interpret → context → reasoning → claims → methods → answer → verify → review/cache.

- **Snapshot.** At the start of a request it takes a ledger snapshot (`ledger.view()`, a proxy over the registry pinned to a sequence number). Every interpretation and graph read in that request sees one knowledge revision. Writes made while interpreting, such as word discovery and usage counts, still go to the live registry.
- **Clarification.** The interpretation records ambiguous references. Two different singular referents introduced in the same earlier turn lead to a focused clarification ("Do you mean the phone or the laptop?").
- **Causal questions.** These consult the claim store first. Competing explanations are presented with their evidence, and no winner is forced.
- **Methods.** Price, quantity and unit questions go through the method registry, which checks applicability first.
- **Review.** After verification, `recordAnswer` stores the answer history (first, revised or stable, with the justifying event id) and its dependencies (concept atoms, senses, claims, method). For context-free owner questions it also keeps a cache that is invalidated whenever any dependency changes.

### 16.2 Lifecycle (`lib/live/ledger.mjs`)

States: `observed → provisional → investigated → validated → committed → indexed → active`, plus `disputed`, `rejected`, `superseded`, `revoked` and `failed`. Illegal transitions throw.

- **Semantic validation and durability are separate fields.** Validation is `validation.checks`; durability is `persistence`, which is `not-started`, `writing`, `ok` or `failed`.
- **Commit order:**
  1. Write a journal intent.
  2. Stage the revisions. They are content-addressed in the registry and not visible.
  3. Persist the registry blob, then mark the event committed.
  4. Write the journal again.
  5. Prepare the index (indexed).
  6. Activate in one synchronous step under one new sequence number, so all writes of a change set become visible together.
  7. Supersede older active events and invalidate dependents.
  8. Propagate (organism rebuild).
  9. Write the journal again.
- **If persistence fails,** the event becomes `failed` and nothing is activated.
- **Idempotent.** A proposal's key is a hash of the kind and the meaning of its writes, with timestamps excluded. The same update returns the existing event.
- **Concurrent corrections** are validated against `baseRev`. If the atom moved, the event becomes `disputed` instead of overwriting. A per-atom lock prevents two overlapping commits.
- **Restart recovery (`recover()`):**
  - A journal entry still in `writing` becomes `failed`; nothing was durable.
  - `committed` and `indexed` entries roll forward if their revisions are in durable storage.
  - `active` entries re-apply heads if the registry blob was saved before the activation.
- **Revocation** re-activates the previous revisions as a new sequence and keeps the history. It refuses if the atom has changed since.
- **Stores.** The `registry` store covers lexical, sense, concept and phrase atoms. The `knowledge` store covers M-atoms; their values are kept in the journal, so they are durable with it.

### 16.3 New senses (`lib/live/learn.mjs`)

- A new sense is one change set containing the new sense atom, a new revision of the lexical atom, and new revisions of every inflected form (for example, `banks` carries its own sense list).
- **Validation:**
  - a plain-text definition
  - at least two context words
  - at least one non-teacher passage that uses the word in this sense (a teacher alone is rejected)
  - distinct from existing senses
  - a new id
- With two independent publishers the sense is `corroborated`; otherwise it is `provisional`.

### 16.4 Claims (`lib/live/claims.mjs`)

- Each claim is (subject, relation, object) within a time and place scope.
- **Evidence:** each item supports or contradicts, is direct or inferred, and is of kind `source`, `teacher`, `owner` or `computation`. Each has a publisher or origin, an optional `derivedFrom`, a validity window and a privacy level.
- **Independence:** the same publisher, a shared `derivedFrom`, or a near-identical passage (3-word shingle overlap ≥ 0.6) count as one origin.
- **Teacher statements** are listed as opinions and are never counted.
- **Verdicts:** `supported` (within the stated scope), `contradicted`, `disputed`, `outdated`, `inferred`, `insufficient-evidence` (teacher only) and `not-established` (no evidence; not "false").
- **`disagreement()`** records the exact conflicting claims and decides one of `correct-local`, `keep-local` or `withhold`.

### 16.5 Methods (`lib/live/methods.mjs`)

- **Shape:** declarative data with purpose, applicability, inputs (with required fields), preconditions, typed operations, evidence requirements, validation, failure conditions, examples, counterexamples, outcomes, revision and provenance.
- **Operations:** `map-compute`, `rank`, `select`, `filter`, `sum`, `difference`, `ratio` and `threshold`.
- **Expressions** use a small recursive-descent parser over numbers, field names and `+ - * / ()`. There is no `eval`, no code, no shell and no network.
- **Applicability** is checked on every use: signals, inputs present, preconditions such as `same-unit`. When it fails, KENUXA says what is missing.
- **Teacher discipline:**
  - one request per unchanged learning need (`needKey`), with shared in-flight requests
  - "already learned" means no call
  - a failed request is never retried without an explicit retry reason
  - a revoked lesson justifies a new call, and the reason is recorded
- **Natural-language input extraction** for prices is a narrow, labelled heuristic (`extractPriceOptions`).

### 16.6 Tone (`lib/cognition/tone.mjs`)

- What was observed (words, ellipsis, capitals, interjection, previous turns) is kept separate from three inferred readings: literally fine, guarded, irritated or sarcastic.
- The readings are normalised weights capped at 0.7. Replies never state an emotion as fact.

### 16.7 Correction propagation

Activating a knowledge correction does the following:

- re-develops the atom's intrinsic agent and expert (new `dnaRevision`)
- rebuilds molecules and cells, whose fingerprints are member revisions, so their revisions advance
- marks dependency records for molecules and cells as `needs-reevaluation`, then as `valid` again at the new revision
- drops every answer cache that used the atom
- retrains the local answer model

Unrelated caches and atoms are untouched. Revocation reverses all of it.

### 16.8 Privacy

- A word first seen in a conversation gets `manifest.scope = 'private'`. It is excluded from preservation until the teacher confirms a dictionary meaning that is not a proper noun.
- Statements made in public chat become private claims, not shared relations.
- Capitalised bare names are not learned as general facts.
- Public-chat failed questions and "unhelpful" feedback are kept as local error memory. They are excluded from teacher gaps, network task leases and dataset export.
- Federation (`shareable()`) and training (`corpusFromState`) are unchanged and contain no conversation text. Tests cover each boundary.

### 16.9 Teacher answers as a learning source

- `ATOMIZE_ANSWERS` is off by default, so KENUXA's own answers are not turned into atoms.
- Teacher answers from learning cycles and teacher compositions are learned from:
  - every word becomes an atom and is queued for full DNA
  - repeated combinations feed expression discovery
  - simple "X is a Y" and "X causes Y" sentences become teacher opinions in the claim store
- Teacher lessons are remembered in bounded storage, with the oldest evicted; the old 1,000-entry hard stop is gone. Word and expression DNA calls are not cached there, because their results live in the atoms.

### 16.10 Measurements

Isolated test configuration on this sandbox, one Node process, network off:

| Path | Measured |
|---|---|
| `/api/ask` (5 questions) | 77–141 ms |
| `/api/live/sense`: validate, two durable writes and activation | 182 ms |
| `/api/live/correct`, including organism rebuild and model retrain | 174 ms |
| `/api/interpret` after activation | 96 ms (mostly the save path; interpretation itself is about 0.24 ms per sentence in `bench/atoms.bench.mjs`) |
| Process memory | about 200 MB RSS, with the transformer disabled |

The answer cache skips retrieval, web and teacher work. It does not skip comprehension, so a cache hit on a local answer is not faster (95 ms first, 107 ms cached). The benefit is for answers that needed research or a teacher.

### 16.11 Capability status

**Working:**

- the lifecycle, snapshots, idempotency, conflict detection, recovery and revocation
- live senses and knowledge corrections, with propagation
- claim assessment with source independence
- the restricted method runtime with applicability checks and teacher-call discipline
- tone readings
- reference clarification
- the privacy boundaries listed above

**Narrow heuristics:**

- the position rules for words used as verbs (16.12 and 16.13)
- investigation evidence, which keeps only sentences that mention both sides of the claim, with a fixed list of relation cues and negation words
- structured extraction (16.13), which reads what the grammar layer understands, covers a fixed set of relations and units, and falls back to patterns

**Not implemented:**

- automatic re-evaluation of every derived conclusion beyond the organism and caches
- network agreement for knowledge-store corrections; agreement covers registry senses only (16.13)
- global consistency: agreement is per update and eventual, as described in 16.13
- snapshot reads for M-atoms (only registry atoms are snapshotted)

**Durability:** on Render's free tier, ledger durability equals the configured store. With no persistent disk or Supabase, `committed` means the instance's local filesystem, which a redeploy erases. The status reports what is configured; the ledger does not change that.


### 16.12 v1.4.1 additions

- **Bounded investigation (`lib/live/investigate.mjs`).** These are queued for investigation:
  - teacher-only claims, from teacher answers
  - disagreements decided as `withhold`
  - owner requests (`POST /api/live/investigate`)

  The background tick runs each one through the existing discovery search (Wikipedia, or Brave when a key is set). Limits: `INVESTIGATE_PER_HOUR`, default 12, and at most 3 pages per claim. It is off when `RESEARCH_ENABLED=false`. Only sentences that mention both sides of the claim are recorded: as direct support, as a direct contradiction (a negated relation cue), or as inferred context. The claim store then re-assesses. A page that mentions neither side adds nothing; absence of evidence is not counted as evidence against the claim.
- **Interpretation coverage:**
  - "when" and "whenever" split clauses, so in "What happens when a river overflows its banks?" "banks" now gets the river sense.
  - An unknown word sitting between a subject and an object determiner is read as a finite verb.
  - Possessive "have" with a direct object is the main verb.
  - Every coordinated object ("a laptop and a phone") becomes a referent, so a later "it" gets a clarification question.
- **Public chat:** minimizing statements ("I'm fine...") get an uncertainty-preserving reply, without the low-confidence disclaimer meant for factual answers.


### 16.13 v1.4.2 additions

- **Verb senses.** Sense disambiguation now depends on the part of speech.
  - A verb use competes only among verb senses, and a noun use only among noun senses.
  - When a word has no sense for the part of speech it is used in, the frame says so explicitly (`predicateMeaning: 'unknown: no verb sense of this word is known yet'`). It never borrows a noun sense.
  - The predicate sense is disambiguated from context. Inflected forms without senses of their own ("banked") resolve through their lemma.
  - A position rule reads a noun or unknown word as a verb when it follows a modal or "to" and precedes an object ("will bank the plane").
  - Verb senses are learned live like noun senses (`POST /api/live/sense` with `pos: 'verb'`).
- **Structured extraction (`lib/live/extract.mjs`).**
  - Claims are read from KENUXA's own interpretation of each sentence. Classification frames become `is a`; causal predicates (cause, lead to, result in, produce, trigger …) become `causes`; effect predicates (prevent, reduce, increase, cure, require …) get their own relations.
  - Negation becomes a contradicting stance, and modality ("may increase") is kept as hedging, which is recorded as indirect evidence.
  - Sentences the grammar cannot read fall back to patterns, and unreadable sentences are reported as `skipped` rather than guessed.
  - Price options handle a currency before or after the number (GH₵, $, cedis, naira …), bare prices after "costs", per-unit prices ("$3 per kg"), several separators (`;`, `while`, `and the …`), and unit normalisation (MB→GB, g→kg, ml→l, minutes→hours, weeks→days). Mixed units remain incomparable.
- **Network agreement (`lib/live/consensus.mjs`, ATP route `/atp/live/propose`).**
  - After a public live event activates, the origin sends a signed proposal to up to 6 trusted peers. The proposal carries the semantic content, not the origin's local DNA.
  - Each peer re-validates the content with its own validators against its own registry, then votes `accept`, `reject` (with reasons) or `conflict` (it already holds a different meaning under the same id). Unless `LIVE_ADOPT=off`, an accepting peer also activates the update through its own ledger, with full lifecycle and provenance (`source: peer:<fingerprint>`).
  - Unknown or untrusted peers are quarantined, not validated.
  - The origin tallies the votes. A quorum is a majority of reachable voters, with the origin counting once:
    - `agreed`: a quorum accepted, and at least one peer accepted
    - `contested`: any conflict, or a quorum of rejections
    - `pending`: no quorum yet, or peers unreachable; the background tick retries up to 4 attempts
    - `local-only`: there were no peers to ask
  - Signatures prove who voted, not that the content is true. Agreement is per update and eventual; there is no global lock or instantaneous consistency.
  - `POST /api/live/share` re-announces an event. `/api/live/status` lists peer reviews and the agreed, contested and pending counts.
