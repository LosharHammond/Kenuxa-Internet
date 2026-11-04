// Studio "Word atoms" explorer: lists every atom in the registry (words, senses, phrases, sentences, concepts …)
// and shows each atom's complete DNA: meanings, usage, links to other atoms and revision history.
// All data is rendered with textContent, never as HTML.
(() => {
  const $ = s => document.querySelector(s);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  const get = u => (typeof api === 'function' ? api(u) : fetch('/api/' + u).then(r => r.json()));
  let offset = 0, limit = 40, total = 0, wired = false;

  function chip(text, cls = '') { return mk('span', 'lx-chip ' + cls, text); }
  function kv(parent, k, v) { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return; const row = mk('div', 'lx-kv'); row.append(mk('b', '', k), mk('span', '', Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ') : v)); parent.append(row); }

  async function list() {
    const q = encodeURIComponent($('#lx-q').value.trim()), type = encodeURIComponent($('#lx-type').value), status = encodeURIComponent($('#lx-status').value);
    const d = await get(`atoms/list?q=${q}&type=${type}&status=${status}&offset=${offset}&limit=${limit}`); total = d.total;
    $('#lx-summary').textContent = `${d.total.toLocaleString()} matching · ` + Object.entries(d.byType || {}).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(' · ') + ` · ${d.queue} waiting for the teacher · ${d.guided} teacher-guided so far`;
    const box = $('#lx-list'); box.replaceChildren();
    if (!d.atoms.length) box.append(mk('p', 'footnote', 'No atom matches. A new word becomes an atom the first time anyone uses it.'));
    for (const a of d.atoms) {
      const b = mk('button', 'lx-item'); b.type = 'button'; b.setAttribute('role', 'listitem');
      const top = mk('div', 'lx-top'); top.append(mk('strong', '', a.text), chip(a.type), chip(a.meaningStatus, a.meaningStatus === 'unknown' ? 'warn' : ''), chip(a.validation));
      b.append(top, mk('small', '', (a.pos ? [].concat(a.pos).join('/') + ' · ' : '') + (a.meaning || 'meaning not yet known') + ` · ${a.uses} uses · ${a.revisions} revisions`));
      b.addEventListener('click', () => detail(a.id)); box.append(b);
    }
    $('#lx-prev').disabled = offset === 0; $('#lx-next').disabled = offset + limit >= total;
  }

  async function detail(id) {
    const box = $('#lx-detail'); box.replaceChildren(mk('p', 'footnote', 'Loading…'));
    const d = await get('lexicon/atom?id=' + encodeURIComponent(id)); box.replaceChildren();
    if (d.error) { box.append(mk('p', 'notice', d.error)); return; }
    const x = d.dna, h = mk('div', 'lx-top'); h.append(mk('h2', '', x.identity.canonical), chip(x.identity.type), chip(x.identity.validation), chip('v' + (x.identity.knowledgeVersion || 1)));
    box.append(h, mk('code', 'lx-id', x.identity.id));
    const idn = mk('section', 'lx-sec'); idn.append(mk('h3', '', 'Identity & language'));
    kv(idn, 'Language', x.identity.language); kv(idn, 'Part of speech', x.linguistic?.partsOfSpeech || x.linguistic?.pos); kv(idn, 'Lemma', x.linguistic?.lemma); kv(idn, 'Forms', x.linguistic?.inflections); kv(idn, 'Pronunciation', x.linguistic?.pronunciation); kv(idn, 'Expression kind', x.linguistic?.kind); kv(idn, 'Words', x.linguistic?.words); kv(idn, 'Created', x.identity.createdAt); kv(idn, 'Origin node', x.identity.originNode); kv(idn, 'Durability', d.manifest?.durability);
    box.append(idn);
    const sem = mk('section', 'lx-sec'); sem.append(mk('h3', '', 'Meaning'));
    kv(sem, 'Status', x.semantic?.meaningStatus || (d.senses.length || x.semantic?.definition || x.semantic?.meaning || x.semantic?.claim ? 'known' : 'unknown')); kv(sem, 'Purpose', x.semantic?.purpose); kv(sem, 'Definition', x.semantic?.definition || x.semantic?.meaning); kv(sem, 'Claim', x.semantic?.claim); kv(sem, 'Function', x.semantic?.function); kv(sem, 'Tags', x.semantic?.tags); kv(sem, 'Broader', x.semantic?.hypernyms); kv(sem, 'Note', x.semantic?.note);
    d.senses.forEach((s, i) => { const c = mk('div', 'lx-sense'); c.append(mk('b', '', `${i + 1}. ${s.pos ? '(' + s.pos + ') ' : ''}${s.definition || s.id}`)); kv(c, 'Is a', s.hypernyms); kv(c, 'Field', s.categories); kv(c, 'Used', s.usage); kv(c, 'Register', s.register); kv(c, 'Examples', s.examples); kv(c, 'Synonyms', s.synonyms); kv(c, 'Antonyms', s.antonyms); c.append(mk('small', 'footnote', s.id + ' · ' + (s.validation || ''))); sem.append(c); });
    box.append(sem);
    const fn = mk('section', 'lx-sec'); fn.append(mk('h3', '', 'Use'));
    kv(fn, 'Collocations', x.functional?.collocations); kv(fn, 'Usage notes', x.functional?.usageNotes); kv(fn, 'Examples', x.functional?.examples);
    if (d.usage) { kv(fn, 'Observed uses', `${d.usage.count} (first ${d.usage.firstSeen?.slice(0, 10)}, last ${d.usage.lastSeen?.slice(0, 10)})`); kv(fn, 'Roles', d.usage.roles); kv(fn, 'Surface forms', d.usage.forms); kv(fn, 'Sources', d.usage.sources); kv(fn, 'Seen with', d.usage.collocates.map(c => `${c.label} (${c.n})`)); kv(fn, 'Seen in', d.usage.examples); }
    box.append(fn);
    const rel = mk('section', 'lx-sec'); rel.append(mk('h3', '', `Links (${d.relations.length})`));
    for (const e of d.relations.slice(0, 60)) { const b = mk('button', 'lx-link'); b.type = 'button'; b.textContent = `${e.type} → ${e.label}` + (e.confidence != null ? ` · ${e.confidence}` : '') + (e.source ? ` · ${e.source}` : ''); b.addEventListener('click', () => detail(e.target)); rel.append(b); }
    box.append(rel);
    const ep = mk('section', 'lx-sec'); ep.append(mk('h3', '', 'Evidence & trust'));
    kv(ep, 'Confidence', x.epistemic?.confidence); kv(ep, 'Verification', x.epistemic?.verification); kv(ep, 'Uncertainty', x.epistemic?.uncertainty); kv(ep, 'Evidence', (x.epistemic?.evidence || []).map(e => e.source + (e.provider ? ':' + e.provider : '') + (e.uses ? ` (${e.uses} uses)` : ''))); kv(ep, 'Corroborated by', d.manifest?.corroboration?.agree?.length ? d.manifest.corroboration.agree.length + ' node(s)' : null); kv(ep, 'Teacher replies rejected', d.rejected.map(r => r.issues.join('; ')));
    box.append(ep);
    const hi = mk('section', 'lx-sec'); hi.append(mk('h3', '', `Revision history (${d.manifest.history.length})`));
    for (const r of d.history.slice().reverse()) hi.append(mk('div', 'lx-kv', `v${r.knowledgeVersion || '?'} · ${r.validation || ''}${r.meaningStatus ? ' · ' + r.meaningStatus : ''} · ${r.rev.slice(0, 16)}…`));
    box.append(hi);
    const raw = mk('details'); raw.append(mk('summary', '', 'Raw DNA (JSON)'), mk('pre', 'lx-raw', JSON.stringify(x, null, 2))); box.append(raw);
  }

  async function expressions() {
    const d = await get('atoms/candidates'), box = $('#lx-expr'); box.replaceChildren();
    const made = mk('div', 'lx-cols'), a = mk('div'), b = mk('div');
    a.append(mk('h3', '', `Expression atoms (${d.expressions.length})`)); for (const e of d.expressions.slice().reverse().slice(0, 40)) { const btn = mk('button', 'lx-link'); btn.type = 'button'; btn.textContent = `${e.text} · ${e.kind}${e.meaning ? ' — ' + e.meaning : ' — meaning unknown'}`; btn.addEventListener('click', () => detail(e.id)); a.append(btn); }
    b.append(mk('h3', '', `Waiting to be checked (${d.candidates.length})`)); for (const c of d.candidates.slice(0, 30)) b.append(mk('div', 'lx-kv', `${c.sentence ? 'sentence: ' : ''}“${c.phrase}” · seen ${c.count}×${c.pmi != null ? ' · PMI ' + c.pmi : ''}`));
    b.append(mk('p', 'footnote', `${d.checked} combinations already checked by the teacher.`));
    made.append(a, b); box.append(made);
  }

  async function open() {
    if (!wired) {
      wired = true;
      $('#lx-form').addEventListener('submit', e => { e.preventDefault(); offset = 0; list().catch(err => $('#lx-summary').textContent = err.message); });
      $('#lx-type').addEventListener('change', () => { offset = 0; list(); }); $('#lx-status').addEventListener('change', () => { offset = 0; list(); });
      $('#lx-prev').addEventListener('click', () => { offset = Math.max(0, offset - limit); list(); });
      $('#lx-next').addEventListener('click', () => { offset += limit; list(); });
    }
    await Promise.all([list(), expressions()]);
  }
  window.kenuxaLexicon = open;
})();
