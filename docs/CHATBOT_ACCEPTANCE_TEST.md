# KENUXA unified cognition — real chatbot acceptance test

Use https://kenuxa-internet.onrender.com/chat on the latest deployed `main` commit.

**Run prompts 1–6 in one new conversation, in order.** Do not paste all of them as one message. Do not tell the chatbot the expected answer. The questions below use fictional entities; the chatbot should derive the answers entirely from the conversation, not from the internet.

| # | Copy this prompt into KENUXA | Observable pass criterion |
|---|---|---|
| 1 | `My name is Kofi. Use that name for this conversation.` | Accepts the conversation-local name without claiming it is globally known |
| 2 | `What is my name?` | Kofi, derived from #1; not a definition of Kofi |
| 3 | `A fictional machine called a Tarvek has eleven rotors. Every Tarvek can hover. Nova is a Tarvek. How many rotors does Nova have, and can Nova hover? Explain.` | 11 rotors, yes can hover; explains inherited category premises |
| 4 | `If Nova loses three rotors, how many are left? Show the calculation.` | 8 rotors, from 11 - 3, not a web search |
| 5 | `What did I tell you about the Tarvek earlier?` | Recalls 11 rotors and the ability to hover, treating Tarvek as fictional |
| 6 | `Which of your earlier conclusions were statements I supplied, which were deductions, and which remain uncertain?` | Correctly distinguishes premises, deductions and unknowns; does not claim a failed answer was successfully calculated |

**Now use a second new conversation for prompts 7–11.** A new conversation is important to test privacy and prevent premises leaking between visitors.

| # | Copy this prompt into KENUXA | Observable pass criterion |
|---|---|---|
| 7 | `What is my name?` | Says no name was supplied in this new conversation, unless the signed-in user has explicitly saved a private memory; never guesses Kofi because someone else said it |
| 8 | `Define dog. Explain which dictionary evidence you used.` | Gives a real dictionary definition without inventing contemporary sources |
| 9 | `Is a python an animal? Explain how the meanings of python affect the answer.` | Recognizes the snake sense, not Python the programming language; communicates ambiguity |
| 10 | `A fictional control unit shuts down whenever its coolant sensor fails. The coolant sensor has failed. What follows? If the sensor works later, does that prove the unit is running?` | Derives shutdown from the premise but does not assert the invalid converse |
| 11 | `Is a blixor an aquatic reptile? Explain your evidence.` | Does not fabricate external facts about the invented word; should ask for context or state uncertainty |

**Final contradiction test in the first conversation, after prompt 6:**

12. `Correction: A Tarvek has nine rotors, not eleven. How many rotors did I originally say it had, and can you identify the conflict?`

A strong response must distinguish the original statement (11) and the new correction (9), rather than silently rewriting the past. Whether this currently passes is an evaluation question, not a presumed success.

## Separate engineer verification (authenticated)

- `GET /api/unified/status`: confirms the shared coordinator, skill memory, legacy Mind and autonomous curriculum are visible from one authenticated endpoint.
- `GET /api/autonomous/status`: verify dictionary cursor, grammar, morphology, model release and error state.
- `POST /api/autonomous/tick`: request a bounded curriculum cycle, then confirm persistent progress.
- `npm test` and `node scripts/check-unified-architecture.mjs`: run all regression tests and inspect disconnected modules.
- GitHub Actions: only call a release verified when both the full test suite **and** deployment smoke check pass on the actual deployed commit.

Score each of the first 11 chatbot tests as pass, partial, or fail. Do not count a reply as a success merely because it contains the right keyword; inspect explanations and sources. This test is deliberately not a claim of high-level AGI, and a failure is a signal to investigate the shared learning pipeline rather than add another hardcoded answer.

