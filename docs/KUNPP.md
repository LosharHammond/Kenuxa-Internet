# KUNPP: KENUXA Universal Node Participation Protocol (v2)

Every number in this document was measured in this repository's sandbox. Rows marked *extrapolated* are calculated from those measurements and are not observed traffic.

## 1. The architecture before this change

| Area | What existed | Where |
|---|---|---|
| Nodes | Independently hosted backends (Render, Railway, VPS, a PC). Each has an Ed25519 identity, and they talk over signed **ATP/1.0** (`/atp/*`). | `lib/mesh.mjs`, `lib/node.mjs` |
| Discovery | Seeds, gossip, hello, an optional Supabase directory, and peer reputation. | `lib/mesh.mjs` |
| Atomic knowledge | A content-addressed registry: manifests point to the head revision, and each revision is `sha256(canonical MessagePack)`. Durability comes from RS erasure coding across *server* nodes, with quorum metadata. | `lib/atoms/registry.mjs`, `codec.mjs`, `preservation.mjs` |
| Background work | The evolution tick runs the incremental atom audit (2,000 atoms per tick), lexicon guidance, learning cycles, preservation repair and consensus retries. It all runs **on the core**. | `lib/evolution.mjs`, `lib/node.mjs` |
| Users | Browsers only consume: chat, the owner studio, accounts. **A visitor's device contributed nothing.** | `public/*` |
| Live learning | A ledger, claims, methods, and peer agreement for public updates between server nodes. | `lib/live/*` |

**The limitation.** Total capacity came only from hosted servers. With one free Render instance, every visitor adds load and no capacity.

## 2. What KUNPP/2 adds (implemented)

```
   Type B: visitors' browsers (opt-in)                Type C/D: installed agents (opt-in)
 ┌─────────────┬─────────────┐                    ┌───────────────────────────────────────┐
 │ Web Worker  │ Web Worker  │◄── WebRTC ──►      │ node agent/kenuxa-agent.mjs --consent  │
 │ tasks + PoW │ tasks + PoW │  DataChannel       │ same task code · disk store · probes   │
 └──────┬──────┴──────┬──────┘  (public atoms,    └───────────────┬───────────────────────┘
        │             │          hash-verified)                   │
        └─── HTTPS /peer/* (gzip, token per peer, paced) ─────────┘
                      │                           │  failover: any coordinator in the list
        ┌─────────────▼─────────────┐   ┌─────────▼─────────────────┐
        │ Core node A (coordinator)  │◄─►│ Core node B (coordinator)  │ ← every hosted core runs KUNPP
        │ leases · verification ·    │ATP│ advertised as              │
        │ per-kind cost gate ·       │   │ 'kunpp-coordinator'        │
        │ storage plan · restore     │   │                            │
        └────────────────────────────┘   └────────────────────────────┘
```

| Gap from v1 | v2 status | Where |
|---|---|---|
| WebRTC peer-to-peer | **Implemented** for public-atom DNA on replica leases; signalling relayed by the coordinator inside the pair only; HTTPS fallback counted. Measured in a real browser (§6.3). | `public/peer.js`, `network.mjs issue/signal/poll/fullPayload` |
| Type C installed agent | **Implemented**: `agent/kenuxa-agent.mjs` (Node ≥ 20, no dependencies), `dedicated` profile, durable public-replica storage on disk. | `agent/` |
| Type D specialised nodes | **Implemented**: a claimed capability is used only after the peer passes a **probe with a known answer**; one specialised kind (`isa-closure/1`). | `network.mjs probeFor`, `tasks.mjs isaClosure` |
| Storage on peers | **Implemented** as storage tiers: replicated public revisions on dedicated nodes, proven by fresh storage proofs, restorable after hash verification. Browsers are cache only. | `network.mjs planStorage/verifyStorage/requestRestore` |
| More task types | **Implemented**: A–E plus specialised and storage kinds (§3.3). | `lib/peers/tasks.mjs` |
| Sybil resistance beyond rate limits | **Implemented**: hashcash proof-of-work over a signed, single-use challenge with adaptive difficulty; per-account device cap; replicas from different networks. Limits in §8. | `network.mjs challenge/checkPow` |
| Single-bootstrap outage | **Implemented** for peers: multiple coordinators, discovery from the mesh, automatic failover in browsers and agents. Limits in §7. | `lib/node.mjs coordinatorUrls`, `peer.js`, agent |
| Cheap kinds wasting core CPU | **New in v2**: the "is delegation worth it" gate is measured **per task kind**; kinds the core runs more cheaply stay on the core. | `network.mjs worthKind` |

**Trust boundaries (unchanged, enforced in code):**

- **Peers receive only public atom DNA.** Atoms with `manifest.scope = 'private'`, conversations, accounts, private claims and tokens are never sent. P2P exchange carries the same public DNA, and every receiver re-hashes it.
- **Peers run only the fixed task vocabulary** (`/peer-tasks.mjs`, the same module the core uses). No `eval`, no imports, no network access from the task code; a time budget.
- **Peers never write knowledge.** Results feed audit findings after verification. A restore writes a revision only if the core already has a manifest naming that exact hash.

## 3. Protocol: KUNPP/2

### 3.1 Routes

| Step | Request | Rules |
|---|---|---|
| Describe | `GET /peer/protocol` | Version `kunpp/2`, consent version, task vocabulary `kunpp-tasks/2` with each kind's needs and verification, profiles, data policy, P2P settings (ICE servers), coordinator list. |
| Puzzle | `GET /peer/challenge` | `{challenge: exp.rand.bits.mac, bits}`. HMAC-signed, expires, single-use. |
| Consent + register | `POST /peer/register {consent, consentVersion, capabilities, profile, pow: {challenge, nonce}}` | Refused without explicit consent; **428** without a valid proof-of-work. Rate-limited per network (salted /24 or /48 hash, never an identity). Max 10 devices per signed-in account (salted user hash). Returns `peerId`, `token` (only its SHA-256 stored), limits, `heartbeatMs`. |
| Capabilities | `POST /peer/capabilities` | Update claims (cores, storage MB, specialised). A new specialised claim triggers a probe. |
| Lease | `POST /peer/lease` | Gzipped. Backpressure: concurrency, profile interval, hourly cap, "core busy answering people", per-kind cost gate, adaptive idle retry `max(15 s, active × 50 ms)`. |
| Full payload | `POST /peer/payload {leaseId}` | HTTPS fallback when a P2P transfer fails. Counted as a fallback and cancels the counted saving. Gzipped. |
| Signal / poll | `POST /peer/signal {pairId, data}` · `POST /peer/poll` | WebRTC offer/answer/ICE, relayed only between the two members of a pair; mailbox TTL 60 s. Poll also delivers `pair` notices to the source peer. |
| Submit | `POST /peer/result` | Shape-checked, idempotent per lease, late or foreign leases refused. |
| Cancel / heartbeat / leave | `/peer/cancel`, `/peer/heartbeat`, `/peer/leave` | Give a lease back; idle keep-alive (`max(30 s, active × 20 ms)`); release everything. |
| Owner | `GET /api/compute`, `POST /api/compute/revoke`, `POST /api/compute/run` | Dashboard, revocation, forcing a core run. |

`/peer/*` has its own per-network limiter (`COMPUTE_REQUESTS_PER_NET_MINUTE`), so volunteers behind one NAT never block people. Coordinators answer CORS only for origins in their own coordinator list, and the page CSP `connect-src` lists the same coordinators.

### 3.2 Peer types

| Type | What it is | Profile | Can do |
|---|---|---|---|
| A · core | A hosted KENUXA node | — | Coordinates, verifies, stores canonical knowledge |
| B · browser | A visitor's tab, opt-in | Light / Balanced / Custom | Compute kinds A–E; P2P cache serving; never durable storage |
| C · dedicated | `kenuxa-agent.mjs` | `dedicated` (300-atom batches, concurrency 2, 120 s leases) | Compute kinds plus **replicated public storage** |
| D · specialised | An agent with `--specialized symbolic-reasoning` | `dedicated` | Additionally `isa-closure/1`, **only after passing its probe** |

### 3.3 Task vocabulary `kunpp-tasks/2`

| Kind | Needs | Checks | Verification |
|---|---|---|---|
| `atom-validate/1` (A) | — | Content hash vs manifest head, schema, identity, relation vocabulary and endpoint types, broken refs, IS_A+CONTRADICTS, duplicates, provenance | flags re-checked + replica / spot-check |
| `relation-check/1` (B) | — | Duplicate, self and asymmetric edges, invalid types, IS_A cycles in the shard | the **whole shard** is re-checked when issues are flagged (cycles depend on the shard) |
| `lexical-consistency/1` (C) | — | Lemma links, plural and past-tense morphology against the grammar rules | flags + replica |
| `claim-consistency/1` (D) | — | Deterministic checks over **public** claims and their evidence | flags + replica |
| `graph-metrics/1` (E) | — | Degree statistics, components, IS_A depth; returns a digest | replica (digests must match) |
| `isa-closure/1` | symbolic-reasoning | Transitive IS_A inference for a batch of queries | probe with known answers, then replica |
| `replicate/1` | storage | Store public revisions (content-addressed) | hash of each stored revision; unproven until a storage proof |
| `storage-proof/1` | storage | `sha256(nonce ‖ canonical bytes)` for random held revisions, fresh nonces | the core computes the expected proof |
| `restore/1` | storage | Return revisions the core lost | re-hash must equal the head named by a manifest |

**Scheduling.** Priority: restore 9 · storage-proof 6 · replicate 5 · other capability kinds 4 · compute 3. A storage peer's lease triggers storage planning (at most every 3 s), so storage work does not wait for the atom queue to empty. Storage work is never gated by the cost check, because the core cannot do it for itself.

**Per-kind cost gate.** For each kind the core keeps `{core µs, core atoms, overhead µs, delegated atoms}`. Overhead counts every lease and submit (payload building, serialisation, verification). A kind is delegated while `overhead per delegated atom < 0.9 × core cost per atom`. Before there is enough data (< 500 delegated or < 50 core atoms) it is delegated so it can be measured. Otherwise the **core runs that kind itself** in `coreTick` and finishes any half-replicated task of it. `GET /api/compute → offload.byKind` shows the live numbers.

### 3.4 Verification

1. **Reported issues are re-checked on the core**: flagged atoms, or the whole shard for `relation-check/1`.
2. **A clean result needs confirmation**: a replica from a peer on another network (always for new or low-reputation peers, otherwise `COMPUTE_REPLICATE`), or a core spot-check (`COMPUTE_SPOT_CHECK`).
3. **Disagreeing replicas go to arbitration** on the core.
4. **Storage** is checked by hash on replicate, by expected value on proofs, and by re-hash on restore. A tampered restore penalises the holder and writes nothing.
5. **Capabilities** are checked by probes. A failed probe leaves the capability unverified, and the peer never gets that kind.

Reputation decides how often a peer is replicated; it never establishes correctness. Revocation: ≥ 5 rejected and more rejected than accepted.

### 3.5 Proof-of-work and Sybil resistance

- `GET /peer/challenge` → `exp.rand.bits.mac` (HMAC with the node secret). The peer finds `nonce` so that `sha256(challenge:nonce)` has `bits` leading zero bits, in a Web Worker (browser) or in-process (agent).
- The challenge is single-use (replay refused) and expires.
- **Adaptive difficulty:** `bits` rises with the registration volume of the last hour (default base `COMPUTE_POW_BITS=14`).
- Measured solve time on this sandbox (Node, one core, 12 runs each): 10 bits 1 ms median; **14 bits 30 ms median / 69 ms p90**; 16 bits 58 / 182 ms; 18 bits 496 / 1,605 ms. Verifying costs ~0.1 ms.
- Layered with per-network registration limits, a per-account device cap, replicas only from *different* networks, mandatory replication of new peers, and revocation.

### 3.6 P2P (WebRTC DataChannel)

- When a replica of a task is leased, the scheduler pairs the second peer with the first one, which already holds the same public DNA. The lease then carries **references only** (`dnaVia: 'p2p'`, ids and heads) plus `{pairId, source}`. The source learns of the pair through `poll`.
- Offer, answer and ICE travel through `/peer/signal` and are delivered only to the other member of the pair. Outsiders cannot inject signals (tested).
- The receiver re-hashes every revision in its worker (`sha256(canonical)` must equal the head) before using it.
- On timeout (9 s), an error or a hash mismatch, it calls `/peer/payload`. That fallback is counted and **subtracts** the saving counted at lease time, so the metric never overstates P2P.
- STUN servers are configurable (`COMPUTE_STUN`). **No TURN server is provided**, so peers behind symmetric NATs fall back to HTTPS.
- Browser caches are capped by the user ("Cache limit (MB)"), can be cleared from the panel, and are never treated as durable.

### 3.7 Storage tiers

| Tier | Where | Durable? |
|---|---|---|
| canonical | the core's store (and RS preservation across core nodes) | yes, authoritative |
| replicatedPublic | dedicated agents' disks, target `COMPUTE_REPLICAS` (2) proven copies per revision | yes once proven; re-proven with fresh nonces |
| temporaryCache | browser memory / IndexedDB | no; only for P2P serving |
| proposed | peer results awaiting verification | no |
| private | the core only | never leaves the core |

**Recovery path:** `requestRestore(heads)` creates a priority-9 `restore/1` task for the proven holders. Each returned revision is re-hashed, and `onRestore` stores it only if a manifest already names that head and the revision is missing.

### 3.8 Multiple coordinators and failover

- Every hosted core already runs KUNPP and advertises `kunpp-coordinator`. `coordinatorUrls()` = `COMPUTE_COORDINATORS` plus the mesh's good peers (up to 8). It is published in `/peer/protocol`.
- **Browsers** keep that list and switch after repeated failures (`stats.failovers`). They then re-register, with a new PoW, on the next coordinator. Coordinator state is not shared.
- **Agents** take `--coordinator` (comma-separated), merge the discovered list, and fail over after 2 consecutive failures.
- For a browser to fail over across origins, the target coordinator must list the page's origin (CORS). Mesh peers know each other, so this holds by default in a mesh.

### 3.9 Installed agent

```bash
node agent/kenuxa-agent.mjs --coordinator https://your-node.onrender.com,https://backup.example --consent \
     [--storage-dir ./kenuxa-store --storage-mb 512] [--specialized symbolic-reasoning] [--duration 600]
```

- Without `--consent` it refuses to start.
- It stores only public revisions, as `<head>.json`, after checking each hash. It enforces `--storage-mb` and leaves cleanly on Ctrl-C.
- It runs the same `lib/peers/tasks.mjs` as browsers and the core.

## 4. User control (implemented, in the public chat sidebar → "Contribute computing")

- **Off by default; consent dialog.** The dialog states what runs and what never leaves the node, and links to the actual task code.
- **Profiles:**
  - Light: about one 40-atom batch every 10 s
  - Balanced: about one 120-atom batch every 2 s
  - Custom: maximum tasks per hour and maximum MB per hour
- **Pause, resume and stop.** Stop terminates the worker immediately.
- **Statistics:** tasks, atoms, accepted and rejected results, KB transferred, and worker milliseconds. v2 adds P2P atoms received and served, fallbacks, failovers and the cache size.
- **Automatic pauses:** while the tab is hidden, and on low battery when the browser reports it. Save-Data and mobile devices get small, slow tasks.
- **What browsers cannot do.** They do not let a page set an exact CPU share or read temperatures, so limits are enforced through task size, pace, caps and pauses. The dialog says so.

**Studio → Compute network** (owner) shows peers, tasks, verification counts, measured per-atom core cost against delegation overhead, KB sent and received, confirmed findings, and a revoke button.

- **Cache limit and clear.** "Cache limit (MB)" caps the browser's P2P cache (memory + IndexedDB); "Clear cache" deletes it. The dialog explains the one-off puzzle (PoW) and that peer-to-peer serving sends public atoms only.

## 5. Tests

| Suite | What it proves |
|---|---|
| `tests/compute.test.mjs` (9) | KUNPP/2 registration with PoW, consent, privacy filter, verification and arbitration, revocation, leases and expiry, core fallback, the full-shard re-check regression, real HTTP peers |
| `tests/compute2.test.mjs` (6) | Kinds B–E and the specialised kind find seeded problems deterministically. PoW is bound to a signed challenge, cannot be replayed, and adapts. Type D gets specialised work only after its probe (a liar never does). Type C replicates, proves storage with fresh nonces, and restores a deleted core revision byte-identically, while a cheating holder is caught. P2P leases carry references only, outsiders cannot inject signals, and a fallback cancels the counted saving. The **installed agent against two real servers** passes PoW and the probe, stores revisions on disk, passes storage proofs, then **fails over when its coordinator is SIGKILLed** and keeps working. |
| `tests/browser/p2p-failover.e2e.cjs` (manual, Chromium) | Two real browsers opt in through the chat UI and exchange atoms over WebRTC. The first coordinator is killed, and a browser fails over to the second. |

Whole repository: `npm test` → **137 / 137 pass**.

## 6. Measurements

### 6.1 Core CPU, in-process (`node bench/compute.bench.mjs`; 3,697 atoms; only the core's own work is counted)

v2 benchmark: the default task mix (A–E) with the per-kind cost gate.

| Scenario | Core CPU | vs A | Notes |
|---|---|---|---|
| A: the core does everything (all kinds) | 1,012 ms | — | |
| B: 8 honest peers, default policy | 319 ms | **−68%** | 88 tasks leased (47 atom-validate). 41 tasks of cheap kinds were run by the core because the gate measured them cheaper there. |
| B2: steady state (5% spot-checks, no replicas) | 180 ms | **−82%** | |
| C: 8 peers, 20% drop their task, 1 malicious | 326 ms | **−68%** | 5 rejections, 5 arbitrations, 26 expired leases; the malicious peer was revoked |
| D: the v1 workload only (atom-validate) | 92 ms | **−91%** | comparable with v1's −88% |

**What the per-kind numbers showed.** This finding is the reason v2 adds the per-kind gate. Per 120-atom task, measured on the core:

| Kind | Lease + submit overhead | Core runs it itself | Worth delegating? |
|---|---|---|---|
| atom-validate | 2.1 ms | 30 ms (hashing) | **yes** |
| relation-check | 2.6 ms | 1.0 ms | no |
| lexical-consistency | 1.3 ms | 0.7 ms | no |
| graph-metrics | 1.5 ms | 1.6 ms | break-even |

Before the per-kind gate, the cheap kinds pulled the global average above the core's cost. The global gate then switched off delegation for everything, and core CPU went **up** 13–16× in B, B2 and C. With the gate per kind, the core keeps the cheap kinds and delegates the expensive one. Kinds B–E exist and are verified, but **at today's registry size they mostly do not save CPU**. They become worthwhile as shards and graphs grow, and the gate will start delegating them automatically when the measurement says so.

**Bandwidth:**

- Leases are gzipped. In-process, the v2 mix produced 9.45 MB of lease JSON and 0.81 MB gzipped (**11.7×**).
- In the real browser run (§6.3), 1.98 MB became 234 KB on the wire (**8.5×**).
- v1 sent about 99 KB per 120-atom task uncompressed; v2 sends about 9–10 KB.

### 6.2 Per request over real HTTP (v1 measurement, `server.mjs` on this sandbox; process CPU from `/proc`)

| Request | Core CPU | Wall time |
|---|---|---|
| register | 0.9 ms (+ ~0.1 ms PoW verify in v2) | 2.0 ms |
| heartbeat | 0.6 ms | 1.4 ms |
| idle lease poll | 0.7 ms | 1.5 ms |
| lease with a 120-atom task | 1.0 ms | 1.8 ms |
| submit and verify | 8.3 ms | 10.9 ms |

Resident memory was 137 MB with 300 registered peers. These routes are unchanged in cost except for gzip (applied to lease and payload responses).

### 6.3 Real browsers (Chromium via Playwright, through the chat UI, two coordinators)

| | Run 1 | Run 2 (final code) |
|---|---|---|
| P2P pairings | — | 6 |
| Atoms received directly from the other browser (hash-verified) | 844 | 244 |
| Coordinator bytes avoided (net of fallbacks) | 911 KB | 342 KB |
| HTTPS fallbacks | 0 | 1 (137 KB, counted and subtracted) |
| Lease bytes, raw → on wire (gzip) | 1.80 MB → 232 KB | 1.98 MB → 234 KB |
| Results accepted / rejected | all accepted / 0 | 10 / 0 |
| Failover after SIGKILL of coordinator A | browser switched to B; B: 2 peers, 7 accepted | the same (1 failover, 20 tasks total) |
| Page errors | 0 | 0 |

P2P only applies to **replica** leases, because only then does another peer already hold the DNA. How much it saves depends on the replication rate and the pairing timing, so the two runs differ. Both runs are on loopback without NAT. Over real networks without TURN, some pairs will fall back to HTTPS, and the counters will show how many.

## 7. Scaling and outage analysis

### 7.1 Scaling (*extrapolated* from §6)

The same assumptions as v1, plus several coordinators:

- each idle request costs ≈ 0.65 ms of core CPU
- a delegated atom-validate task costs ≈ 9.3 ms of core CPU and ≈ 10 KB with gzip
- a free Render instance has ≈ 0.1 vCPU

| Connected / opted-in peers | 1 coordinator | 3 coordinators (peers spread by failover / configuration) |
|---|---|---|
| 10 / 3 | negligible | negligible |
| 100 / 30 | ~2 ms/s of idle traffic | ~0.7 ms/s each |
| 1,000 / 300 | ~20 ms/s (20% of 0.1 vCPU) | ~7 ms/s each |
| 10,000 / 3,000 | ≈ 45 ms/s (adaptive polling caps the rate at ≈ 70 req/s) | ≈ 15 ms/s each |
| 100,000 / 30,000 | coordinator- and bandwidth-bound; `COMPUTE_MAX_PEERS` caps it | still bound by per-coordinator caps; needs more coordinators, not more peers |

- **Where peers help:** hash-heavy validation (−68% to −91% core CPU), redundancy of public knowledge (proven replicas off the core), and bandwidth for replica payloads (P2P).
- **Where peers cannot help:** coordination itself, authentication, canonical commits, private questions, and the kinds the gate measures as cheaper on the core.

### 7.2 Failure and outage analysis

| Situation | What happens (implemented) |
|---|---|
| No peer opts in | The core runs everything, exactly as before (tested). Storage and specialised tasks are dropped with a reason. |
| A peer disconnects mid-task | The lease expires and the task is reassigned; after 3 attempts the core runs it. |
| A malicious compute peer | Its results are refuted, arbitrated or spot-checked, and the peer is revoked. Nothing it returns touches knowledge. |
| A malicious storage peer | Fails its storage proofs (never verified as `storage`). A tampered restore is rejected by hash, and the holder is penalised. |
| A peer lying about a capability | Fails its probe and never receives that kind (tested). |
| Sybil registrations | Limited by PoW per registration (adaptive), per-network limits, the per-account device cap, cross-network replicas, mandatory replication of new peers, and revocation. |
| **The coordinator a peer uses goes down** | Browsers and agents fail over to the next coordinator in their list and re-register there (**tested with SIGKILL, browser and agent**). |
| **The only Render node goes down, with no other coordinator** | v2 does not change this. Peers idle; new users cannot be served. With ≥ 2 hosted core nodes in `COMPUTE_COORDINATORS` or the mesh, peers keep working on the survivors. |
| The core loses a revision | `requestRestore` recovers it from a proven replica holder, byte-identical after hash verification (tested). |
| A P2P transfer fails | The HTTPS fallback is used and counted. |

## 8. Limits that remain (honest list)

- **A botnet spread over many networks** can still register many peers: PoW makes this cost ≈ 30 ms of CPU per identity at 14 bits, not impossible. Verification, not registration control, is what keeps results correct.
- **No TURN server** is provided or required. Symmetric-NAT pairs fall back to HTTPS.
- **Coordinator state is not shared.** After failover a peer re-registers, and its reputation and leases at the dead coordinator are lost. Replica *locations* are known only to the coordinator that planned them.
- **Browser storage is never durable.** Only dedicated agents hold replicated public revisions, and the canonical copy stays on core nodes.
- **Only one specialised capability** (`symbolic-reasoning` → `isa-closure/1`) exists.
- **Kinds B–E save little today.** The gate keeps them on the core until the registry grows.
- **New users still need a reachable hosted node** to load the app. Failover protects contributing peers, not first contact.

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `COMPUTE_PEERS` | on | `off` disables `/peer/*`. |
| `COMPUTE_COORDINATORS` | — | Comma-separated coordinator URLs (merged with mesh peers). They are trusted for CORS and CSP. |
| `COMPUTE_POW_BITS` | 14 | Base proof-of-work difficulty (0 disables it; it rises adaptively with volume). |
| `COMPUTE_P2P` | on | `off` disables WebRTC pairing. |
| `COMPUTE_STUN` | — | Comma-separated STUN URLs for WebRTC. No TURN. |
| `COMPUTE_REPLICAS` | 2 | Target proven copies per public revision on dedicated nodes. |
| `COMPUTE_DISTINCT_NETWORKS` | on | Replicas must come from different networks. Set `off` only for LAN or test setups. |
| `COMPUTE_REPLICATE` | 0.25 | Probability of a replica for an established peer. |
| `COMPUTE_SPOT_CHECK` | 0.1 | Probability of a full core recomputation. |
| `COMPUTE_MAX_PEERS` | 5000 | Cap on registered peers. |
| `COMPUTE_REG_PER_NET_HOUR` | 20 | Registrations per network per hour. |
| `COMPUTE_REQUESTS_PER_NET_MINUTE` | 600 | `/peer/*` requests per network per minute. |
| `COMPUTE_MAX_ACTIVE_REQUESTS` | 8 | Leases pause above this many in-flight interactive requests. |

**Monitoring:** Studio → Compute network, or `GET /api/compute`:

- `offload.byKind`
- `p2p`
- `storage.tiers`
- `peers.byType`
- `peers.verifiedCapabilities`
- `powBits`

## 10. Roadmap

1. **Done (v2):** multiple coordinators and failover; the installed agent (C) and specialised nodes (D); storage tiers with proofs and restore; kinds A–E; PoW; P2P for replica payloads; per-kind cost gate; gzip.
2. **Shared coordinator state:** gossip peer reputation and replica locations over ATP, so a failover keeps them.
3. **More specialised capabilities**, each with a probe that has a known answer before it is used.
4. **P2P for cache distribution beyond replicas**, only if the counters show a net saving.
5. **Account-bound contribution** (signed-in volunteers get a higher trust start) — needs a product decision.
