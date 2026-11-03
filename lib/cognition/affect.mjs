// Emotional-context model. KENUXA does not feel emotions and never claims to know how someone feels:
// it recognises wording that is commonly associated with an emotion, weighs it (negation, intensity,
// repetition, conversation history) and adapts its tone. Emotions are concept atoms (concept:en:frustration …).
const CUES = {
  excitement: [/\b(finally|at last) (finished|done|did it|launched|passed|got)\b/, /\bi did it\b/, /\b(so|really|super) (excited|happy|thrilled)\b/, /\bcan'?t wait\b/, /\byay\b|\bwoo+hoo\b/, /\bgreat news\b/, /!{2,}/],
  happiness: [/\b(happy|glad|delighted|joy(ful)?|pleased)\b/, /\bfeel(ing)? (good|great)\b/],
  gratitude: [/\b(thank(s| you)|grateful|appreciate)\b/],
  frustration: [/\bnothing (works|is working)\b/, /\bfor (hours|days|ages)\b/, /\b(still|keeps?) (not working|failing|crashing|breaking)\b/, /\b(frustrat(ed|ing)|annoy(ed|ing)|fed up|sick of|ugh+)\b/, /\bagain and again\b/, /\bwhy (won'?t|doesn'?t|isn'?t) (it|this)\b/],
  sadness: [/\b(sad|unhappy|heartbroken|miserable|down|depressed|grieving)\b/, /\b(i lost|passed away|broke up)\b/],
  fear: [/\b(scared|afraid|frightened|terrified|worried|anxious|nervous|panick(ed|ing))\b/],
  confusion: [/\b(confus(ed|ing)|don'?t understand|doesn'?t make sense|makes no sense|lost me|what do you mean)\b/],
  curiosity: [/\b(curious|i wonder|wondering|fascinat(ed|ing)|interesting)\b/],
  uncertainty: [/\b(not sure|unsure|no idea|don'?t know (if|whether|what))\b/],
  loneliness: [/\b(lonely|alone|no one to talk|nobody (cares|to talk)|no friends|isolated)\b/],
  disappointment: [/\b(disappoint(ed|ing)|let down|expected better|not what i (wanted|expected))\b/],
};
const CRISIS = /\b(kill (myself|me)|end my life|suicid(e|al)|want to die|self[- ]harm|hurt myself)\b/i;
const NEG = /\b(not|never|no longer|isn'?t|wasn'?t|am not|i'm not)\s+(\w+\s+)?$/;
export const EMOTIONS = Object.keys(CUES);

export function detectAffect(text, { history = [] } = {}) {
  const t = String(text || '').toLowerCase(), signals = [];
  for (const [emotion, res] of Object.entries(CUES)) for (const re of res) { const m = t.match(re); if (!m) continue; const before = t.slice(0, m.index); if (NEG.test(before.slice(-25))) continue; signals.push({ emotion, cue: m[0].slice(0, 40), weight: /\b(so|really|very|super|extremely)\b/.test(t) ? 1.3 : 1 }); }
  // Repeated frustration across turns raises the weight (the conversation history is evidence too).
  const earlier = history.slice(0, 3).map(h => String(h.question || '').toLowerCase());
  for (const s of signals) if (s.emotion === 'frustration' && earlier.some(q => CUES.frustration.some(re => re.test(q)))) s.weight += 0.4;
  const totals = {}; for (const s of signals) totals[s.emotion] = (totals[s.emotion] || 0) + s.weight;
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]), crisis = CRISIS.test(t);
  const primary = crisis ? 'distress' : ranked[0]?.[0] || null;
  return { primary, confidence: crisis ? 0.8 : primary ? Math.min(0.8, 0.35 + 0.2 * ranked[0][1]) : 0, signals, crisis, alternatives: ranked.slice(1, 3).map(r => r[0]), basis: 'wording only — KENUXA infers, it does not know how you feel', concept: primary && primary !== 'distress' ? `concept:en:${primary}` : null };
}

// Tone adaptation: a short, honest acknowledgement placed before the substance. No claims of feeling.
export function acknowledgement(a, { question = false } = {}) {
  if (!a?.primary || a.confidence < 0.5) return null;
  if (a.crisis) return 'It sounds like you may be going through something really painful. You deserve support from a person right now — please reach out to someone you trust or your local emergency services. I can stay here and talk with you too.';
  return ({
    excitement: question ? 'Congratulations — that sounds like real progress!' : 'Congratulations — that’s a real milestone!',
    happiness: 'That’s good to hear.',
    gratitude: 'You’re welcome.',
    frustration: 'Spending that long on something that won’t work is draining — let’s narrow it down step by step.',
    sadness: 'I’m sorry you’re going through that.',
    fear: 'That sounds worrying. Let’s look at it calmly, one piece at a time.',
    confusion: 'Let me make this clearer.',
    disappointment: 'That’s disappointing — let’s see what can still be done.',
    loneliness: 'I’m glad you reached out. I’m an AI, so I can’t replace the people in your life, but I’m happy to talk.',
    curiosity: null, uncertainty: null,
  })[a.primary] || null;
}
export function statementReply(a) {
  if (!a?.primary) return null;
  return ({
    excitement: 'Congratulations — that’s a real milestone! What was the project, and what are you proudest of?',
    happiness: 'That’s good to hear! What made it a good day?',
    gratitude: 'You’re welcome — I’m glad it helped.',
    frustration: 'That sounds draining. Tell me what you’re trying to do, what you expected and what happens instead (any error message helps), and we’ll narrow it down.',
    sadness: 'I’m sorry you’re going through that. Do you want to talk about what happened?',
    fear: 'That sounds worrying. What’s on your mind? We can look at it calmly together.',
    loneliness: 'I’m glad you reached out. I’m an AI, so I can’t replace the people in your life, but I’m happy to talk. What would you like to talk about?',
    disappointment: 'That’s disappointing. What happened?',
    confusion: 'Let’s untangle it — which part is unclear?',
  })[a.primary] || null;
}
