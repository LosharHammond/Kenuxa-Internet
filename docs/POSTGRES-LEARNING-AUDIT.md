# PostgreSQL persistence and safe learning integration audit

## Verified from source
`lib/store.mjs` selects `SupabaseStore` when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) are present. The service loads `kenuxa_node_state.state` by `node_id`, upserts that JSON state, and mirrors graph rows to PostgreSQL tables. Without these environment variables, `createStore()` falls back to local `FileStore`. This repository audit **does not confirm the Render environment variables or live database contents**.

`lib/node.mjs` loads state via `store.load()` and schedules saves through `store.save(state)`. Cognitive Mind state is nested under the node state and must be included in the node's save lifecycle. Existing graph mirroring handles `state.atoms`, not every experimental Mind atom structure as separate relational rows. JSON state persistence and relational mirroring are different.

## Changes in this branch
- Native atom format registry is now extensible through an explicit owner-authorized API.
- Native atom verification fails closed unless the caller supplies a trusted authenticator. A callback is not itself an implementation of independent evidence validation.
- A consent-gated conversation learning inbox stores content hashes only, not raw chat text; it cannot infer facts from hashes or autonomously learn. It is available through `Mind.captureLearningCandidate()`, not wired into the public chat endpoint.
- No untrusted conversation is automatically promoted to validated knowledge.

## Release gates
1. Verify Render is actually using SupabaseStore (no fallback to FileStore).
2. Confirm `Mind.S` is stored under the persisted node state, not merely an in-memory object.
3. Run `npm test`, inspect the GitHub Actions checks, and verify server startup.
4. Create a backup and exercise restart/redeploy persistence in a staging service.
5. Implement authenticated trusted evidence checks, privacy/retention controls, and source-specific extraction before enabling automatic chat ingestion.
6. Only then integrate the chat answer pipeline with provenance, uncertainty and verified corrections.

**No claim of production readiness or universal open-ended understanding is made.**
