// Evidence-based claims (v1.4). Teachers assist; they do not define truth.
// Each claim is (subject, relation, object) within a scope (time, place). Evidence items support or contradict it, are
// direct or inferred, and carry their origin. Copies of the same article count once (origin + passage similarity), a
// teacher's statement is an opinion that can prompt investigation but never establishes a claim by itself, and the
// absence of evidence is reported as "not established" / "insufficient evidence", never as "false".
import { createHash } from 'node:crypto';

const h = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const n = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
const lemma = s => n(s).replace(/^(the|a|an)\s+/, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1');
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const shingles = t => { const w = n(t).split(' '), s = new Set(); for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(' ')); return s; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
export const VERDICTS = ['supported', 'contradicted', 'disputed', 'outdated', 'inferred', 'not-established', 'insufficient-evidence'];

export class ClaimStore {
  constructor({ state, now = () => Date.now(), staleDays = 365 } = {}) { this.S = state.claims ??= {}; this.S.claims ??= {}; this.S.disputes ??= []; this.now = now; this.staleDays = staleDays; }
  key(subject, relation, object, scope = {}) { return 'claim:' + h([lemma(subject), n(relation), lemma(object), n(scope.time || ''), n(scope.place || '')]).slice(0, 24); }
  claim(id) { return this.S.claims[id] || null; }
  // Record one piece of evidence (idempotent). kind: source | teacher | owner | computation. privacy: public | private.
  assert({ subject, relation, object, scope = {}, stance = 'supports', direct = true, kind = 'source', source = '', url = '', publisher = '', passage = '', derivedFrom = null, checkedAt = null, validUntil = null, privacy = 'public', model = null }) {
    if (!subject || !relation || !object) throw new Error('claim needs subject, relation and object');
    if (!['supports', 'contradicts'].includes(stance)) throw new Error('stance must be supports or contradicts');
    const id = this.key(subject, relation, object, scope), c = this.S.claims[id] ||= { id, subject: lemma(subject), relation: n(relation), object: lemma(object), scope: { time: scope.time || null, place: scope.place || null }, evidence: [], createdAt: new Date(this.now()).toISOString(), privacy };
    if (privacy === 'public' && c.privacy === 'private') c.privacy = 'private'; // any private evidence keeps the claim private
    const eid = 'ev:' + h([id, url, n(passage), kind, model, stance]).slice(0, 20);
    if (c.evidence.some(e => e.id === eid)) return { claim: c, evidence: c.evidence.find(e => e.id === eid), duplicate: true };
    const e = { id: eid, stance, direct: !!direct, kind, source: String(source).slice(0, 200), url: /^https?:\/\//.test(url) ? url.slice(0, 500) : '', publisher: String(publisher || domainOf(url) || source || kind).toLowerCase().slice(0, 120), passage: String(passage).slice(0, 600), derivedFrom, checkedAt: checkedAt || new Date(this.now()).toISOString(), validUntil, model, privacy };
    c.evidence.push(e); if (c.evidence.length > 60) c.evidence.shift(); if (privacy === 'private') c.privacy = 'private';
    return { claim: c, evidence: e, duplicate: false };
  }
  // Independent origins: same publisher, an explicit derivedFrom, or a near-identical passage (≥ 0.6 shingle overlap) collapse into one.
  origins(items) {
    const clusters = [];
    for (const e of items) {
      const sh = shingles(e.passage), root = e.derivedFrom || e.publisher;
      const hit = clusters.find(c => c.roots.has(root) || (sh.size >= 3 && c.shingles.some(s => jaccard(s, sh) >= 0.6)));
      if (hit) { hit.items.push(e); hit.roots.add(root); hit.shingles.push(sh); } else clusters.push({ roots: new Set([root]), shingles: [sh], items: [e] });
    }
    return clusters.map(c => ({ origin: [...c.roots][0], copies: c.items.length, direct: c.items.some(e => e.direct), items: c.items.map(e => e.id) }));
  }
  assess(id) {
    const c = this.S.claims[id]; if (!c) return { verdict: 'not-established', reason: 'no such claim has been recorded', evidence: [] };
    const now = this.now(), fresh = e => !(e.validUntil && Date.parse(e.validUntil) < now) && !(c.scope.time === 'current' && now - Date.parse(e.checkedAt) > this.staleDays * 864e5);
    const nonTeacher = c.evidence.filter(e => e.kind !== 'teacher'), teacher = c.evidence.filter(e => e.kind === 'teacher');
    const sup = nonTeacher.filter(e => e.stance === 'supports'), con = nonTeacher.filter(e => e.stance === 'contradicts');
    const supO = this.origins(sup.filter(fresh)), conO = this.origins(con.filter(fresh)), staleSup = sup.filter(e => !fresh(e));
    const directSup = supO.filter(o => o.direct), directCon = conO.filter(o => o.direct);
    let verdict, reason;
    if (directSup.length && directCon.length) { verdict = 'disputed'; reason = `${directSup.length} independent source(s) support it and ${directCon.length} contradict it`; }
    else if (directCon.length) { verdict = 'contradicted'; reason = `contradicted by ${directCon.length} independent source(s); no direct support`; }
    else if (directSup.length) { verdict = 'supported'; reason = `supported by ${directSup.length} independent source(s)${c.scope.time || c.scope.place ? ' within the stated scope' : ''}`; }
    else if (staleSup.length && !supO.length) { verdict = 'outdated'; reason = 'the only supporting evidence is past its validity or freshness window'; }
    else if (supO.length) { verdict = 'inferred'; reason = 'only indirect (inferred) support'; }
    else if (teacher.length) { verdict = 'insufficient-evidence'; reason = 'only a teacher said so — a teacher opinion prompts investigation but does not establish a claim'; }
    else { verdict = 'not-established'; reason = 'no evidence recorded (absence of evidence is not evidence of falsehood)'; }
    const copies = sup.length - supO.reduce((a, o) => a + 1, 0);
    const uncertainty = [];
    if (copies > 0) uncertainty.push(`${copies} supporting item(s) repeat another source and were not counted again`);
    if (directSup.length === 1 && verdict === 'supported') uncertainty.push('single independent source');
    if (teacher.length) uncertainty.push(`teacher view (${teacher.map(t => t.stance).join(', ')}) recorded as opinion, not evidence`);
    if (!c.scope.time) uncertainty.push('no time scope stated');
    const resolve = verdict === 'disputed' ? ['a primary or official source', 'the date and place each source refers to', 'whether the sources define the terms the same way'] : verdict === 'supported' && directSup.length === 1 ? ['a second independent source'] : ['insufficient-evidence', 'not-established', 'inferred', 'outdated'].includes(verdict) ? ['a direct, independent source that addresses this claim'] : [];
    return { id, claim: `${c.subject} ${c.relation} ${c.object}`, scope: c.scope, verdict, reason, supporting: { independent: supO.length, direct: directSup.length, origins: supO }, contradicting: { independent: conO.length, direct: directCon.length, origins: conO }, teacher: teacher.map(t => ({ stance: t.stance, model: t.model, passage: t.passage.slice(0, 200) })), uncertainty, whatWouldResolve: resolve, lastChecked: c.evidence.map(e => e.checkedAt).sort().pop() || null, privacy: c.privacy };
  }
  competing(subject, relation, { includePrivate = true } = {}) {
    return Object.values(this.S.claims).filter(c => c.subject === lemma(subject) && c.relation === n(relation) && (includePrivate || c.privacy !== 'private')).map(c => this.assess(c.id));
  }
  explanationsFor(object, relation = 'causes', { includePrivate = true } = {}) {
    return Object.values(this.S.claims).filter(c => c.object === lemma(object) && c.relation === n(relation) && (includePrivate || c.privacy !== 'private')).map(c => this.assess(c.id));
  }
  // Teacher vs local knowledge: record the exact disagreement, compare evidence, decide — never obey by default.
  disagreement({ subject, relation, teacherObject, localObject, model = null, teacherPassage = '' }) {
    if (teacherObject) this.assert({ subject, relation, object: teacherObject, kind: 'teacher', model, passage: teacherPassage || `${subject} ${relation} ${teacherObject}` });
    const t = this.assess(this.key(subject, relation, teacherObject)), l = this.assess(this.key(subject, relation, localObject));
    const strong = a => a.verdict === 'supported', weak = a => ['contradicted', 'insufficient-evidence', 'not-established', 'outdated'].includes(a.verdict);
    let decision, reason;
    if (strong(t) && (weak(l) || l.verdict === 'contradicted')) { decision = 'correct-local'; reason = 'independent evidence supports the teacher’s claim and not the local one'; }
    else if (strong(l) && !strong(t)) { decision = 'keep-local'; reason = 'local claim is supported by independent evidence; the teacher’s claim is not'; }
    else if (strong(l) && strong(t)) { decision = 'withhold'; reason = 'both claims have independent support — possibly different scopes or definitions'; }
    else { decision = 'withhold'; reason = 'neither claim is established by independent evidence'; }
    const record = { at: new Date(this.now()).toISOString(), subject: lemma(subject), relation: n(relation), teacher: { object: lemma(teacherObject), verdict: t.verdict }, local: { object: lemma(localObject), verdict: l.verdict }, decision, reason };
    this.S.disputes.push(record); if (this.S.disputes.length > 200) this.S.disputes.shift();
    return { ...record, teacherAssessment: t, localAssessment: l };
  }
  verbalize(assessments, { topic = '' } = {}) {
    const live = assessments.filter(a => a.verdict !== 'not-established'); if (!live.length) return null;
    const line = a => `- **${a.claim}** — ${a.verdict.replace('-', ' ')}: ${a.reason}.${a.supporting.origins.length ? ' Sources: ' + a.supporting.origins.map(o => o.origin).join(', ') + '.' : ''}${a.contradicting.origins.length ? ' Contradicted by: ' + a.contradicting.origins.map(o => o.origin).join(', ') + '.' : ''}`;
    const backed = live.filter(a => ['supported', 'disputed'].includes(a.verdict));
    if (backed.length >= 2 || live.some(a => a.verdict === 'disputed')) return `I found ${backed.length >= 2 ? backed.length + ' ' : ''}competing explanations${topic ? ' for ' + topic : ''}, and the evidence does not settle which is right, so I am not choosing a winner.\n\n${live.map(line).join('\n')}\n\n**Still uncertain:** ${[...new Set(live.flatMap(a => a.uncertainty))].slice(0, 4).join('; ') || 'the scope of each claim'}.\n**What would help resolve it:** ${[...new Set(live.flatMap(a => a.whatWouldResolve))].slice(0, 3).join('; ')}.`;
    const a = live[0];
    if (a.verdict === 'supported') return `${a.claim[0].toUpperCase() + a.claim.slice(1)} — ${a.reason}.${a.uncertainty.length ? ' Note: ' + a.uncertainty.join('; ') + '.' : ''}`;
    return `I can’t establish that: “${a.claim}” is ${a.verdict.replace('-', ' ')} (${a.reason}).${a.whatWouldResolve.length ? ' What would help: ' + a.whatWouldResolve.join('; ') + '.' : ''}`;
  }
  status() { const all = Object.values(this.S.claims), by = {}; for (const c of all) { const v = this.assess(c.id).verdict; by[v] = (by[v] || 0) + 1; } return { claims: all.length, byVerdict: by, disputes: this.S.disputes.length }; }
}
