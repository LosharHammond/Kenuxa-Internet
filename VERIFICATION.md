# Delivery verification, 3 November 2026

## v0.4: transformer, 7-part responses, Supabase, cross-host federation

Checks that passed:

- **Tests:** 25 automated tests pass (`npm test`, about 13 s).
- **Transformer gradients:** the hand-written backward pass for all weight types, and for atom-kernel prefix inputs, matches central-difference numerical gradients within 2%, both with and without gradient checkpointing.
- **Transformer inference:** KV-cache tiled attention reproduces full attention to within 1e-4. Appending identity-initialised layers leaves the outputs unchanged.
- **Transformer training:** training lowers loss, and fp16 checkpoints round-trip.
- **Real data:** the v0.3 state from the user's PC (24 atoms) loaded unchanged. It produced 10 molecules, 5 cells, and life-cycle stages (13 shared, 11 local).
- **Background training:** the worker reached step 25 (loss 5.13) while `/health` kept answering in about 35 ms, including during kernel growth.
- **Evolution tick:** a tick grew an atom kernel and embedding inside the worker.
- **Browser:** the 7-part answer and the Core & evolution view rendered in Chromium with no console errors.
- **Supabase mirroring:** tested against a mock Supabase REST API. Every mirrored row satisfied the original v1.1 CHECK constraints (entity type, relationship type, attachment category, weight range). Unchanged entities were not re-sent.
- **Serverless:** a Netlify-style node built from a web `Request` answered with all 7 sections. It ran an evolution tick through `/cron/tick` with `CRON_SECRET`, rejected the tick without the secret, and flushed state before replying.
- **Discovery:** three real node processes found each other. C learned A's address by gossip through B, and A learned B from B's hello. C then pulled A's public atom directly over signed MTP. The atom arrived pending, with A recorded as a confirmation.

Not verified:

- **Live deployments:** no Render, Railway, Vercel or Netlify deployment was tested. The configuration files follow each platform's documented format.
- **Live Supabase writes:** these depend on running the migration and adding the server key to `.env`.
- **Transformer quality:** text quality after long training is not established. Drafts stay hidden until 1000 steps.

## v0.3 research and method learning

- Fifteen automated test groups pass. New coverage includes first-time method teaching, transfer from Venus to Saturn using new evidence rather than copied answers, parallel request deduplication, method persistence, source-reference inheritance through molecules/cells, blocked reuse of rejected lessons, suppressed failed-teacher retries, teacher response cache reuse across restart without credentials or additional quota use, search-key routing, and citation/coverage critique. Provider and Brave calls use fixtures, not live credentials.
- In the actual local browser, asked the previously unknown question What is bioluminescence? The service discovered Wikipedia results, read three public pages and returned three exact cited passages. The UI displayed source links, pending review status, search coverage and self-review gaps.
- Repeating the question returned Answer memory reused with no new search or teacher call. Restarted the actual service, reloaded v0.3, and verified that the saved answer still returned from memory with citation review.
- A live fresh-source request read three pages again and reported wordingChanged=false. The original supported wording was retained, and the preceding answer version was saved for comparison.
- Local research status confirmed one saved researched question and zero teacher attempts. No teacher or Brave API key is installed, so live method teaching and broad Brave search were NOT verified. The live method was builtin:explanation; teacher-trained methods are verified by mocked integration tests only.
- Researched atoms remain pending until owner approval. Local answer reuse is explicitly provisional. Private research/teacher data remains in ignored local state; no credentials or runtime learning files are committed.
- Screenshot proof: kenuxa-research-v03.png in the Codex visualization output directory. This is bounded extractive evidence processing and reusable parameterized research procedures, not a generally reasoning model, whole-web crawler, or hallucination-free answer system.

## v0.2 upgrade verification

- Ten automated test groups pass, including the original two-node HTTP test and the new DNA, hierarchy, native capability, provider and crawler checks.
- The original local state was migrated to version 2 with a pre-DNA backup in the ignored data directory. Existing learned knowledge remained available.
- In the actual browser, created Dolphin, Shoe, Dress, Perfume, Homemade and Body spray as six domain atoms. Each developed its own native agent/expert records from its DNA.
- In the browser, combined Dolphin/Shoe/Dress into Outfit molecule and Perfume/Homemade/Body spray into Scent molecule, then formed Fashion cell from those molecules. The cell displayed advanced native specialists, its evidence/consistency/domain council, six unique atom members and inherited outfit/brand/scent capabilities.
- Executed the Fashion cell's outfit capability in the browser. Then grew Shoe's meaning and example questions, taught Shoe a new shoe-fit text workflow, and observed Fashion cell's DNA revision and inherited capability update.
- Executed that newly inherited workflow through Fashion cell. Output included the supplied Accra walking brief, learned steps/checks and the relevant Shoe DNA claims.
- Restarted the service and repeated that learned capability execution successfully. The structures, DNA and learned program persisted. Council output clearly identified local rule-based checks and the absence of external evidence for the manually created examples.
- Real outbound HTTPS crawling successfully captured Wikipedia's Knowledge graph and Solar energy pages and produced pending atoms with source URLs, timestamps, excerpts and SHA-256 fingerprints. The initial 600 KB page limit proved too small; the final extractor uses a bounded 3 MB response limit. Failures were recorded rather than represented as successful atoms.
- Source-grounded atoms stayed pending because no teacher keys were configured. The crawler remains enabled on the running local node. Automatic acceptance/training is off by default and can be enabled explicitly in Web learning.
- Verified the AI teachers screen shows Groq as primary, all eight provider presets, the compatible-provider option, a daily call budget and no configured credentials.
- Automated tests cover every provider adapter with synthetic responses; runtime keys are absent from serialized state, exports and metadata. No provider was called live and no key was created.
- Automated crawler tests cover missing teachers, matching/mismatched quotations, newly configured teachers inspecting old captures, unchanged-source deduplication, source-change proposals and rejection of automatic acceptance with unresolved source conflicts.
- HTTP tests exercise domain creation, manual molecule/cell formation, DNA growth, learned-capability inheritance/execution and blocking private-address source URLs. Existing private DNA, lessons, conversations and credentials remain excluded from peer payloads.
- The native specialists are local graph/procedural runtimes. They are not independent general-purpose LLMs, professional experts or proof that all subject tasks can be completed. The own answer model remains the small supervised answer-selection model.

The v0.2 source is prepared for the existing public GitHub repository. Git upload is verified separately by checking the remote commit against the local commit. Local learned state and secrets are excluded.

## Original v0.1 delivery record

Location: `C:\Users\Procus\Desktop\KENUXA\kenuxa-internet`

## Completed

- Node.js v24.20.0 ran this dependency-free application locally at http://127.0.0.1:3210.
- `npm install --package-lock-only --ignore-scripts` completed; audit reported zero dependencies with vulnerabilities (there are no external runtime dependencies).
- `npm test`: four tests passed, zero failed. The integration test launched two independent real HTTP node processes with separate data directories.
- Own model: trained starter curriculum, answered a paraphrase about Ghana and one about solar energy, declined an unknown topic, produced numerical weight checkpoints.
- Federation: public lesson from A entered B's pending queue, B abstained before approval, B answered after approval without Groq, duplicate sync added no duplicate, B retained its answer after process restart. Private lesson content and conversation memory were absent from A's signed snapshot.
- Authentication: missing admin token rejected; missing/wrong/expired/replayed federation authentication rejected; non-Render and metadata-service peer URLs rejected. Signed response verification passed.
- Groq teacher adapter: mocked request/response test passed, including missing-key and HTTP 429 handling. No paid request was made.
- Browser: opened the actual app, typed “What is the capital of Ghana?”, and observed “The capital of Ghana is Accra” labelled KENUXA own model.
- Browser: created a private manual lesson about Kenuxa outcomes in the Learning studio. Counts changed from 13 meanings / 45 examples to 14 / 48. Asked “What does an outcome record?” and observed the newly learned answer from the own model with no teacher configured.
- Browser: inspected teacher-offline messaging, local model metadata and review queue. Saved `kenuxa-preview.png` showing both real answers.
- Syntax checks: `node --check server.mjs` and `node --check public/app.js` completed successfully.

## Not established

- No Groq key was configured and no live Groq lesson batch was requested. Teacher functionality requires GROQ_API_KEY on the server.
- No Render account was deployed or connected. The supplied Render blueprint and instructions are deployment preparation, not proof of a hosted mesh. The source repository was subsequently prepared for upload to https://github.com/LosharHammond/Kenuxa-Internet; learned state, checkpoints and credentials are excluded from Git.
- No existing Supabase database was modified.
- This verifies a small trained answer-selection model and curriculum federation, not an original generative transformer, distributed parameter training, broad factual accuracy or a security audit.

The manual lesson and the two browser questions remain in the local data directory as initial knowledge and memory. Test fixtures use separate temporary directories and do not populate the user's node.

## Render binding regression fix - 3 November 2026

The supplied Render log deployed commit 45dca26 (v0.3) and bound only to 127.0.0.1. The local v0.4 upgrade was not yet committed. Render platform detection now forces 0.0.0.0 even if a copied local HOST setting specifies loopback; the supplied PORT is preserved. A real-process regression test starts with RENDER=true and HOST=127.0.0.1, checks the 0.0.0.0 startup address, verifies /health, and verifies unauthenticated /api/status is denied. Local environment files and Claude outputs are excluded from Git and container context. This verifies startup locally; a successful hosted Render redeploy still needs to be observed.
