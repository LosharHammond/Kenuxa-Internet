// Deep Comprehension layer: combines what the existing pipeline already computes (lexical atoms, senses and grammar
// from lib/atoms/language.mjs; intent and focus from lib/comprehension.mjs; tone readings from cognition/tone.mjs;
// conversation context) with three things it lacked: the UNDERLYING GOAL behind the literal question, the scope of
// negations (what the person says they do not have / cannot do), and an explicit list of what is missing.
// Several readings are kept when the evidence does not decide between them.

const has = (re, t) => re.test(t);
const GOALS = [
  // order matters: earlier patterns are more specific
  ['emotional', t => !/\?\s*$/.test(t) && /\b(i'?m|i am|i feel|feeling|so|finally|can'?t stop)\b.*\b(tired|sad|angry|happy|excited|worried|worrying|stressed|upset|frustrated|lonely|passed|won|did it|great|awful|terrible|scared)\b|!\s*$/.test(t) && !/\b(not charging|won'?t|isn'?t|doesn'?t|broken|stopped)\b/.test(t)],
  ['hypothetical', t => /\b(what (would|will|could|might) (happen|change)|what if|suppose|supposing|imagine|hypothetically)\b|\bif\b[^?]*\b(were|had)\b[^?]*\b(would|could)\b/.test(t)],
  ['calculation', t => /\b(how (much|many|long)|what is the (cost|total|runtime))\b/.test(t) && /\d/.test(t)],
  ['diagnosis', t => /\b(not|isn'?t|won'?t|doesn'?t|don'?t|stopped|keeps|refuses to|no longer)\s+(\w+\s+)?(charg\w*|work\w*|turn\w* on|start\w*|cool\w*|come on|power\w* on|beep\w*|hold\w*|run\w*)\b|\b(starts but|stops after|dies? (so )?fast|drains?)\b|\bwhy does my\b/.test(t)],
  ['possibility-under-constraint', t => /^(can|could|is it possible|may|would it be possible)\b/.test(t) && /\b(without|with no|no|even if i (don'?t|do not) have)\b/.test(t)],
  ['decision', t => /\b(what should i do|what do i do|what can i do|should i|which (one |option )?should i|which should i get|what('?s| is) the best (option|choice) for me|help me (decide|choose))\b/.test(t)],
  ['comparison', t => /\b(difference between|better than|versus|vs\.?|compared? (to|with)|pros and cons|which is (cheaper|better|faster|safer)|or)\b/.test(t) && /\b(difference|better|versus|vs|compare|pros|cheaper|which is)\b/.test(t)],
  ['procedure', t => /^(how (do|can|should) (i|we|you)|steps to|ways to|how to|guide to)\b|\bhow (do|can) i\b/.test(t)],
  ['explanation', t => /^(why|how come)\b/.test(t)],
  ['information', () => true],
];
export function goalOf(text) { const t = String(text || '').trim().toLowerCase(); for (const [g, f] of GOALS) if (f(t)) return g; return 'information'; }

// what the person says is absent or impossible — the object of "without", "no", "don't have", "can't"
export function negations(text) {
  const t = String(text || ''), out = [];
  for (const m of t.matchAll(/\b(?:without|with no)\s+(?:a |an |any |the |my )?([a-z][a-z' -]{1,40}?)(?=[?.!,]|$| and | or | to | for )/gi)) out.push(m[1].trim());
  for (const m of t.matchAll(/\b(?:i|we) (?:don'?t|do not|haven'?t|have not|never) (?:have|own|got)\s+(?:a |an |any |the |my )?([a-z][a-z' -]{1,30}?)(?=[?.!,]|$| and | or | to | for | but )/gi)) out.push(m[1].trim());
  for (const m of t.matchAll(/\bno\s+([a-z][a-z-]{2,25})(?=[?.!,]|$| and | or | to | for )/gi)) if (!/^(longer|one|more|idea|way|problem)$/i.test(m[1])) out.push(m[1].trim());
  return [...new Set(out.map(x => x.toLowerCase()))];
}

const UNDERLYING = {
  'possibility-under-constraint': (t, neg) => `find a realistic way to achieve it despite having no ${neg[0] || 'resource that is normally needed'}`,
  procedure: () => 'a sequence of steps they can follow', decision: () => 'a recommendation that fits their own situation and constraints',
  explanation: () => 'understand the cause or mechanism', diagnosis: () => 'find out what is wrong and how to fix it safely',
  hypothetical: () => 'explore consequences of a premise that is not (necessarily) true', calculation: () => 'a number computed from the values they gave',
  comparison: () => 'the differences that matter for choosing', information: () => 'a fact or definition', emotional: () => 'to be heard; a human response, not a lookup',
};

export function deepComprehend(text, { understanding = null, interpretation = null, tone = null, world = null, context = null } = {}) {
  const goal = goalOf(text), neg = negations(text);
  const literal = understanding?.goal?.statement || null;
  const missing = [...(world?.unknowns || [])];
  if (goal === 'decision' && !world?.events?.length && !Object.keys(context?.situation || {}).length) missing.push('your situation and constraints (budget, time, what you already have)');
  return {
    literal: { intent: understanding?.intent?.type || null, statement: literal, answerType: understanding?.answerType || null },
    underlying: { goal, statement: UNDERLYING[goal](text, neg) },
    differs: !!literal && goal !== 'information' && !String(literal).toLowerCase().includes(UNDERLYING[goal](text, neg).slice(0, 12).toLowerCase()),
    hypothetical: goal === 'hypothetical',
    negated: neg,
    entities: (interpretation?.clauses || []).flatMap(c => Object.values(c.semantics?.roles || {}).map(r => r?.head).filter(Boolean)).slice(0, 12),
    ambiguities: (interpretation?.ambiguities || []).map(a => a.word).slice(0, 6),
    references: (interpretation?.coreference || []).filter(c => c.antecedent).map(c => `${c.pronoun} → ${c.antecedent}`),
    pragmatics: tone?.applies ? tone.readings?.slice(0, 3).map(r => ({ reading: r.reading, weight: r.weight })) : null,
    context: context ? { kind: context.kind, topic: context.topic?.focus || null } : null,
    missing,
  };
}
