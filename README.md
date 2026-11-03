# KENUXA Internet v0.4: own transformer, 7-part answers, Supabase and cross-host federation

A fresh reconstruction from your surviving semantic-internet specification. It is not a recovered copy of the lost laptop's code. v0.4 reconnects to the original **INTERNET** Supabase project and reuses its v1.1 *Semantic Graph Entity Schema* tables: entities, relationships, attachments, capabilities, embeddings and resolutions.

Every component serves **Meaning → Capability → Outcome → Evolution**. The graph is the intelligence layer. The transformer is a component inside the network; it is not the centre. Storage is not intelligence.

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

### MTP federation on any host (`lib/federation.mjs`, `lib/node.mjs`, `lib/adapters.mjs`)

The protocol is MTP/0.4, the *Meaning Transfer Protocol* named in the original design. Peers can be any public HTTPS origin: Render, Railway, Vercel, Netlify, Fly or a custom domain. Every request and every response is HMAC-signed with the shared `NETWORK_SECRET`.

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

Run `npm test` (25 tests). v0.4 adds numerical gradient checks for the transformer, KV-cache equivalence, identity-preserving layer stacking, checkpoint round-trips, Supabase mirroring against the v1.1 CHECK constraints (using a mock), a serverless Netlify/Vercel-style node with a 7-part answer and cron tick, and three real node processes that discover one another through hello and gossip. Earlier tests train the actual model, verify an unseen paraphrase and unknown-topic abstention, exercise provider adapters with mocks (no spending), reject unsafe peers, invalid signatures and replays, verify source-quote checks, robots exclusions, DNA growth and parent propagation, inherited learned capabilities and absence of provider secrets in state/export. An integration test launches two real HTTP node processes, teaches A a public lesson, reviews/trains B, checks B answers independently, verifies private DNA stays off the wire, and restarts B to check persistence.

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
