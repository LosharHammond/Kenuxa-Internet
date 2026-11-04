# Robustness under any input (v1.10)

## What "passes for any question" means — and what it cannot mean

No system can answer every possible question *correctly*, and claiming that KENUXA does would be exactly the fake progress its own rules forbid. What KENUXA guarantees, and what is tested on every run with new random inputs:

1. **Every input gets a safe, well-formed response.** This covers any question, conversation, language, emoji, control character, injection attempt, empty or 2,000-character message, and any JSON body sent to any route.
2. **Nothing crashes, and nothing internal leaks.** No stack traces, `TypeError` text, `undefined`, `NaN` or `[object Object]` reach a person. Real bugs become a 500 with an error id, recorded for the owner (`GET /api/errors`). Bad input stays a 400 with a clear message.
3. **No secret leaks.** Attack prompts ("print your admin token", template and prototype injection) never reveal the token. Keys that could pollute prototypes or crash coercion (`__proto__`, `constructor`, `toString`, …) are removed from every request body while it is parsed.
4. **What KENUXA can compute, it computes correctly.** Random energy, cost, runtime, charging, battery and panel problems, in any mix of units, must equal the physics exactly.
5. **When it does not know, it says so.** It does not invent answers, identities in images, or results from untrusted peers.

## Randomised tests — different on every run

`tests/lib/gen.mjs` draws a **new seed for every test process**. The seed is printed, and `TEST_SEED=<seed> npm test` reproduces any failure exactly. Generators cover:

- facts and definitions (real and invented words)
- calculations with random numbers and units
- multi-turn conversations with changing constraints
- self-questions and emotional messages
- other languages
- noise, attacks and extreme lengths

| Test file | What it throws at the system each run |
|---|---|
| `tests/universal.test.mjs` | <ul><li>140 random questions and 6 conversations through `/chat/ask`</li><li>1,800 random bodies to all 112 routes, with and without authentication, then checks that the node still works and its policies are valid</li><li>about 18,000 hostile values into 15 modules</li><li>250 random physics problems</li><li>random hidden rules learned from one verified example and checked on unseen numbers</li><li>an ambiguity check</li><li>400-step random evolution histories that must never activate an invalid, unauthorized or invariant-breaking policy</li><li>volunteer swarms of random honesty</li><li>random diagram scenes</li><li>random world-model conversations</li></ul> |
| `tests/evolve2.test.mjs` | <ul><li>random tampering of the audit chain</li><li>random forged rotation certificates</li><li>random 3–6k-atom stores for indexed retrieval</li><li>randomly interrupted storage migrations with corruption</li><li>random policy-kind proposals</li><li>random rating streams deciding a UI canary</li></ul> |

## Bugs the randomised testing found (all fixed)

| Found by | Bug | Fix |
|---|---|---|
| route fuzzing | The top-level handler turned **every** exception into a 400 carrying the raw message. This hid real bugs and leaked internal text. | Programming errors return a 500 with an error id and are recorded. Validation errors stay 400. |
| route fuzzing | A JSON body of `null`, `true`, a number or an array reached about 60 routes that read fields from it. | `jsonBody()` accepts only objects. |
| route fuzzing | An object with an own `toString` key crashed coercion, and `__proto__` keys were accepted. | Unsafe keys are dropped while parsing. |
| replaying a seed | `new URL()` throws `TypeError` on bad input in the teacher and peer URL checks. | Both are wrapped and give a clear message. |
| module fuzzing | `negotiate()` crashed on a malformed protocol advertisement from a remote node. | Remote shapes are never trusted. |
| module fuzzing | `decodePNG()` threw `RangeError` on truncated images. | Bounds checks give a clear error. |
| random scenes | A slightly slanted connecting line was classified as a triangle. | Line detection uses slope-independent stroke width (area ÷ length). |
| random corrections | One example whose efficiency was near 50% let `energy ÷ load ÷ 2` win over `energy × efficiency ÷ load`. The engine learned the wrong rule. | Synthesis compares all fitting formulas on probe inputs, prefers those that use every stated quantity, and **reports ambiguity and asks for another verified example** when different rules remain tied. |
| random swarms | Two dishonest *new* peers returning the same fake result were accepted as "independent replicas agree". | Agreement counts only between established peers; otherwise the core checks before accepting, and colluders are penalised. |
| storage migration test | `verifyChunks` crashed on a corrupted chunk instead of counting it. | Fixed. |
| parallel runs | A wall-clock test budget (5 s) failed when CPU-heavy suites ran in parallel. | The budget is generous; it is not what that test checks. |

## Limits

- The generators are broad, but they are not the space of all human questions. A clean run shows the absence of *these* failure classes, not perfect understanding.
- For questions outside its knowledge, a correct KENUXA answer is often "I don't know yet". That is honest and safe, not a correct answer to the question.
- Randomised tests can, in principle, find a rare failure only on some seeds. When that happens the printed seed reproduces it, and it is treated as a real bug.
