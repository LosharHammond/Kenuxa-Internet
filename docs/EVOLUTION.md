# KENUXA Universal Evolution Engine (KUEE) — v1.9–v1.10

KENUXA is built so that nothing in it is fixed merely because it was first written that way. Every major subsystem has a defined path to change, and every change goes through the same lifecycle:

> observe → measure → identify weakness → propose → simulate/test → verify → approve → deploy → monitor → refine or roll back.

Validation is proportional to risk. A small set of security and privacy invariants holds across every version, whoever proposes the change.

## 1. Audit: what was fixed in place before v1.9

| Subsystem | Before v1.9 | Now |
|---|---|---|
| Atom categories | Cognitive categories were a constant list | An extension point (`atom-category`) adds categories as data and can roll them back. Built-ins are protected. |
| Retrieval | One function (`findForQuery`) with a fixed 0.5 threshold | A `retrieval` policy with three interchangeable implementations, measured by recall@1, recall@3 and latency |
| KUNPP routing | Leases sorted by priority only | A `routing` policy (priority, waiting time, data locality, peer reliability, payload cost), evaluated in a scheduling simulation, rolled out as a canary, and monitored on real accept/reject outcomes |
| Replication | `COMPUTE_REPLICAS` env only. A holder that left still counted, and re-planning was silently deduplicated. | A `replication` policy with a durability model. Only reachable holders count. Replicate tasks are re-planned when holders change (tested). |
| Memory bounds | Constants (working memory 64, experience 2,000) | A `memory` policy, evaluated by re-running scenarios that must give identical answers |
| Learning | Synthesis search settings were constants. Tariff (money/kWh) procedures could not be learned (bug found by the new evaluator). | A `learning` policy, evaluated on corrections fixed, held-out transfer and search effort. The synthesis unit bug is fixed. |
| Security | Fixed env values. Token hashing fixed to SHA-256. | A `security` policy (proof-of-work floor, rate limits, versioned credential hashing with migration on use). High risk. Protected invariants. |
| Protocols | `/atp/info` listed versions; no negotiation | A `protocols` policy. Versions are advertised in `/atp/info` and negotiated before cognitive sync. Deprecation warnings. Safe refusal. |
| Transports | HTTPS and WebRTC, hard-wired per use | A transport registry with selection by required properties and fallback. WebSocket is listed as an unimplemented extension point. |
| Chat UI | Presentation in code | A `ui` policy (data only; executable content refused), served in `/chat/config` and read by the chat client |
| Evolution itself | Cognitive evolution only | An `evolution` policy (canary share, monitor window, regression threshold, auto-approval of low risk). Its own safeguards are invariants. |
| Change records | Only cognitive atoms had history | Every change is a record, with tests, approval, deployment, monitoring and a rollback reference |

## 2. Architecture (`lib/evolve/`)

| File | Role |
|---|---|
| `registry.mjs` | **Component registry.** One contract for every subsystem: id, type, version, capabilities, dependencies, resources, compatibility, policy, extension points, alternative implementations, metrics, health, history, validation (from the risk tier), and rollback. **Discovery is by capability**, including dynamic providers: volunteer peers advertise `task-execution`, verified capabilities and `storage-replica`; mesh nodes advertise what their `/atp/info` lists. Departed peers are withdrawn. |
| `policies.mjs` | **Versioned policies.** 9 kinds, each with a schema and a risk tier. **Invariants** are checked on every proposal, before tests and before approval. |
| `engine.mjs` | **The lifecycle.** Proposal → schema and invariants → staged version → evaluator → risk-based approval → deploy, in one of two ways:<ul><li>**canary:** a deterministic share of decisions, keyed by request or peer, uses the candidate</li><li>**full**</li></ul>Then monitoring of real outcomes, with automatic rollback above the regression threshold, then activation. Change records are exported to, and adopted from, peers. |
| `strategies.mjs` | Replaceable strategies and their evaluators: retrieval implementations with recall@k; the routing score and a deterministic scheduling simulator; learning-settings evaluation. |
| `protocols.mjs` | Version negotiation (newest common version, deprecation warnings, explicit safe refusal), and transport selection. |
| `index.mjs` | **Wiring into the running node:** the 13 components, an evaluator per policy, appliers that put an active version into effect, the dynamic providers, and the atom-category extension. |

### Risk tiers

| Tier | Validation | Examples |
|---|---|---|
| low | schema, invariants and evaluator; auto-approved if not worse | retrieval strategy, a new atom category |
| medium | as low, plus a canary rollout with monitoring, then full use. The owner may end a canary early. | routing, replication, memory, learning, UI |
| high | as medium, plus **explicit authenticated owner authorization**. Never auto-approved, never adopted from a peer. | security, protocols, the evolution policy |

### Invariants (cannot be changed by any approval)

- **Authentication:** owner routes always require authentication.
- **Audit:** the audit log stays on.
- **Proof-of-work:** registration PoW is at least 8 bits.
- **Credentials:** tokens are stored with a SHA-2 hash.
- **Replicas:** there is at least one replica target.
- **Protocols:**
  - a supported ATP version is kept
  - a version cannot be both active and deprecated
- **Monitoring:** monitoring and automatic rollback stay on.
- **Approval:** no auto-approval of high-risk changes.
- **Learning:** held-out and regression validation cannot be removed.

### What evolves in which way

1. **Live knowledge and state.** Atoms and cognitive atoms change through the ledger and the cognitive evolution engine.
2. **Live policies, rules and procedures.** The policy store, plus procedure, rule, causal and action atoms.
3. **Replaceable components.** Retrieval implementations; task kinds (KUNPP vocabulary); transports.
4. **Versioned protocols.** ATP, KUNPP and kenuxa-mind version lists, with negotiation.
5. **Infrastructure.** Code changes still go through git, tests and deployment. KUEE never executes code supplied by peers or generated at run time.
6. **Invariants.** Enforced in every version.

## 3. Measured results (`node` on this sandbox; evaluators are the ones the engine runs)

| Proposal | Outcome | Evidence |
|---|---|---|
| Routing: locality 5, cost 1 | canary, then deployed after monitoring | Simulated priority-weighted wait 137 → **91**; failures 82.8 → 78.5; data transferred 36.6 MB → **14.8 MB** (4 seeds) |
| Routing: age weight 2 | **rejected** | wait 137 → 142 (worse) |
| Retrieval: plain lexical | **rejected** | recall@1 0.839 → 0.935, but recall@3 1.0 → 0.968. Both must not get worse. |
| Retrieval: concept + lexical + graph | deployed | recall@3 1.0 → 1.0 and recall@1 equal; 0.19 ms/query |
| Learning: max 2 operands | **rejected** | corrections fixed 3 → 2 of 3; held-out transfer 3 → 2 |
| Learning: constants {1, 2} | canary | fixed 3 → 3 and transfer 3 → 3; expressions searched 8,993 → **3,959** |
| Replication: 3 copies | canary | loss probability per proof window 2.5·10⁻³ → 1.25·10⁻⁴ (assuming independent holder failure of 5%/day) |
| Replication: 1 copy, weekly proofs | **rejected** | loss probability 2.5·10⁻³ → 0.35 |
| Memory: working memory 16 | canary | answers identical on the scenario set |
| Security: PoW floor 16 bits | awaiting authorization | estimated median puzzle time on a slow browser 0.2 s → 0.95 s |
| Security: PoW floor 24 bits | **rejected** | estimated ≈ 170 s on a slow browser (unusable) |

**Defects found by the new evaluators and tests, all fixed:**

- Synthesis could not learn procedures whose inputs have no factor-1 unit (tariffs).
- A storage holder that left kept counting toward the replica target.
- Re-replication after a holder left was deduplicated away.

**Caveats:**

- The routing results come from a simulation, not from production traffic. That is why routing changes go through a canary monitored on real accept/reject outcomes.
- The replication figures depend on the stated failure assumption.

## 4. Tests (`tests/evolve.test.mjs`, 15 tests, one per requirement)

1. A new atom category is introduced, used and rolled back.
2. A reasoning procedure is improved by a verified correction.
3. The retrieval strategy is replaced after measurement, and a worse one is refused.
4. Nodes join and advertise capabilities; roles follow verified capabilities.
5. A node disconnects mid-task:
   - committed results stay
   - interrupted work returns to the queue
   - late results are refused
   - the node is no longer advertised
6. The routing policy goes through simulation, canary and monitoring to full deployment, and a worse policy is refused.
7. A storage replica is reassigned when its holder leaves.
8. Protocol negotiation works, deprecation warnings appear, and transports are selected by requirement.
9. The memory policy changes with identical answers. Private data cannot even be expressed in it.
10. A security upgrade (SHA-512 credential hashing):
    - needs authorization
    - existing credentials are migrated on use
    - invariant-breaking variants are refused
11. The UI policy changes through the authenticated owner API:
    - executable content is refused
    - `/chat/config` serves the new version
    - the change appears in the component history
12. The learning strategy is evaluated: a weaker one is refused, a leaner one is adopted, and removing validation is refused.
13. A failing canary is rolled back automatically, and a deployed change can be rolled back manually.
14. An outdated node:
    - an ATP/1.0 node stays compatible
    - an ATP/0.9 node is refused safely
    - dropping a version a known peer uses is refused
    - protocol changes need authorization
15. A deployed change propagates to another node, which re-validates and re-tests it. High-risk changes are refused, and a worse change fails local evaluation.

## 5. Interfaces

**Owner routes:**

| Route | Returns |
|---|---|
| `GET /api/evolution` | components, capabilities, providers, policies, records, canaries |
| `GET /api/evolution/record?id=` | one change record |
| `POST /api/evolution/propose` | proposes a change: `{ kind: 'policy', target, value, reason }`, or `{ kind: 'atom-category', value }` |
| `POST /api/evolution/approve` | authorizes a high-risk change, or ends a canary early |
| `POST /api/evolution/rollback` | rolls a change back |

**Node to node:**

- `GET /atp/evolution/records` (signed) returns deployed low- and medium-risk policy changes. Each receiving node runs them through its **own** pipeline.
- `/atp/info` advertises `protocols`, `deprecated` and `capabilities`.

**Client:** `/chat/config` returns the active `ui` policy, which the chat client reads.

## 6. Limits and roadmap

**Limits:**

- Policies cover the parameters listed in the audit table. Adding a new *kind* of policy, or a new retrieval implementation, is still a code change, through the normal repository workflow.
- Canary monitoring uses the outcome signals that exist today (KUNPP accept/reject, retrieval returning results). The UI and memory policies have no live outcome signal, so their canary is ended by the owner after evaluation.
- Evolution records propagate between nodes over the mesh. Nodes do not vote on them: each node decides for itself.
- WebSocket transport, storage-backend migration tooling and multi-modal perception components beyond diagrams are extension points, not implementations.

**Roadmap:**

1. Live outcome metrics for the UI policy, using rating signals per policy version.
2. Retrieval evaluation on real query logs, using public queries only.
3. Shadow evaluation of routing on real leases. Today the canary splits live decisions instead.
4. Agreement between nodes on high-impact policy changes, reusing live consensus.

## 7. What v1.10 completed

| v1.9 limit | v1.10 |
|---|---|
| Security evolution had no audit trail or key lifecycle | A **tamper-evident audit chain** (each entry hashes the previous one; any edit, deletion or reordering is detected). It records every evolution step, peer revocations and cognitive reviews (`GET /api/audit`). **Node key rotation** is a high-risk extension: the old *and* new Ed25519 keys sign a rotation certificate, and peers move trust to the new fingerprint only if the old key is the one they knew. Rotation is not replayed on restart. |
| A new policy *kind* needed code | **Policy kinds defined as data** (`policy-kind` extension): field types and ranges, defaults, risk, and declarative invariants. Built-ins cannot be redefined. |
| No live outcome signal for the UI | `/chat/config` serves the UI canary by client, and 👍/👎 ratings feed the canary monitor. A version people like more is deployed; one they like less is rolled back (tested with random rating streams). |
| Routing was compared only in simulation and on the canary share | **Shadow evaluation:** on baseline leases the candidate's pick is computed but not used, and agreement, bytes and wait are recorded (`metrics.shadowRouting`). |
| Retrieval touched every atom | An **inverted-index** implementation. On stores of 2k–20k atoms: **5–7× faster** with higher top-1 recall, recall@3 0.997 vs 1.0. The evaluator refuses that trade-off unless the owner raises the new `evolution.retrievalRecallTolerance`, which is 0 by default and high risk. |
| No storage migration path | `lib/evolve/migrate.mjs`: state-store migration with read-back verification, and resumable chunk migration verified by hash. The source is never deleted. |
| Hard-coded per-address limit (180/min) | `REQUESTS_PER_MINUTE`. |
| Exceptions disguised as bad input | Error boundary (see `docs/ROBUSTNESS.md`). |

**Peer collusion.** v1.9 accepted results when replicas agreed. v1.10 counts agreement only between established peers: new or low-reputation agreeing peers are checked by the core, and penalised when they are wrong.
