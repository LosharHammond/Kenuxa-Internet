// Studio "Cognitive engine": cognitive atoms, self-evaluation history, the verification queue (teacher disagreements
// waiting for an independent check), promoted/shared procedures, and a form to submit a verified correction.
(() => {
  const $ = s => document.querySelector(s), mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined && x !== null) e.textContent = String(x); return e; };
  const call = (u, b) => (typeof api === 'function' ? api(u, b) : fetch('/api/' + u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}).then(r => r.json()));
  const pct = r => r == null ? '—' : Math.round(100 * r) + '%';
  async function open() {
    const d = await call('mind'), box = $('#mind-status'); box.replaceChildren();
    const card = (h, lines) => { const c = mk('article', 'card'); c.append(mk('h3', '', h)); for (const l of lines) c.append(mk('p', '', l)); box.append(c); };
    const by = d.store.byCategory || {};
    card('Cognitive atoms', [`${d.store.atoms} atoms · ${d.store.revisions} revisions`, Object.entries(by).map(([k, v]) => `${k}: ${Object.entries(v).map(([s, n]) => `${n} ${s}`).join(', ')}`).join(' · ') || '—']);
    card('Experience', [`${d.experience.episodes} reasoning episodes`, Object.entries(d.experience.byOutcome || {}).map(([k, v]) => `${v} ${k}`).join(' · ') || '—']);
    card('Evolution', [`${d.evolution.corrections} verified corrections · case bank ${d.evolution.cases.dev} dev / ${d.evolution.cases.heldOut} held-out`, ...(d.evolution.recent || []).slice(-3).map(e => `${e.kind}${e.id ? ' ' + e.id : ''}`)]);
    card('Self-evaluation', (d.evaluations || []).length ? d.evaluations.map(e => `${e.at.slice(0, 16)} · held-out calc ${pct(e.calcHeldOut)} → ${pct(e.afterLearning)} after learning · diagnosis ${pct(e.diagnosis)} · comprehension ${pct(e.comprehensionHeldOut)}`) : ['not run yet — use “Run self-evaluation”']);
    try { const e = await call('evolution'); card('Universal evolution (KUEE)', [`${e.records} change records · ${Object.entries(e.byStatus || {}).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none yet'}`, `policies: ${Object.entries(e.policies || {}).map(([k, p]) => `${k} v${p.active} (${p.risk})`).join(' · ')}`, `canaries running: ${Object.keys(e.canaries || {}).join(', ') || 'none'} · providers: ${Object.entries(e.providers || {}).map(([k, v]) => `${v} ${k}`).join(' · ')}`, ...(e.recent || []).slice(-3).map(r => `${r.target}: ${r.status}${r.rejection ? ' — ' + r.rejection.slice(0, 90) : ''}`)]); } catch {}
    const q = $('#mind-review'); q.replaceChildren(); if (!(d.review || []).length) q.append(mk('p', 'footnote', 'Nothing waiting. Teacher disagreements about KENUXA’s own computations appear here; they are never learned from until verified.'));
    for (const r of (d.review || []).slice().reverse()) { const row = mk('div', 'lx-kv'); row.append(mk('b', '', r.errorClass), mk('span', '', `${r.question} — ${r.evidence}`)); q.append(row); }
    const sh = $('#mind-shared'); sh.replaceChildren(); for (const s of d.shared || []) sh.append(mk('div', 'lx-kv', `${s.id} · v${s.version} · ${s.status}`)); if (!(d.shared || []).length) sh.append(mk('p', 'footnote', 'No promoted public atoms yet.'));
  }
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'mind-correct') return; ev.preventDefault(); const f = new FormData(ev.target), out = $('#mind-correct-out');
    const r = await call('mind/correct', { problem: f.get('problem'), expected: { value: Number(f.get('value')), unit: f.get('unit') }, verifiedBy: f.get('verifiedBy'), ref: f.get('ref') });
    out.textContent = r.error ? r.error : r.status === 'already-correct' ? 'KENUXA already answers this correctly.' : `${r.diagnosis?.cause || ''} → ${r.expr || r.reason} · ${r.promoted ? 'PROMOTED (no regressions)' : 'not promoted: ' + (r.reason || '')}`; open();
  });
  document.addEventListener('click', async ev => { if (ev.target.id === 'mind-eval') { ev.target.disabled = true; await call('mind/evaluate', {}); ev.target.disabled = false; open(); } });
  window.kenuxaMind = open;
})();
