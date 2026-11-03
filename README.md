# KENUXA Internet — first working foundation

A fresh reconstruction from your surviving semantic-internet specification. This is not a recovered copy of the lost laptop's code. The existing Supabase project is not modified or required.

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
| Teacher | Optional Groq curriculum proposals; never used by ordinary answering |
| Evolution | Draft → review → approval → local model retraining; rejected drafts are retained |
| Capabilities | Listed implemented operations, no arbitrary code execution |
| Outcomes/memory | Local answer history, user feedback, learning and sync events |
| Goals | Local goal records (no autonomous execution) |
| Federation | Signed peer snapshots, explicit public sharing, review of imported lessons |
| Portability | JSON backup export; import up to 100 lesson records at a time into review |

## Groq as teacher

Copy `.env.example` to `.env`. Set `GROQ_API_KEY` there and restart. Never commit `.env`. The default `GROQ_MODEL` is `openai/gpt-oss-20b`, hosted through Groq. This uses Groq credentials, not OpenAI API credentials; the teacher model is external and is not KENUXA's student model. Choose another model available in your Groq account if needed.

In **Learning studio**, request a topic. Only the topic and a fixed teacher instruction are sent to Groq. Each request proposes at most five lessons and is a billable/rate-limited Groq call. Conversations, existing private lessons, admin tokens and network secrets are not sent. The teacher endpoint is fixed to `https://api.groq.com/openai/v1/chat/completions`.

Review each draft's factual accuracy, then click **Approve & train**. Approval is human review, not independent source verification; teacher-generated lessons retain their unverified-draft provenance. Once approved, ask its questions with the teacher disconnected: KENUXA answers with its own trained weights. This is teacher-generated supervised data, not full logit-level model distillation. There is no unattended paid training loop.

## Deploy separate nodes to Render

1. The source repository is https://github.com/LosharHammond/Kenuxa-Internet. Use it when creating each Render deployment. Local data and credentials are excluded from Git; back them up separately.
2. On each Render account, deploy that same repository using `render.yaml`, or create a Node web service manually with build `npm ci --ignore-scripts` and start `npm start`.
3. Give each node a different NODE_ID, such as `kenuxa-accra` and `kenuxa-kumasi`. Set HOST to `0.0.0.0`; Render supplies PORT. Keep each node's ADMIN_TOKEN different and secret, at least 32 characters. The blueprint generates it; copy it from Render's environment settings into that node's login screen.
4. Choose one random NETWORK_SECRET, at least 32 characters, and securely set the same value on all trusted nodes. It must differ from all ADMIN_TOKEN values. Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; do not put it in URLs or source control.
5. After Render assigns URLs, set PEER_URLS on each node to the comma-separated HTTPS origins of the peers it should pull from. Example for node A: `https://kenuxa-kumasi.onrender.com`. Node B uses A's URL. Origins only: no paths, query parameters or trailing path segments. Restart after environment changes. This prototype allows Render subdomains only, up to 10 peers per node.
6. Use the blueprint's persistent disk and DATA_DIR `/var/data/kenuxa`. **The supplied blueprint uses a paid starter service and disk.** Free services have ephemeral local storage; model/state changes can disappear after a restart or deployment. They can also sleep, preventing continuous sync. Use exports for backups regardless of plan.
7. Add a manual public lesson on A. On B click **Sync knowledge**, inspect the review queue, approve the lesson, then ask it. B will answer independently from its own local model. Background sync checks configured peers every 120 seconds while running.

Federation does not pool Render resources, bypass service limits, keep free services awake or train a single model across accounts. It exchanges curricula; each node trains independently. Use accounts you control under Render's applicable terms. A star or mesh of trusted nodes is possible. No transitive lesson rebroadcasting is performed in v0.1; configure direct peers for all required exchanges. Disconnected peers retain their already approved knowledge.

## Trust and privacy boundaries

- Every API operation requires the node admin token on public hosts, including chat and exports. Tokens stay only in browser tab memory. This is a single-owner prototype, not a multi-user service.
- Peers authenticate using HMAC-SHA256 over method, path, timestamp, nonce and body. Requests expire after 60 seconds, used nonces are rejected, redirects are disallowed, and responses are signed. Use HTTPS in production. Nonce state is process-local and resets on restart; bounded timestamp replay remains possible across restarts or replicas. One process per node is the supported topology.
- Shared-secret members can impersonate a network member. Signatures prove possession of the shared secret, not factual truth or cryptographic per-node identity. Revoke a compromised peer by rotating NETWORK_SECRET on retained nodes and removing its URL. Per-node public-key identities remain future work.
- Only approved public originals are exposed to authenticated peers. Private lessons, imported peer lessons, drafts, memory, goals and credentials are excluded. Changing an exported lesson later does not recall existing copies; update/revocation propagation is not implemented.
- Network inputs have limits and enter review. Local server state and API response sizes are bounded for a small prototype: 500 lesson records, 100 memory entries, 300 events, 100 goals. Graph links are based on shared tags, not a transformer attention-routing protocol.
- The UI renders untrusted text using textContent. There is no shell/tool execution, public signup or automatic external publishing. This is not an audited production security product.

## Backups and recovery

Use **Learning studio → Export backup** regularly. This file contains private knowledge and conversation history; store it securely. With the server stopped, you can additionally copy the entire data directory to preserve exact local state. To restore the same node, put state.json back into its DATA_DIR before startup; the model is retrained. Backups must come from a trusted source.

UI import restores lesson content into the review queue with new IDs; it does not restore original identities, visibility, goals, conversations or outcomes. For more than 100 lessons, split the import or restore the trusted full state file while stopped. Model weights are local artifacts; federation shares approved examples rather than weights.

## Verification

Run `npm test`. Tests train the actual model, verify an unseen paraphrase and unknown-topic abstention, exercise the Groq adapter with a mock (no spending), reject unsafe peers, invalid signatures and replays, then launch two real HTTP node processes. The integration test teaches A a new public lesson, pulls it into B's review queue, verifies B cannot answer before approval, approves/trains B, checks B answers without Groq, verifies private data stays off the wire, and restarts B to check persistence.

Live Groq access requires your own configured key. Live cross-account Render deployments are not established by local tests. See `VERIFICATION.md` for the checks actually completed during delivery.

## Provider documentation

- Groq text generation: https://console.groq.com/docs/text-chat
- Groq current models: https://console.groq.com/docs/models
- Render Blueprint specification: https://render.com/docs/blueprint-spec
- Render free-service storage and sleep limits: https://render.com/docs/free

The foundation is built around Meaning → Capability → Outcome → Evolution. Real general reasoning, autonomous capability execution, source-validated knowledge, private federation, distributed parameter training and trained attention routing are future work, not hidden features of this prototype.
