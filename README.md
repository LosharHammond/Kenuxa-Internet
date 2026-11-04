# KENUXA Internet v1.11 — offline foundation and federated record storage

## New: licensed offline foundation and provider-independent records

A fresh installation now includes 147,306 WordNet lemmas, 117,659 senses and a small CC0 Wikidata educational snapshot. Eight compressed dictionary shards are cached at most. Explicit definition requests can be answered offline. Grammar, starter lessons, world packs, cognitive seeds and declarative methods are checksummed data assets; active knowledge can evolve through the existing live ledger without a code redeploy.

The new owner-operated storage manager supports immutable local, Supabase REST and Turso HTTP records, canonical manifests, placement budgets, independent-domain replica policies, checksum fallback and partial-write recovery. It does not create cloud accounts or migrate your production database. Cloud adapters have isolated protocol tests; live cloud replication is not configured by this release.

Open **Web learning → Offline foundation & federated storage**. Read [the complete architecture, setup and limits](docs/FOUNDATION-STORAGE.md), [dataset licensing](foundation/README.md) and [provider eligibility snapshot](docs/FOUNDATION-STORAGE.md#current-eligibility-snapshot--4-november-2026). R2 and Neon are evaluated candidates, not active adapters. No package or test establishes universal question answering.


A fresh reconstruction from your surviving semantic-internet specification. It is not a recovered copy of the lost laptop's code. v0.4 reconnects to the original **INTERNET** Supabase project and reuses its v1.1 *Semantic Graph Entity Schema* tables: entities, relationships, attachments, capabilities, embeddings and resolutions.

Every component serves **Meaning → Capability → Outcome → Evolution**. The graph is the intelligence layer. The transformer is a component inside the network; it is not the centre. Storage is not intelligence.

## New in v1.10: safe under any input, and tested differently every run

- **Any input, any route.** Every question and every request body sent to any route gets a safe, honest, well-formed response. Nothing crashes, and no internal errors or secrets leak. What KENUXA can compute it computes exactly. When it doesn't know, it says so.
- **Different tests every run.** The automated tests generate new random questions, conversations, attack inputs and calculations on every run. Any failure can be replayed exactly. This found and fixed 11 real bugs, including a learning mistake on ambiguous examples and two dishonest volunteers backing each other's fake result. See `docs/ROBUSTNESS.md`.
- **Also new:**
  - a tamper-proof audit log
  - safe replacement of a server's identity key
  - new kinds of setting defined as data
  - people's ratings decide whether a chat-layout change is kept
  - routing changes tested quietly on real work before they decide anything
  - a 5–7× faster search option for large knowledge stores
  - verified storage migration

## New in v1.9: the whole system can evolve (KUEE)

Every part of KENUXA can now be improved safely, not only its knowledge and reasoning. This covers retrieval, how volunteer work is scheduled, replication, memory limits, learning settings, security settings, protocols, the chat layout, and the evolution process itself.

- **One process for every change.** Each change is proposed, checked against protected safety rules, measured against the current version, approved according to its risk, tried on a share of traffic, watched, and kept or rolled back automatically.
- **Approval by risk.** Security and protocol changes always need the owner's explicit approval.
- **Never weakened.** Sign-in, the audit log, credential hashing, minimum proof-of-work, keeping a working protocol, and validation of learning cannot be weakened by any change.
- **Measured, not claimed.** In the scheduling simulation a better routing rule cut priority-weighted waiting by a third and data transfer by 60%. A rule that made things worse was rejected. A simpler search method that found the top answer more often but missed others more often was also rejected. The new measurements found and fixed three real bugs.
- **Nodes discover each other's capabilities.** Servers and volunteer devices are found by what they can do. Protocol versions are negotiated, and outdated nodes are refused safely instead of silently. Approved improvements spread between servers, and each server re-checks them itself.
- **Details:** `docs/EVOLUTION.md`.

## New in v1.8: KENUXA knows itself

- **Knows who made it.** Ask "Who created you?" and KENUXA answers: **created by Loshar Hammond Kenku, the owner of Kenuxa Technologies.** It also answers what it is (not a large language model), what it can and cannot do, how it works, and its current live state.
- **Never makes things up about itself.** Its self-knowledge comes from stored atoms plus the running node's real numbers, and it does not invent details about its creator.
- **Hypotheses and what-if results are really stored.** Each is saved as an atom whose status follows the evidence.
- **Self-evaluation.** "Run self-evaluation" (Studio → Cognitive engine, or `POST /api/mind/evaluate`) measures every reasoning category on a sandbox copy and keeps the history, so improvement or regression is visible.
- **Reviewable new knowledge.** New rules, causes and actions can be proposed and approved by the owner, after which they are used immediately.
- **Reasoning on request.** An owner reasoning service is available at `/api/mind/reason`.
- **New Studio panel** for the cognitive engine.

## New in v1.7: the Evolving Cognitive Engine

KENUXA now *applies* its knowledge, not just stores it. The new engine (`lib/mind/`) runs on the CPU with no model and no paid service, and it is part of the normal chat.

- **Calculations with executable procedures.** Methods are stored as data with physical units, for example "energy = power × time". They are checked for unit consistency and chained together automatically: a phone's battery size, its level and its use give how long it lasts. If a value is missing, KENUXA asks for it instead of guessing.
- **Situations that change.** "My phone is at 10% and I travel for three hours" builds a picture of the situation in which what you said, what was inferred and what was assumed are kept apart. "I don't have a power bank" removes that option, and "only ten minutes before leaving" is worked in. A different server can answer the next turn, because the picture travels with the conversation.
- **Diagnosis.** "My solar battery is not charging" lists the possible causes, rules some out from what you say, recommends the most informative safe check first, and never calls a cause proven.
- **What-if questions.** "What if a solar panel produced electricity at night?" is worked out on a model of the system and marked as hypothetical. KENUXA says which known fact the premise contradicts, and none of it is stored as knowledge.
- **Learning from corrections.** A verified correction (from the owner, a test or a reference, never a teacher alone) leads KENUXA to find the error, build a new procedure, check it on problems it has never seen and against everything it already got right, then adopt it or reject it. Measured on the evaluation set: held-out calculations went from 8/10 to 10/10 after a single correction, with no regressions.
- **Also included:**
  - rules with logical proofs, learned patterns, analogies, time constraints, budget constraints and probability (only with an explicit model)
  - a working memory for each problem, and a memory of past problems found by structure, not by wording
  - simple diagram vision: shapes, colours, connections; objects are named only from a legend or verified examples
- **Shared across the network.** Volunteer devices re-run the tests of new procedures (KUNPP `procedure-test/1`). Proven procedures are shared between servers, and each server re-tests them before use.
- **Details and honest limits:** `docs/COGNITIVE-ENGINE.md` has the audit, design, measurements, security review and what is not supported (no OCR, no real photographs, small evaluation sets).

## New in v1.6: KUNPP/2 — peer-to-peer, installed agents, storage on peers, failover

- **Peer-to-peer (WebRTC).** When two browsers check the same public atoms, the second gets them directly from the first over a DataChannel and re-hashes every revision. In a real two-browser run the server avoided sending 342–911 KB; a failed transfer falls back to HTTPS and is subtracted from the counted saving.
- **Installed agent (Type C) and specialised nodes (Type D).** `node agent/kenuxa-agent.mjs --coordinator https://your-node --consent [--storage-dir ./store --storage-mb 512] [--specialized symbolic-reasoning]`. No dependencies. A claimed capability is used only after the agent passes a probe with a known answer.
- **Storage on peers.** Agents hold replicated **public** revisions, prove them with fresh storage challenges, and can restore a revision the core lost. A restored revision is accepted only if its hash matches one the core already knows. Browsers are a cache, never durable storage.
- **More work types.** Relation checks, word-form consistency, claim consistency, graph metrics and transitive IS_A inference join atom validation.
- **The node measures every work type separately.** Today the new types are cheaper to run on the node than to hand out, so the node keeps them. Atom validation is still delegated, saving **68–91%** of the node's CPU for that work.
- **Harder to flood.** Each registration solves a small proof-of-work puzzle (about 30 ms; harder when many arrive at once), on top of the per-network limits, a per-account device cap, and replicas from different networks.
- **Survives a coordinator outage.** Every hosted node is a coordinator. Browsers and agents switch to the next one when theirs goes down; this is tested by killing the coordinator.
- **Smaller transfers.** Task payloads are gzipped, 8.5–11.7× smaller.
- **Still not covered:** a TURN relay, shared coordinator state, and first contact for new users when no hosted node is reachable. Details, measurements and limits are in `docs/KUNPP.md`.

## New in v1.5: volunteer computing (KUNPP)

Visitors can now **choose** to lend their browser to KENUXA. In the public chat sidebar, "Contribute computing" opens a consent dialog. If the visitor starts it, the tab checks small batches of **public** knowledge atoms in a background Web Worker: content hashes, schema, links and provenance. It runs only while the tab is open and visible, within the chosen profile (Light, Balanced or Custom). Pausing or stopping takes effect at once.

- **Safety.** Peers receive only public atoms and run only a fixed, published task module (`/peer-tasks.mjs`), with no code from the network. Every reported problem is re-checked by the node, and clean results are confirmed by an independent replica or a spot-check. Peers never write knowledge.
- **Measured.** Delegating the atom audit to 8 peers cut the node's own CPU for that work by **88%** with the default verification, and by **66%** with peers that drop tasks plus one malicious peer. The cost is outbound bandwidth (about 1.5 KB per atom). The node stops delegating whenever the measured overhead exceeds the work saved, and does the work itself when nobody participates.
- **Owner view:** Studio → **Compute network** shows peers, tasks, verification counts, the measured saving, findings and a revoke button.
- **Limits (v1.5, addressed in v1.6 above).** There was no WebRTC, no installed agent and no storage on peers, and one Render node was the single coordinator.
- **Details:** `docs/KUNPP.md` covers the architecture, protocol, measurements, scaling table, outage analysis, configuration and roadmap.

## New in v1.4: live cognitive evolution

KENUXA's knowledge now changes while the same server process keeps running. No redeploy is needed and no neural weights change. Studio → **Live evolution** shows every learning event, claim, method and answer revision.

- **Transactional learning events.** Each change moves through observed → provisional → validated → committed (durably stored) → indexed → active, with explicit disputed, rejected, superseded, revoked and failed states.
  - A request reads one consistent knowledge snapshot.
  - A failed write activates nothing.
  - Identical updates are applied once.
  - A correction made against a stale revision becomes a dispute instead of overwriting.
  - An interrupted commit is recovered after restart.
  - Any activation can be revoked.
- **Live senses.** Teach a word a new meaning with evidence (`POST /api/live/sense`). A teacher alone is not enough. The next request uses the new sense, and other senses keep their meaning.
- **Evidence-based claims.** Claims carry supporting and contradicting evidence, scope, dates and origin.
  - Copies of one article count once.
  - A teacher's statement is an opinion that does not establish a claim.
  - Verdicts: supported, contradicted, disputed, outdated, inferred, insufficient evidence or not established.
  - Competing explanations are shown with their evidence, and no winner is forced.
- **Learned methods.** Reusable procedures run in a restricted interpreter: no code, no `eval`, a fixed set of operations.
  - A method is applied only when it fits the new problem's inputs. Otherwise KENUXA says what is missing.
  - Each learning need gets one teacher request. A failed request is never retried silently.
- **Correction propagation.** Correcting a knowledge atom re-develops its intrinsic agent and expert, advances its molecules and cells, invalidates dependent answer caches and records the answer revision. Unrelated knowledge is untouched, and revoking the correction restores the old knowledge.
- **Context and tone.** An ambiguous "it" gets a focused clarification. "I'm fine" variants get calibrated alternative readings (never above 0.7) that are kept separate from what was observed.
- **Privacy.**
  - Words first seen in conversations stay private (not preserved to the network) until the teacher confirms them.
  - Public-chat statements become private notes.
  - Public-chat questions never enter the teacher curriculum or dataset export.
- **Learning sources.** `ATOMIZE_ANSWERS` is now **off** by default, so KENUXA's own answers are not turned into atoms. Teacher answers are learned from in depth: their words become atoms, and their claims are recorded as opinions to be checked.
- **Fixes.** The teacher-lesson memory no longer stops with "memory full" after 1,000 lessons; it is bounded and drops the oldest. The studio header shows the real version.
- **v1.4.2: verb senses, structured extraction, network agreement.**
  - Verb uses get verb senses; when no verb sense is known, the meaning stays explicitly unknown.
  - Claims and price options are read from KENUXA's own interpretation (roles, negation, modality, unit normalisation) instead of fixed patterns.
  - A live update is re-validated by each peer node, which then votes accept, reject or conflict. The origin reports agreed, contested or pending, and accepting peers activate the update through their own ledgers.
- **Bounded investigation (v1.4.1).** Disputed and teacher-only claims are checked against a few public pages, within `INVESTIGATE_PER_HOUR` (default 12). Only sentences that mention both sides of a claim count as evidence.
- **APIs (owner):**
  - `GET /api/live/status`, `/api/live/events`, `/api/live/claims`, `/api/live/methods`, `/api/live/answers`
  - `POST /api/live/sense`, `/api/live/correct`, `/api/live/revoke`, `/api/live/claim`, `/api/live/disagreement`, `/api/live/method`, `/api/live/method/learn`, `/api/live/method/apply`, `/api/live/retry`, `/api/live/investigate`, `/api/live/share`
- **Migration:** none. Existing state loads unchanged, and new fields are created on first use. No database migration is needed.

Details, measurements and the status of each capability (working, narrow heuristic or not implemented) are in `docs/COGNITIVE-ARCHITECTURE.md` §16.

## New in v1.3: every word and every meaning is an atom, with complete, evolving, teacher-guarded DNA

- **Every word a person or KENUXA uses becomes an atom.** This covers each word in a question or reply, and each word in KENUXA's own answers. A new word gets its atom on first use and is queued for the teacher.
- **Complete lexical DNA from a guarded teacher.** For each new word the teacher (Groq by default) is asked for:
  - every part of speech, the lemma, inflected forms and pronunciation
  - the word's purpose
  - every distinct meaning, each as its own sense atom with a definition, a broader category, a field, where and how it is used, register, examples, synonyms and antonyms
  - related words and collocations

  Synonyms, antonyms and related words become linked word atoms of their own, which are queued in turn.
- **The teacher cannot poison the registry.** Every reply is validated before anything is written:
  - text containing links, HTML, scripts or prompt-injection phrases is rejected
  - the lemma must be a plausible form of the word
  - examples must actually use the word
  - a part of speech that contradicts how people really used the word is recorded as uncertainty

  Rejected replies are logged (visible in the studio) and retried once. Accepted meanings stay **provisional** until another node or this node's own teacher corroborates them.
- **No teacher cap by default (v1.3.1).** Each cycle drains the whole word queue, bounded only by a time budget (`LEXICON_TICK_MS`, default 25 s). On hosted nodes, words from a new question are worked on right away. The old implicit limit of 30 teacher calls per day is lifted. KENUXA follows the provider's own rate limits instead: after HTTP 429 or 503 it pauses all teacher calls for as long as the provider says (`Retry-After` or the `x-ratelimit-reset-*` headers), otherwise with exponential backoff, and nothing queued is lost. Optional caps: `LEXICON_MAX_PER_HOUR`, `LEXICON_PER_TICK`, `TEACHER_MAX_CALLS_PER_DAY`, or the daily limit in Studio → AI teachers (leave it empty for no limit). Set a cap if your teacher charges per call.
- **Backfill.** Words from conversations and lessons stored before v1.3 are turned into atoms once.
- **Atoms keep evolving.** Each use is observed: count, roles, surface forms, neighbouring words and example sentences. At milestones (2, 5, 10, 25 … uses) the observations are written into the atom's DNA as a new revision. Words that repeatedly appear together get `RELATED_TO` links. History is never rewritten.
- **Multi-word meanings get atoms too.** Frequent word combinations (2–4 words, scored by PMI) and repeated whole sentences are checked by the teacher. Compounds ("solar panel"), idioms, phrasal verbs and proverbs become phrase or sentence atoms linked to their words, and the interpreter recognises them. Ordinary combinations are marked compositional. Without a teacher, frequent combinations become candidate atoms whose meaning is honestly marked unknown.
- **Privacy.** Only impersonal sentences are kept as examples. Sentences with first- or second-person words, names, numbers or addresses still count as usage, but their text is never stored in shared DNA.
- **Studio → Word atoms.** A new explorer lists every atom in the registry, with search and type/status filters. Each atom's full DNA is shown: identity, all senses, usage, links (clickable), evidence and trust, revision history and raw JSON. A separate panel lists expression atoms and the combinations still waiting to be checked. APIs: `GET /api/atoms/list`, `GET /api/lexicon/atom?id=`, `GET /api/atoms/candidates`.
- **Configuration:**
  - `LEXICON_PER_TICK` and `LEXICON_MAX_PER_HOUR` are optional caps; unset or 0 means unlimited.
  - `LEXICON_TICK_MS` sets the time budget per cycle. `LEXICON_EAGER=false` turns off starting work right after a question.
  - `ATOMIZE_ANSWERS=true` turns on atomizing KENUXA's own answers (off by default since v1.4).

## New in v1.2: ATP, causal reasoning, decomposition, synced chats

- **ATP, the Atom Transfer Protocol, replaces the old MTP name everywhere.** Nodes talk over `/atp/*` with `x-atp-*` signatures and advertise `ATP/1.0`. **Migration:** nodes still on MTP/0.5 keep working. Requests to `/mtp/*` with `x-mtp-*` headers are accepted, and a v1.2 node retries a peer's `/mtp/` route if it does not yet know `/atp/`. Both directions are tested. `GET /atp/info` now also advertises the node's **capabilities and health** (uptime, memory, storage, pending commits, alerts, open learning tasks).
- **Causal, multi-step reasoning.** "Heat causes expansion." and "Expansion causes cracks." are learned as unverified causal links. KENUXA then answers:
  - "Does heat cause cracks?" with "Possibly, indirectly…", treating each extra step as weaker
  - "What causes cracks?" with direct and indirect causes
  - "Why do cracks happen?" in the same way

  Denials ("Heat does not cause cracks.") make the question **disputed**.
- **Sentences are decomposed into events.** "The solar panel converts sunlight into electrical energy." gives actor = solar panel, action = convert, input = sunlight, output = electrical energy. Every answer's plan now carries this structure.
- **Only general statements become shared knowledge.** "My sister is a nurse." is personal and is never learned as a general fact.
- **Chat history syncs across your devices when you sign in.** It stays private and bounded, the newer edit wins, unsafe links are stripped, and signing out removes your synced chats from a shared device. Chats you make while signed out stay on that device only.
- **Metadata now survives as many losses as the data it describes.** On networks of 12 or more nodes, the index is kept on 5 nodes with majority writes, matching 8+4 stripes.

## New in v1.1: context continuity, verified answers, learning from a teacher, accounts and memory

The full report is in [docs/COGNITIVE-ARCHITECTURE.md](docs/COGNITIVE-ARCHITECTURE.md). It covers the audit, the design, the before/after measurements, security, deployment and limitations.

- **Follow-ups are understood, on any node.** "What if I don't have money?", "Which one should I start with?", "What about the licenses?" and "What happens if two nodes disappear?" are resolved against the conversation's topic, options and situation. Every answer carries a small context capsule that the chat sends back, so a *different* node, or the same node after a restart, continues the conversation. Measured: 0 of 4 follow-ups were bound correctly before, 4 of 4 now.
- **Verified knowledge packs with real citations.** The solar-business-in-Ghana answer now:
  - distinguishes six business models
  - cites the Energy Commission, Act 832, the 2023 licence guideline, ORC and GRA
  - flags figures that may have changed
  - adapts to a small or zero budget
- **Every answer is verified before delivery.** Internal errors never reach users, citations are deduplicated and valid, repetition and agreement errors are fixed, and relevance and uncertainty are checked.
- **Emotional context.** KENUXA recognises excitement, frustration, sadness, loneliness and other emotions from wording, says that this is an inference, and adapts its tone without claiming feelings.
- **Teacher–student learning.** KENUXA answers a gap question first, offline. The teacher (Groq or Grok) then answers, and the Atomic Dissection Engine compares both claim by claim. Errors are verified, their root cause is found, and teacher claims are promoted only as provisional knowledge. The teacher can be wrong and is caught. Tasks are leased so nodes don't duplicate work, a scheduler keeps background work out of the way of users, and a privacy-safe dataset is exported.
- **Accounts and private memory.** Users can say "Remember that…" and "Forget…", download their data, delete their account, and use approximate location only with consent. Sign-out separates people on a shared device, and private memory never becomes network knowledge.
- **Atomic correctness audit and a repository snapshot.** Public atoms can be backed up into the repository, which matters because Render free disks are ephemeral.

```bash
npm test                        # 94 tests
node bench/cognition.eval.mjs   # before/after conversation evaluation
```

## New in v1.0: learning from people, corroboration, multilingual understanding, encrypted private atoms

- **KENUXA learns from what it is told, carefully.**
  - Say "A kente is a cloth." and later ask "Is a kente a cloth?". The answer is yes, together with a note that this rests on an unverified statement.
  - Confidence grows only when *independent* sources agree.
  - Curated knowledge cannot be overwritten by a statement.
  - Contradictory statements make the question **disputed** instead of silently replacing anything.
- **Corroboration.** A meaning proposed by one node or teacher stays *provisional* until a second independent node agrees, or the node's own teacher does. It then becomes *corroborated*. Persistent disagreement marks it *disputed*.
- **Any language in, KENUXA reasoning out.** Words in any language become atoms natively. When a teacher is configured, it supplies a labelled analysis and an English rendering, which KENUXA then reasons over with its own rules. For example, "Le serpent est-il un animal ?" gets "Yes. A snake is a reptile, a reptile is an animal…".
- **Encrypted private atoms.** Set `KENUXA_DEDUP_DOMAIN` and `KENUXA_DOMAIN_KEY` (a 32-byte key). The node's atoms are then sealed with AES-256-GCM before they are spread over the network, and the index hides which atoms exist.
- **Wider codes on bigger networks.** From 12 nodes, segments use 8+4 coding, which survives 4 node losses at the same 1.5× overhead. Critical data gets an extra parity fragment.

```bash
npm test                       # 71 tests
```

## New in v0.9: reasoning, ellipsis, idioms, plans and a gated training pipeline

The full report is in [docs/ATOMIC-ARCHITECTURE.md](docs/ATOMIC-ARCHITECTURE.md); section K covers v0.9.

- **Reasoning over atoms.** Shared concept atoms form an IS_A taxonomy. Asked "Is a python an animal?", KENUXA works through each sense of the word. It answers that it **depends on the sense**: a python is a snake, a snake is a reptile, and a reptile is an animal. Each answer comes with its confidence and assumptions. A missing link is reported as "not established", never as "no". A proven inference is stored as a derived, provisional relationship atom.
- **Richer language.** It handles ellipsis ("I am learning." → "Are you?" / "So am I." / "Neither can she.") and idioms ("kick the bucket" means *die*, while "kicked the bucket of water" stays literal). It follows "What is Python?" → "How do I install it?" → "Can I use it on Windows?".
- **Every answer has a structured plan.** The plan records the intent, entities, references, where the answer came from (own node → network → web → teacher), the facts and reasoning used, the uncertainty, and validation checks.
- **Conversation memory.** Public chat keeps per-conversation discourse in memory only, for 30 minutes, keyed by a hash of the conversation id and the visitor's address. A device is never treated as a person.
- **Stronger preservation:**
  - metadata 10× smaller (compressed index)
  - private deduplication domains
  - backpressure and retry backoff
  - automatic rebalancing onto new hosts
  - safe garbage collection, alerts, and a REPAIRING state
- **Training is separate and gated.** Atom updates never touch weights. The transformer trains a *candidate*, and the served model changes only when a candidate:
  - beats it on held-out data
  - stays stable on a frozen regression set
  - passes the release policy (`TRANSFORMER_PROMOTION=gated|manual|off`)

  Versions can be rolled back. Training data is deduplicated and privacy-scrubbed first.

```bash
npm test                       # 63 tests
node bench/atoms.bench.mjs     # real timings on your machine
```

## New in v0.8: universal atoms and decentralized preservation

The full report is in [docs/ATOMIC-ARCHITECTURE.md](docs/ATOMIC-ARCHITECTURE.md). It covers the audit, the DNA schema, a pipeline demo, the measured efficiency, recovery, the tests and the limitations.

- **Every word, punctuation mark and number becomes an atom.**
  - Each has a stable logical ID (`lex:en:learning`, `sense:en:bank#river`, `sym:2e`) and content-hashed immutable revisions.
  - Each atom's DNA has six sections: identity, linguistic, semantic, functional, relational and epistemic.
  - Words never seen before become *provisional* atoms with `meaningStatus: unknown`. Meanings are never invented.
  - Segmentation is Unicode-aware, so Chinese and Thai, which have no spaces, also work.
- **Sentences are interpreted, not concatenated.**
  - The pipeline produces tense, aspect, negation, questions, modality, copular types and semantic roles. It also detects because-clauses as causes.
  - "it" is resolved from earlier turns, and "bank" is disambiguated from context.
  - Each node's answer cascade uses this interpretation and answers in this order: **its own knowledge → all other nodes → the web**, with the teacher guiding throughout.
- **Atoms survive their creator.**
  - Atoms are batched into content-addressed segments, either Reed–Solomon 4-of-6 coded or held as 3 replicas.
  - Placement spreads segments across different hosts (Render, Railway, Vercel, Netlify, Fly, home servers).
  - Metadata is signed and quorum-replicated, so the registry has no single point of failure.
  - Nothing is reported COMMITTED until enough copies exist; otherwise the atom stays PENDING_DURABILITY with the reason.
  - Repair rebuilds lost fragments automatically.
  - Tested by SIGKILLing the creating node among six real processes.
- **Measured:** 93 % less storage than copying everything everywhere, and 100 of 100 degraded segments restored after 2 of 8 nodes died. Run it yourself:

```bash
npm test                       # 49 tests, including A–O
node bench/atoms.bench.mjs     # real timings on your machine
```

Studio APIs: `POST /api/interpret {text}`, `GET /api/lexicon`, `GET /api/lexicon/atom?id=`, `POST /api/atoms/fetch {id, network}`, `POST /api/preserve` and `GET /api/preservation`.

## New in v0.7: the network joins itself

KENUXA is a network, not a single app. **Every node that is hosted online joins the KENUXA network automatically**: on Render, Railway, Vercel, Netlify, Fly or any server with a public address. Nobody has to set `NETWORK_SECRET` or `PEER_URLS`.

A node running on your own machine stays private. To join from your PC anyway, set `KENUXA_NETWORK=on`.

How joining works (`lib/mesh.mjs`, protocol **ATP/1.0 — Atom Transfer Protocol**; MTP/0.5 nodes are still accepted):

1. **Identity.** On first start a node creates its own Ed25519 key pair. Its network identity is the key's fingerprint. Every request and response is signed with it, timestamped and protected against replay, and each fingerprint is bound to exactly one key.
2. **First contact.** The node reads the bundled genesis seeds and the living directory in `network/seeds.json`, which it fetches again from the public repo, so the list can grow without code changes. It then says hello. The receiving node checks the announced URL by fetching the sender's signed `/mtp/info`.
3. **Gossip.** Every node tells its peers about the peers it knows, so the network spreads node to node. Learned peers are saved, so the network survives even if the genesis seed goes offline.
4. **Knowledge spreads.** Nodes pull each other's shareable atoms (`/mtp/snapshot`), deduplicated by content hash. They are shared:
   - knowledge learned from the public web, research, teachers or the network
   - anything the owner marked public

   Owner-written manual lessons stay private unless marked public, or unless you set `NETWORK_SHARE=all`.
5. **Ask the network.** When a node doesn't know something, it asks the network (`/mtp/query`) before calling a teacher. The answer cites the node it came from, and the atom is kept for review.
6. **The network adapts:**
   - every peer has a trust score that rises when its exchanges succeed and falls when they fail
   - unreachable peers are contacted less and less often
   - dead or hostile peers are eventually forgotten
   - knowledge held independently by several nodes is approved automatically by **network consensus**; the number of nodes required grows with the network
   - the evolution rhythm speeds up while the network is changing and slows when it's quiet

The original secret-based federation still works alongside this as an optional private overlay.

| Setting | Effect |
| --- | --- |
| `KENUXA_NETWORK=on/off` | Force joining or leaving the public network (default: on when hosted, off on your PC) |
| `KENUXA_SEEDS` | Extra first-contact URLs, comma-separated |
| `NETWORK_SHARE=all` | Also share owner-written lessons |
| `NETWORK_CONSENSUS` | Fix the number of confirming nodes instead of letting it adapt |
| `NETWORK_CONSENSUS_APPROVE=false` | Keep network-received atoms pending until the owner reviews them |

To help others find the network, add your node's URL to `network/seeds.json` with a pull request. Nodes only need the list for their first contact.

## New in v0.6: public chat and research studio

**Hosted nodes show a clean chat by default.** On Render, Railway, Vercel or Netlify, visitors see a chat page (`public/chat.html`) with:

- chat history on the left (New chat, search, grouped by day, delete)
- light, dark and system themes
- answers that type out in clean formatting: paragraphs, bold, numbered steps, comparison tables and numbered citations linked to their sources
- a subtle "understood as…" line under each answer, which expands to show how KENUXA read the question
- copy, regenerate, 👍/👎 and suggested follow-up questions
- a layout that works on phones

Visitors need no account. Their conversations stay in their own browser (localStorage); the node keeps only anonymous outcome events and whatever it learns from research. Public questions go through `POST /chat/ask`, which is limited per visitor (`PUBLIC_QUESTIONS_PER_MINUTE`, default 12) and per node (`PUBLIC_QUESTIONS_PER_DAY`, default 1000).

**The research studio is for owners.** Atoms & DNA, the meaning graph, learning studio, web learning, AI teachers, core & evolution, connected nodes, and memory & outcomes all live at `/studio`, behind the admin token. Public visitors never see them.

| Setting | Effect |
| --- | --- |
| `KENUXA_MODE=chat` | `/` is the public chat (default on hosted platforms) |
| `KENUXA_MODE=studio` | `/` is the research studio (default when self-hosted on your PC); the chat stays at `/chat` |
| `STUDIO_ENABLED=false` | Removes `/studio` entirely |
| `KENUXA_NAME` | Display name in the chat (default KENUXA) |

## New in v0.5

### Comprehension before answering (`lib/comprehension.mjs`)

Before KENUXA answers, it works out what the message means:

- **Speech act and intent:** 17 intent families, including define, explain, achieve a goal, how-to, compare, why, who/where/when, how many, list, recommend, yes/no, make something, go deeper and greeting.
- **Underlying goal:** what the person is trying to achieve, plus the qualities a good answer needs.
- **Focus and action:** what the message is about, and the verb when there is one (for example "start").
- **Linked meaning atoms:** words are matched to atoms by exact label, alias, value, partial match or tag.
- **Constraints:** location, time, budget, audience, format and tone.
- **References:** "it", "this" and "they" resolve to what the conversation was just about.
- **Ambiguity and score:** ambiguities are flagged, and the whole reading gets an understanding score.

The understanding guides research: the search uses the understood focus, not the raw words.

The answer is then **constructed for the shape the person needs**: a definition, an explanation, a staged plan, a comparison, reasons, a list, a fact or a yes/no answer. It is built from meaning frames, approved claims and captured evidence. When KENUXA has no grounded knowledge, it says so instead of inventing an answer.

Plans for goals it has no verified facts about are labelled as a general framework. If a teacher is configured and KENUXA's own knowledge cannot fully serve the goal, the teacher composes the answer. That answer is saved as a pending atom, so the same question is never sent to a teacher twice. Set `TEACHER_COMPOSE=false` to turn this off.

`POST /api/understand` returns the understanding alone. The app shows it live while you type, and on every answer as "How KENUXA understood you".

### Every atom has explicit meaning (`lib/meaning.mjs`)

Each atom's DNA now holds a **meaning frame** (`dna.meaning.frame`) with these slots: label, essence, kind, category (genus), value, distinguishing traits, purposes, causes, effects, parts, examples, places and domains. Each frame also records its depth and provenance. Frames are extracted from the atom's own definition, claims and evidence, and they regrow whenever the DNA grows. Molecules and cells compose frames from their members.

A teacher can **enrich** a frame (`POST /api/meaning/enrich`). Enrichments are validated, merged with their source recorded, and never silently replace what was extracted.

### Premium interface

- **Public landing page:** a live 3D "meaning cosmos" drawn from the node's public atoms, live counters from the public `/pulse` endpoint (aggregate data only), an animated comprehension demo, and the atom → molecule → cell story.
- **App:** a glass interface with a live understanding preview, a command palette (Ctrl/⌘K, or `/` to jump to the question box), an animated force-directed meaning graph (hover, drag, zoom, click to open an atom), meaning-frame cards on atoms, and a live status pill.
- **Accessibility and security:** layouts work on phones, reduced-motion is respected, and the strict CSP is unchanged (no external scripts, fonts or images).

## New in v0.4

### KENUXA Core Transformer (`lib/transformer/`)

This is a real decoder-only transformer written in plain JavaScript. It has no dependencies and no downloaded weights. Every parameter is trained by your node on approved atoms.

| Spec item | Implementation |
| --- | --- |
| 9 transformer layers | 9 pre-norm blocks in every profile. `TRANSFORMER_EXTRA_LAYERS` stacks more layers that start as exact identities, so the network's existing behaviour is preserved |
| 81 attention heads | 81 query heads per layer |
| GQA | 9 key/value heads, so 9 query heads share each KV head |
| RoPE | Rotary positions, base 500000 |
| RMSNorm, SwiGLU | Both used in every block, plus a final RMSNorm |
| 32K context baseline | 32,768-token positional range. Inference uses a KV cache |
| Flash attention | Tiled online-softmax attention during inference, which never materialises the full attention matrix. This is the flash-attention algorithm on the CPU, not NVIDIA's CUDA kernel |
| Mixed precision | fp32 compute and fp16 checkpoint storage. JavaScript has no fp16 arithmetic |
| Gradient checkpointing | On by default. Layer activations are recomputed during the backward pass |
| Scalable hidden dimension | Profiles `nano` (head dim 2, about 2.5M parameters), `lite` (4, about 9.7M) and `core` (8, about 39M) |
| Mini-transformer kernel per atom | Each approved atom trains its own prefix vectors against the frozen shared transformer. Molecules and cells merge their members' kernels |

Its jobs are meaning embeddings (stored in `embeddings`, including a pgvector `vec` column), atom kernels, and *experimental drafts*. Drafts are hidden until `TRANSFORMER_MIN_STEPS_FOR_DRAFTS` (1000) steps have run, and they are always labelled as generated rather than retrieved. Embedding-based `similar-meaning` links are created only after 2000 steps.

Long-running hosts train continuously in a worker thread, so the server stays responsive. `nano` manages about 1,000–2,000 steps per hour on a typical CPU. A model trained from scratch on a small curriculum will produce rough text for a long time. It does not compare with Groq or GPT-class models. The backward pass is verified against numerical gradients in `tests/transformer.test.mjs`.

### Mandatory 7-part response

Every `/api/ask` reply includes `sections`: **1** direct answer, **2** meaning graph (entities, relationships, parent molecules and cells), **3** outcomes (expected result, observed ratings, confidence, validation, prediction), **4** capabilities (executable native skills, each with a ready API call), **5** action layer, **6** evidence layer (external citations and internal trust), and **7** evolution layer (what was learned this turn). The internal graph is searched first. External research follows only when needed.

### 4-stage atom life cycle and trust scoring

**LOCAL** (private) → **SHARED** (public or received from a peer) → **VERIFIED** (approved, with captured external evidence, no open contradictions, and either teacher support or two or more source domains) → **GLOBAL** (verified, with identical approved knowledge confirmed by two or more other nodes). Each atom carries a numeric 0–1 trust score.

### Evolution Kernel (`lib/evolution.mjs`)

Each node keeps creating and growing its own atoms, molecules, cells, agents and experts. One tick runs these steps in order:

1. Expand the crawl frontier from known topics.
2. Crawl.
3. Run teacher inspection when a teacher is configured.
4. Update the life cycle.
5. Grow kernels and embeddings.
6. Add semantic links.
7. Discover peers.
8. Federate.
9. Train.

Agents and experts regenerate from the grown DNA. Long-running hosts tick every `EVOLUTION_INTERVAL_SECONDS`. Serverless hosts tick from a scheduler. You can also trigger a tick under **Core & evolution → Run an evolution tick**.

### Supabase storage (`lib/store.mjs`, `supabase/migrations/`)

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or a `sb_secret_…` key). The node then keeps its full graph state in `kenuxa_node_state` and mirrors it into the original tables:

- entities use the v1.1 type vocabulary (atom → Knowledge, domain atom → Concept, molecule or cell → Custom)
- relationships use CONNECTED_TO, PART_OF and SIMILAR_TO
- attachments use category Evidence
- capabilities, embeddings and resolutions are mirrored too
- the new tables are `outcomes`, `agents` and `memory_logs`

Every row carries `node_id`, so several nodes can share one project. Transformer checkpoints go to the private Storage bucket `kenuxa`. Run `0001_kenuxa_internet_v04.sql` once; it is additive and never drops data. `0002_tighten_v11_policies.sql` is recommended. It removes the v1.1 "anyone with the anon key can write" policies.

### ATP federation on any host (`lib/federation.mjs`, `lib/node.mjs`, `lib/adapters.mjs`)

The legacy pull protocol is ATP/0.4 (the *Atom Transfer Protocol*; earlier releases called it MTP). Peers can be any public HTTPS origin: Render, Railway, Vercel, Netlify, Fly or a custom domain. Every request and every response is HMAC-signed with the shared `NETWORK_SECRET`.

Nodes find each other in three ways:

1. **Configured** `PEER_URLS`.
2. **Hello announcements.** A node tells its peers its own public URL.
3. **Gossip and registry.** Snapshots list each node's known peers. Nodes sharing a Supabase project also find each other through the `kenuxa_nodes` table.

Received atoms arrive pending unless `FEDERATION_AUTO_APPROVE=true` and the sender marked them VERIFIED or GLOBAL. Peer molecules re-form locally once their members exist on the receiving node.

## Question-driven research and method memory

Ask Kenuxa an unfamiliar question. It first checks local memory and its small trained model. It then discovers at most five candidate URLs and reads at most three public pages with the existing HTTPS, DNS pinning, robots and redirect controls. Without a search key, discovery searches Wikipedia only. Add your own Brave Search key in Web learning or BRAVE_SEARCH_API_KEY for broader public-web discovery. Search terms leave this node; configured teachers receive the question and bounded source excerpts. No whole-web coverage is claimed.

The configured primary teacher can inspect a task-family example and teach a validated research recipe: discover, read, rank, extract and critique, with ranking weight and output size. Kenuxa executes this bounded procedure locally against NEW evidence for related explanation, comparison or procedure questions. This is executable method reuse, not memorizing a previous subject's answer. It is an initial extractive learning system, not general reasoning or arbitrary skill acquisition. Teacher output cannot add code or tool execution. Procedure tasks return research passages; they do not guarantee a complete actionable solution.

Successful teacher responses are hashed and persisted privately so identical requests reuse the original lesson even after restart. Concurrent identical requests share one upstream call. Research teaching attempts are persisted before dispatch; each of the three task families gets at most one automatic teaching attempt. Failure or interruption suppresses automatic retries. No key means a clearly identified built-in extraction recipe is used; add a key and choose Research further to obtain the first teaching attempt. The default primary is Groq, which is distinct from xAI's Grok. Provider availability, free tiers and quotas depend on the account; no provider is assumed permanently free.

Each researched answer stores exact source passages, retrieval times, method reference and a pending atom. Owner review is required before it trains the answer model or joins approved formations. Approved parent molecules and cells inherit method references. A researched answer may be reused provisionally before approval, with its review status displayed; rejecting the atom blocks that answer cache. Repeating the question uses saved evidence and local critique without another teacher call. The cache preserves word order to avoid confusing reversed relationships. The model also abstains when too much question vocabulary is unseen.

Learning & self-review shows execution steps, coverage and unresolved gaps. Known approved answers retain their supported wording when there is no evidenced improvement. Research further explicitly checks fresh sources, reuses the procedure, saves the new source version and retains the preceding answer for comparison. A changed answer is not labeled more accurate merely because it changed. Evidence older than 24 hours is flagged. Exact quotations prove source correspondence, not truth, relevance or completeness; every answer is not guaranteed to improve.

Memory limits are 500 researched questions and 1,000 successful teacher responses, without automatic eviction of learned teacher lessons. Store and back up the ignored data directory on persistent storage: Render instances without a disk lose local learning on redeploy. API configuration keys stay in server memory until restart; environment keys persist through your host configuration. Private question/method/teacher memory is excluded from federation snapshots. Full trusted state restoration preserves methods; lesson-only UI import does not restore them.

Search API documentation: [MediaWiki Search](https://www.mediawiki.org/wiki/API:Search), [Brave Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/get).

## A growing semantic organism

The source design is the shared [Building a New Internet conversation](https://chatgpt.com/share/6ae9f7be-f968-83e9-96bf-5dbfe23b34b1), extended by the atom/DNA → molecule → cell requirements. That conversation establishes immutable identity, meaning, graph connections, evidence, trust, context, attachments, capabilities, outcomes and version history. It is a conceptual design, not proof of an existing trained transformer.

Open **Atoms & DNA** to create a domain such as Shoe, Dress, Wisdom or Perfume. Each atom generates its native agent and expert from its own current DNA. The specialist records are developed locally from the atom's domain, claims, examples, evidence, learned programs and outcomes. No external expert is assigned to the atom. Their development index measures recorded knowledge/experience, not independently evaluated intelligence.

Combine any two or more approved atoms into a named molecule. Combine two or more molecules into a cell. A molecule develops medium specialists; a cell develops advanced specialists plus an evidence/consistency/domain council. The council runs distinct local inspections rather than pretending to be multiple independently trained language models. Automatic topic clusters also form, alongside your explicit structures.

DNA includes immutable identity, meaning/claims, domain context, relationship references, attachments, captured evidence, trust/reviews/contradictions, native capabilities, outcomes, memory, version history, own-model kernel metadata, and its native agent/expert. Runtime JSON files are serialization of this graph; the graph's typed entities and referenced relationships define the domain model. DNA is a bounded extensible record, not a claim to contain every fact about a topic.

When you add meaning, context, examples or a capability to an atom, its identity remains stable and its DNA revision grows. Its native specialists regenerate from the enriched DNA, and parent molecule/cell revisions and inherited capabilities update. Historical meaning snapshots are retained (last 50). Old local data is backed up in `data/pre-dna-backup-*.json` before its first v2 migration. Do not commit that backup.

### Native capabilities that run

The own runtime can retrieve scoped member knowledge, inspect evidence, compare members and create grounded task plans. Starter domain procedures include outfit direction, fashion-brand blueprints, scent concept briefs and decision frameworks. These are local procedural generators and do not call an LLM at execution time. They do not physically dress people, formulate safe cosmetics, execute purchases or guarantee professional expertise.

You can **teach new native capabilities** to an approved atom in its DNA screen: a named declarative workflow, steps and expert checks. Templates can use `{{brief}}` and `{{domain}}`. Parent molecules and cells inherit it. These programs produce structured proposals; they cannot execute JavaScript, shell commands or arbitrary remote tools. The primary teacher can draft new capabilities, but those proposals require owner review before learning. This extends domains beyond the starter procedures without pretending a new atom instantly knows everything about its subject.

### Continuous public-web ingestion

**Web learning** starts enabled, with a first cycle after roughly one minute and later cycles every 10 minutes while this process is awake. It checks at most two pages per cycle. The initial sources are Wikipedia articles on solar energy, photosynthesis and knowledge graphs. Configure 1–20 source URLs and the interval in the UI, pause it there, or set `CRAWLER_ENABLED=false` to force a pause at startup. Optional link discovery stays on configured source origins and caps the queue at 20 URLs.

The crawler obeys its parsed robots.txt rules, validates public HTTPS destinations, pins validated DNS addresses, rejects private/reserved addresses and credentials, checks redirected destinations, bounds HTML to 3 MB and captured excerpts to 12,000 characters, and records source URLs, capture times and content fingerprints. It has a deliberately small HTML/text extractor; paywalls, authenticated sites, JS-only pages, PDFs, videos and comprehensive robots protocol support are outside this prototype. Unavailable/disallowed sources are recorded as failures rather than fabricated captures. Unchanged captures do not generate duplicate atoms or teacher calls.

Without a teacher, new source-grounded atoms remain pending. With a configured primary teacher, the teacher compares the proposed answer with the captured source and returns supported/uncertain/contradicted plus an exact supporting quote. “Supported” is downgraded to uncertain if the quote is missing or does not occur in the capture. You may enable automatic training on supported candidates; it is off by default. Unresolved contradictions block automatic training. Inspection can also be requested with any other configured teacher; all opinions are retained. There is no silent multi-provider voting loop.

These checks reduce errors; they do not eliminate hallucinations, establish source truth or justify global/verified status. A single source and a model agreeing are not independent verification. Source changes preserve prior meaning and raise a contradiction for review. Global canonical identity governance remains future work.

### Bring your own teachers and models

**AI teachers** supports Groq (default), OpenAI, Anthropic/Claude, DeepSeek, Google/Gemini, xAI/Grok, Mistral and OpenRouter, plus arbitrary public HTTPS OpenAI-compatible endpoints. Groq and Grok are different providers. A finite catalogue cannot honestly promise every known model; the extension path supports models sharing the implemented API protocols. New proprietary protocols require an adapter. Enter an exact model ID available to your own account; only Groq has a prefilled default.

Select any configured provider as primary. Provider failures do not silently send data to a different provider. Entered keys stay only in this server process's memory until restart, never in state.json, model.json, exports, DNA, peers or Git. For persistence use the corresponding `*_API_KEY` and `*_MODEL` environment variables in `.env.example` or Render's environment settings. This is a single-owner installation: the node admin can use configured teachers; there is no multi-user key isolation.

Teacher calls send the explicit topic, captured excerpt/answer under inspection, or the domain definition and requested capability for a capability-drafting request. Provider keys are sent only to that provider's endpoint using HTTPS. Custom endpoints must be providers you trust. The UI has an explicit default limit of 30 teacher calls per UTC day (including failed attempts), configurable from 0–500. This is a per-process/node request cap, not a currency spending limit or a replacement for provider billing controls. Groq's free tier has quotas; free usage is not guaranteed.

The local startup, Render instructions and foundational model details below still apply. No API key was provisioned for this project.

## Start on Windows

Install Node.js 22 or newer. Double-click **START-KENUXA.cmd**, then open **http://127.0.0.1:3210**. Or run `npm start` in this folder. There are no third-party package dependencies or model downloads.

Local startup binds to 127.0.0.1. Without an ADMIN_TOKEN, only local browser access with a localhost/127.0.0.1 host is allowed. Public deployments refuse to start without a long ADMIN_TOKEN. Close the server window or press Ctrl+C to stop.

Try “What is the capital of Ghana?”, “Explain solar energy”, “What is a meaning object?” and “How do you learn?” Unknown topics should produce an explicit “I do not have a reliable learned answer yet.”

## What the own model actually is

`lib/model.mjs` implements KENUXA Answer Model v1: a sparse bag-of-words multiclass softmax model, trained with supervised gradient descent. It learns numerical weights from approved example questions and selects their corresponding factual answers. The saved checkpoint is `data/model.json`; the curriculum and node state are in `data/state.json`. Both survive a normal local restart. Training is deterministic and rebuilt from approved knowledge on startup and after learning.

This is a small **answer-selection model**, not a pretrained LLM or an original transformer foundation model. It cannot freely write essays, reason generally, browse the web or answer arbitrary unseen questions. Confidence is an uncalibrated model score, not proof of accuracy. Word features provide limited paraphrase support. The first major next step would be an independently evaluated encoder/generative student and a real held-out training corpus.

## Included foundations

| Layer | Working behavior |
| --- | --- |
| Own model | Local training, weights, answer scoring and unknown-topic abstention |
| M-Atoms | Stable IDs, question/answer examples, tags, provenance, visibility, approval state |
| Meaning addressing | `meaning://solar` resolves stored topics through the UI/API |
| Meaning graph | Relationships derived from shared tags, rendered as a graph and accessible cards |
| Teacher | Optional primary teacher for curriculum, inspection and first-time research-method teaching |
| Evolution | Draft → review → approval → local model retraining; rejected drafts are retained |
| Capabilities | Listed implemented operations, no arbitrary code execution |
| Outcomes/memory | Local answer history, user feedback, learning and sync events |
| Goals | Local goal records (no autonomous execution) |
| Federation | Signed peer snapshots, explicit public sharing, review of imported lessons |
| Portability | JSON backup export; import up to 100 lesson records at a time into review |

## Groq as teacher

Copy `.env.example` to `.env`. Set `GROQ_API_KEY` there and restart. Never commit `.env`. The default `GROQ_MODEL` is `openai/gpt-oss-20b`, hosted through Groq. This uses Groq credentials, not OpenAI API credentials; the teacher model is external and is not KENUXA's student model. Choose another model available in your Groq account if needed.

In **Learning studio**, request a topic. Only the topic and a fixed teacher instruction are sent to Groq. Each request proposes at most five lessons and is a billable/rate-limited Groq call. Conversations, existing private lessons, admin tokens and network secrets are not sent. The teacher endpoint is fixed to `https://api.groq.com/openai/v1/chat/completions`.

Review each draft's factual accuracy, then click **Approve & train**. Approval is human review, not independent source verification; teacher-generated lessons retain their unverified-draft provenance. Once approved, ask its questions with the teacher disconnected: KENUXA answers with its own trained weights. This is teacher-generated supervised data, not full logit-level model distillation. The configured crawler can make background inspection calls under the explicit daily call cap; automatic answer-model learning remains opt-in.

## Deploy anywhere

Every hosted node needs a unique `NODE_ID`, its own `ADMIN_TOKEN` (32 or more characters), the same `NETWORK_SECRET` as its trusted peers (32 or more characters, different from every admin token) and, ideally, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` so nothing is lost when the host restarts. Set `PEER_URLS` to at least one other node; the rest are discovered. Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

| Host | How | Notes |
| --- | --- | --- |
| **Render** | New Blueprint → this repo (`render.yaml`) | The free plan works when Supabase is configured. Free services sleep, so evolution pauses while asleep |
| **Railway** | New project → deploy from GitHub (`railway.json`) | Set `HOST=0.0.0.0`. The public domain is detected automatically |
| **Vercel** | Import the repo (`vercel.json`, `api/index.mjs`) | Serverless. **Supabase is required** for durable state. Set `CRON_SECRET`. Hobby crons run once a day; Pro can run every 10 minutes. Background transformer training is off; inference and drafts work from the stored checkpoint |
| **Netlify** | Import the repo (`netlify.toml`, `netlify/functions/`) | Serverless. **Supabase is required**. `kenuxa-evolve` is a scheduled function that runs every 10 minutes |
| **Fly, Cloud Run, Koyeb, any Docker host** | `Dockerfile` | Long-running, like Render |
| **Your PC** | `START-KENUXA.cmd` or `npm start` | Local files by default. Add the Supabase variables to `.env` to share the cloud graph |

A good topology: your PC plus one long-running host (Render or Railway) do the training and crawling, serverless nodes (Vercel and Netlify) serve and federate, and all of them share the same Supabase project or peer with each other.

Federation does not pool compute across hosts or train one distributed model. Nodes exchange approved knowledge, evidence and molecule definitions. Each node trains its own models.

## Trust and privacy boundaries

- Every API operation requires the node admin token on public hosts, including chat and exports. Tokens stay only in browser tab memory. This is a single-owner prototype, not a multi-user service.
- Peers authenticate using HMAC-SHA256 over method, path, timestamp, nonce and body. Requests expire after 60 seconds, used nonces are rejected, redirects are disallowed, and responses are signed. Use HTTPS in production. Nonce state is process-local and resets on restart; bounded timestamp replay remains possible across restarts or replicas. One process per node is the supported topology.
- Shared-secret members can impersonate a network member. Signatures prove possession of the shared secret, not factual truth or cryptographic per-node identity. Revoke a compromised peer by rotating NETWORK_SECRET on retained nodes and removing its URL. Per-node public-key identities remain future work.
- Only approved public originals are exposed to authenticated peers. The payload includes question/answer content and public provenance, not full private DNA, learned programs, context layers, memory, goals or credentials. Imported atoms develop new local DNA. Parent structures and capabilities are currently local. Changing an exported lesson later does not recall existing copies; update/revocation propagation is not implemented.
- Network inputs have limits and enter review. Local server state and API response sizes are bounded for a small prototype: 500 lesson records, 100 memory entries, 300 events, 100 goals. Graph links come from shared tags, explicit formations and, once the transformer is trained enough, embedding similarity (labelled `similar-meaning`, with scores).
- The UI renders untrusted text using textContent. There is no shell/tool execution, public signup or automatic external publishing. This is not an audited production security product.

## Backups and recovery

Use **Learning studio → Export backup** regularly. This file contains private knowledge and conversation history; store it securely. With the server stopped, you can additionally copy the entire data directory to preserve exact local state. To restore the same node, put state.json back into its DATA_DIR before startup; the model is retrained. Backups must come from a trusted source.

UI import restores lesson content into the review queue with new IDs; it does not restore original identities, visibility, goals, conversations or outcomes. For more than 100 lessons, split the import or restore the trusted full state file while stopped. Model weights are local artifacts; federation shares approved examples rather than weights.

## Verification

Run `npm test` (28 tests). v0.5 adds meaning-frame extraction, comprehension (intent, goal, constraints, references, value linking) and grounded construction tests. v0.4 adds numerical gradient checks for the transformer, KV-cache equivalence, identity-preserving layer stacking, checkpoint round-trips, Supabase mirroring against the v1.1 CHECK constraints (using a mock), a serverless Netlify/Vercel-style node with a 7-part answer and cron tick, and three real node processes that discover one another through hello and gossip. Earlier tests train the actual model, verify an unseen paraphrase and unknown-topic abstention, exercise provider adapters with mocks (no spending), reject unsafe peers, invalid signatures and replays, verify source-quote checks, robots exclusions, DNA growth and parent propagation, inherited learned capabilities and absence of provider secrets in state/export. An integration test launches two real HTTP node processes, teaches A a public lesson, reviews/trains B, checks B answers independently, verifies private DNA stays off the wire, and restarts B to check persistence.

Live Groq access requires your own configured key. Live cross-account Render deployments are not established by local tests. See `VERIFICATION.md` for the checks actually completed during delivery.

## Provider documentation

- Groq text generation: https://console.groq.com/docs/text-chat
- Groq current models: https://console.groq.com/docs/models
- Render Blueprint specification: https://render.com/docs/blueprint-spec
- Render free-service storage and sleep limits: https://render.com/docs/free
- Vercel cron jobs: https://vercel.com/docs/cron-jobs
- Netlify scheduled functions: https://docs.netlify.com/functions/scheduled-functions/
- Supabase API keys: https://supabase.com/docs/guides/api/api-keys
- OpenAI Responses/text: https://developers.openai.com/api/docs/guides/text
- Anthropic Messages: https://platform.claude.com/docs/en/api/messages/create
- DeepSeek chat: https://api-docs.deepseek.com/api/create-chat-completion/
- Google GenerateContent: https://ai.google.dev/api/generate-content
- xAI API: https://docs.x.ai/developers/rest-api-reference/inference/chat-completions
- Mistral: https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request
- OpenRouter: https://openrouter.ai/docs/api/reference/overview

The foundation is built around Meaning → Capability → Outcome → Evolution. General reasoning, arbitrary autonomous actions, independently validated truth, distributed parameter training and trained attention routing are future work, not hidden features of this prototype.
