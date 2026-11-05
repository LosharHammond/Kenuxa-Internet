# KENUXA Cognitive Fabric and Render-to-Render Compute Network

KENUXA is **one logical knowledge network**, not one Render container and not a set of competing answer engines.

## What this change actually implements

- **Persistent, unique node identities.** Each Render hostname gets its own NODE_ID unless explicitly supplied; the original primary hostname retains `kenuxa-home` to preserve existing Supabase records. The Ed25519 identity is stored under that node ID.
- **Automatic discovery.** The existing signed ATP mesh uses the committed genesis directory and `PEER_URLS`. When configured with a common Supabase project, the node registry adds each other live URL to the same mesh. Every new peer verifies signed messages and performs a reciprocal handshake.
- **Direct server-to-server compute.** Hosted nodes automatically seek work from other signed, established nodes when idle. They lease bounded tasks through the existing KUNPP coordinator and return audited results. No arbitrary code or private conversations are sent between nodes.
- **Interactive priority.** Human questions preempt the worker. One peer task runs at a time in an isolated worker thread with an execution deadline and memory cap. Network timeouts, backoff, task size limits and retry/fallback prevent a dead peer from permanently blocking the scheduler.
- **Resilient cognition.** Existing conversation, learned-procedure, dictionary, ontology and Mind components execute behind isolated error boundaries. A failing component is quarantined briefly while other healthy capabilities remain usable. No knowledge is deleted because a component throws an exception.
- **Atomic knowledge privacy.** Only explicitly approved **public** atoms may be offered to peers. Neither `NETWORK_SHARE=all` nor network membership can export a private atom.
- **Reused development system.** Existing versioned atoms, organism growth, teacher pipeline, grammar induction, declarative skill synthesis, transformer candidate evaluation, and checkpoint rollback remain authoritative. This change does not invent a second memory or public chatbot.

### What is not yet distributed

Live transformer parameter training, arbitrary private-user inference and GPU workloads do **not** migrate to peers; safe cross-node task processing currently covers bounded public atom validation, lexical checks, graph reasoning/metrics, public-claim consistency, and candidate-procedure testing. Adding these other kinds requires explicit, independently testable job schemas, private-data safeguards, model consistency and a measured performance benefit.

## Two Render accounts — deployment configuration

1. Deploy the same repository at **two distinct Render HTTPS URLs**, each with its own `RENDER_EXTERNAL_URL`.
2. **Use different `NODE_ID` values**, or leave `NODE_ID` *unset* to derive one automatically from each hostname. Do not share an explicit `NODE_ID`: both deployments would otherwise overwrite the same `kenuxa_node_state` record and share a private signing identity. The original `https://kenuxa-internet.onrender.com` retains `kenuxa-home` if unset.
3. Set `KENUXA_NETWORK=on` and `KENUXA_NODE_WORKER=true` on both deployments. They default to on for hosted Render workers under the blueprint. Set `COMPUTE_PEERS=on`.
4. Provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on **both** services if you want cross-node persistent registry discovery, durable knowledge and model checkpoints. They can use the **same** Supabase project because their node IDs are distinct. Keep these secrets exclusively in Render environment settings, never in GitHub or `PEER_URLS`.
5. The repository's default network seed is the primary `https://kenuxa-internet.onrender.com`. Optionally add the other URL in `PEER_URLS` or `KENUXA_SEEDS` to speed first contact. No shared `NETWORK_SECRET` is necessary for the **signed ATP/1.0 mesh** (the secret still applies to the older ATP/0.4 federation).
6. Keep `PUBLIC_URL` unset if Render supplies `RENDER_EXTERNAL_URL`, or set it to that node's own HTTPS URL. Do not set both nodes' `PUBLIC_URL` to the same hostname.
7. Restart/redeploy each service. A sleeping free Render instance must first wake before the next handshake or task. Free hosting does not guarantee 24/7 availability, shared RAM or aggregated transformer training.
8. Check each public `GET /health` response: the **nodeId** should differ, `nodeCompute.enabled` should be true, and `nodeCompute.peers` should rise after discovery. Check each authenticated `GET /api/network` for peer fingerprints/handshake status. Check authenticated `GET /api/compute` and `GET /api/status` for task counts and worker load.

## Failure tests

1. Start two isolated nodes, connect through a signed `GET /atp/info` + `POST /atp/hello` handshake, and verify peer discovery in both directions.
2. A signed but unknown node must get HTTP 403 for `POST /atp/compute/lease`. Replaying the same signed request must get HTTP 401. Unrecognized task routes are not executable.
3. After handshake, idle node B can ask node A for a public KUNPP task. B executes only a fixed deterministic job in an isolated worker and submits the result. A verifies it under its existing KUNPP rules.
4. Kill or sleep A; B backs off, attempts another peer if available, and continues answering its own chats.
5. During an incoming chat request, the compute worker yields. A private atom must never enter an ATP snapshot.
6. Inject exceptions into the contextual, skill, ontology and Mind adapters independently; a surviving dictionary or reasoning component should still answer.
7. Check GitHub Actions complete tests **and** the live smoke test before calling a commit verified. A passing network connection is not proof of correctness or self-improving general intelligence.

## Core operational limitation

Two free Render CPUs do not become one faster CPU. This implementation **divides independent jobs**, avoiding duplicated work and reducing the originating coordinator's load where delegated tasks are worthwhile. Network round-trips can be slower than local work, and both free services may sleep simultaneously. Actual model-quality improvements still depend on independent validation and sufficient training data and compute.
