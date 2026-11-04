// Bounded investigation of a claim (v1.4.1): when a teacher and local knowledge disagree, or a claim rests only on a
// teacher's word, KENUXA looks for public sources within a budget, reads at most a few pages, and records only the
// sentences that actually mention both sides of the claim — as direct support, direct contradiction or inferred
// context. The claim store then re-assesses; nothing is "decided" by the number of pages fetched.
import { plainText } from '../web.mjs';

const CUES = { causes: /\b(cause[sd]?|causing|lead[s]? to|led to|result(s|ed)? in|trigger(s|ed)?|responsible for|because of|due to)\b/i, 'is a': /\b(is|are|was|were)\s+(a|an|the)?\s*(kind|type|species|form|member)?\b/i, prevents: /\b(prevent[s]?|stop[s]?|reduce[s]?)\b/i };
const NEG = /\b(not|no|never|doesn'?t|don'?t|isn'?t|aren'?t|myth|misconception|no evidence|unrelated|does not)\b/i;
const stem = w => String(w).toLowerCase().replace(/(ies|es|s)$/, '').slice(0, Math.max(4, String(w).length - 2));
const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } };

export function evidenceFrom(text, { subject, relation, object }) {
  const sents = String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.length > 20 && s.length < 500), sub = stem(subject), obj = stem(object), cue = CUES[relation] || null, out = [];
  for (const s of sents) {
    const low = s.toLowerCase(); if (!low.includes(sub) || !low.includes(obj)) continue;
    const direct = !!(cue && cue.test(s)), negated = direct && NEG.test(s.slice(0, Math.max(s.toLowerCase().search(cue) + 25, 0)));
    out.push({ passage: s.slice(0, 300), direct, stance: negated ? 'contradicts' : 'supports' });
    if (out.length >= 3) break;
  }
  return out;
}

export async function investigateClaim(claims, claimId, { search, fetchText, maxPages = 3 }) {
  const c = claims.claim(claimId); if (!c) throw new Error('unknown claim');
  const before = claims.assess(claimId).verdict, query = `${c.subject} ${c.relation === 'causes' ? 'cause' : c.relation} ${c.object}`;
  const results = (await search(query)).slice(0, 5), pages = [], recorded = [];
  for (const r of results.slice(0, maxPages)) {
    let text = ''; try { text = plainText(await fetchText(r.url)).slice(0, 200000); } catch (e) { pages.push({ url: r.url, error: e.message }); continue; }
    const found = evidenceFrom(text, c); pages.push({ url: r.url, title: r.title || '', sentences: found.length });
    for (const f of found) { const x = claims.assert({ subject: c.subject, relation: c.relation, object: c.object, scope: c.scope, url: r.url, publisher: domain(r.url), passage: f.passage, stance: f.stance, direct: f.direct, kind: 'source' }); if (!x.duplicate) recorded.push({ url: r.url, stance: f.stance, direct: f.direct }); }
  }
  const after = claims.assess(claimId);
  return { claim: claimId, query, pages, recorded, before, after: after.verdict, assessment: after, note: recorded.length ? 'recorded only sentences that mention both sides of the claim' : 'no page mentioned both sides of the claim — the claim stays as it was (absence of evidence is not evidence against it)' };
}
