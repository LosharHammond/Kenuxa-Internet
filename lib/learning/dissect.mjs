// Atomic Dissection Engine. Two answers (KENUXA's own "student" answer and the teacher's) are not compared as
// strings: each is decomposed into atom-level claims through KENUXA's own interpretation pipeline (subject,
// predicate, object, polarity, numbers), then claims are aligned, contradictions and gaps are found, claims are
// verified where a deterministic check exists, and confirmed errors are traced to a likely root cause.
// The teacher can be wrong: a teacher claim that contradicts verified graph knowledge is classified as a teacher error.
import { interpret } from '../atoms/language.mjs';
import { classify } from '../atoms/reasoning.mjs';
import { verifyAnswer } from '../cognition/verify.mjs';

const stripMd = t => String(t || '').replace(/\[\d+\]/g, '').replace(/\*\*|__|`|^#+\s*|^>\s*/gm, '').replace(/(^|\s)[*_](\S[^*_]*\S)[*_](?=\s|[.,;:!?]|$)/g, '$1$2').replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '');
export const sentencesOf = t => stripMd(t).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 4 && (/\p{L}{2}/u.test(s) || /\d\s*[-+*/×÷=]\s*\d/.test(s))).slice(0, 40);
const NUM = /(-?\d+(?:[.,]\d+)?)\s*(%|percent|gh₵|ghs|cedis?|usd|\$|kwh|kw|mw|w|v|years?|days?|hours?|nodes?|fragments?|copies)?/gi;
const headOf = r => r ? String(r.head || r.quality || r.referent || r.text || r.pronoun || '').toLowerCase() || null : null;

export function claimsOf(text, registry) {
  return sentencesOf(text).map(s => {
    let f = null; try { f = interpret(s, { registry, node: 'dissect' }).clauses[0]?.semantics; } catch { /* unparsable sentence: kept as text */ }
    const subjRole = f?.subjectRole || 'agent', subject = headOf(f?.roles?.[subjRole] || f?.roles?.agent || f?.roles?.theme);
    const object = headOf(f?.roles?.category || f?.roles?.attribute || (subjRole !== 'theme' ? f?.roles?.theme : null) || f?.roles?.location);
    const numbers = [...s.matchAll(NUM)].map(m => ({ value: Number(m[1].replace(',', '.')), unit: (m[2] || '').toLowerCase() })).filter(n => Number.isFinite(n.value));
    return { text: s, kind: f?.type || 'unparsed', subject, predicate: f?.predicate || null, object, polarity: f?.polarity || 'positive', tense: f?.tense || null, numbers, key: [subject, f?.predicate, object].map(x => x || '?').join('|') };
  });
}
const sameTopic = (a, b) => a.subject && a.subject === b.subject && a.predicate && a.predicate === b.predicate;
const words = s => new Set((String(s).toLowerCase().match(/\p{L}{4,}/gu) || []));
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };

// Deterministic verification where possible; everything else stays provisional.
export function verifyClaim(c, { registry }) {
  const arith = c.text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/×x÷])\s*(-?\d+(?:\.\d+)?)\s*(?:=|is|equals)\s*(-?\d+(?:\.\d+)?)/i);
  if (arith) { const [a, op, b, r] = [Number(arith[1]), arith[2], Number(arith[3]), Number(arith[4])], v = op === '+' ? a + b : op === '-' ? a - b : ['*', '×', 'x'].includes(op) ? a * b : a / b; return { status: Math.abs(v - r) < 1e-9 ? 'verified' : 'refuted', method: 'arithmetic', expected: v }; }
  if (c.kind === 'classification' && c.subject && c.object && registry) { const r = classify(registry, c.subject, c.object); const curated = r.readings.some(x => x.holds && !x.unverified); if (c.polarity === 'positive') { if (r.answer === 'yes' && curated) return { status: 'verified', method: 'atom-graph', chain: r.readings.find(x => x.holds)?.chainLabels }; if (r.answer === 'no') return { status: 'refuted', method: 'atom-graph' }; } else if (r.answer === 'yes' && curated) return { status: 'refuted', method: 'atom-graph', chain: r.readings.find(x => x.holds)?.chainLabels }; }
  const bad = c.text.match(/\b(I (is|are)|(he|she|it) (are|am)|(we|they|you) (is|am))\b/i); if (bad && !/incorrect|wrong|ungrammatical|not correct/i.test(c.text)) return { status: 'refuted', method: 'grammar-rule', rule: 'rule:en:subject-verb-agreement' };
  return { status: 'unverified', method: null };
}

export function dissect({ question, student, teacher, registry, studentRun = null }) {
  const S = claimsOf(student.answer, registry), T = claimsOf(teacher.answer, registry);
  const agreements = [], contradictions = [], teacherOnly = [], studentOnly = [];
  for (const t of T) {
    const exact = S.find(s => s.key === t.key && s.key !== '?|?|?'), near = exact || S.find(s => overlap(s.text, t.text) >= 0.6), clash = S.find(s => sameTopic(s, t) && ((s.object && t.object && s.object === t.object && s.polarity !== t.polarity) || (s.numbers.length && t.numbers.length && s.numbers[0].unit === t.numbers[0].unit && s.numbers[0].value !== t.numbers[0].value)));
    if (clash) contradictions.push({ student: clash.text, teacher: t.text, on: t.key, type: clash.polarity !== t.polarity ? 'polarity' : 'number' });
    else if (near) agreements.push({ student: near.text, teacher: t.text, match: exact ? 'structure' : 'content' }); else teacherOnly.push(t);
  }
  for (const s of S) if (!agreements.some(a => a.student === s.text) && !contradictions.some(c => c.student === s.text)) studentOnly.push(s);
  // Verification of every claim we can check deterministically.
  const checks = [...T.map(c => ({ side: 'teacher', c })), ...S.map(c => ({ side: 'student', c }))].map(x => ({ side: x.side, claim: x.c.text, ...verifyClaim(x.c, { registry }) }));
  const studentErrors = checks.filter(c => c.side === 'student' && c.status === 'refuted'), teacherErrors = checks.filter(c => c.side === 'teacher' && c.status === 'refuted');
  const focusTerms = words(question), relevance = side => { const w = words(side); let n = 0; for (const f of focusTerms) if (w.has(f)) n++; return focusTerms.size ? +(n / focusTerms.size).toFixed(2) : 1; };
  const grammar = side => verifyAnswer({ answer: side }).checks.find(c => c.name === 'subject-verb-agreement');
  const report = {
    question, interpretation: { student: studentRun?.understanding?.summary || null, studentIntent: studentRun?.understanding?.intent?.type || null, teacher: teacher.interpretation || null },
    entities: { student: [...new Set(S.map(c => c.subject).filter(Boolean))], teacher: [...new Set(T.map(c => c.subject).filter(Boolean))] },
    claims: { student: S.length, teacher: T.length }, agreements, contradictions, missingFromStudent: teacherOnly.map(c => c.text), studentOnly: studentOnly.map(c => c.text),
    assumptions: { teacher: teacher.assumptions || [], student: studentRun?.plan?.reasoning?.assumptions || [] }, uncertainty: { teacher: teacher.uncertainty || [], student: studentRun?.plan?.uncertainty || [] },
    verification: checks.filter(c => c.status !== 'unverified'), studentErrors, teacherErrors,
    grammar: { student: grammar(student.answer)?.ok !== false, teacher: grammar(teacher.answer)?.ok !== false },
    completeness: T.length ? +(agreements.length / T.length).toFixed(2) : null, relevance: { student: relevance(student.answer), teacher: relevance(teacher.answer) },
  };
  report.rootCauses = rootCauses(report, { studentRun, student, teacher: () => teacher.answer });
  report.verdict = studentErrors.length ? 'student-error' : teacherErrors.length && !contradictions.length ? 'teacher-error' : report.completeness != null && report.completeness < 0.34 ? 'student-incomplete' : contradictions.length ? 'disputed' : 'consistent';
  return report;
}

// Likely source of each confirmed problem (several may apply). Disagreement alone is not a student error.
export function rootCauses(r, { studentRun, student, teacher = x => x.teacherAnswer || '' }) {
  const out = [], add = (cause, evidence) => { if (!out.some(x => x.cause === cause)) out.push({ cause, evidence }); };
  const plan = studentRun?.plan || {}, interp = studentRun?.understanding?.interpretation || {};
  if ((interp.atoms?.discovered || []).length) add('missing-atom', `unknown words in the question: ${interp.atoms.discovered.map(i => i.split(':').pop()).join(', ')}`);
  if ((interp.ambiguities || []).length && r.contradictions.length) add('wrong-sense', `ambiguous: ${interp.ambiguities.map(a => a.word).join(', ')}`);
  if (/don'?t have reliable knowledge|won'?t guess|could not research/i.test(student.answer) || plan.retrieval?.answeredFrom === 'none') add('incomplete-evidence', 'the student had no grounded knowledge for this question');
  if (r.missingFromStudent.length && r.completeness != null && r.completeness < 0.5) add('missing-relationship', `${r.missingFromStudent.length} teacher claim(s) have no counterpart in KENUXA’s answer`);
  if (r.teacherErrors.length) add('teacher-error', r.teacherErrors.map(e => `${e.claim} (${e.method})`).join('; '));
  for (const e of r.studentErrors) add(e.method === 'grammar-rule' ? 'grammar-construction' : e.method === 'atom-graph' ? 'incorrect-atom' : 'faulty-inference', e.claim);
  if (r.interpretation.teacher && r.interpretation.studentIntent && !new RegExp(r.interpretation.studentIntent.replace(/-/g, '.?'), 'i').test(r.interpretation.teacher) && r.relevance.student < 0.5) add('incorrect-intent', `student read the question as “${r.interpretation.studentIntent}”`);
  if (plan.context && plan.context.dependsOnContext === false && /\b(it|this|that|which one)\b/i.test(r.question)) add('failed-context-retrieval', 'pronoun or reference left unresolved');
  if (r.relevance.student < 0.34 && !out.length) add('response-planning', 'the student answer does not address the question’s terms');
  if ((studentRun?.result?.trace || []).some(t => /unavailable/i.test(t))) add('storage-retrieval', 'a retrieval step was unavailable during the student run');
  // v1.7 cognitive engine: failures inside the student's own reasoning operations
  const cog = plan.cognition;
  if (cog?.handled && cog.result?.steps?.length) {
    const num = x => [...String(x || '').matchAll(/(\d+(?:[.,]\d+)?)\s*(wh|kwh|h|hours|w|minutes|ghs|cedis|panels)\b/gi)].map(m => Number(m[1].replace(',', '')));
    const mine = cog.result.steps.at(-1)?.output?.value, theirs = num(teacher(r));
    if (typeof mine === 'number' && theirs.length && !theirs.some(v => Math.abs(v - mine) <= 0.02 * Math.max(Math.abs(v), Math.abs(mine)))) add(/did not use/.test(student.answer) ? 'invalid-assumption' : 'calculation-error', `KENUXA computed ${+mine.toPrecision(4)}; the teacher states ${theirs.slice(0, 3).join(', ')} — re-check by a verified correction, not by agreement`);
  }
  if (cog && !cog.handled && cog.type) add('poor-strategy-selection', `the ${cog.type} methods (${cog.strategy?.methods?.join(', ') || 'none'}) produced no result`);
  if (cog?.hypothetical && /\b(is|are) (true|a fact)\b/i.test(student.answer)) add('simulation-error', 'a hypothetical result was stated as fact');
  if ((r.verification || []).length === 0 && r.contradictions?.length) add('unverified-evidence', 'the disagreement could not be checked against independent evidence; both claims stay unverified');
  return out.map(x => ({ ...x, errorClass: ERROR_CLASS[x.cause] || x.cause }));
}
// The directive's error taxonomy (PART 12.3) for each root cause the dissector can establish.
export const ERROR_CLASS = { 'missing-atom': 'missing knowledge', 'incomplete-evidence': 'missing knowledge', 'missing-relationship': 'missing knowledge', 'incorrect-atom': 'incorrect knowledge', 'wrong-sense': 'incorrect meaning selection', 'incorrect-intent': 'incorrect meaning selection', 'failed-context-retrieval': 'context failure', 'storage-retrieval': 'context failure', 'faulty-inference': 'faulty rule', 'poor-strategy-selection': 'poor strategy selection', 'invalid-assumption': 'invalid assumption', 'calculation-error': 'calculation error', 'simulation-error': 'simulation error', 'response-planning': 'response construction error', 'grammar-construction': 'response construction error', 'unverified-evidence': 'unverified evidence', 'teacher-error': 'teacher error (not a student failure)' };
