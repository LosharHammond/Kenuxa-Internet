# KENUXA v0.8–v1.0: universal atoms, Atomic DNA and decentralized preservation

This document is the v0.8 delivery report, updated for v0.9 (section K) and v1.0 (section L). Every number in it was measured on the build machine (Node 22, Linux) by `npm test` and `node bench/atoms.bench.mjs`. Run them again to reproduce the results; do not quote these figures as guarantees.

## A. Architecture audit (before v0.8)

| Area | What existed (file) | Gap |
|---|---|---|
| Node core | `lib/node.mjs` `createNode()` / `handle()`: one core behind every host adapter (`lib/adapters.mjs`, `api/`, `netlify/`) | none; kept as is |
| Atoms / DNA | `lib/organism.mjs`: knowledge atoms (concept facts) and organism DNA (molecules, cells, agents, experts) | no **word-level** atoms; no lexical, grammatical or epistemic DNA; no stable logical IDs or revisions per word |
| Understanding | `lib/comprehension.mjs` (intent, goal and constraint detection by keywords and patterns), `lib/meaning.mjs` (meaning frames) | no tokenization into atoms, no syntax, no tense, aspect or negation, no coreference beyond history rewriting |
| Response | `lib/response.mjs`, `lib/model.mjs` (construction into Markdown), `lib/transformer/` (9-layer, 81-head; embeddings, kernels and drafts), `lib/teacher.mjs` (Groq) | the answer was driven by intent and templates, not by an interpreted structure of the question |
| Storage | `lib/store.mjs`: local JSON plus blobs, optional Supabase mirror | knowledge lived only on its own node; there was no content addressing, redundancy or recovery |
| Network | `lib/mesh.mjs` MTP/0.5-open (renamed ATP/1.0, the Atom Transfer Protocol, in v1.2): Ed25519 identities, signed calls, gossip, reputation, consensus, network query | lessons were gossiped, but atoms were neither stored across peers nor recoverable after their creator died |
| Tests | 33 tests in `tests/` | none covered language structure, durability or fault injection |

## B. Source code added or changed

- `lib/atoms/schema.mjs`: the DNA schema, the atom types, the validation and trust ranks, the durability states, and typed relations with endpoint rules.
- `lib/atoms/lexicon-en.mjs`: the curated English core, closed classes complete (pronouns, auxiliaries, modals, determiners, prepositions, conjunctions, wh-words, negators, contractions), irregular verbs, and an open-class seed with senses and disambiguation signals.
- `lib/atoms/registry.mjs`: `AtomRegistry` with stable logical IDs, content-hashed immutable revisions, `discover`, `propose` (with quarantine), `rollback`, `merge` (deterministic reconciliation), serialization, and 428 genesis atoms that are identical on every node.
- `lib/atoms/language.mjs`: the interpretation pipeline (see D).
- `lib/atoms/codec.mjs`: canonical MessagePack, DEFLATE and SHA-256 content addressing.
- `lib/atoms/erasure.mjs`: systematic Reed–Solomon over GF(256), default 4-of-6.
- `lib/atoms/preservation.mjs`: `PreservationEngine` (placement, quorum metadata, commits, retrieval, failure detection, repair) plus `LocalStore` and `InMemoryTransport`.
- `lib/atoms/mesh-transport.mjs`: preservation over the real signed mesh, using peers' hosts as failure domains.
- `lib/node.mjs` changes:
  - integrates the registry, the lexicon tick (network first, then teacher guidance) and the preservation tick
  - adds atom interpretation to the answer cascade
  - adds ATP store, meta and ping endpoints (`/atp/*`; `/mtp/*` accepted as a legacy alias)
  - adds the studio APIs `/api/interpret`, `/api/lexicon`, `/api/lexicon/atom`, `/api/atoms/fetch`, `/api/preserve` and `/api/preservation`
- `lib/evolution.mjs`: each cycle runs `atomsTick`.
- `lib/adapters.mjs`: a 3 MB body limit applies only to `/mtp/store/*`.
- New tests and benchmarks: `tests/atoms.test.mjs` (A–O), `tests/atoms-network.test.mjs` (G on real processes) and `bench/atoms.bench.mjs`.

## C. Atomic DNA schema (`kenuxa-atomic-dna/1`)

Every atom is a versioned record with six sections. Fields that do not apply are omitted, and sections reference other atoms by ID rather than copying their content.

```
identity    id (logical, stable), type, canonical, language, normalized, createdAt, originNode,
            schemaVersion, knowledgeVersion, validation, provenance[]
            (content fingerprint = sha256 of canonical msgpack = the revision id in the manifest)
linguistic  pos, subtype, lemma, morphology{person,number,case,tense,aspect,form,degree…},
            syntacticFunctions[], inflections{}, spellings[], posSource
semantic    senses[] (→ sense atoms), meaning, definition, category, referential,
            signals[] (disambiguation), meaningStatus ('unknown' for discovered words)
functional  agreement{}, constraints[] (→ rule atoms), frame{roles}, examples[], counterexamples[]
relational  [{type, target, confidence}] using IS_A, INSTANCE_OF, FORM_OF, PART_OF, SYNONYM_OF,
            ANTONYM_OF, REQUIRES, MODIFIES, REFERS_TO, PRECEDES, COMPOSES_WITH, DERIVED_FROM,
            RELATED_TO, SUPPORTED_BY, CONTRADICTS, SENSE_OF, USES_RULE (each with directedness and
            allowed endpoint types, enforced by validateRelation)
epistemic   evidence[{source, reliability, at}], verification, confidence, contradictions[],
            uncertainty[], lastValidated, limitations[]
```

**Atom types and logical IDs**

- symbol: `sym:<hex>`
- lexical: `lex:<lang>:<norm>`
- sense: `sense:<lang>:<lemma>#<id>`
- rule: `rule:en:<name>`
- phrase (materialized composite): `phr:<hash>`
- number: `num:<value>`, derived on demand and never stored

**Manifest** (separate from the DNA, so the DNA stays immutable):

```
{id, type, head, history[], createdBy, createdAt, durability, quarantined[], alternatives[]}
```

**Trust ranks:** curated 5 > verified 4 > corroborated 3 > provisional 2 > disputed 1 > quarantined 0.

**Durability states:** PROVISIONAL, VALIDATING, PENDING_DURABILITY, COMMITTED, DEGRADED, REPAIRING, QUARANTINED. Genesis atoms are `COMMITTED-GENESIS`, because every node rebuilds them deterministically.

**Reference atoms**

- `lex:en:i`: a personal pronoun (person 1, singular, nominative) whose function is subject. Its referential field is `deictic-context-dependent` and its meaning is "the speaker or writer in the current discourse". It is never bound to a person; the discourse binds it per turn to `current-speaker`.
- `lex:en:am`:
  - an auxiliary verb with lemma `be`, present tense, person 1, singular, finite
  - its functions are copula, progressive auxiliary and passive auxiliary
  - it has a `FORM_OF → lex:en:be` relation
  - its constraints point to the shared rule atoms: subject-verb agreement, copula complement, progressive aspect and passive voice

Grammar explanations live once in those rule atoms, and individual words only reference them.

## D. The semantic pipeline (working demo)

The pipeline runs these stages in order:

1. Input
2. Language detection
3. Unicode tokenization with `Intl.Segmenter`, which expands contractions and turns punctuation and numbers into symbol and number atoms
4. Atom resolution, which reuses existing atoms and sends unknown words to discovery
5. Morphology
6. Clause analysis (wh-words, auxiliary inversion, subject NP, auxiliary chain, negation, verb, objects, PPs, infinitives)
7. Semantic composition (tense, aspect, voice, polarity, mood, frame type, roles, agreement)
8. Discourse (speaker and addressee, anaphora with number and humanness agreement, re-disambiguation of the antecedent)
9. Inter-clause relations (because → cause)
10. Phrase materialization, only after 3 uses

The output of `interpret()` feeds the existing comprehension, construction and teacher stages.

Output from `lib/atoms/language.mjs` on this build:

| Input | Frame | Tense / aspect | Polarity / mood | Notes |
|---|---|---|---|---|
| I am learning. | event `learn` | present progressive | positive, declarative | agreement ok (1sg); rules: agreement and progressive |
| I am not learning. | event `learn` | present progressive | **negative**, declarative | |
| Am I learning? | event `learn` | present progressive | positive, **interrogative-yn** | |
| I was learning. | event `learn` | **past** progressive | positive, declarative | |
| I am happy. | **state** `happy` | present simple | | copular, attributive |
| I am a developer. | **classification** | present simple | | developer is ambiguous (software or property); reported, not guessed |
| I am learning because I need to improve. | 2 events | | | relation: clause 2 is the **cause** of clause 1 |
| I am building a network. → How can I protect it? | event `protect`, theme "a network" | modal-present | interrogative-wh | coref: it → a network, `sense:en:network#computing` |
| I deposited money in the bank. | event `deposit` | past | | location bank → `sense:en:bank#finance` (0.8) |
| I sat beside the river bank. | event `sit` | past | | location bank → `sense:en:bank#river` (0.95) |
| The zibberfloop quorbled. | event | past (morphological guess) | | discovered `lex:en:zibberfloop` and `lex:en:quorbled`, `meaningStatus: unknown` |
| 我喜欢学习。 | | | | segmented as 我 / 喜欢 / 学习 / 。 into `lex:zh:*`; grammar is English-only (stated in output) |

No sentence is answered from a lookup table. The frames come from the general rules in `semantics()`, which apply to any sentence.

In a running node, `answerQuestion` interprets each question before anything else and attaches the result to `understanding.interpretation`. It rewrites pronouns using the coreference result, queues discovered words for the lexicon, and then answers in this order:

1. its own grounded knowledge
2. other nodes over the mesh
3. the web

The teacher composes and guides at every step: it proposes provisional senses for unknown words, but only after the network has been asked first.

## E. Distributed atom storage

**Commit unit.** Atoms are batched into segments of up to 200 records. Each segment is canonical MessagePack plus DEFLATE, and its key is `sha256` of those bytes, so identical segments are deduplicated within the network.

**Adaptive policy.** The policy lives in `DEFAULT_POLICY` and can be overridden per engine:

- A segment of at least 4 KB, with at least 6 usable members, is erasure-coded 4+2. It is COMMITTED once 5 fragments are acknowledged, which still tolerates the loss of one more.
- Otherwise it gets 3 replicas and is COMMITTED after 2 acknowledgements.
- With too few members, it stays PENDING_DURABILITY and `reason` explains why. It is never reported as committed.

**Placement.** Rendezvous hashing (HRW) chooses where fragments go and prefers distinct failure domains. On the mesh, a failure domain is the peer's host, so fragments spread across Render, Railway, Vercel, Netlify, Fly and home servers.

**Registry (no single point of failure).** There is no central registry. Segment manifests (`seg:<hash>`) and the atom index (256 buckets `idx:xx`, holding compact grow-only maps from atom to segment and revision prefix) are replicated to 3 home nodes chosen by HRW.

- Writes need W=2 and reads need R=2.
- Index buckets merge on read; manifests use the highest version.
- Home replicas are repaired on read.
- Every record is signed by its writer's Ed25519 key and verified on read.

This model has strong-ish consistency for manifests (quorum, versioned) and eventual consistency for index buckets (a CRDT-style union). Ordinary lookups need no consensus.

**Integrity.**

- Every chunk is stored under `seg:i:sha256(chunk)` and checked on put and get.
- `getAtom` checks the segment hash, then the atom's content hash, then the revision prefix.
- Peers accept store and meta writes only from known peers with reputation of at least 0.2, and keys must match strict patterns.

## F. Node failure and recovery

- **Failure detection.** A node is *suspect* after 15 s without contact and *dead* after 60 s, so temporary outages do not trigger repair storms.
- **Repair.** `repair()` lists the segments, computes the margin of each (surviving fragments minus k), and repairs the most endangered first.
  - At most 2 repairs run concurrently.
  - Each repair takes an idempotent lock, reconstructs from any k fragments, verifies checksums, places missing fragments on new independent members, and writes a version+1 manifest.
  - It logs an audit record and then repairs metadata replicas.
- **Metadata recovery.** `metaRepair` re-replicates manifests and index buckets whose home replicas died.
- **Evidence:**
  - Test G (in-memory) and the real-process test in `tests/atoms-network.test.mjs` run six `server.mjs` processes. Node alpha interprets new words and commits them; alpha is killed with **SIGKILL**; nodes delta and zeta, which never saw the words, fetch them from the network with the original DNA and `meaningStatus: unknown`.
  - Test H drops 2 of 6 fragments, reconstructs with a verified checksum, and restores all 6.
  - The benchmark killed 2 of 8 nodes and restored **100 of 100** degraded segments in 157 ms.

## G. Storage efficiency (measured, v0.9)

**Test I** (one run, 8 nodes, the 585 genesis atoms):

| | Bytes |
|---|---|
| Logical JSON | 477,513 |
| MessagePack | 398,885 |
| Packed (msgpack + deflate) | 50,690 |
| Physical stored payload (4+2 coding, ×1.50 of packed) | 76,038 |
| Metadata (manifests and compressed index, 3 replicas) | 180,669 |
| Full replication to 8 nodes (JSON) | 3,820,104 |
| **Saving vs full replication** | **93.3 %** |

**Benchmark** (`node bench/atoms.bench.mjs`, one run, in-memory transport, 8 nodes):

| Metric | v0.8 | v0.9 |
|---|---|---|
| Genesis seed | 62 ms (428 atoms) | 104 ms (585 atoms) |
| Atom lookup | 0.025 µs (0.33 µs at 20k) | 0.048 µs (0.31 µs at 20k) |
| Atom creation (discover) | 31.9 µs | 32.5 µs |
| Interpretation | 0.091 ms per sentence | 0.109 ms per sentence (now with idiom and ellipsis passes) |
| Cache-hit ratio after warm-up | 1.0 | 1.0 |
| Relationship traversal | 0.18 µs | 0.20 µs |
| IS_A classification (reasoner) | — | 27 µs |
| Propagation (merge of 500 atoms) | 23.4 ms | 26.1 ms |
| Commit ≈20.5k atoms (103 segments) | 7.4 s | 7.1 s |
| Metadata reads per second | ≈2,850 | ≈7,180 |
| Remote atom retrieval | 4.9 ms | 0.7 ms |
| Logical / physical payload / **metadata** / full replication | 13.28 / 1.69 / **5.80** / 106.2 MB | 13.41 / 1.71 / **0.57** / 107.3 MB |
| Recovery (2 of 8 nodes dead) | 157 ms, 100/100 | 272 ms, 97/97 in 2 bounded runs; 0 degraded afterwards |

**The v0.8 caveat is fixed.** In v0.8, metadata at 20k atoms (5.8 MB) was larger than the coded payload. v0.9 stores index buckets compressed (msgpack + DEFLATE), which makes metadata **10× smaller** (0.57 MB) and reads faster. The whole network now stores about 2.3 MB where naive replication would store 107 MB. Recovery takes two runs because repair is deliberately limited to 64 segments per run, so a mass failure cannot start a recovery storm.

## H. Automated tests

`npm test` runs **71 tests, all passing** (v1.0 adds 8 in `tests/v1.test.mjs`, see section L). They are the 33 from before v0.8, 15 in `tests/atoms.test.mjs` (A–O), the real-process network test, 8 in `tests/atoms-advanced.test.mjs`, 4 in `tests/pipeline.test.mjs` and 2 in `tests/reasoning-node.test.mjs` (the last three files are v0.9; see section K). Each of A–O maps one to one to the scenarios in the master prompt:

| Test | What it checks |
|---|---|
| A | atomization, stable IDs, reuse and discovery |
| B | grammar and agreement |
| C | context and "it" |
| D | "I am happy" vs "I am learning" |
| E | the two senses of bank |
| F | 10,000 sentences create no duplicate canonical atoms |
| G | origin failure |
| H | fragment loss, reconstruction and repair |
| I | measured efficiency |
| J | a registry replica dies and quorum continues |
| K | concurrent discovery converges to one canonical atom |
| L | death before the threshold is reported as PENDING_DURABILITY or lost, never COMMITTED |
| M | a poisoned meaning for a curated atom is quarantined and the head is unchanged |
| N | partition: provisional writes, failed reads, convergence after healing |
| O | English and Chinese/Thai segmentation |

## I. Migration and deployment

- **No database migration.** The registry persists as the blob `atoms-registry.bin` through the existing store (local disk, or Supabase storage when it is configured). Two new state keys, `lexicon` and `preservation`, default to empty values, and existing knowledge, organism DNA and lessons are untouched.
- **Upgrade.** Deploy as usual (git push to the Render, Railway or Vercel repo). On first boot a node seeds the genesis atoms deterministically, so every node gets identical ones, and then grows.
- **Upgrading from v0.8 (genesis migration, automatic).** The registry records `genesisVersion`. A v0.8 registry (genesis 1) gains the v0.9 genesis-2 knowledge as **new revisions**:
  - 36 concept atoms
  - sense → concept IS_A links
  - 9 idioms, plus extra verbs and nouns

  Nothing is rewritten, and history keeps the old heads. Words the node had discovered with unknown meaning, and that genesis now knows (for example *animal*), are upgraded to their curated meaning. The discovery revision stays in history. Upgraded nodes and fresh nodes converge on identical heads, which a test checks.
- **Transformer release pipeline (automatic).** The existing `transformer.ckpt` becomes *version 0, the live model*. From then on, training produces a **candidate** (`transformer.candidate.ckpt`). The live model changes only on promotion, and each promoted version is kept as `transformer.vN.ckpt`; the last 3 are kept.
- **Settings:**
  - `STORE_QUOTA_MB` limits the fragments a node stores for others (default 256).
  - `KENUXA_NETWORK=on|off` controls whether a node joins the mesh; hosted nodes are on by default and PCs are private.
  - `KENUXA_DEDUP_DOMAIN` sets a private deduplication domain (tenant boundary). The default is `public`.
  - `STORE_PEER_MB_PER_HOUR` limits how much one peer may store on this node per hour (default 64).
  - `TRANSFORMER_PROMOTION=gated|manual|off` controls model releases (default `gated`). `gated` promotes a candidate automatically only when it passes evaluation; `manual` waits for approval; `off` never promotes.
  - `TRANSFORMER_MIN_STEPS_PER_RELEASE` sets the minimum training steps between releases (default 25), and `TRANSFORMER_EVAL_SECONDS` how often a running trainer is evaluated (default 600).
- **Behaviour by network size:**
  - A private node never sends data out, so its atoms stay PROVISIONAL.
  - A networked node with 2 to 5 usable members uses replicas (COMMITTED after 2 acknowledgements; 3 copies once 3 members exist).
  - Six or more members enable 4+2 erasure coding.
- **Ephemeral disks** (Render free, Vercel, Netlify): local fragments are lost on restart, so durability depends on peers. Mixing hosts helps, because failure domains are hosts.

## J. Limitations and future work (as of v0.9)

**Complete and tested**

- word, punctuation and number atomization (Unicode and multilingual segmentation)
- the six-section DNA with revisions, history, rollback and quarantine; genesis migration without rewriting history
- English clause semantics:
  - tense, aspect, negation, questions and modals
  - copular types and because-clauses
  - **verb-phrase ellipsis and additive inversion**
  - **idioms, with the literal reading kept as an alternative**
- coreference with sense re-disambiguation, and **server-side per-conversation discourse**
- WSD from context signals
- **conceptual taxonomy (level 8) and IS_A reasoning with chains, confidence, open-world semantics and derived atoms (level 9 → 10)**
- **structured response plans** attached to every answer
- preservation:
  - content-addressed segments, RS 4+2, quorum signed and **compressed** metadata
  - commit-before-publication, failure detection and repair
  - **backpressure, retry backoff, rebalancing, orphan GC, alerts, the REPAIRING state, tenant-scoped deduplication**
- survival after SIGKILL across real processes
- **gated, versioned and reversible transformer releases with dataset curation and privacy scrubbing**

**Partial**

- **Grammar rules are English only.** Other languages are atomized natively. Since v1.0, when a teacher is configured, the teacher provides a structured analysis and a faithful English rendering, clearly labelled as teacher-derived, which KENUXA then interprets with its own rules. Without a teacher, non-English input is atomized but not parsed.
- **Small curated lexicon.** It has 585 genesis atoms. Most content words start as discovered atoms with unknown meaning, until the network or the teacher supplies senses.
- **Rule-based parser.** Idioms come from a curated list, so new idioms are not detected; nominal ellipsis, gapping, garden-path sentences and long coordination are not handled.
- **Reasoning covers IS_A only.** It handles IS_A classification (yes / depends-on-sense / not-established / no) over curated concepts. It is not general logical inference, and it answers only questions phrased as "Is X a Y?".
- **Teacher path tested only with a stand-in.** Teacher senses enter as *provisional* and become *corroborated* only when independent nodes, or this node's own teacher, agree (v1.0). The whole path is tested with a stand-in provider, but **not against live Groq**, because this environment has no internet access.
- **Metadata conflicts use last-writer-wins.** Resolution is versioned LWW with a deterministic tie-break, not Raft or Paxos. Future-dated index pointers are ignored.
- **A trusted peer can still publish provisional junk.** It can publish a competing *provisional* revision of an atom. Receivers never raise trust because data came from the network, curated meanings are protected by quarantine, and since v1.0 a meaning is corroborated only by agreement from at least 2 independent sources. Persistent disagreement marks it *disputed*.
- **Single-machine benchmarks.** They run in memory on one machine, so real cross-host latency and Render cold starts will be slower.
- **Transformer evaluation is basic.** It uses held-out next-token loss and a frozen regression set. There are no task-level benchmarks, because the nano model is too small for those to mean anything.

**Not done / future**

- additional language grammars
- larger curated lexicons (for example WordNet, after licence review)
- per-user (rather than per-domain) keys and key rotation for private domains

**Separation from model training (PART 14).** Creating or updating an atom changes the knowledge network immediately and never changes model weights. Weights change only through `lib/transformer/pipeline.mjs`:

1. **Curate the dataset.** Remove duplicates and documents outside the length bounds, and run the privacy scrub, which excludes emails, phone or account numbers, API keys, tokens, private keys and credentials.
2. **Split.** A deterministic content-hash split sets aside held-out documents, which are never trained on.
3. **Train a candidate.** The candidate is never served.
4. **Evaluate.** The candidate is scored on the held-out set and on a frozen regression set.
5. **Gate.** A candidate is rejected if it is worse, diverged, or too few steps after the last release. Otherwise `gated` mode promotes it, `manual` mode waits for approval, and `off` holds it.
6. **Release.** A promoted candidate becomes a versioned checkpoint.
7. **Roll back** when needed.

Admin API: `POST /api/transformer/release` with `{action: 'review'}`, `{action: 'approve'}` or `{action: 'rollback', version}`.

The small nano model (about 1.9M parameters) still trains in a background thread on long-running hosts, but that only produces candidates. To stop it, set `TRANSFORMER_TRAINING=false`. Expensive training is never started automatically: there is no automatic profile upgrade and no GPU job.

## K. What v0.9 added (files)

| Requirement | Implementation | Test |
|---|---|---|
| Ellipsis (4.4) | `semantics()` and `analyzeClause()` in `lib/atoms/language.mjs`; `Discourse.lastFrame` | `atoms-advanced` · ellipsis |
| Idioms (4.4) | `IDIOMS` in `lexicon-en.mjs`; idiom phrase atoms in genesis 2; `findIdioms()`, `applyIdiom()` | `atoms-advanced` · idioms |
| Python → install it → Windows (6.1) | discourse plus WSD | `atoms-advanced` · 6.1 context |
| Conversation state, memory policy, device ≠ person (6.1) | `discourseFor()` in `lib/node.mjs`: in memory, 30 min TTL, keyed by hash(conversation id + address); `public/chat.js` sends the conversation id | `reasoning-node` · public chat |
| Structured response plan (6.2) | `responsePlan()` in `lib/node.mjs`, attached as `result.plan` (intent, entities, references, retrieval source, facts, reasoning, uncertainty, structure, validation) | `reasoning-node` |
| Levels 8–10 (concepts, reasoning, derived knowledge) | `CONCEPTS` taxonomy; `lib/atoms/reasoning.mjs` (`closure`, `classify`, `explain`, `verbalizeClassification`); derived `relationship` atoms | `atoms-advanced` · reasoning; `reasoning-node` |
| Tenant boundary for deduplication (9.1) | the `domain` is part of the segment content address | `atoms-advanced` · dedup |
| Compact metadata (9.2) | compressed index buckets (`wire` / `unwire`) | `atoms-advanced` · dedup; benchmark |
| Rebalancing (8.2) | `PreservationEngine.rebalance()` | `atoms-advanced` · rebalancing |
| Backpressure, retry policy, degraded alerts (11.1) | `maxPending`, exponential backoff in `retryPending`, `maxRepairsPerRun`, `alert()`, `report()` | `atoms-advanced` · backpressure; rebalancing |
| Safe storage reclamation | `gc()`: the holder decides from quorum metadata after a grace period; peers cannot delete each other's data; persistent chunk index (`LocalStore.load`) | `atoms-advanced` · rebalancing |
| REPAIRING state (8.3) | `durability()` | `atoms-advanced` · rebalancing |
| Per-peer rate limit, clock-abuse guard (15) | `/mtp/store/put` limit; future-dated index pointers ignored | (code review) |
| Training pipeline (14) | `lib/transformer/pipeline.mjs`, `TransformerService` (candidate, review, promote, approve, rollback) | `pipeline.test.mjs` |

## L. What v1.0 added (closing the gaps listed in v0.9)

| Gap left after v0.9 | v1.0 implementation | Test (`tests/v1.test.mjs`) |
|---|---|---|
| Knowledge only from the curated seed (level 10) | `learnClassification()` in `reasoning.mjs`. "A kente is a cloth." / "A whale is not a fish." become *provisional* IS_A / CONTRADICTS relations on shared concept atoms. Each relation records its sources: 25 % confidence for one source, rising only with *independent* sources (capped at 60 %). Repeats from the same source count once. Curated concepts are never changed; the claim is held for review instead. Contradictions are kept and the question becomes **disputed**. Statements about the speaker ("I am a developer") are not learned as general knowledge. At most 30 statements are stored per conversation. | level 10; running node |
| Reasoning did not disclose weak links | Every inference chain flags unverified links (source count and confidence), and the answer says so | level 10 |
| No multi-source validation | `AtomRegistry.endorse()`, `meaningSummary()` and `agree()`. A meaning becomes **CORROBORATED** only when at least 2 independent nodes agree on part of speech, lemma and the senses' broader categories. Persistent disagreement makes it **DISPUTED**. The proposer counts once. `lexiconTick` checks meanings against the network and against this node's own teacher; senses are fetched together with words. | corroboration |
| Teacher path untested | The full lexicon path is tested with a stand-in provider: discovery, then teacher senses (provisional), then verification of a network-learned word by this node's own teacher, ending CORROBORATED | teacher path |
| Non-English grammar | A teacher-assisted analysis (`ANALYSIS_INSTRUCTION`) returns a faithful English rendering plus clauses. It is labelled as teacher-derived in the plan and the trace, then interpreted and reasoned over by KENUXA's own rules. The original words are still atomized natively. | non-English |
| Private atoms not encrypted | Segments in a private domain are sealed with AES-256-GCM before coding. The nonce is derived from the content, so deduplication still works inside the domain. Index entries are keyed hashes of the atom id (`privateId`), so peers see neither content nor which atoms exist, and a wrong key finds nothing. Settings: `KENUXA_DEDUP_DOMAIN` + `KENUXA_DOMAIN_KEY` (32 bytes, hex or base64). | private domains |
| One fixed code | Stripe width adapts to network size: 8+4 from 12 nodes (survives 4 losses, same 1.5× overhead), 4+2 from 6 nodes. `critical` data gets one extra parity fragment (and one extra replica on small networks). An explicit `k`/`m` stays fixed. | adaptive stripes |
| Per-peer limit untested | `ByteWindow` (`lib/atoms/limits.mjs`), used by `/mtp/store/put` | per-peer budget |

**Benchmark after v1.0** (one run, same machine):

| Metric | Value |
|---|---|
| Lookup | 0.027 µs |
| Creation | 32.4 µs |
| Interpretation | 0.157 ms per sentence |
| Classification | 26.5 µs |
| Commit of ≈20.6k atoms | 6.5 s |
| Metadata | 0.57 MB, against 107 MB for full replication |
| Retrieval | 0.38 ms |
| Recovery (2 of 8 nodes dead) | 150 ms, 95/95 segments restored, 0 degraded |
