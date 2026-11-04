# Delivery verification, 4 November 2026

## v1.10: robustness under any input; randomised tests

- **Tests:** `npm test` → **189 / 189 pass in three consecutive full runs**, each with fresh random seeds. New test files:
  - `tests/universal.test.mjs` (10)
  - `tests/evolve2.test.mjs` (9)
- **Exploratory fuzzing before the tests** found no failures in:
  - about 1,500 random questions through `/chat/ask`
  - 24,000 random route calls across 112 routes
  - about 30,000 hostile module inputs
  The remaining failures were fixed first — see `docs/ROBUSTNESS.md` for the 11 bugs.
- **Measured:** indexed retrieval on 20,013 atoms takes 35 ms/query vs 190 ms (recall@1 0.943 vs 0.917; recall@3 0.997 vs 1.0).
- **Honest limit:** "any question passes" means every question gets a safe, honest, well-formed response, and everything KENUXA can compute is computed correctly. It does not mean every question is answered correctly; unknown topics get "I don't know yet".

## v1.9: Universal Evolution Engine

- **Tests:** `npm test` → **170 / 170 pass** (one earlier run had a time-budget test fail while a benchmark ran in parallel; it passes alone and in a clean full run). New `tests/evolve.test.mjs` has 15 tests, one per system-wide evolution requirement (see `docs/EVOLUTION.md` §4).
- **Measured evaluator results** (`docs/EVOLUTION.md` §3):

  | Proposal | Outcome |
  |---|---|
  | Routing: locality + cost | priority-weighted wait 137 → 91, data 36.6 → 14.8 MB (simulation) |
  | Routing: age weight | rejected |
  | Retrieval: plain lexical | rejected (recall@3 1.0 → 0.968) |
  | Learning: narrower search | rejected (3 → 2 corrections fixed) |
  | Learning: fewer constants | same results with 8,993 → 3,959 expressions searched |
  | Replication: 1 copy | rejected |
  | Security: 24-bit PoW | rejected (≈ 170 s on a slow browser) |

- **Bugs found by the new evaluators and tests, all fixed:**
  - synthesis could not learn tariff procedures
  - a departed storage holder still counted toward the replica target
  - re-replication was deduplicated away
- **Not verified here:** real multi-node propagation over the internet (in-process and signed-route code paths are tested); routing gains on production traffic (simulation only — which is why routing changes go through a monitored canary).

## v1.8: self-knowledge, imagination memory, self-evaluation

- **Tests:** `npm test` → **155 / 155 pass**. `tests/mind.test.mjs` grew to 18 tests; the three new ones cover:
  - self-knowledge, directly and through `/chat/ask`
  - hypothesis and simulation atoms; sandboxed self-evaluation (the live node's procedures are unchanged by it)
  - the reasoning service; a candidate causal atom used only after owner review; rating signals on episodes
- **Self-evaluation** (`node bench/mind.bench.mjs`, same code as `/api/mind/evaluate`):

  | Measure | Result |
  |---|---|
  | Comprehension | 20/20 and 20/20 |
  | Calculation, dev | 7/7 |
  | Calculation, held-out | 8/10 → 10/10 after one verified correction (0 regressions, no repeated error) |
  | Diagnosis | 5/5 |
  | Counterfactuals | 3/3 |
  | Planning | 3/3 |
  | Vision | 36/36 and 12/12 |
  | Time per episode | 0.3–0.7 ms median |
  | Whole run | ≈ 0.3 s and ≈ 7 MB heap |

- **Studio "Cognitive engine" view:** rendered in Chromium with live data and no script errors.
- **Fixed:** v1.7 counterfactual answers claimed a stored simulation that did not exist; it is now stored and referenced by id.

## v1.7: Evolving Cognitive Engine

- **Tests:** `npm test` → **152 / 152 pass** (137 earlier tests plus 15 new ones in `tests/mind.test.mjs`).
  - The new tests cover:
    - the procedure kernel and composition
    - Scenarios A–H
    - deduction, induction, analogy, temporal reasoning, constraints and Bayes
    - the world model and capsule round-trip
    - comprehension on labelled cases
    - working memory, experience memory and metareasoning
    - security
    - two-node chat integration
  - The whole suite was re-run after the last change: 152 / 152.
- **Benchmark** (`node bench/mind.bench.mjs`):

  | Measure | Result |
  |---|---|
  | Comprehension goal | 20/20 dev and 20/20 held-out |
  | Calculation, dev | 7/7 |
  | Calculation, held-out | 8/10 before learning → 10/10 after one verified correction (0 regressions) |
  | Diagnosis | 5/5 |
  | Counterfactuals | 3/3 |
  | Planning adaptation | 3/3 |
  | Vision | 36/36 detection, 12/12 connection questions |
  | Time per episode | 0.3–1 ms median |
  | Heap over 120 episodes | ≈ 2.3 MB |

  - The first held-out run found two phrasing gaps; it scored 7/10 before and 9/10 after learning, with diagnosis at 4/5. Both gaps were fixed, and this is disclosed in `docs/COGNITIVE-ENGINE.md` §10.
- **Defects found and fixed:**
  - follow-up licences question lost the context (Scenario A)
  - one-word definition questions were treated as follow-ups
  - the KUNPP global cost gate starved new task kinds
  - procedure-test results were replaced by the core's partial re-check
  - role-word binding: a solar procedure was applied to a light bulb
- **Not verified here:**
  - comprehension or reasoning beyond the small, same-author evaluation sets
  - OCR and real photographs (not implemented)
  - many nodes sharing procedures over the internet: sharing is tested in-process, and the signed ATP route reuses the existing mesh signing

## v1.6: KUNPP/2 (P2P, Type C/D, storage tiers, task kinds A–E, PoW, multiple coordinators)

- **Tests:** `npm test` → **137 / 137 pass**. New `tests/compute2.test.mjs` (6 tests):
  - kinds B–E and `isa-closure/1` find seeded problems deterministically
  - PoW is bound to a signed, single-use challenge, a replay is refused, and difficulty adapts
  - Type D gets specialised work only after its probe, and a lying peer never does
  - Type C replicates, passes fresh storage proofs, and restores a deleted core revision byte-identically; a cheating holder fails its proofs
  - P2P leases carry references only, signals are relayed only inside the pair, and a fallback cancels the counted saving
  - the installed agent runs against two real server processes (PoW, probe, disk storage, proofs), then fails over when its coordinator is SIGKILLed and keeps working
- **`tests/compute.test.mjs`** is updated for KUNPP/2 (9 tests). It includes a regression test: an honest relation-check result was wrongly rejected because the core re-checked only part of the shard.
- **Bugs found and fixed while testing:**
  - storage tasks were starved behind the atom queue and blocked by the compute cost gate
  - restore and storage-proof tasks computed their heads wrongly
  - the agent overslept its run deadline
  - the test helper waited forever on an already-killed process
- **Benchmark (measured, `bench/compute.bench.mjs`):** with the v2 mix and the per-kind gate, core CPU fell −68% (8 honest peers), −82% (steady state), −68% (churn plus a malicious peer), and −91% (v1 workload).
  - The first v2 run, with a single global gate, made core CPU **13–16× worse**: the cheap new kinds pulled the average up and stopped all delegation. That measurement led to the per-kind gate.
  - Kinds B–E currently cost the core more to delegate than to run, so the node keeps them.
  - gzip makes payloads 11.7× smaller.
- **PoW (measured):** a 14-bit solve takes 30 ms median and 69 ms p90 on one core; verification takes about 0.1 ms.
- **Real browsers (Chromium, `tests/browser/p2p-failover.e2e.cjs`, two coordinators):**
  - Final code: 6 P2P pairings and 244 atoms received directly, all hash-verified. 342 KB avoided net; 1 fallback, counted.
  - Earlier run: 844 atoms received and 911 KB avoided.
  - gzip: 1.98 MB became 234 KB.
  - After coordinator A was SIGKILLed, the browser failed over to B and kept working.
  - 0 page errors and 0 rejected results.
- **Studio dashboard** was rendered with live `/api/compute` data after an agent run, with no script errors. It shows per-kind gate decisions, P2P and gzip numbers, storage tiers, PoW bits and verified capabilities.
- **Not verified here:**
  - NAT traversal over the real internet (no TURN; STUN configurable)
  - mobile browsers
  - hosted Render coordinators under load
  - agents on other operating systems
  The scaling rows in `docs/KUNPP.md` §7.1 are extrapolated.

## v1.5: KUNPP volunteer computing

- **Tests:** `tests/compute.test.mjs` adds 8 tests:
  - the task module's encoding is byte-identical to the core codec on every genesis atom, and its checks give the same verdicts as the core audit
  - consent, tokens, limits and per-network rate limits
  - the full task lifecycle, with idempotency, pacing, and private atoms never sent
  - malicious peers (invented and hidden issues) caught, with reputation dropping and revocation
  - expired leases, peers leaving, core fallback, and the no-peer mode
  - the offload decision
  - HTTP routes: consent, same-origin, authentication, owner-only dashboard, revocation
  - a real server process with four independent peer clients, one malicious and one that vanishes with a task
- **Benchmarks (measured):** `bench/compute.bench.mjs` gives −88% core CPU with 8 honest peers, −93% in steady state, and −66% with churn plus a malicious peer; this costs about 1.5 KB per atom checked. Per-request costs over real HTTP are listed in `docs/KUNPP.md` §5.2.
- **Real browser check:** Chromium went through the chat consent dialog and a Web Worker, completing 5 tasks and 600 atoms, all accepted, with latency p50 43 ms and p95 99 ms. There were no page errors. With 100% spot-checks, the scheduler correctly paused delegation because it cost more than it saved.
- **Not verified here:** many real devices on the internet, mobile browsers, and a hosted Render coordinator under load. The scaling table in `docs/KUNPP.md` §6 is an extrapolation.

## v1.4.2: verb senses, structured extraction, network agreement

- **Tests:** 122 automated tests pass. New coverage:
  - a learned verb sense used in held-out sentences; before learning, the meaning is explicitly unknown, and no noun sense is borrowed
  - claims extracted from interpreted roles, negation and modality
  - price options with currencies, per-unit prices and unit normalisation, applied through a learned method
  - `tests/consensus.test.mjs`: three real server processes over signed ATP:
    - alpha teaches a verb sense; beta re-validates and activates it; gamma validates without adopting (`LIVE_ADOPT=off`); the result is agreed
    - gamma then activates a different meaning under the same id; alpha and beta vote conflict, and gamma's event is contested
    - alpha's own meaning is not overwritten
- **Not verified here:** agreement across real hosted Render nodes. The tests use local processes.

## v1.4.1: bounded investigation, interpretation coverage

- **Tests:** 118 automated tests pass, 2 of them new. They cover investigation against fixture pages (budget, disabled mode, both-sides rule) and the spec sentences (the river "when" clause, coordinated objects, and the Python follow-ups with no clarification).
- **Public chat check:** in Chromium, "I have a laptop and a phone." → "Is it expensive?" produced the clarification, and "I'm fine..." produced an uncertainty-preserving reply. There were no page errors.
- **Fixtures, not live sources:** investigation was tested only with fixture pages. Live Wikipedia and Brave fetching was not exercised here.

## v1.4: live cognitive evolution

Checks that passed:

- **Tests:** 116 automated tests pass. `tests/v14.test.mjs` covers acceptance demonstrations A–J, plus learning from teacher answers and failed-request discipline, and uses a frozen regression set (`tests/fixtures/regression-v14.json`).
- **Runtime check:** a real `server.mjs` process in an isolated test configuration (network off, no credentials), all in the same process:
  - the "bank of panels" sense was taught: observed → provisional → validated → committed → indexed → active (182 ms)
  - the next interpretation used `sense:en:bank#arrangement`, and finance questions still used the finance sense
  - the knowledge sequence went from 0 to 1, and transformer training steps stayed at 0
  - a knowledge correction (174 ms) advanced two molecules and one cell, invalidated the cached answer, and the next answer showed the corrected value with its review marked revised
- **Browser check:** a Chromium run of Studio → Live evolution showed events, propagation, answer history and the teach form.
- **Fixtures, not live providers:** teacher and method-learning results use stand-in teachers. Live Groq or xAI behaviour was not exercised.
- **Not verified here:**
  - multi-node activation
  - durability on Render free tier (it depends on the configured store)

## v1.3.1: no default teacher cap, provider rate-limit backoff, backfill

- **Tests:** 105 automated tests pass, 3 of them new. They check that:
  - the whole queue drains in one cycle with no cap
  - owner caps still apply
  - HTTP 429 pauses calls with Retry-After and reset-header parsing, and queued words are kept
  - the old 30-per-day default is lifted
  - earlier conversations are backfilled once
- **Not verified here:** live Groq rate-limit headers. The parsing is tested with stand-in responses.

## v1.3: every word and every meaning is an atom (complete, evolving, teacher-guarded DNA)

Checks that passed:

- **Tests:** 102 automated tests pass. `tests/v13.test.mjs` adds 8, covering:
  - words in questions and in KENUXA's answers become atoms
  - usage consolidation, with personal text never stored
  - full teacher DNA with links
  - poisoned and wrong teacher replies rejected
  - part-of-speech conflicts recorded as uncertainty
  - the hourly budget
  - corroboration with the new schema
  - expression atoms with and without a teacher
  - the explorer APIs
- **Browser check:** a Chromium run of Studio → Word atoms covered search, the list and the full DNA panel. The only console message was the expected 401 before sign-in.
- **Benchmarks:** interpretation, including usage observation, takes 0.24 ms per sentence. Median answer latency in the conversation evaluation is 144 ms.
- **Not verified here:**
  - the live Groq teacher's reply quality for the new full-DNA schema (tests use a stand-in teacher)
  - multi-node corroboration of teacher meanings across real hosts

## v1.2: ATP (Atom Transfer Protocol), causal reasoning, decomposition, synced chats

Checks that passed:

- **Tests:** 94 automated tests pass. `tests/v12.test.mjs` adds 6, plus an ATP migration test in `tests/mesh.test.mjs`.
- **Browser check:** a Chromium run with two separate browser profiles signed in to the same account. The second profile showed the first one's conversation, and after signing out nothing remained on that device. There were no page errors.
- **Benchmarks:** the conversation evaluation and atom benchmark figures are in `docs/COGNITIVE-ARCHITECTURE.md` §14.
- **Not verified here:** an actual mixed network of v1.2 and older nodes on Render. Legacy interoperability is tested in-process and with signed requests, but not across real hosts.

## v1.1: cognitive network (context, verified answers, teacher dissection, identity)

Checks that passed:

- **Tests:** 87 automated tests pass. These suites are new:
  - `tests/cognition.test.mjs`: the PART 12 solar regression across two nodes, plus restart, context, packs, verification and affect
  - `tests/learning-loop.test.mjs`
  - `tests/identity.test.mjs`
  - `tests/integrity.test.mjs`
- **Before and after** (`node bench/cognition.eval.mjs`, offline):

  | | v1.0 | v1.1 |
  |---|---|---|
  | Follow-ups bound to their topic | 0 / 4 | 4 / 4 |
  | Leaked internal errors | 3 | 0 |

- **Browser check:** a Chromium run of the chat (solar conversation and account dialog) showed no page or console errors.
- **Regulatory claims** in the Ghana solar pack were checked against the Energy Commission pages, the June 2023 guideline, GNA and Pulse on 3 November 2026.
- **Not verified here:** live Groq or Grok calls, because the sandbox has no internet access (the teacher paths are tested with a stand-in provider), and accounts across multiple real Render services.

## v1.0: statement learning, corroboration, teacher path, multilingual analysis, encrypted domains, adaptive stripes

Checks that passed:

- **Tests:** 71 automated tests pass. `tests/v1.test.mjs` adds 8 of them:
  - statement learning with sources, contradictions and curated protection
  - a running node learning a statement and then reasoning with it
  - corroboration and disputes
  - the teacher lexicon path, end to end, with a stand-in provider
  - a French question answered through a labelled teacher analysis
  - encrypted private domains (no plaintext and no atom ids at peers, wrong key finds nothing)
  - 8+4 stripes surviving 4 losses, then repaired
  - the per-peer storage budget
- **Benchmark:** results are in `docs/ATOMIC-ARCHITECTURE.md` §L.
- **Not verified here:** live Groq (the sandbox has no internet access), and preservation and corroboration across real hosted nodes. Both are implemented, but they must be checked after deploying.

## v0.9: reasoning, ellipsis, idioms, response plans, gated training releases

Checks that passed:

- **Tests:** 63 automated tests pass. The 14 new ones are:
  - **`tests/atoms-advanced.test.mjs` (8):**
    - Python/Windows context, ellipsis and idioms
    - IS_A reasoning
    - genesis migration from v0.8
    - tenant-scoped deduplication with compressed index metadata
    - backpressure and retry backoff
    - rebalancing, orphan GC, alerts and the REPAIRING state
  - **`tests/pipeline.test.mjs` (4):**
    - dataset curation and the privacy scrub
    - the promotion gate
    - candidate training that never changes the served model until it passes, with versioned rollback
    - manual approval
  - **`tests/reasoning-node.test.mjs` (2):**
    - a running node answers "Is a python an animal?" by inference, with a response plan
    - public chat keeps per-conversation discourse
- **Benchmark** (`node bench/atoms.bench.mjs`): at about 20.5k atoms, metadata fell from 5.80 MB (v0.8) to 0.57 MB, and remote retrieval from 4.9 ms to 0.7 ms. Recovery after 2 of 8 nodes died restored 97 of 97 segments, leaving 0 degraded.
- **Not verified here:** teacher (Groq) sense proposals and preservation across real hosted nodes, because the sandbox has no internet access. The per-peer storage rate limit was reviewed but has no automated test.

## v0.8: universal atoms, Atomic DNA, decentralized preservation

Checks that passed:

- **Tests:** 49 automated tests pass. The 16 new ones are:
  - A–O from the master prompt, in `tests/atoms.test.mjs`
  - a real-process test with six `server.mjs` nodes: node alpha commits newly discovered atoms across the mesh and is killed with SIGKILL, then delta and zeta, which never saw the words, retrieve them from the network
- **Benchmarks:** the figures in `docs/ATOMIC-ARCHITECTURE.md` §G come from `node bench/atoms.bench.mjs` on the build machine. The benchmark runs in memory on one machine, so cross-host latency will be higher.
- **Not verified here:** teacher (Groq) sense proposals and preservation across real hosted nodes. The sandbox has no internet access, so both are implemented but must be checked after deploying.

## v0.7: automatic open network

Checks that passed:

- **Tests:** 33 automated tests pass. The new ones cover:
  - **Signatures:** a fingerprint is bound to one key, replays are rejected, a signature only works for its own path, and swapping in another key is rejected.
  - **Joining:** four real node processes, with no shared secret and no peer list, joined starting from one seed:
    - B joined A, and A learned B from B's hello
    - C learned A by gossip through B
    - a lesson held independently by A and B reached C and was approved there by network consensus
    - a brand-new node D answered a question it had never learned by asking the network
  - **Defaults:** a node hosted on Render is on the network with the bundled seed, and a node on a PC is private.
- **Genesis seed:** `https://kenuxa-internet.onrender.com` responded to `/health` on 3 November 2026. It was still running v0.4, so it starts acting as the seed once v0.7 is deployed there.

## v0.6: public chat and research studio

Checks that passed:

- **Tests:** 30 automated tests pass. The new chat test runs a node flagged as hosted on Render and checks that:
  - `/` serves the chat with no studio navigation
  - `/studio` serves the studio, while `/api/status` still needs the admin token
  - the public `/chat/ask` answers without exposing internal sections or traces
  - "Tell me more about it" resolves against the conversation history
  - the per-visitor rate limit triggers, and cross-origin posts are refused
- **Browser:** Chromium screenshots (desktop dark and light, iPhone 13) of the empty state, a staged plan, a comparison table, a follow-up, an unknown topic and a mobile answer. There were no page or console errors.

## v0.5: comprehension, meaning frames and premium interface

Checks that passed:

- **Tests:** 28 automated tests pass. The new ones cover meaning frames on every atom (category, purposes, examples, parts, value, enrichment merge) and comprehension:
  - "How do I start a solar company in Ghana with $5000?" → intent: plan, action: start, focus: solar company, location: Ghana, budget: $5000, linked atom: solar energy.
  - Two-sided comparison, cause, greeting and yes/no questions are recognised.
  - "Where is Accra?" links through a value match.
  - "Tell me more about it" resolves "it" to the previous concept.
  - Answers are grounded, and an unknown topic returns an honest "not invented" reply.
- **Real data:** on the user's real v0.3 data, the live server built a 6-step plan that respects the stated constraints, a comparison of footwear and garment from the meaning frames, a greeting, a value lookup ("Where is Accra?") and a pronoun follow-up. An unknown topic got an honest reply.
- **Browser:** Chromium screenshots of the landing page (desktop and iPhone 13), the chat with the live understanding preview and the comprehension card, the force-directed graph, the meaning-frame card and the command palette showed no page errors. The only console error was the expected 401 from the status check before login.

Not verified:

- **Teacher composition** and **meaning enrichment** depend on a configured teacher key. They were not exercised live.

## v0.4: transformer, 7-part responses, Supabase, cross-host federation

Checks that passed:

- **Tests:** 25 automated tests pass (`npm test`, about 13 s).
- **Transformer gradients:** the hand-written backward pass for all weight types, and for atom-kernel prefix inputs, matches central-difference numerical gradients within 2%, both with and without gradient checkpointing.
- **Transformer inference:** KV-cache tiled attention reproduces full attention to within 1e-4. Appending identity-initialised layers leaves the outputs unchanged.
- **Transformer training:** training lowers loss, and fp16 checkpoints round-trip.
- **Real data:** the v0.3 state from the user's PC (24 atoms) loaded unchanged. It produced 10 molecules, 5 cells, and life-cycle stages (13 shared, 11 local).
- **Background training:** the worker reached step 25 (loss 5.13) while `/health` kept answering in about 35 ms, including during kernel growth.
- **Evolution tick:** a tick grew an atom kernel and embedding inside the worker.
- **Browser:** the 7-part answer and the Core & evolution view rendered in Chromium with no console errors.
- **Supabase mirroring:** tested against a mock Supabase REST API. Every mirrored row satisfied the original v1.1 CHECK constraints (entity type, relationship type, attachment category, weight range). Unchanged entities were not re-sent.
- **Serverless:** a Netlify-style node built from a web `Request` answered with all 7 sections. It ran an evolution tick through `/cron/tick` with `CRON_SECRET`, rejected the tick without the secret, and flushed state before replying.
- **Discovery:** three real node processes found each other (over MTP/0.5, now ATP). C learned A's address by gossip through B, and A learned B from B's hello. C then pulled A's public atom directly over signed MTP. The atom arrived pending, with A recorded as a confirmation.

Not verified:

- **Live deployments:** no Render, Railway, Vercel or Netlify deployment was tested. The configuration files follow each platform's documented format.
- **Live Supabase writes:** these depend on running the migration and adding the server key to `.env`.
- **Transformer quality:** text quality after long training is not established. Drafts stay hidden until 1000 steps.

## v0.3 research and method learning

- Fifteen automated test groups pass. New coverage includes first-time method teaching, transfer from Venus to Saturn using new evidence rather than copied answers, parallel request deduplication, method persistence, source-reference inheritance through molecules/cells, blocked reuse of rejected lessons, suppressed failed-teacher retries, teacher response cache reuse across restart without credentials or additional quota use, search-key routing, and citation/coverage critique. Provider and Brave calls use fixtures, not live credentials.
- In the actual local browser, asked the previously unknown question What is bioluminescence? The service discovered Wikipedia results, read three public pages and returned three exact cited passages. The UI displayed source links, pending review status, search coverage and self-review gaps.
- Repeating the question returned Answer memory reused with no new search or teacher call. Restarted the actual service, reloaded v0.3, and verified that the saved answer still returned from memory with citation review.
- A live fresh-source request read three pages again and reported wordingChanged=false. The original supported wording was retained, and the preceding answer version was saved for comparison.
- Local research status confirmed one saved researched question and zero teacher attempts. No teacher or Brave API key is installed, so live method teaching and broad Brave search were NOT verified. The live method was builtin:explanation; teacher-trained methods are verified by mocked integration tests only.
- Researched atoms remain pending until owner approval. Local answer reuse is explicitly provisional. Private research/teacher data remains in ignored local state; no credentials or runtime learning files are committed.
- Screenshot proof: kenuxa-research-v03.png in the Codex visualization output directory. This is bounded extractive evidence processing and reusable parameterized research procedures, not a generally reasoning model, whole-web crawler, or hallucination-free answer system.

## v0.2 upgrade verification

- Ten automated test groups pass, including the original two-node HTTP test and the new DNA, hierarchy, native capability, provider and crawler checks.
- The original local state was migrated to version 2 with a pre-DNA backup in the ignored data directory. Existing learned knowledge remained available.
- In the actual browser, created Dolphin, Shoe, Dress, Perfume, Homemade and Body spray as six domain atoms. Each developed its own native agent/expert records from its DNA.
- In the browser, combined Dolphin/Shoe/Dress into Outfit molecule and Perfume/Homemade/Body spray into Scent molecule, then formed Fashion cell from those molecules. The cell displayed advanced native specialists, its evidence/consistency/domain council, six unique atom members and inherited outfit/brand/scent capabilities.
- Executed the Fashion cell's outfit capability in the browser. Then grew Shoe's meaning and example questions, taught Shoe a new shoe-fit text workflow, and observed Fashion cell's DNA revision and inherited capability update.
- Executed that newly inherited workflow through Fashion cell. Output included the supplied Accra walking brief, learned steps/checks and the relevant Shoe DNA claims.
- Restarted the service and repeated that learned capability execution successfully. The structures, DNA and learned program persisted. Council output clearly identified local rule-based checks and the absence of external evidence for the manually created examples.
- Real outbound HTTPS crawling successfully captured Wikipedia's Knowledge graph and Solar energy pages and produced pending atoms with source URLs, timestamps, excerpts and SHA-256 fingerprints. The initial 600 KB page limit proved too small; the final extractor uses a bounded 3 MB response limit. Failures were recorded rather than represented as successful atoms.
- Source-grounded atoms stayed pending because no teacher keys were configured. The crawler remains enabled on the running local node. Automatic acceptance/training is off by default and can be enabled explicitly in Web learning.
- Verified the AI teachers screen shows Groq as primary, all eight provider presets, the compatible-provider option, a daily call budget and no configured credentials.
- Automated tests cover every provider adapter with synthetic responses; runtime keys are absent from serialized state, exports and metadata. No provider was called live and no key was created.
- Automated crawler tests cover missing teachers, matching/mismatched quotations, newly configured teachers inspecting old captures, unchanged-source deduplication, source-change proposals and rejection of automatic acceptance with unresolved source conflicts.
- HTTP tests exercise domain creation, manual molecule/cell formation, DNA growth, learned-capability inheritance/execution and blocking private-address source URLs. Existing private DNA, lessons, conversations and credentials remain excluded from peer payloads.
- The native specialists are local graph/procedural runtimes. They are not independent general-purpose LLMs, professional experts or proof that all subject tasks can be completed. The own answer model remains the small supervised answer-selection model.

The v0.2 source is prepared for the existing public GitHub repository. Git upload is verified separately by checking the remote commit against the local commit. Local learned state and secrets are excluded.

## Original v0.1 delivery record

Location: `C:\Users\Procus\Desktop\KENUXA\kenuxa-internet`

## Completed

- Node.js v24.20.0 ran this dependency-free application locally at http://127.0.0.1:3210.
- `npm install --package-lock-only --ignore-scripts` completed; audit reported zero dependencies with vulnerabilities (there are no external runtime dependencies).
- `npm test`: four tests passed, zero failed. The integration test launched two independent real HTTP node processes with separate data directories.
- Own model: trained starter curriculum, answered a paraphrase about Ghana and one about solar energy, declined an unknown topic, produced numerical weight checkpoints.
- Federation: public lesson from A entered B's pending queue, B abstained before approval, B answered after approval without Groq, duplicate sync added no duplicate, B retained its answer after process restart. Private lesson content and conversation memory were absent from A's signed snapshot.
- Authentication: missing admin token rejected; missing/wrong/expired/replayed federation authentication rejected; non-Render and metadata-service peer URLs rejected. Signed response verification passed.
- Groq teacher adapter: mocked request/response test passed, including missing-key and HTTP 429 handling. No paid request was made.
- Browser: opened the actual app, typed “What is the capital of Ghana?”, and observed “The capital of Ghana is Accra” labelled KENUXA own model.
- Browser: created a private manual lesson about Kenuxa outcomes in the Learning studio. Counts changed from 13 meanings / 45 examples to 14 / 48. Asked “What does an outcome record?” and observed the newly learned answer from the own model with no teacher configured.
- Browser: inspected teacher-offline messaging, local model metadata and review queue. Saved `kenuxa-preview.png` showing both real answers.
- Syntax checks: `node --check server.mjs` and `node --check public/app.js` completed successfully.

## Not established

- No Groq key was configured and no live Groq lesson batch was requested. Teacher functionality requires GROQ_API_KEY on the server.
- No Render account was deployed or connected. The supplied Render blueprint and instructions are deployment preparation, not proof of a hosted mesh. The source repository was subsequently prepared for upload to https://github.com/LosharHammond/Kenuxa-Internet; learned state, checkpoints and credentials are excluded from Git.
- No existing Supabase database was modified.
- This verifies a small trained answer-selection model and curriculum federation, not an original generative transformer, distributed parameter training, broad factual accuracy or a security audit.

The manual lesson and the two browser questions remain in the local data directory as initial knowledge and memory. Test fixtures use separate temporary directories and do not populate the user's node.

## Render binding regression fix - 3 November 2026

The supplied Render log deployed commit 45dca26 (v0.3) and bound only to 127.0.0.1. The local v0.4 upgrade was not yet committed. Render platform detection now forces 0.0.0.0 even if a copied local HOST setting specifies loopback; the supplied PORT is preserved. A real-process regression test starts with RENDER=true and HOST=127.0.0.1, checks the 0.0.0.0 startup address, verifies /health, and verifies unauthenticated /api/status is denied. Local environment files and Claude outputs are excluded from Git and container context. This verifies startup locally; a successful hosted Render redeploy still needs to be observed.

## v1.11 foundation + federated record storage — 4 November 2026

- Downloaded official Princeton WordNet 3.0, retained its full licence, and built 147,306 normalized lemmas / 117,659 synsets / 5,940 morphology exceptions into 513 gzip data shards (12,512,673 bytes). Every compressed shard has a verified SHA-256 manifest entry. The full package is shipped; raw downloads stay ignored.
- Obtained 30 CC0 structured Wikidata educational entities with source revisions/URLs and selected claim references. Existing grammar, seed lessons, source packs, cognitive seed models/rules and declarative procedure specifications moved into checksummed JSON assets. Pattern descriptors preserve trusted RegExp behavior through explicit data encoding/revival; executable functions are rejected.
- New randomized foundation/storage test groups exercise source lookup, source integrity, real file replicas, SQLite-backed Turso protocol execution, Supabase protocol fixtures, stable IDs/versions, idempotence, missing/corrupt replica fallback, private access denial, duplicate/non-durable domain rejection, capacity backpressure, interrupted writes, control-journal failure and restart recovery. Hosted adapters were NOT run against live cloud databases; no production migration or account setup occurred.
- Authenticated owner APIs and studio lookup/storage controls were inspected in the actual browser on an isolated offline server at port 3299. Looked up microscope, saw its source sense ID and example, stored that atom, and observed COMMITTED with one local location and 2,029 stored bytes. This is a local-policy commit, not a global or cloud durability claim.
- Definition API answered Define microscope from local dictionary senses with no teacher. A fresh node without cloud keys or network retained foundation lookup and recovered a committed record after restart. Private live events were proven excluded from automatic/public storage routes.
- The first full regression pass identified four dictionary integration regressions, fixed by preserving dictionary verb morphology and leaving absent lexical reads to explicit hydration. A later pass caught RegExp serialization loss in cognitive data; tagged data encoding/revival and a regression test fixed it. Affected cognition/live-update groups pass after the fixes.
- Local benchmark (Node v24.20.0): catalog open 2.47 ms; 12 cold lookups 261.76 ms; 60 cached atom accesses 227.69 ms; 39.76 MiB heap in the benchmark process. Thirty records into two local failure-domain fixtures took 514.96 ms; thirty reads 41.04 ms. No cloud cost/latency benchmark is implied. See docs/FOUNDATION-BENCHMARK.json.
- Scope: English lexical baseline + small world subset; no Wiktionary/ConceptNet dump bundled, no arbitrary provider signup, no S3/R2/Neon adapter, no automatic multi-writer canonical consensus or independent remote journal backup. These boundaries are explicit in docs/FOUNDATION-STORAGE.md.

Final acceptance: 200 tests passed, zero failures, in the complete suite excluding the previously unverified long-running candidate-training promotion test. The final file-adapter atomic publish path was separately rechecked in all 12 foundation/storage groups. Background backfill avoids eager dictionary hydration, and the bounded lexicon loop consults the offline foundation before spending teacher quota.
