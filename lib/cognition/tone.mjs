// Tone interpretation (v1.4). What was observed (the words, punctuation, capitals, interjections, the previous turns)
// is kept separate from what is inferred. Readings are alternatives with calibrated weights; no reading is ever given
// more than 0.7, because text alone cannot establish how someone feels.
const MINIMIZING = /\b(i'?m|i am|it'?s|its|everything'?s|all)\s+(fine|ok(ay)?|alright|all right|good|whatever)\b|\bno worries\b|\bit doesn'?t matter\b/i;
const NEGATIVE_PRIOR = /\b(nothing works|failed|lost|sad|tired|exhausted|angry|upset|fight|fired|broke up|alone|stress(ed)?|worried|hurt|crying|bad day|terrible|awful|frustrat\w*)\b/i;
const POSITIVE_PRIOR = /\b(thanks|great|good news|passed|finished|happy|excited|glad|solved|works now|congrat\w*)\b/i;
const CARE_PRIOR = /\b(how are you|are you ok(ay)?|you okay|how('?s| is) it going|how do you feel|are you alright)\b/i;

export function interpretTone(text, { history = [] } = {}) {
  const raw = String(text || ''), t = raw.toLowerCase(), prev = history.slice(0, 3).map(h => String(h.question || h.text || h || ''));
  const observed = {
    text: raw.slice(0, 200), minimizing: MINIMIZING.test(raw), ellipsis: /(\.\.\.|…)\s*$/.test(raw.trim()), exclamation: /!\s*$/.test(raw.trim()),
    capitals: (raw.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !/^(OK|AI|USA|GPS|PDF|URL|API)$/.test(w)), interjection: (t.match(/^\s*(oh|ugh|yeah|sure|wow|great)\b/) || [])[1] || null,
    previousTurns: prev.length, previousNegative: prev.some(p => NEGATIVE_PRIOR.test(p)), previousPositive: prev.some(p => POSITIVE_PRIOR.test(p)), askedAfterCareQuestion: prev.some(p => CARE_PRIOR.test(p)),
  };
  if (!observed.minimizing) return { observed, readings: [], applies: false, note: 'no minimizing statement detected' };
  // Weights are evidence counts, not certainties: each cue shifts plausibility between three readings.
  let literal = 2, guarded = 0.5, irritated = 0.3;
  if (observed.ellipsis) { guarded += 1.2; literal -= 0.6; }
  if (observed.capitals.length) { irritated += 1.4; literal -= 0.8; }
  if (observed.exclamation && (observed.capitals.length || observed.interjection)) irritated += 0.8;
  if (observed.interjection && ['oh', 'ugh', 'sure', 'great'].includes(observed.interjection)) { irritated += 0.7; literal -= 0.4; }
  if (observed.previousNegative) { guarded += 1; irritated += 0.4; literal -= 0.5; }
  if (observed.previousPositive) literal += 0.8;
  if (observed.askedAfterCareQuestion && !observed.ellipsis && !observed.capitals.length) literal += 0.4;
  const raw3 = [['literally fine', Math.max(0.1, literal)], ['possibly not fine but not saying more (guarded)', Math.max(0.05, guarded)], ['possibly irritated or sarcastic', Math.max(0.05, irritated)]];
  const total = raw3.reduce((a, [, w]) => a + w, 0);
  let readings = raw3.map(([reading, w]) => ({ reading, weight: w / total })).sort((a, b) => b.weight - a.weight);
  // calibration cap: never more than 0.7 for any reading from text alone
  const over = readings[0].weight - 0.7; if (over > 0) { readings[0].weight = 0.7; const rest = readings.slice(1), sum = rest.reduce((a, r) => a + r.weight, 0); for (const r of rest) r.weight += over * (r.weight / sum); }
  readings = readings.map(r => ({ ...r, weight: Math.round(r.weight * 100) / 100, basis: basisFor(r.reading, observed) }));
  const spread = readings[0].weight - readings[1].weight;
  return { observed, readings, applies: true, uncertain: true, ambiguous: spread < 0.25, note: 'Inferred from wording and the previous turns only — KENUXA cannot know how someone feels.' };
}
function basisFor(reading, o) {
  const b = [];
  if (reading.startsWith('literally')) { b.push('the words say “fine”'); if (o.previousPositive) b.push('previous turn was positive'); if (o.askedAfterCareQuestion) b.push('reply to a “how are you” question'); }
  if (reading.includes('guarded')) { if (o.ellipsis) b.push('trailing ellipsis'); if (o.previousNegative) b.push('a difficult earlier turn'); }
  if (reading.includes('irritated')) { if (o.capitals.length) b.push('capitalised ' + o.capitals.join(', ')); if (o.interjection) b.push(`opening “${o.interjection}”`); if (o.exclamation) b.push('exclamation'); }
  return b.length ? b : ['weak default plausibility'];
}
// A reply that respects the uncertainty: it never tells the person what they feel.
export function toneReply(tone) {
  if (!tone?.applies) return null; const top = tone.readings[0];
  if (top.reading.startsWith('literally') && !tone.ambiguous) return 'Good to hear. Is there anything you’d like to talk about or work on?';
  if (top.reading.includes('irritated')) return 'Okay. I might be reading this wrong, but if something’s annoying you — including something I said — tell me and I’ll try to fix it.';
  return 'Okay — glad if that’s so. And if anything is weighing on you, I’m happy to listen; no pressure either way.';
}
