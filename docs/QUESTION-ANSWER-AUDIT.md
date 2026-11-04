# Question-to-answer audit and basic QA, v1.12

Universal question answering is **not established**. KENUXA does not understand or correctly write everything. The new basic operators improve a bounded set of tasks. They do not turn the dictionary, molecule graph, or small transformer into a general foundation model.

## Audited path

Both owner `/api/ask` and public `/chat/ask` use `answerQuestion` in `lib/node.mjs`.

| Stage | Existing behavior and findings | Change or remaining limit |
|---|---|---|
| Request boundary | JSON-object validation, length limits, public/owner authorization, private session memory | Preserved; public and owner paths tested with identical native calculation |
| Snapshot and input | Consistent ledger view; lexical atoms, grammar, senses, conversation reference resolution | New basic operators consume the original supplied text; unsupported language/grammar remains limited |
| Teacher analysis | Optional translation/analysis for non-English input | Native basic operations bypass teacher analysis; successful teacher analysis stays attributed |
| Understanding | Intent, context, constraints, affect, ambiguity | These are bounded rules, not proof that every statement is understood |
| Reasoning and learning | Classification, causal claims, source/private scope, correction/revocation | Preserved; atom graph coverage is incomplete and conversation statements are not automatically truth |
| Methods and cognition | Reusable guarded procedures, calculations, planning, diagnosis | Added safe arithmetic parsing, correction and dimension-checked conversions. Existing teacher-learned research methods preserve teacher lineage during transfer |
| Retrieval | Approved local lessons → peers → bounded web search/pages, dictionary fallback | Fixed research-disable flag to use the node's configured environment rather than the process-global flag. An injected discovery adapter without environment retains the prior process fallback |
| Construction | Grounded local frames or limited framework, optional teacher composition | Added explicit passage relation extraction, supporting sentence retrieval, extractive summaries and fact-constrained writing templates |
| Teacher reuse | Previously `teacherUsed=false` could describe cached teacher compositions | New performance object distinguishes teacher dependency from new calls. Cached composition remains teacher-assisted. Research method lineage survives reuse/restart |
| Final verification | Citations, grammar, repetition, relevance, uncertainty, nonempty output | Verification is explicitly labeled **surface checks, not factual truth**. Native operator applicability supplies relevance; lexical focus-overlap checks do not judge numeric outputs |
| History and caching | Answer dependencies, revisions, cache invalidation | Teacher-derived answers excluded from independent local answer-cache promotion. Existing explicit teacher caches remain usable and attributed |
| Delivery | Public route previously dropped teacher provenance | Both APIs expose `performance`; public chat always shows native/local/teacher attribution, including when general engine labels are hidden |
| Capability reporting | Counts could be mistaken for knowledge coverage | `/api/status` includes `basicQA.universal=false`, supported families, examples and limitations |

## New native task scope

- Arithmetic: decimal numbers, parentheses, unary signs, `+ - * /`, postfix percent. No JavaScript execution, powers, variables or arbitrary prose. Bounded length/depth, finite results up to absolute value 10^15; display rounds to 12 significant digits.
- Arithmetic correction: `Check: 13 * 9 = 118.` recomputes the result rather than trusting the assertion.
- Unit conversion: explicit common units in `foundation/core/basic-qa.json`, same dimensions only; temperatures below absolute zero are rejected. This asset is versioned and checksum-verified with the other core foundation data.
- Passage location: binds one explicit affirmative subject/action/object/location statement. Conflicting, missing or negated matching statements withhold the location. Other passage questions return a clearly marked relevant quotation or insufficient-evidence response; a quote is not silently presented as an entailed answer.
- Writing: email, announcement, paragraph and bullet-list drafts **from supplied facts**. This is constrained template composition, not arbitrary creative writing. Summaries are extractive and bounded to the first three sentences.

Examples:

```text
Calculate 37 * (12 - 5)
Convert 2.75 kilometers to meters
Check: 13 * 9 = 118.
Passage: Neri stored the red cup inside the cabinet. Question: Where did Neri store the red cup?
Write an email using these facts: Our library opens Monday; Visitors should bring ID.
```

The native operators apply a reusable algorithm to fresh inputs. They are authored procedures; **they are not evidence that KENUXA taught itself those algorithms**. Separate existing learning tests show a simulated teacher teaching one bounded extraction method, reuse on a different subject, persistence across restart, and no duplicate teacher request. Existing mind tests demonstrate verified correction followed by transfer; teacher agreement alone does not approve the correction.

## Evaluation and evidence

Before the change, the isolated offline pipeline declined all five probed arithmetic, conversion, arithmetic-correction, passage, and supplied-fact email tasks. It also correctly withheld an unknown current-officeholder question. These probes diagnosed gaps; they are not a blind benchmark.

Run `npm run eval:qa` or `node bench/basic-qa.bench.mjs <seed>`. See `BASIC-QA-EVALUATION.json` for every question, answer, rubric, provenance and timing. Each run creates a new isolated node without credentials, web, peers or live teachers. Fresh numeric values and passage entities are generated from the recorded seed. The implementer knows the families and rubrics; this is **not an independent blind evaluation**. Limited string/content checks cannot establish general correctness.

Recorded seed 20261104:

| Category | Passing / total |
|---|---:|
| Arithmetic | 8 / 8 |
| Arithmetic correction | 8 / 8 |
| Method transfer to fresh conversion inputs | 8 / 8 |
| Explicit passage comprehension | 4 / 4 |
| Supplied-fact writing | 4 / 4 |
| Uncertainty / invalid input | 4 / 4 |
| Broader challenges | **0 / 6** |

The broader failures include sky color, Japan's capital, hexagon sides, a creative poem, Spanish translation, and a novel syllogism. They remain in the report. Abstention is appropriate when evidence is missing, but it counts as a **coverage failure**, not a successful answer to these questions. Broad challenges are reported separately and do not prevent running the supported-family regression gate.

Tests cover arithmetic transfer over 100 generated cases, malformed and injection-like expressions, physical/dimensional boundaries, subject/object binding, negation and conflicting passages, writing constraints, public/owner HTTP, cached simulated-teacher attribution and research disabled. Live teacher answer quality and cost are unmeasured. No key is created or needed for these checks.

## Performance attribution contract

`performance.mode` is `native-procedure`, `teacher-assisted`, `local-cache`, or `local-pipeline`. `teacherDerived` identifies detected teacher dependencies, including retained composition, research methods, and explicitly labeled source lessons. `newTeacherCall` records known direct calls/attempts separately from retained knowledge. `outcome` distinguishes answers, drafts, evidence-only results, insufficient information and limited fallbacks. Correctness is never reported as universally verified.

Historical provenance is incomplete. A local pipeline answer without an identified teacher dependency is **not proof of independent intelligence**. The `lineage` field explicitly states that historical dependency lineage is not completely audited. Teacher fixture tests establish attribution/control behavior, not the quality of any real provider.

## What still requires work

Broader basic QA needs richer licensed factual relations, reliable question decomposition and entailment, more executable verified methods, general language generation, multilingual coverage, freshness, and adversarial independent evaluation. Arbitrary new algorithms cannot be learned merely by caching teacher text. Fully autonomous general comprehension, perfect answers, and complete atoms/molecules/cells for all knowledge remain unproven. Adding labels or increasing graph counts would not establish them.
