// Studio "Live evolution": learning events, claims, methods and answer history. All data rendered as text.
(() => {
  const $ = s => document.querySelector(s);
  const mk = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; if (t !== undefined && t !== null) e.textContent = String(t); return e; };
  const call = (u, body) => (typeof api === 'function' ? api(u, body) : fetch('/api/' + u, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json()));
  const chip = (t, warn) => mk('span', 'lx-chip' + (warn ? ' warn' : ''), t);
  let wired = false;
  async function render() {
    const [st, ev, cl, me, an] = await Promise.all([call('live/status'), call('live/events?limit=40'), call('live/claims'), call('live/methods'), call('live/answers')]);
    const box = $('#lv-status'); box.replaceChildren();
    const card = (title, lines) => { const c = mk('article', 'card'); c.append(mk('h3', '', title)); for (const l of lines) c.append(mk('p', '', l)); box.append(c); };
    card('Knowledge revision', [`Sequence ${st.ledger.seq}`, Object.entries(st.ledger.byState).map(([k, v]) => `${v} ${k}`).join(' · ') || 'no events yet', `${st.ledger.metrics.invalidated} dependent items invalidated so far`]);
    card('Claims', [`${st.claims.claims} claims · ${st.claims.disputes} recorded disagreements`, Object.entries(st.claims.byVerdict).map(([k, v]) => `${v} ${k}`).join(' · ') || '—']);
    card('Methods', [`${st.methods.active} active of ${st.methods.methods}`, `${st.methods.runs} runs · ${st.methods.needs} learning needs`]);
    card('Neural weights', [`training steps ${st.neural.trainingSteps}`, st.neural.note]);
    card('Privacy & recovery', [`${st.privateWords} conversation words kept private`, `restart recovery: ${st.recovery.rolledForward.length} rolled forward, ${st.recovery.failed.length} failed`, `${st.failedTeacherRequests} failed teacher requests awaiting explicit retry`]);
    const e = $('#lv-events'); e.replaceChildren(); if (!ev.events.length) e.append(mk('p', 'footnote', 'No learning events yet.'));
    for (const x of ev.events) { const row = mk('div', 'lx-sense'); const top = mk('div', 'lx-top'); top.append(mk('strong', '', x.summary), chip(x.state, !['active'].includes(x.state)), chip(x.kind), chip('durability ' + x.persistence), x.activation ? chip('seq ' + x.activation.seq) : '', x.network ? chip('network ' + x.network.status + (x.network.voters ? ` ${x.network.accept + 1}/${x.network.voters}` : ''), x.network.status === 'contested') : '', x.proposedBy ? chip('from peer') : ''); row.append(top, mk('div', 'footnote', x.history.map(h => h.state).join(' → ') + ' · ' + (x.history.at(-1)?.reason || '')));
      if (x.propagation) row.append(mk('div', 'footnote', `updated: ${x.propagation.organism.map(o => `${o.kind} ${o.id} r${o.from}→r${o.to}`).join(', ') || 'no organism entities'} · invalidated ${x.propagation.invalidated.length}`));
      if (x.state === 'active') { const b = mk('button', 'secondary', 'Revoke'); b.type = 'button'; b.addEventListener('click', async () => { await call('live/revoke', { event: x.id, reason: 'revoked from studio' }); render(); }); row.append(b); }
      e.append(row); }
    const c = $('#lv-claims'); c.replaceChildren(); if (!cl.claims.length) c.append(mk('p', 'footnote', 'No claims recorded yet.'));
    for (const a of cl.claims.slice(-20).reverse()) { const r = mk('div', 'lx-kv'); r.append(mk('b', '', a.verdict), mk('span', '', `${a.claim} — ${a.reason}`)); c.append(r); }
    const m = $('#lv-methods'); m.replaceChildren(); if (!me.methods.length) m.append(mk('p', 'footnote', 'No learned methods yet.'));
    for (const x of me.methods) { const r = mk('div', 'lx-sense'); r.append(mk('b', '', `${x.family} · r${x.revision} · ${x.status}`), mk('p', '', x.purpose), mk('small', 'footnote', `applied ${x.outcomes.applied} · succeeded ${x.outcomes.succeeded} · failed ${x.outcomes.failed} · rejected as inapplicable ${x.outcomes.rejected} · ${x.provenance.source}`)); m.append(r); }
    const h = $('#lv-answers'); h.replaceChildren(); if (!an.answers.length) h.append(mk('p', 'footnote', 'No answer history yet.'));
    for (const a of an.answers.slice(-12).reverse()) { const r = mk('div', 'lx-kv'); r.append(mk('b', '', a.revisions.at(-1)?.change?.kind || '—'), mk('span', '', `${a.label || a.key} · ${a.revisions.length} revision(s)${a.cached ? ' · cached' : ''}`)); h.append(r); }
  }
  async function open() {
    if (!wired) { wired = true;
      $('#lv-sense').addEventListener('submit', async ev => { ev.preventDefault(); const f = new FormData(ev.target), src = String(f.get('source') || ''); const out = $('#lv-sense-out');
        try { const r = await call('live/sense', { word: f.get('word'), gloss: f.get('gloss'), hypernym: f.get('hypernym'), domain: f.get('domain'), signals: f.get('signals'), evidence: [{ passage: f.get('passage'), url: /^https?:/.test(src) ? src : '', publisher: /^https?:/.test(src) ? '' : src }] }); out.textContent = `${r.event.state}: ${r.event.history.at(-1).reason} (${r.ms} ms)`; }
        catch (e) { out.textContent = e.message; } render(); }); }
    await render();
  }
  window.kenuxaLive = open;
})();
