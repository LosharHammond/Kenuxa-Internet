// Structured extraction (v1.4.2): claims and price/quantity options are read from KENUXA's own interpretation of each
// sentence (semantic roles, polarity, modality, coordination) instead of fixed sentence-shape regexes. The old patterns
// remain only as a fallback for sentences the parser cannot analyse. Still bounded: it extracts what the grammar layer
// understands, and reports the rest as not extracted rather than guessing.
import { interpret } from '../atoms/language.mjs';

const CAUSE = new Set(['cause', 'produce', 'generate', 'lead', 'result', 'trigger', 'create', 'bring']);
const EFFECT_REL = { prevent: 'prevents', stop: 'prevents', reduce: 'reduces', lower: 'reduces', decrease: 'reduces', increase: 'increases', raise: 'increases', improve: 'improves', damage: 'damages', kill: 'kills', protect: 'protects', require: 'requires', need: 'requires', contain: 'contains', cure: 'cures', treat: 'treats' };
const HEDGE = /\b(may|might|could|can|possibly|perhaps|sometimes|often|some|likely|probably|suggests?)\b/i;
const head = r => r?.head && !r.pronoun ? String(r.head).toLowerCase() : null;
const objectOf = sem => head(sem.roles?.theme) || head(sem.roles?.goal) || head(sem.roles?.patient) || head(sem.roles?.theme2) || (sem.roles?.result && head(sem.roles.result));
const VERBS = [...CAUSE, ...Object.keys(EFFECT_REL)].join('|');
const VERB_RE = new RegExp(`^(?:an?\\s+|the\\s+)?([a-z][a-z\\s-]{1,30}?)\\s+((?:may|might|can|could|often|usually|does not|do not|doesn't|don't|did not|never)\\s+)?(${VERBS})(?:e?s|ed|d)?\\s+(?:to\\s+|in\\s+)?([a-z][a-z\\s-]{1,40}?)[.!?]?$`, 'i');
const lemma = p => String(p || '').toLowerCase().replace(/(ies)$/, 'y').replace(/(ed|es|s)$/, '');

export function sentencesOf(text) { return String(text || '').replace(/[*_#>`]/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 6).slice(0, 40); }

export function claimsFromText(text, registry, { max = 20 } = {}) {
  const out = [], skipped = [];
  for (const sent of sentencesOf(text)) {
    let found = false;
    try {
      const o = interpret(sent, { registry, observe: false });
      for (const c of o.clauses || []) {
        const sem = c.semantics || {}, negative = sem.polarity === 'negative', hedged = !!sem.modality || HEDGE.test(sent), base = { stance: negative ? 'contradicts' : 'supports', hedged, passage: sent.slice(0, 300), via: 'interpretation' };
        if (sem.type === 'classification' && head(sem.roles?.theme) && head(sem.roles?.category)) { out.push({ ...base, subject: head(sem.roles.theme), relation: 'is a', object: head(sem.roles.category) }); found = true; }
        else if (sem.type === 'event' && sem.predicate) {
          const p = lemma(sem.predicate), subj = head(sem.roles?.agent) || head(sem.roles?.[sem.subjectRole]), obj = objectOf(sem);
          // "lead to X" / "result in X": the effect sits in a prepositional role
          const pp = (sem.roles && Object.values(sem.roles).find(v => v?.prep && ['to', 'in'].includes(v.prep) && v.head)) || null;
          if (subj && CAUSE.has(p) && (obj || pp)) { out.push({ ...base, subject: subj, relation: 'causes', object: obj && !['lead', 'result'].includes(p) ? obj : head(pp) || obj }); found = true; }
          else if (subj && obj && EFFECT_REL[p]) { out.push({ ...base, subject: subj, relation: EFFECT_REL[p], object: obj }); found = true; }
        }
      }
    } catch { /* fall back below */ }
    if (!found) { // fallback: the two original shapes, for sentences the parser could not analyse
      let m = sent.match(/^(?:an?\s+|the\s+)?([a-z][a-z-]{1,30})s?\s+(?:is|are)\s+(not\s+)?(?:an?|the)\s+(?:kind of\s+|type of\s+)?([a-z][a-z-]{1,30})\b/i);
      if (m) { out.push({ subject: m[1].toLowerCase(), relation: 'is a', object: m[3].toLowerCase(), stance: m[2] ? 'contradicts' : 'supports', hedged: HEDGE.test(sent), passage: sent.slice(0, 300), via: 'pattern' }); found = true; }
      else if ((m = sent.match(VERB_RE))) { const neg = !!m[2] && /not|n't|never/i.test(m[2]), v = lemma(m[3]), rel = CAUSE.has(v) ? 'causes' : EFFECT_REL[v]; out.push({ subject: m[1].toLowerCase().trim(), relation: rel, object: m[4].toLowerCase().replace(/^(the|a|an)\s+/, '').trim(), stance: neg ? 'contradicts' : 'supports', hedged: HEDGE.test(sent), passage: sent.slice(0, 300), via: 'pattern' }); found = true; }
      else if ((m = sent.match(/^([a-z][a-z\s-]{1,30}?)\s+(?:causes?|leads? to|results? in)\s+([a-z][a-z\s-]{1,30}?)[.!?]?$/i))) { out.push({ subject: m[1].toLowerCase().trim(), relation: 'causes', object: m[2].toLowerCase().trim(), stance: 'supports', hedged: HEDGE.test(sent), passage: sent.slice(0, 300), via: 'pattern' }); found = true; }
    }
    if (!found) skipped.push(sent.slice(0, 120));
    if (out.length >= max) break;
  }
  return { claims: out, skipped };
}

// ---------- price / quantity options ----------
const CURRENCY_BEFORE = /(GH₵|GHS|GH¢|₵|¢|\$|US\$|£|€|₦|NGN|USD|EUR|KES|KSh)\s?(\d+(?:[.,]\d+)?)/i;
const CURRENCY_AFTER = /(\d+(?:[.,]\d+)?)\s?(cedis?|ghs|dollars?|usd|pounds?|euros?|naira|shillings?|pesewas)\b/i;
const UNIT = '(gb|mb|tb|kg|g|grams?|kilos?|kilograms?|l|litres?|liters?|ml|millilitres?|units?|pieces?|pcs|items?|bags?|packs?|bottles?|kwh|hours?|hrs?|days?|weeks?|months?|minutes?|mins?|sachets?|loaves|tins?)';
const BARE = new RegExp(`\\b(?:costs?|sells? for|is priced at|goes for)\\s+(\\d+(?:[.,]\\d+)?)\\b(?!\\s?${UNIT}\\b)`, 'i');
const QTY = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?${UNIT}\\b`, 'i'), PER = new RegExp(`\\b(?:per|a|each|/)\\s?${UNIT}\\b`, 'i');
const NORM = { gb: ['gb', 1], mb: ['gb', 0.001], tb: ['gb', 1000], kg: ['kg', 1], kilo: ['kg', 1], kilos: ['kg', 1], kilogram: ['kg', 1], kilograms: ['kg', 1], g: ['kg', 0.001], gram: ['kg', 0.001], grams: ['kg', 0.001], l: ['l', 1], litre: ['l', 1], litres: ['l', 1], liter: ['l', 1], liters: ['l', 1], ml: ['l', 0.001], millilitre: ['l', 0.001], millilitres: ['l', 0.001], hour: ['hour', 1], hours: ['hour', 1], hr: ['hour', 1], hrs: ['hour', 1], minute: ['hour', 1 / 60], minutes: ['hour', 1 / 60], min: ['hour', 1 / 60], mins: ['hour', 1 / 60], day: ['day', 1], days: ['day', 1], week: ['day', 7], weeks: ['day', 7], month: ['month', 1], months: ['month', 1] };
const num = s => Number(String(s).replace(',', '.'));
function unitOf(u) { const k = String(u).toLowerCase().replace(/s$/, '') ; const n = NORM[String(u).toLowerCase()] || NORM[k]; return n ? { unit: n[0], factor: n[1] } : { unit: k.replace(/^(piece|pc|item)$/, 'unit'), factor: 1 }; }
function nameOf(seg, priceIdx) {
  const before = seg.slice(0, priceIdx).replace(/\b(costs?|is|are|sells?(?: for)?|goes for|gives|offers|charges|priced at|at|for|:|-|–|—|=)\s*$/i, '').trim();
  const cand = (before.match(/([A-Z][\w'’-]*(?:\s+[A-Z0-9][\w'’-]*){0,3})\s*(?:\b(?:costs?|is|sells|gives|offers|charges|bundle|pack)\b.*)?$/) || [])[1] || before.split(/\s+/).slice(-3).join(' ');
  return cand.replace(/^(the|a|an|option|brand|while|and|but|whereas)\s+/i, (m, w) => /option|brand/i.test(w) ? m : '').trim() || null;
}
export function extractQuantityOptions(text) {
  const out = [], segs = String(text || '').split(/[;\n]|,(?=\s*[A-Z])|\.(?=\s+[A-Z])|\s+(?:while|whereas|versus|vs\.?|but)\s+|\s+and\s+(?=[A-Z]|(?:the|a|an)\s)/);
  for (const seg0 of segs) {
    const seg = seg0.trim(); if (!seg) continue;
    const cb = seg.match(CURRENCY_BEFORE), ca = seg.match(CURRENCY_AFTER), bare = !cb && !ca ? seg.match(BARE) : null, price = cb ? { v: num(cb[2]), cur: cb[1], idx: cb.index } : ca ? { v: num(ca[1]), cur: ca[2], idx: ca.index } : bare ? { v: num(bare[1]), cur: null, idx: bare.index } : null;
    if (!price) continue;
    const rest = seg.replace(cb ? cb[0] : ca ? ca[0] : bare[0], ' '), q = rest.match(QTY), per = rest.match(PER);
    let quantity, unit;
    if (q) { const u = unitOf(q[2]); quantity = num(q[1]) * u.factor; unit = u.unit; } else if (per) { const u = unitOf(per[1]); quantity = u.factor; unit = u.unit; } else continue;
    const nm = nameOf(seg, Math.min(price.idx, q ? seg.indexOf(q[0]) >= 0 ? seg.indexOf(q[0]) : price.idx : price.idx));
    out.push({ name: nm || `option ${out.length + 1}`, price: price.v, currency: price.cur, quantity: +quantity.toFixed(6), unit, source: 'stated in the question', text: seg.slice(0, 120) });
  }
  return out;
}
