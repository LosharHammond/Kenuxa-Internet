// Comprehension → Construction.
// KENUXA first UNDERSTANDS a message (speech act, intent, underlying goal, focus, concepts linked to meaning
// atoms, constraints, references, expected answer shape), then CONSTRUCTS an answer from that understanding
// using only atom meaning frames, approved claims and captured evidence. Nothing here invents facts.
import { features } from './model.mjs';
import { conceptLabel } from './meaning.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const STOPWORDS = new Set('a an the of to in on for and or is are was were be been do does did can could should would will i me my we our you your it its this that these those please tell about what which who whom how why when where there their them they with from by as at into than then so if just also very really some any'.split(' '));

const INTENTS = [
  ['elaborate', 'Go deeper', /\b(tell me more|more about|go on|continue|elaborate|expand on|go deeper)\b/i, 'explanation'],
  ['greeting', 'Greeting / conversation', /^(hi|hello|hey|good (morning|afternoon|evening)|akwaaba|thanks|thank you)\b/i, 'conversation'],
  ['compare', 'Compare options', /\b(compare|comparison|difference(s)? between|differ|versus|vs\.?|better than|which is better|pros and cons)\b/i, 'comparison'],
  ['plan', 'Achieve a goal', /\b(how (do|can|should|would) (i|we|one)|help me|i want to|i'd like to|i need to|steps to|guide to|plan (to|for))\b.*\b(start|build|create|launch|open|become|grow|make|get|set up|run|register|establish|earn|learn|win|scale|found)\b/i, 'plan'],
  ['procedure', 'Learn how to do something', /\b(how to|how do (i|you|we)|how can (i|you|we)|steps|step-by-step|guide|procedure|instructions|way to|tutorial)\b/i, 'steps'],
  ['cause', 'Understand causes', /\b(why|what causes|reason(s)? (for|why)|cause of|how come)\b/i, 'reasons'],
  ['person', 'Identify a person', /^(who (is|was|are|were|invented|founded|created|discovered|wrote|built))\b/i, 'person'],
  ['place', 'Locate something', /^(where)\b|\b(location of|located)\b/i, 'place'],
  ['time', 'Find a time', /^(when)\b|\b(what (year|date|time)|how long ago)\b/i, 'time'],
  ['quantity', 'Get a number', /\b(how (many|much|far|big|old|long|tall)|what percentage|number of|amount of|cost of|price of)\b/i, 'quantity'],
  ['list', 'Enumerate', /\b(list|examples? of|types of|kinds of|name (some|a few)|what are some|categories of)\b/i, 'list'],
  ['recommend', 'Get a recommendation', /\b(should i|recommend|best (way|option|choice)|which (one|option)|advice|suggest|what would you)\b/i, 'recommendation'],
  ['explain', 'Understand how it works', /\b(explain|describe|tell me about|how does .+ work|how do .+ work|what happens|overview of)\b/i, 'explanation'],
  ['define', 'Understand what something is', /^(what('s| is| are| was| were)|define|meaning of|what does .+ mean)\b|\b(definition of|stand for)\b/i, 'definition'],
  ['verify', 'Confirm a claim', /^(is|are|does|do|can|was|were|will|has|have|did)\b/i, 'yes-no'],
  ['task', 'Get something made', /^(create|make|generate|write|design|draft|build|compose|plan|outline)\b/i, 'artifact'],
];
const PREFIXES = /^(please\s+)?(can you\s+|could you\s+)?(tell me\s+)?(what('s| is| are| was| were)|who (is|was|are|were)|where (is|are|was|were|can i find)|when (is|was|did|does)|why (is|are|do|does|did)|how (do|does|did|can|should|would) (i|we|you|one)?|how to|how (many|much)|explain|describe|define|tell me about|compare|list|give me|help me( to)?|i want to|i need to|i'd like to|should i|is|are|does|do|can)\s+/i;

export function constraintsOf(text) {
  const c = {};
  const loc = text.match(/\b(?:in|within|across|around|near|for)\s+((?:the\s+)?[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})/); if (loc && !/^(I|English)$/.test(loc[1])) c.location = loc[1].replace(/^the\s+/i, '');
  const time = text.match(/\b(in|by|before|after|during|since)\s+(\d{4}|today|tomorrow|next (?:year|month|week)|this (?:year|month|week))\b|\b(\d+\s+(?:days?|weeks?|months?|years?))\b/i); if (time) c.time = clean(time[0]);
  const money = text.match(/((?:\$|USD|GHS|GH₵|₵|€|£|NGN|₦)\s?\d[\d,.]*\s?(?:k|m|million|thousand)?|\d[\d,.]*\s?(?:k|m|million|thousand)?\s?(?:dollars|cedis?|ghs|usd|euros?|pounds|naira))/i); if (money) c.budget = clean(money[1]);
  const aud = text.match(/\b(?:for|as)\s+(an?\s+)?(kids|children|beginners?|students?|my team|businesses|a business|seniors|women|men|farmers|developers|teachers|parents|non-experts?|experts?)\b/i); if (aud) c.audience = aud[2].toLowerCase();
  const fmt = text.match(/\b(in\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(steps|sentences|words|points|bullets|paragraphs))|\b(briefly|in detail|step by step|in simple terms|simply|like i'?m five|eli5|summary|summarize)\b/i); if (fmt) c.format = clean(fmt[0]).toLowerCase();
  const tone = text.match(/\b(formal|casual|friendly|professional|funny|serious)\b/i); if (tone) c.tone = tone[1].toLowerCase();
  return c;
}
function stripConstraints(s, c) {
  let t = s;
  if (c.location) t = t.replace(new RegExp(`\\b(in|within|across|around|near|for)\\s+(the\\s+)?${c.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '');
  for (const k of ['time', 'budget', 'format']) if (c[k]) t = t.replace(c[k], '');
  if (c.audience) t = t.replace(new RegExp(`\\b(for|as)\\s+(an?\\s+)?${c.audience}\\b`, 'i'), '');
  return clean(t.replace(/\bwith\s*$/i, ''));
}
const trimEdges = s => { const w = clean(clean(s).replace(/[?!.,;:]+$/, '')).split(' ').filter(Boolean); while (w.length && STOPWORDS.has(w[0].toLowerCase())) w.shift(); while (w.length && STOPWORDS.has(w[w.length - 1].toLowerCase())) w.pop(); return w.join(' '); };

// Link the message to meaning atoms (exact label, alias, tag, partial), best first.
export function linkConcepts(text, atoms) {
  const terms = new Set(features(text)), lower = ' ' + text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ') + ' ', out = [];
  for (const a of atoms) {
    if (a.status !== 'approved') continue;
    const label = (a.dna?.meaning?.frame?.label || conceptLabel(a.title)).toLowerCase(), lf = features(label);
    if (!lf.length) continue;
    let score = 0, match = null;
    if (lower.includes(' ' + label + ' ')) { score = 1; match = 'exact'; }
    else if ((a.questions || []).some(q => clean(q).toLowerCase().replace(/[?!.]+$/, '') === text.toLowerCase().replace(/[?!.]+$/, '').trim())) { score = 0.98; match = 'alias'; }
    else { const hit = lf.filter(t => terms.has(t) || terms.has(t.replace(/s$/, '')) || terms.has(t + 's')).length / lf.length; if (hit >= 0.5) { score = 0.55 + 0.4 * hit; match = 'partial'; } }
    const val = a.dna?.meaning?.frame?.value?.toLowerCase();
    if (!match && val && lower.includes(' ' + val + ' ')) { score = 0.85; match = 'value'; }
    if (!match) { const tag = (a.tags || []).find(t => terms.has(t)); if (tag) { score = 0.5; match = 'tag'; } }
    if (match) out.push({ phrase: label, atomId: a.id, atomTitle: a.title, kind: a.dna?.meaning?.frame?.kind, match, score: Math.round(score * 100) / 100 });
  }
  out.sort((x, y) => y.score - x.score || y.phrase.length - x.phrase.length);
  // Prefer the most specific atoms; drop atoms whose label is contained in a better exact match.
  const kept = []; for (const c of out) if (!kept.some(k => k.match === 'exact' && c.match !== 'exact' && k.phrase.includes(c.phrase))) kept.push(c);
  return kept.slice(0, 8);
}

export function comprehend(message, { atoms = [], memory = [] } = {}) {
  const text = clean(message), lower = text.toLowerCase();
  const scored = INTENTS.map(([type, label, re, answerType], i) => ({ type, label, answerType, hit: re.test(text), order: i })).filter(x => x.hit);
  const primary = scored[0] || { type: /\?$/.test(text) ? 'explain' : 'statement', label: /\?$/.test(text) ? 'Understand something' : 'Share information', answerType: /\?$/.test(text) ? 'explanation' : 'acknowledgement' };
  const speechAct = primary.type === 'greeting' ? 'greeting' : /\?$/.test(text) || INTENTS.slice(2, 16).some(([, , re]) => re.test(text)) ? 'question' : /^(create|make|generate|write|design|draft|build|list|give|show|plan|compare|explain|describe|tell)\b/i.test(text) ? 'command' : 'statement';
  const constraints = constraintsOf(text);
  // Focus: what the message is about, once the intent wording and constraints are removed.
  let core = stripConstraints(text, constraints), action = null, article = '';
  const verb = core.match(/\b(?:how (?:do|can|should|would) (?:i|we|one)|help me(?: to)?|i want to|i need to|i'd like to|steps to|guide to|how to)\s+([a-z]+(?:\s+up)?)\s+(.*)$/i);
  if (verb && ['plan', 'procedure'].includes(primary.type)) { action = verb[1].toLowerCase(); core = verb[2]; article = (core.match(/^(a|an|the)\s/i) || [''])[0].toLowerCase(); }
  else core = core.replace(PREFIXES, '').replace(/\b(work|mean|happen)\??$/i, '').replace(/^(tell me\s+)?(more|deeper)(\s+about)?\s*/i, '').replace(/^(some\s+)?(examples?|types|kinds|categories|a list|list) of\s+/i, '');
  let focus = trimEdges(core.replace(/^(the|a|an)\s+/i, ''));
  // References: resolve "it / this / they" to what the conversation was just about.
  const references = [];
  if (/\b(it|this|that|they|them|its|their|those|these)\b/i.test(lower) && (!focus || features(focus).length <= 1)) {
    const prev = memory.find(m => m.entityIds?.length), prevAtom = prev && atoms.find(a => a.id === prev.entityIds[0]);
    if (prevAtom) { const label = prevAtom.dna?.meaning?.frame?.label || conceptLabel(prevAtom.title); references.push({ pronoun: (lower.match(/\b(it|this|that|they|them|its|their|those|these)\b/) || [])[0], to: label, atomId: prevAtom.id }); focus = focus && !/^(it|this|that|they|them)$/i.test(focus) ? `${focus} (${label})` : label; }
  }
  const linkText = [focus, ...references.map(r => r.to)].join(' ') || text;
  let concepts = linkConcepts(linkText, atoms);
  if (!concepts.length && focus) concepts = linkConcepts(text, atoms);
  for (const r of references) if (!concepts.some(c => c.atomId === r.atomId)) concepts.unshift({ phrase: r.to, atomId: r.atomId, match: 'reference', score: 0.9 });
  const covered = new Set(concepts.flatMap(c => features(c.phrase)));
  const unknown = features(focus).filter(t => !covered.has(t) && !covered.has(t.replace(/s$/, '')) && t.length > 2);
  // Comparison sides.
  let sides = null;
  if (primary.type === 'compare') { const m = focus.match(/^(?:between\s+)?(.+?)\s+(?:and|vs\.?|versus|or|with|to)\s+(.+)$/i); if (m) sides = [trimEdges(m[1]), trimEdges(m[2])]; }
  // Underlying goal: why the person is asking.
  const F = focus || 'this', goals = {
    greeting: ['connect and see what KENUXA can do', ['a friendly reply', 'a clear next step']],
    define: [`understand what ${F} is`, ['a precise definition', 'its category', 'what makes it distinct']],
    elaborate: [`go deeper into ${F}`, ['more detail', 'connections to related ideas']],
    explain: [`understand how ${F} works and why it matters`, ['the mechanism', 'key parts', 'consequences']],
    procedure: [`be able to ${action ? action + ' ' + article : ''}${F} yourself`, ['ordered steps', 'what is needed', 'common pitfalls']],
    plan: [`${action ? action + ' ' + article : 'achieve '}${F}${constraints.location ? ' in ' + constraints.location : ''}`, ['a staged plan', 'resources and requirements', 'risks', 'a first action you can take today']],
    compare: [`decide between ${sides ? sides.join(' and ') : F}`, ['what each is', 'key differences', 'when each fits']],
    cause: [`know why ${F}`, ['main causes', 'how they connect']],
    person: [/^who (is|was|are|were)\b/i.test(text) ? `find out who ${F} ${text.match(/^who (is|was|are|were)/i)[1].toLowerCase()}` : `find out who ${F}`, ['who they are', 'why they matter']],
    place: [`know where ${F} is`, ['the location', 'context']],
    time: [`know when ${F}`, ['the date or period', 'context']],
    quantity: [`get a reliable figure for ${F}`, ['a number', 'its source', 'its date']],
    list: [`see the main kinds or examples of ${F}`, ['a clear list', 'one line on each']],
    recommend: [`make a good decision about ${F}`, ['options', 'criteria', 'a reasoned suggestion']],
    verify: [`confirm whether ${trimEdges(text.replace(/^(is|are|does|do|can|was|were|will|has|have|did)\s+/i, ''))}`, ['a yes/no answer', 'the evidence for it']],
    task: [`receive a ready-to-use ${F}`, ['a usable draft', 'room to refine']],
    statement: ['share information with KENUXA', ['acknowledgement', 'what KENUXA can do with it']],
  };
  const [goal, successCriteria] = goals[primary.type] || goals.explain;
  const frame = { who: references.length ? 'you (continuing the conversation)' : /\b(i|my|me|we|our)\b/i.test(lower) ? 'you, personally' : 'general', what: focus || null, why: goal, how: primary.answerType, where: constraints.location || null, when: constraints.time || null };
  const ambiguity = [];
  if (!focus && primary.type !== 'greeting') ambiguity.push('The topic of the question is unclear.');
  if (concepts.length > 1 && concepts[0].score === concepts[1].score && concepts[0].match !== 'exact') ambiguity.push(`“${focus}” could refer to ${concepts.slice(0, 2).map(c => c.phrase).join(' or ')}.`);
  if (primary.type === 'compare' && !sides) ambiguity.push('Two things to compare were not clearly identified.');
  const conceptCoverage = focus ? Math.min(1, features(focus).filter(t => covered.has(t) || covered.has(t.replace(/s$/, ''))).length / Math.max(1, features(focus).length)) : (primary.type === 'greeting' ? 1 : 0);
  const understood = Math.round(Math.min(1, (scored.length ? 0.35 : 0.15) + (focus || primary.type === 'greeting' ? 0.2 : 0) + conceptCoverage * 0.3 + (ambiguity.length ? 0 : 0.15)) * 100) / 100;
  const cons = Object.entries(constraints).map(([k, v]) => `${k}: ${v}`);
  const summary = primary.type === 'greeting' ? 'You are greeting KENUXA.' : `You want to ${goal}. You are asking for ${({ definition: 'a definition', explanation: 'an explanation', steps: 'step-by-step guidance', plan: 'a plan', comparison: 'a comparison', reasons: 'reasons', person: 'a person', place: 'a place', time: 'a time', quantity: 'a figure', list: 'a list', recommendation: 'a recommendation', 'yes-no': 'a yes/no answer', artifact: 'something to be made', acknowledgement: 'acknowledgement' })[primary.answerType] || 'an answer'}${focus ? ` ${({ definition: 'of', explanation: 'of', plan: 'for', comparison: 'of', list: 'of', steps: 'for' })[primary.answerType] || 'about'} “${focus}”` : ''}${cons.length ? ` (${cons.join(', ')})` : ''}.`;
  const searchQuery = clean([action, sides ? sides.join(' ') : focus, constraints.location].filter(Boolean).join(' ')).slice(0, 200) || text;
  return { schema: 'kenuxa-understanding/1', text, speechAct, intent: { type: primary.type, label: primary.label, alternatives: scored.slice(1, 4).map(s => s.type) }, goal: { statement: goal, successCriteria }, action, focus: focus || null, sides, concepts, unknownTerms: unknown.slice(0, 8), constraints, answerType: primary.answerType, frame, references, ambiguity, understood, summary, searchQuery };
}

// ---------- construction ----------
const sentences = t => clean(t).replace(/\s*\[\d+\]/g, '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map(clean).filter(s => s.length > 15);
function similar(a, b) { const A = new Set(features(a)), B = new Set(features(b)); if (!A.size || !B.size) return a === b; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size) >= 0.8; }
const relevantTo = (s, terms) => terms.filter(t => s.toLowerCase().includes(t)).length;

// Answers are written as clean Markdown prose: a direct opening, then structure only where it helps.
const bold = s => `**${s}**`;
const lowerFirst = s => s && /^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
const list = (a, n = 6) => a.slice(0, n).join(', ').replace(/, ([^,]*)$/, ' and $1');
export function construct(u, { result, atoms = [], plan = null } = {}) {
  const core = u.concepts.map(c => atoms.find(a => a.id === c.atomId)).filter(a => a && a.status === 'approved');
  const frames = core.map(a => a.dna.meaning.frame);
  const evidence = (result?.evidence || []).filter(e => e.quote);
  const pool = [...frames.map(f => f.essence), ...core.flatMap(a => [a.answer, ...(a.dna.meaning.claims || []).map(c => c.text)]), ...evidence.map(e => e.quote), result?.answer].filter(Boolean);
  const facts = []; for (const x of pool.flatMap(sentences)) if (!facts.some(y => similar(x, y))) facts.push(x);
  const terms = features([u.focus, ...(u.sides || [])].join(' '));
  const ranked = facts.map(s => ({ s, r: relevantTo(s, terms) })).filter(x => x.r > 0 || !terms.length).sort((a, b) => b.r - a.r).map(x => x.s);
  const used = new Set(), take = (arr, n) => arr.filter(s => !used.has(s)).slice(0, n).map(s => (used.add(s), s));
  const f0 = frames[0], focus = u.focus || 'this', out = [];
  let grounded = ranked.length > 0 || !!plan?.length, framework = false;
  const facts_ = (f) => { const rows = []; if (f.genus) rows.push(`- ${bold('Category:')} ${f.genus}`); if (f.purposes?.length) rows.push(`- ${bold('Used for:')} ${list(f.purposes, 3)}`); if (f.parts?.length) rows.push(`- ${bold('Made of:')} ${list(f.parts, 5)}`); if (f.examples?.length) rows.push(`- ${bold('Examples:')} ${list(f.examples, 5)}`); if (f.places?.length) rows.push(`- ${bold('Where:')} ${list(f.places, 4)}`); return rows; };

  if (u.intent.type === 'greeting') return { text: `Hi! I'm KENUXA. Ask me anything — what something is, how it works, how to reach a goal, or how two ideas compare. I'll understand what you're after and answer from what I know, and I'll tell you honestly when I don't know yet.`, structure: 'conversation', grounded: true, basis: [] };

  if (u.answerType === 'comparison' && u.sides) {
    const find = side => core.find(x => features(x.dna.meaning.frame.label).some(t => features(side).includes(t)))?.dna.meaning.frame;
    const [A, B] = u.sides.map(find), [a, b] = u.sides.map(cap);
    if (A || B) {
      out.push(`Here's how ${bold(a)} and ${bold(b)} compare.`, '', `| | ${a} | ${b} |`, '|---|---|---|',
        `| What it is | ${A?.essence || '—'} | ${B?.essence || '—'} |`, `| Category | ${A?.genus || A?.kind || '—'} | ${B?.genus || B?.kind || '—'} |`);
      if (A?.purposes?.length || B?.purposes?.length) out.push(`| Used for | ${A?.purposes?.slice(0, 2).join('; ') || '—'} | ${B?.purposes?.slice(0, 2).join('; ') || '—'} |`);
      if (A?.examples?.length || B?.examples?.length) out.push(`| Examples | ${A?.examples?.slice(0, 3).join(', ') || '—'} | ${B?.examples?.slice(0, 3).join(', ') || '—'} |`);
      out.push('', A && B ? (A.genus && A.genus === B.genus ? `Both are kinds of ${A.genus}; the difference lies in what distinguishes each.` : `In short: they belong to different categories — ${A.genus || A.kind} versus ${B.genus || B.kind}.`) : `I only have reliable knowledge about ${A ? a : b} so far, so the comparison is incomplete.`);
      [A, B].filter(Boolean).forEach(f => used.add(f.essence));
    } else grounded = false;
  } else if (['plan', 'steps', 'recommendation'].includes(u.answerType)) {
    const goal = u.goal.statement.replace(/^be able to /, '').replace(/ yourself$/, '');
    const ctx = take(ranked, 2);
    out.push(u.answerType === 'recommendation' ? `Here's how I'd approach this decision.` : `Here's a practical way to ${bold(goal)}${u.constraints.budget ? ` on a budget of ${u.constraints.budget}` : ''}.`);
    if (ctx.length) out.push('', `${bold('Good to know:')} ${ctx.join(' ')}`);
    const steps = plan?.length ? plan.map(s => [s, '']) : [
      ['Define success', `Decide exactly what “${focus}” should achieve for you and how you'll measure it.`],
      ['Learn the essentials', 'Study how it works, who already does it well, and what they needed to get started.'],
      ['Check the requirements', `Find out which permits, registrations, standards and costs apply${u.constraints.location ? ` in ${u.constraints.location}` : ''}.`],
      ['Gather resources', `Line up the skills, people, tools, suppliers and funding${u.constraints.budget ? ` — keeping within ${u.constraints.budget}` : ''}.`],
      ['Start small', 'Run a small, reversible pilot, record what happens, and improve from there.'],
      ['Manage the risks', "Note what could go wrong, how you'd spot it early, and what you'd do then."],
    ];
    out.push('', ...steps.map(([t, d], i) => d ? `${i + 1}. ${bold(t + '.')} ${d}` : `${i + 1}. ${t}`));
    if (!plan?.length) { framework = true; grounded = true; out.push('', `_This is a general framework shaped around your goal. I don't yet have verified, specific facts about how to ${goal}, so check local details before acting._`); }
  } else if (u.intent.type === 'elaborate' && f0) {
    const a0 = core[0], related = (a0.dna.relationships || []).map(r => atoms.find(x => x.id === r.target && x.status === 'approved')).filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 3);
    const more = take(ranked.filter(x => !similar(x, f0.essence) && !related.some(r => similar(x, r.dna.meaning.frame.essence))), 4);
    out.push(more.length ? `Going deeper into ${bold(f0.label)}: ${more.join(' ')}` : `Here's more on ${bold(f0.label)}. ${f0.essence}`);
    const rows = facts_(f0); if (rows.length) out.push('', ...rows);
    if (related.length) out.push('', `${bold('How it connects')}`, '', ...related.map(x => `- ${bold(cap(x.dna.meaning.frame.label))} — ${x.dna.meaning.frame.essence}`));
    used.add(f0.essence); grounded = true;
  } else if (u.answerType === 'definition' || u.answerType === 'explanation') {
    if (f0) {
      const lead = f0.essence.replace(new RegExp('^(the |an? )?' + f0.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), m => bold(m.trim()));
      const rare = terms.length > 1 ? [...terms].sort((x, y) => facts.filter(f => f.toLowerCase().includes(x)).length - facts.filter(f => f.toLowerCase().includes(y)).length)[0] : null;
      const extra = take(ranked.filter(x => !similar(x, f0.essence) && (!rare || x.toLowerCase().includes(rare))), u.answerType === 'explanation' ? 3 : 1);
      out.push([cap(lead), ...extra].join(' ').trim());
      used.add(f0.essence); const rows = facts_(f0); if (rows.length) out.push('', ...rows); grounded = true;
    } else if (ranked.length) out.push(take(ranked, u.answerType === 'explanation' ? 4 : 2).join(' '));
  } else if (u.answerType === 'reasons') {
    const causal = ranked.filter(s => /\b(because|due to|caused|causes|leads? to|results? in|since|therefore|so that|in order to|needs?|requires?)\b/i.test(s));
    if (causal.length || f0?.causes?.length) { out.push(take(causal, 3).join(' ')); if (f0?.causes?.length) out.push('', ...f0.causes.map(c => `- ${cap(c)}`)); }
    else if (ranked.length) { out.push(`I don't have a clear explanation of why ${lowerFirst(focus)} yet. Here's what I do know:`, '', ...take(ranked, 3).map(s => `- ${s}`)); }
  } else if (u.answerType === 'list') {
    const items = [...new Set(frames.flatMap(f => [...(f.examples || []), ...(f.parts || [])]))];
    if (items.length) out.push(`Here are some ${u.text.match(/types|kinds|categories/i)?.[0].toLowerCase() || 'examples'} of ${bold(focus)}:`, '', ...items.slice(0, 8).map(x => `- ${cap(x)}`));
    else if (ranked.length) out.push(`I don't have examples of ${focus} yet. Here's what I know about it:`, '', ...take(ranked, 3).map(s => `- ${s}`));
  } else if (['quantity', 'time', 'place', 'person'].includes(u.answerType)) {
    const re = { quantity: /\d/, time: /\b(1[0-9]{3}|20[0-9]{2}|century|year|ago|ancient|modern)\b/i, place: /\b(in|at|located|capital|city|country|region)\b/, person: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/ }[u.answerType];
    const hits = ranked.filter(s => re.test(s)); out.push(take(hits.length ? hits : ranked, 2).join(' '));
  } else if (u.answerType === 'yes-no') {
    const best = take(ranked, 2); out.push(best.length ? best.join(' ') : '');
  } else out.push(take(ranked, 3).join(' '));

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) grounded = false;
  if (u.constraints.location && grounded && !framework && !text.includes(u.constraints.location)) text += `\n\n_My current knowledge isn't specific to ${u.constraints.location}._`;
  const about = { person: `who ${focus}`, place: `where ${focus} is`, time: `when ${focus}` }[u.answerType] || bold(focus);
  if (!grounded) text = `I don't have reliable knowledge about ${about} yet, so I won't guess.${result?.engine?.includes('research') ? '' : ' Try rephrasing, or ask me something related.'}`;
  if (u.constraints.format && /brief|summary|summarize|simple|five|eli5/.test(u.constraints.format) && !framework) text = text.split('\n\n')[0];
  return { text, structure: u.answerType, grounded, basis: [...used].slice(0, 8), framework };
}
