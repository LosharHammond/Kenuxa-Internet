# KENUXA v1.1: atom-native cognitive network

This document is the delivery report for the master development directive (context continuity, deep comprehension, verified response construction, emotional context, the teacher–student loop with atomic dissection, background learning, identity and memory, and atomic correctness). It builds on [ATOMIC-ARCHITECTURE.md](ATOMIC-ARCHITECTURE.md), which covers atoms, DNA, storage and recovery.

Every number below was measured on the build machine, offline (no internet, no teacher key), using:

- `npm test`
- `node bench/cognition.eval.mjs`
- `node bench/atoms.bench.mjs`

The status words mean: **Implemented** = working and covered by tests. **Partial** = working with stated limits. **Not implemented** = not built yet.

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
