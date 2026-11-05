# KENUXA Cognitive Fabric — migration (v1)

## What is actually running

The public /chat/ask route now enters CognitiveFabric instead of calling the old first-winner answer router. The kernel receives bounded candidates from context, atomic relation proofs, learned procedures, ontology and dictionary. It quarantines inconsistent verified answers rather than arbitrarily deciding which source is right. One failed adapter is isolated by a circuit breaker. The existing deeper answer pipeline is retained as a migration fallback when the fabric cannot establish an answer.

This is an incremental architectural migration, not evidence of unrestricted language understanding. It does not imply that a pretrained model is installed or that separate Render CPUs constitute one shared RAM/CPU process.

## Knowledge plane and Five Laws

1. Durable cognitive atoms and changes stay in the configured FileStore or SupabaseStore node state; the existing atom registry, CognitiveStore and ledger retain version histories. New FabricJournal maintains a bounded hash-chained event trail, explicit dependent artifacts and pending rebuild markers.
2. Answer candidates are gathered from independent adapters; model mistakes and adapter failures do not promote knowledge. Strong, conflicting verified candidates are withheld.
3. Existing approved ledger changes and owner-reviewed relations can emit a versioned learning event. The event records a proof hash, not chat text. Dependency rebuilds are budgeted for idle windows.
4. Errors are classified and deduplicated. Owner-authorized repairs must pass at least two unique independent verified tests, then still require an existing atom promotion/review gate.
5. Snapshots are integrity-checked and inspect-only. Restoring a verified snapshot is a separate explicit process; no peer may overwrite canonical state merely by submitting a snapshot.

## Primary language interpreter: how to turn it on

For CPU-only machines, provide a locally running llama.cpp server and a legally obtainable, compatible quantized open-weight model. Configure:

    KENUXA_FABRIC_MODEL_BACKEND=local
    KENUXA_FABRIC_MODEL_ID=<the-local-server-model-id>
    KENUXA_FABRIC_MODEL_URL=http://127.0.0.1:8080/v1/chat/completions
    KENUXA_FABRIC_MODEL_TIMEOUT_MS=7000

KENUXA does NOT download or install model weights itself. Use a model with a compatible license and adequate memory. The free Render CPU/RAM allocation may be too small even for a 0.5B quantized checkpoint; do not turn on an untested large model in production.

For an explicitly consented managed model adapter, configure:

    KENUXA_FABRIC_MODEL_BACKEND=teacher
    KENUXA_FABRIC_REMOTE_CONSENT=true

This sends current question and bounded history to the configured primary provider. Never enable without proper privacy notice and consent for the relevant users. There is no automatic remote fallback when consent is absent. Provider answers serve as interpretation candidates, NOT verified knowledge.

The semantic frame is a typed, declarative operation. It carries exact supporting quote spans, numeric premises, named entities, and permitted operations. The deterministic kernel rechecks the source spans, operands, inheritance and action polarity and refuses unsupported operations. No generated JavaScript is executed.

## Current limitations

- The model interface is real but a general pretrained model has not been deployed by this migration.
- No automatic learning from untrusted user chat: ordinary premises are conversation-local.
- A validated repair is a proposal, not an automatic replacement of existing model weights.
- Non-cooperating or sleeping Render hosts still require live operational diagnosis.
- In-process synchronous adapters cannot yet be forcibly preempted. Timeouts cover asynchronous model inference; existing worker threads isolate background CPU tasks.
- Content-addressed snapshots are not a substitute for a tested restore/disaster-recovery procedure. They cover a bounded public export, not all private state or model weights.

## Owner controls

Authenticated POST /api/fabric/status (empty JSON body) — runtime interpreter, journal and adapter health.

Authenticated POST /api/fabric/depend — {"artifact":"mol:example","sources":["atom:example"],"kind":"molecule"}.

Authenticated POST /api/fabric/repair — {"failureId":"gap:...","kind":"relation","candidateRef":"atom:candidate"}.

Authenticated POST /api/fabric/repair/evaluate — {"id":"repair:...","trials":[{"testId":"unique-test-a","source":"verified-test","passed":true},{"testId":"unique-test-b","source":"verified-test","passed":true}]}.

Authenticated POST /api/fabric/idle — process pending dependency rebuilds in a bounded idle pass.

Authenticated POST /api/fabric/snapshot — create an integrity-checked bounded public knowledge snapshot.

Authenticated POST /api/fabric/snapshot/inspect — inspect a snapshot checksum without changing current state.

Existing owner POST /api/mind/fabric review of an approved relation emits a FabricJournal learning event.

## Acceptance gates

- npm test (includes generated unseen concepts, real public chat, simulated component failures, integrity checks and restarted node).
- GitHub CI on main.
- Deployment smoke for BOTH Render hosts on the expected commit and signed ATP discovery.
- Live telemetry proving independent CPU task execution, completion and coordinator acceptance in both directions.
- Separate evaluation against truly withheld examples, including generalization beyond the fixed operator vocabulary.

The last two gates MUST NOT be declared passed until actual deployment evidence supports them.
