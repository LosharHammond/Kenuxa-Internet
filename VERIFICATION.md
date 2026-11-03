# Delivery verification — 3 November 2026

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
