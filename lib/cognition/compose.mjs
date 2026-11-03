// Response construction from structured knowledge (Interpret → Retrieve → Reason → Plan → Construct).
// Composers select claims from knowledge packs according to the interpreted request (mode, aspect,
// condition, the person's situation), order them, and cite each claim with the sources that support it.
// Citations are numbered once per distinct source, in order of first use — never repeated or invented.
const CAPITAL = { 'very low': 0, low: 1, 'low to medium': 2, 'medium to high': 3, high: 4, 'very high': 5 };
const LICENCE = {
  'licensed-partner': 'the partner company holds the Energy Commission licence; you register your own business',
  install: 'Energy Commission Installation & Maintenance licence',
  'sale-import': 'Energy Commission licence for sale/distribution, plus an importation licence if you import',
  manufacture: 'Energy Commission Manufacturing or Assembling licence',
  power: 'electricity-sales, mini-grid or wholesale-supply licence — not an installer licence',
  verify: 'probably the installation category — confirm with the Energy Commission',
};
class Citations {
  constructor(pack) { this.pack = pack; this.order = []; }
  n(key) { let i = this.order.indexOf(key); if (i < 0) { this.order.push(key); i = this.order.length - 1; } return i + 1; }
  mark(claim) { return claim.sources.map(s => `[${this.n(s)}]`).join(''); }
  list() { return this.order.map((k, i) => ({ n: i + 1, title: this.pack.sources[k].title, url: this.pack.sources[k].url, publisher: this.pack.sources[k].publisher })); }
}
const art = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;

export function rankOptions(options, situation = {}) {
  const w = situation.budget === 'none' ? 3 : situation.budget === 'low' ? 2 : situation.budget === 'substantial' ? -0.3 : 1;
  return options.map(o => {
    let score = -(CAPITAL[o.capital] ?? 3) * w, why = [];
    if (situation.budget === 'none' || situation.budget === 'low') why.push(`needs ${o.capital} start-up capital`);
    if (o.needsTechnician && situation.experience === 'none') { score -= 2; why.push('needs a certified electrical professional, which you said you are not (yet)'); }
    if (o.needsTechnician && situation.experience === 'qualified') { score += 2; why.push('uses the electrical qualification you have'); }
    if (o.licence === 'licensed-partner') why.push('the licence and equipment costs are carried by the licensed partner');
    return { ...o, score, why };
  }).sort((a, b) => b.score - a.score);
}

export function composeFromPack(pack, { mode = 'overview', aspect = null, condition = null, situation = {}, question = '' } = {}) {
  const C = new Citations(pack), claim = id => pack.claims.find(c => c.id === id), used = [];
  const say = id => { const c = claim(id); if (!c) return ''; used.push(c.id); return `${c.text} ${C.mark(c)}${c.status === 'check-current' ? ' _(may have changed — check the current figure)_' : c.status === 'derived' ? ' _(KENUXA’s inference from these sources)_' : ''}`; };
  return pack.kind === 'business-startup' ? startup() : explanation();

  function startup() {
    const ranked = rankOptions(pack.options, situation), lines = [], top = ranked[0];
    const optionLine = o => `- **${o.label}** — ${o.what} _Start-up capital: ${o.capital}. Licence: ${LICENCE[o.licence]}._`;
    const askList = pack.ask.filter(a => !(situation.budget && /money/i.test(a)) && !(situation.experience && /qualification/i.test(a)));
    if (mode === 'recommend') {
      const second = ranked[1];
      lines.push(`**Start with: ${top.label}.**`, '', `Why, from what you've told me: ${top.why.length ? top.why.join('; ') : 'it has the lowest start-up cost of the options we discussed'}.`, '');
      lines.push(`**Next best:** ${second.label} — ${second.what}`, '');
      if (top.licence === 'licensed-partner') lines.push(say('partner-route'), '');
      else lines.push(say('licence-required'), '');
      lines.push(`If your situation changes — for example you gain a CEWP certificate or raise capital — **${pack.options.find(o => o.id === 'install').label.toLowerCase()}** becomes the stronger first business.`);
    } else if (mode === 'licences') {
      lines.push(`**Licences and registrations for a solar business in Ghana** depend on which business you run:`, '');
      for (const o of pack.options) lines.push(`- **${o.label}:** ${LICENCE[o.licence]}.`);
      lines.push('', '**What the sources say**', '', `1. ${say('licence-required')}`, `2. ${say('licence-types')}`, `3. ${say('install-requirements')}`, `4. ${say('no-power-sales')}`, `5. ${say('offence')}`, '', '**Registering the business itself**', '', `- ${say('registration')}`, `- ${say('tax')}`, '', '**Check before you rely on it**', '', `- ${say('install-fees')}`, `- ${say('amendment')}`, '', `KENUXA checked these sources on ${pack.accessed}; confirm current requirements directly with the Energy Commission before applying.`);
    } else if (mode === 'low-capital') {
      lines.push(`**Yes — you can start a solar business in Ghana with ${situation.budget === 'none' ? 'no' : 'little'} money, but not every kind of solar business.** Start where someone else carries the licence and equipment costs, then grow into your own licence:`, '');
      ranked.slice(0, 3).forEach((o, i) => lines.push(`${i + 1}. **${o.label}** — ${o.what} _(${o.why.join('; ')})_`));
      lines.push('', '**Why your own licence can wait**', '', `- ${say('install-fees')}`, `- ${say('partner-route')}`, '', '**A first plan that costs little**', '', `1. Partner with an Energy Commission-licensed installer and agree a commission or apprenticeship.`, `2. Register a business name once you start earning. ${say('registration-fees')}`, `3. Learn the trade; ${situation.experience === 'none' ? 'an electrical qualification such as CEWP is what an installation licence requires later.' : 'keep records of the systems you help deliver.'} ${C.mark(claim('install-requirements'))}`, `4. Apply for your own licence when your revenue can cover the fees. ${C.mark(claim('licence-required'))}`);
      used.push('install-requirements', 'licence-required');
      if (askList.length) lines.push('', '**To tailor this:** ' + askList.join(' '));
    } else {
      lines.push(`**“Solar company” can mean several different businesses — and in Ghana they are licensed differently**, so the first decision is which one you mean:`, '');
      for (const o of ranked) lines.push(optionLine(o));
      lines.push('', '**What the sources confirm**', '', `1. **Register the business.** ${say('registration')}`, `2. **Get the Energy Commission licence for your activity.** ${say('licence-required')} ${say('licence-types')}`, `3. **Have the qualified people the licence needs.** ${say('install-requirements')}`, `4. **Don't operate unlicensed.** ${say('offence')}`, '', '**Check before you rely on it**', '', `- ${say('install-fees')}`, `- ${say('tax')}`, '', '**To tailor this to you:** ' + askList.join(' '));
    }
    return { text: lines.join('\n'), sources: C.list(), options: pack.options.map(o => ({ id: o.id, label: o.label })), mode, claimsUsed: [...new Set(used)], unverified: [...new Set(used)].filter(id => claim(id)?.status !== 'source-checked'), top: top?.id };
  }
  function explanation() {
    const q = String([question, aspect, condition].filter(Boolean).join(' ')).toLowerCase();
    const wants = new Set(q.match(/\p{L}+/gu) || []); if (/\btwo\b|\b2\b/.test(q)) wants.add('two'); if (/disappear|vanish|offline|die|fail|lost|crash/.test(q)) { wants.add('disappear'); wants.add('loss'); }
    const scored = pack.claims.map((c, i) => ({ c, s: c.tags.filter(t => wants.has(t)).length * 2 + (c.text.toLowerCase().match(/\p{L}+/gu) || []).filter(t => t.length > 3 && wants.has(t)).length - i * 0.01 })).sort((a, b) => b.s - a.s);
    const pick = condition ? scored.filter(x => x.s > 0).slice(0, 5).map(x => x.c) : pack.claims.slice(0, 6);
    const lines = condition ? [`**If ${condition.replace(/\?$/, '')}:**`, ''] : [`**${pack.title}**`, ''];
    for (const c of pick) lines.push(`- ${say(c.id)}`);
    return { text: lines.join('\n'), sources: C.list(), options: [], mode: condition ? 'condition' : 'explain', claimsUsed: used, unverified: used.filter(id => claim(id)?.status !== 'source-checked') };
  }
}

export function modeFor({ context, situation = {}, question = '' }) {
  const a = `${context?.aspect || ''} ${question}`.toLowerCase();
  if (context?.kind === 'select-option' || /\b(which|what) (one|option|business|type)\b.*\b(start|choose|pick|best)\b|\bshould i (start|choose|pick)\b/.test(a) && context?.options?.length) return 'recommend';
  if (/\blicen[cs]es?\b|\bpermits?\b|\bregulat|\blegal\b|\bregist(er|ration)\b/.test(a)) return 'licences';
  if (situation.budget === 'none' || situation.budget === 'low') return 'low-capital';
  return 'overview';
}
export { art };
