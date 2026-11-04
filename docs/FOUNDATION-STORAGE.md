# Foundation and federated knowledge storage (v1.11)

## Repository audit and resulting design

The pre-existing v1.10 work includes atomic identities, a live knowledge ledger, peer preservation with erasure coding, a storage interface for complete node state, volunteer participation, and cognitive procedures. Those systems are preserved. Previously the small lexical baseline, lesson seeds, world packs, cognitive seeds and procedure library were JavaScript constants; open vocabulary depended on network/teacher learning. Whole node state could use local files or Supabase, but there was no independent provider registry for canonical record placement.

This release adds a licensed, out-of-core offline dictionary and a bounded **owner-operated record federation**. It does not replace peer consensus/preservation or pretend that its per-node journal is a globally distributed transaction. It remains a prototype with clear boundaries.

## Foundation and comprehension

See [foundation packaging and licences](../foundation/README.md). Core data is stored as JSON; the full processed WordNet dictionary uses hashed lemma and synset shards. A manifest supplies counts and integrity hashes. The runtime loads a few shards as needed and retains a bounded cache. Active graph revisions take precedence over a baseline entry, preserving live corrections.

Missing English words can hydrate lexical DNA from the dictionary during interpretation. Inflection exceptions and bounded regular morphology preserve root references. Dictionary-supported POS alternatives are retained; an inflected verb can still be interpreted as a verb instead of being forced into an adjective/noun sense. Synsets preserve canonical IDs, provenance, examples, source pointer types and word indices. Unsupported pointers remain source metadata, not invented executable rules. Dictionary-attested meanings are not independently verified claims.

Explicit definition requests can return local dictionary senses without a web or teacher request. Ambiguity is stated. Existing reasoning, mathematics, grammar and declarative methods remain usable offline. Pure lookup does not train the transformer or import the full dictionary into node state.

## Adapters and capabilities

`lib/storage/adapters.mjs` registers versioned factories. Record adapters support immutable put/get and health; the local adapter also reports actual file capacity and hashed inventory. Hosted adapters report **owner budgets**, not fabricated provider-wide remaining capacity.

Implemented:

| Adapter | Interface | Verification completed |
| --- | --- | --- |
| Local files | Immutable canonical records | Real files, checksum fallback, restart and recovery tests |
| Supabase REST | Immutable rows in a dedicated, RLS-protected table | Isolated documented-protocol fixture; no production table created |
| Turso HTTP | Parameterized SQL over `/v2/pipeline` | Real SQLite executes the SQL behind an isolated HTTP-protocol fixture; no live Turso account used |

The existing `store.blobs` interface remains separate for object/blob storage (node checkpoints and recovery journal). Relational APIs are not presented as S3-compatible storage. R2, Neon and a generic S3 adapter are evaluated candidates, **not implemented adapters**. Optional volunteer storage remains the pre-existing opt-in peer system; it is not silently counted as a hosted-provider replica.

## Owner configuration

By default no new cloud provider is contacted or provisioned. Local file storage works offline; on hosted ephemeral filesystems it does **not** count toward durable replication. Set `KNOWLEDGE_LOCAL_DURABLE=true` only for a real persistent volume. Back up local data; an owner-configured durable flag is not an independent audit of a filesystem.

Cloud setup is explicit. Review [Supabase SQL](storage-supabase-setup.sql) or [Turso SQL](storage-turso-setup.sql) in an isolated database, then supply credentials through environment variables. These files are **setup templates**, not migrations executed by this release. Existing production schema is untouched.

Example non-secret configuration (replace endpoints, budgets and review date after checking the actual account):

```json
[
  {
    "id": "supa-knowledge",
    "type": "supabase-records",
    "adapterVersion": 1,
    "url": "https://YOURPROJECT.supabase.co",
    "keyEnv": "SUPABASE_SERVICE_ROLE_KEY",
    "domain": "supabase-provider",
    "eligible": true,
    "quotaReviewedAt": "2026-11-04",
    "maxBytes": 10485760,
    "maxRequests": 1000
  },
  {
    "id": "turso-knowledge",
    "type": "turso-records",
    "adapterVersion": 1,
    "url": "https://YOURDATABASE-YOURORG.turso.io",
    "keyEnv": "TURSO_AUTH_TOKEN",
    "domain": "turso-provider",
    "eligible": true,
    "quotaReviewedAt": "2026-11-04",
    "maxBytes": 10485760,
    "maxRequests": 1000
  }
]
```

Put this JSON in `KNOWLEDGE_STORAGE_PROVIDERS`. No key values belong in the JSON or repository. Configuration requires positive budgets and a quota review within 30 days; this does not guarantee the provider's commercial policies cannot change. Namespace defaults to the node ID. Select independent failure-domain labels honestly; two tables/accounts on one provider are not automatically independent domains. Do not create accounts to bypass limits.

`KNOWLEDGE_STORAGE_REPLICAS=2` requires two distinct configured durable domains. Never select a target that exceeds actual eligible capacity. `KNOWLEDGE_STORAGE_AUTO=true` optionally mirrors eligible public, activated atomic revisions from the existing live ledger; it is off by default. Queued, failed and insufficient-replica outcomes stay explicit on the learning event. Web/teacher statements remain provisional until existing validation accepts them; source text is not auto-promoted simply to fill storage.

## Canonical manifests, placement and consistency

Canonical ID, type, numeric version, validation, provenance and privacy classification are separate from content hash and storage locations. Storage movement does not change identity. Immutable record keys are `record:<SHA-256>`. The local provider hashes keys into safe filenames. Existing head revisions remain readable until the replacement meets its replica policy.

Placement skips non-durable or privacy-ineligible backends, checks configured byte/request budgets, prefers fewer observed failures and less-used capacity, and chooses distinct domains. Records are partitioned by content hash across providers rather than replicating the entire dictionary everywhere. Manifests locate each shard/record; a single record is limited to 128 KiB. Bulk multi-gigabyte package placement is not implemented.

The per-node blob journal stores intent and partial receipts before returning COMMITTED. Every receipt requires read-back checksum verification. Insufficient copies leave PENDING_DURABILITY; they do not become canonical heads. Recovery rechecks partial copies and retries idempotently. Concurrent writes within a manager serialize; conflicting canonical versions are rejected or left CONFLICT. Earlier versions and locations remain in manifest history.

Retrieval checks canonical version/checksum, tries available locations, and falls back to a verified replica. Missing copies fail explicitly. If there is no canonical live record, bundled foundation lookup remains available. The existing `/api/atoms/fetch` owner route also consults these canonical manifests. A dictionary alone is not used to fabricate a missing live record.

Control manifests live in the existing node blob store, which must itself be durable for remote records to remain discoverable after a node dies. There is no atomic transaction across providers and no automatic multi-writer conflict resolution across two processes sharing one node ID. Use one writer per namespace. An external independent backup of the control journal is still required for disaster recovery; the existing peer metadata system is not automatically a replica of this new journal.

## Capacity, monitoring and privacy

The studio's Web learning panel shows dataset coverage, offline lookup, manifests, pending writes and provider budgets. Owner APIs:

```
GET  /api/foundation
GET  /api/foundation/lookup?word=microscope&limit=20
GET  /api/knowledge-storage
GET  /api/knowledge-storage/manifest?id=CANONICAL_ID
GET  /api/knowledge-storage/record?id=CANONICAL_ID
POST /api/knowledge-storage/commit   {"id":"CANONICAL_ID"}
POST /api/knowledge-storage/health  {}
POST /api/knowledge-storage/recover {}
POST /api/knowledge-storage/repair  {"id":"CANONICAL_ID"}
```

All use the existing owner authorization boundary. Public visitors and volunteer peers cannot edit manifests or read private records through these routes. Backend credentials remain on the server and are omitted from status. Supabase's new table has RLS enabled, no anonymous/authenticated grants or policies, and only server-role select/insert. No public writable buckets are added.

Private records are supported only through explicitly authorized manager calls and private-eligible backends. Public atom commit/mirroring rejects the registry's private scope; it does not migrate conversations or account data. No new browser replication of private data is introduced.

Byte occupancy is measured for local files; hosted occupancy is an estimate of this manager's writes against an owner budget, not account-wide truth. Operation counts budget hosted immutable writes conservatively as insert plus verification, plus manager read-back. Quotas shared with other applications, bandwidth and the node's separate control-journal writes require provider dashboard monitoring. A low local counter cannot prove no charges are possible. No quota-expansion, overage activation or account creation is performed.

Limits: 2,000 canonical records, 100 pending writes, 128 KiB per record, up to eight configured remote adapters and one to five required domains. Full capacity returns explicit backpressure; it does not delete knowledge. Health checks and recovery are owner actions; there is no always-running cloud capacity agent.

## Current eligibility snapshot — 4 November 2026

These are reviewed public offers, not allocation promises or deployment approvals. Existing free accounts may have different terms; confirm the account dashboard, retention, region and acceptable-use rules before enabling. No provider's free tier is assumed permanent.

| Candidate | Public free allowance reviewed | Eligibility / operational notes | Adapter |
| --- | --- | --- | --- |
| Supabase | 500 MB database; 1 GB storage; 5 GB uncached and 5 GB cached egress; 2 active free projects; paused after 1 week inactive | Server key required; no new project created; backups/retention need separate review | Implemented REST records; live setup not performed |
| Turso | 5 GB storage; 500 million monthly rows read; 10 million written; 3 GB sync; 100 databases advertised; no card required | Shared plan/account limits apply. Keep overages disabled. Namespace isolation is server-controlled; backend token permissions must match use | Implemented HTTP records; live setup not performed |
| Neon | 1 GB storage/project; 100 CU-hours/project monthly; free plan advertised without a time limit or card | Compute/connection/egress and retention behavior must be checked for the selected account; not eligible automatically | Candidate only |
| Cloudflare R2 Standard | 10 GB-month; 1 million Class A and 10 million Class B operations monthly; Internet egress free | R2 subscription/checkout required; usage beyond included amounts can bill. Not chosen as mandatory zero-budget infrastructure | Candidate only |
| Owner/community files | Capacity and retention are volunteered/configured, not a provider free-tier promise | Consent, real persistent media, independent failure domains, bandwidth and battery constraints apply | Local records; existing peer preservation separately |

Sources: [Supabase pricing](https://supabase.com/pricing), [API grants/RLS](https://supabase.com/docs/guides/api/securing-your-api), [Turso pricing](https://turso.tech/pricing), [Turso HTTP protocol](https://docs.turso.tech/sdk/http/reference), [Neon pricing](https://neon.com/pricing), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 subscription setup](https://developers.cloudflare.com/r2/get-started/).

Some provider-specific inactivity, account-verification, AUP and retention details were not conclusively established by the public pages reviewed. This release does not claim all providers have equivalent commercial-use or retention guarantees. Operators must finish those account-specific checks; the software cannot infer eligibility from a marketing free-storage number.

## Verification, release and remaining work

Run `node --test tests/foundation-storage.test.mjs` and `node bench/foundation.bench.mjs`. Tests cover full-package checksums, randomized vocabulary cases, actual files, SQLite-backed Turso protocol execution, Supabase protocol fixtures, private denial, capacity and duplicate-domain rejection, checksum corruption, replica fallback, partial-write recovery, stale versions, concurrency, authenticated APIs, offline definitions and restart retention. Fixed regressions remain alongside randomized tests; replacing all fixed tests with random ones would hide regressions.

Use `node scripts/verify-foundation-server.mjs` for an isolated offline studio on port 3299. It never loads `.env` or cloud credentials. The browser lookup and local commit were verified there. No hosted service deployment, production migration, live hosted adapter write or cloud durability claim follows from those tests.

Next releases: reviewed multilingual/Wiktionary packages with complete attribution, larger independently checked world subsets, object-store package sharding, actual authorized hosted-adapter acceptance tests, provider usage APIs, controlled deletion/garbage collection, independent journal backup/replication and multi-writer coordination. Do not describe those as implemented. No finite package or test suite establishes that every universal question is answerable, and lexical breadth alone is not human-level comprehension.
