// Reads physical quantities out of text: "a 60 W bulb for 5 hours", "1.5kW", "4,000 mAh", "GH₵1.8 per kWh", "10%".
// Returns each value with its unit, dimension and position. Nothing is guessed: a number without a known unit is
// returned as a bare number so that callers can ask for the missing unit instead of assuming one.
import { UNITS } from '../peers/tasks.mjs';

const UNIT_RE = '(kwh|mwh|wh|kj|j|kw|mw|w(?:atts?)?|mah|ah|ma|amps?|a|volts?|v|hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?|s|days?|weeks?|months?|years?|percent|%|km|cm|m2|m|panels?|devices?|items?)';
const CUR_RE = '(gh₵|ghs|ghc|cedis?|\\$|usd|ngn|naira|€|eur)';
const NUM_RE = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const ALIAS = { ghc: 'ghs', '€': 'eur', a: 'a', amps: 'amps', amp: 'amp', hrs: 'hrs', hr: 'hr' };
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, half: 0.5 };
const num = s => Number(String(s).replace(/,/g, ''));

export function parseQuantities(text) {
  let t = String(text || '');
  // number words → digits ("three hours", "ten minutes", "half an hour")
  t = t.replace(/\bhalf an? hour\b/gi, '0.5 hours').replace(/\b(an?|one) hour and a half\b/gi, '1.5 hours').replace(/\ban hour\b/gi, '1 hour').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\b(?=[\s-]+(?:hours?|minutes?|days?|weeks?|months?|years?|panels?|devices?|watts?|percent))/gi, w => String(WORDNUM[w.toLowerCase()]));
  const out = [], taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  // money with currency before or after; "per kWh" makes it a price per energy
  for (const m of t.matchAll(new RegExp(`${CUR_RE}\\s?${NUM_RE}(\\s*(?:per|/|a)\\s*(kwh|month))?|${NUM_RE}\\s?${CUR_RE}(\\s*(?:per|/|a)\\s*(kwh|month))?`, 'gi'))) {
    const value = num(m[2] || m[5]), cur = (m[1] || m[6]).toLowerCase(), per = (m[4] || m[8] || '').toLowerCase();
    const unit = per ? `money/${per}` : 'money'; out.push({ value, unit, dim: UNITS[unit][0], currency: ALIAS[cur] || cur, raw: m[0], index: m.index }); taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of t.matchAll(new RegExp(`(?<![\\w.])${NUM_RE}\\s?-?${UNIT_RE}(?![\\w])`, 'gi'))) {
    if (!free(m.index, m.index + m[0].length)) continue;
    let u = m[2].toLowerCase(); u = ALIAS[u] || u; if (u === 'w' || /^watts?$/.test(u)) u = 'w';
    // "a" and "s" and "m" are only units right after a number with no space or in technical writing; accept, but mark
    const def = UNITS[u]; if (!def) continue;
    out.push({ value: num(m[1]), unit: u, dim: def[0], raw: m[0], index: m.index, ambiguous: ['a', 's', 'm', 'v'].includes(u) && /\s/.test(m[0]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of t.matchAll(new RegExp(`(?<![\\w.])${NUM_RE}(?![\\w.%])`, 'g'))) if (free(m.index, m.index + m[0].length)) out.push({ value: num(m[1]), unit: '', dim: 'number', raw: m[0], index: m.index });
  return out.sort((a, b) => a.index - b.index).filter(q => !q.ambiguous || !/^(a|s)$/.test(q.unit) || /\d(a|s)\b/i.test(q.raw));
}
export const byDim = (qs, dim) => qs.filter(q => q.dim === dim);
