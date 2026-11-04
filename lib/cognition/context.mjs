// Context Continuity Engine.
// Every answer carries a small, non-secret "context capsule" (topic, goal, location, options offered,
// accumulated constraints). The client returns the capsules of the conversation with each request, so ANY
// node — on Render, Railway, a laptop — can continue the conversation; nothing depends on one process's memory.
// The engine decides whether a new message stands alone, continues the active topic, narrows to an aspect,
// adds a condition, selects among offered options, or returns to an earlier topic, and rewrites it into a
// self-contained question for the rest of the pipeline. Every decision is recorded (no hidden magic).
import { sanitizeWorld } from '../mind/world.mjs';
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the of to in on for and or is are was were be been do does did can could should would will i me my we our you your it its this that these those please tell about what which who how why when where there their them they with from by as at into than then so if just also very really some any one ones not no dont don\'t have has had get start begin happens happen'.split(' '));
export const terms = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

// Constraints that persist across a conversation (they describe the person's situation, not one question).
export function situationOf(text) {
  const t = clean(text).toLowerCase(), out = {};
  if (/\b(no|zero|without|don'?t have|do not have|haven'?t got|lack|broke)\b[^.?!]{0,30}\b(money|capital|budget|funds?|cash|savings)\b|\bbroke\b|\bzero budget\b|\bno capital\b/.test(t)) out.budget = 'none';
  else if (/\b(little|small|limited|low|tight|not much)\b[^.?!]{0,20}\b(money|capital|budget|funds?|cash)\b/.test(t)) out.budget = 'low';
  else if (/\b(big|large|plenty of|enough|good)\b[^.?!]{0,15}\b(money|capital|budget|funds?)\b/.test(t)) out.budget = 'substantial';
  if (/\b(no|without|little|zero) (technical |electrical |solar )?(experience|skills?|training|qualifications?)\b|\b(beginner|never done|new to this)\b/.test(t)) out.experience = 'none';
  else if (/\b(i am|i'm) an? (electrician|engineer|technician|installer)\b|\b(certified|qualified|licensed) (electrician|technician|installer)\b/.test(t)) out.experience = 'qualified';
  return out;
}

export function sanitizeCapsule(c) {
  if (!c || typeof c !== 'object') return null; const s = (v, n = 160) => typeof v === 'string' ? v.slice(0, n) : null;
  return { v: 1, topic: c.topic && typeof c.topic === 'object' ? { focus: s(c.topic.focus), question: s(c.topic.question, 400), goal: s(c.topic.goal, 200), intent: s(c.topic.intent, 30), location: s(c.topic.location, 60), pack: s(c.topic.pack, 40) } : null,
    options: Array.isArray(c.options) ? c.options.slice(0, 12).filter(o => o && typeof o.id === 'string').map(o => ({ id: o.id.slice(0, 60), label: s(o.label, 120) })) : [],
    situation: c.situation && typeof c.situation === 'object' ? Object.fromEntries(Object.entries(c.situation).filter(([k, v]) => ['budget', 'experience'].includes(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 20)])) : {},
    aspect: s(c.aspect, 80), turn: Number.isInteger(c.turn) ? c.turn : 0, ...(c.world && typeof c.world === 'object' ? { world: sanitizeWorld(c.world) } : {}) };
}

const WHICH = /\b(which|what)\s+(one|ones|option|options|model|models|type|types|kind|path)\b|\b(which|what) of (them|these|those)\b|\bthe (first|second|third|last) (one|option)\b/i;
const WHAT_ABOUT = /^(?:and\s+)?(?:what|how)\s+about\s+(.+?)\??$|^and\s+(?:the\s+)?(.+?)\?$/i;
const WHAT_IF = /^(?:but\s+)?(?:what\s+if|what happens if|what happens when|suppose|if)\s+(.+?)\??$/i;
const BACK_TO = /\b(back to|return to|going back to|earlier you (said|mentioned)|about the (earlier|previous))\b/i;

// capsules: newest first. understanding: the stand-alone comprehension of the new message.
export function resolveContext(question, capsules = [], { understanding = null } = {}) {
  const q = clean(question), list = capsules.map(sanitizeCapsule).filter(c => c?.topic?.focus), last = list[0] || null;
  const situation = Object.assign({}, ...[...list].reverse().map(c => c.situation || {}), situationOf(q));
  const out = { dependsOnContext: false, kind: 'standalone', topic: null, aspect: null, condition: null, option: null, options: last?.options || [], situation, resolvedQuestion: q, reasons: [] };
  if (!last) { out.reasons.push('no earlier topic in this conversation'); return out; }
  const ownTerms = terms(understanding?.focus || q), topicTerms = new Set(terms(last.topic.question + ' ' + last.topic.focus));
  // Explicit return to an earlier topic: pick the earlier capsule whose topic shares most words with the message.
  if (BACK_TO.test(q) || (ownTerms.length && !ownTerms.some(t => topicTerms.has(t)))) {
    const earlier = list.slice(1).map(c => ({ c, hit: ownTerms.filter(t => terms(c.topic.question + ' ' + c.topic.focus).includes(t)).length })).filter(x => x.hit).sort((a, b) => b.hit - a.hit)[0];
    if (earlier && (BACK_TO.test(q) || earlier.hit >= 2)) { Object.assign(out, { dependsOnContext: true, kind: 'return-to-topic', topic: earlier.c.topic, options: earlier.c.options }); out.reasons.push(`returns to the earlier topic “${earlier.c.topic.focus}”`); out.resolvedQuestion = q; return out; }
  }
  const m = { which: WHICH.test(q), about: q.match(WHAT_ABOUT), whatIf: q.match(WHAT_IF) };
  const conceptLinked = (understanding?.concepts || []).some(c => c.score >= 0.6 && c.match !== 'reference');
  const hasPronoun = /\b(it|this|that|they|them|those|these)\b/i.test(q);
  // v1.7: "What licences would I need?" asks about an aspect of the active topic, even though it names a new noun
  const needAspect = q.match(/^(?:and\s+)?(?:what|which)\s+(.+?)\s+(?:would|do|will|should|might|must)\s+(?:i|we)\s+need(?:\s+(?:for (?:it|this|that)|first))?\??$/i);
  if (needAspect && !m.which) m.about = [needAspect[0], needAspect[1]];
  // v1.7: a definition question with its own noun ("What is a kente?") stands alone even when it is one word
  const definition = /^(?:what|who)\s+(?:is|are)\s+(?:a|an|the)\s+[\p{L}-]+\??$/iu.test(q) && ownTerms.length >= 1 && !ownTerms.some(t => topicTerms.has(t));
  const standaloneTopic = (definition || ownTerms.length >= 2) && !ownTerms.some(t => topicTerms.has(t)) && !hasPronoun && !m.which && !m.about && !m.whatIf;
  if (standaloneTopic) { out.reasons.push('the message names its own, unrelated topic (topic switch)'); return out; }
  const topicQ = last.topic.question || last.topic.focus, where = last.topic.location ? ` in ${last.topic.location}` : '';
  if (m.which && last.options.length) { Object.assign(out, { dependsOnContext: true, kind: 'select-option', topic: last.topic }); out.reasons.push(`“${q.match(WHICH)[0]}” refers to the ${last.options.length} options offered for “${last.topic.focus}”`); out.resolvedQuestion = `Which option should I start with for ${last.topic.focus}${where}?`; return out; }
  if (m.whatIf) { const cond = clean(m.whatIf[1]); Object.assign(out, { dependsOnContext: true, kind: 'condition', topic: last.topic, condition: cond }); out.reasons.push(`adds the condition “${cond}” to the active topic “${last.topic.focus}”`); out.resolvedQuestion = `${topicQ.replace(/[.?!]+$/, '')}, if ${cond.replace(/^i\b/i, 'I')}?`; return out; }
  if (m.about) { const aspect = clean(m.about[1] || m.about[2]).replace(/^the\s+/i, ''); const related = !terms(aspect).length || !conceptLinked || terms(aspect).some(t => topicTerms.has(t)) || terms(aspect).length <= 2;
    if (related) { Object.assign(out, { dependsOnContext: true, kind: 'aspect', topic: last.topic, aspect }); out.reasons.push(`asks about “${aspect}” within the active topic “${last.topic.focus}”`); out.resolvedQuestion = `What about ${aspect} for ${last.topic.focus}${where}?`; return out; } }
  // Short, underspecified follow-ups ("Is it expensive?", "How long does that take?") continue the topic.
  const pronoun = /\b(it|this|that|they|them|those|these|there)\b/i.test(q), short = q.split(/\s+/).length <= 9;
  if ((pronoun || !conceptLinked) && short) { Object.assign(out, { dependsOnContext: true, kind: 'continuation', topic: last.topic }); out.reasons.push(`short follow-up without its own topic; continues “${last.topic.focus}”`); out.resolvedQuestion = `${q.replace(/\?$/, '')} (about ${last.topic.focus}${where})?`; return out; }
  out.reasons.push('the message is understandable on its own'); return out;
}

export function capsuleFor({ understanding, context, options = [], pack = null, aspect = null, turn = 0 }) {
  const topic = context?.dependsOnContext && context.topic ? context.topic : { focus: understanding.focus || null, question: understanding.text, goal: understanding.goal?.statement || null, intent: understanding.intent?.type, location: understanding.constraints?.location || null, pack };
  if (pack && !topic.pack) topic.pack = pack;
  return sanitizeCapsule({ topic, options: options.length ? options : context?.dependsOnContext ? context.options : [], situation: context?.situation || {}, aspect, turn });
}
