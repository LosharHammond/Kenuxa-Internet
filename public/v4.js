// v0.4 UI: 7-part responses, core transformer, evolution kernel and MTP network views.
(() => {
  const SECTIONS = [['directAnswer', '1 · Direct answer'], ['meaningGraph', '2 · Meaning graph'], ['outcomes', '3 · Outcomes'], ['capabilities', '4 · Capabilities'], ['actions', '5 · Action layer'], ['evidence', '6 · Evidence layer'], ['evolution', '7 · Evolution layer']];
  const p = (cls, t) => el('p', cls, t);
  function body(key, s, a, m) {
    const box = el('div', 'seven-body');
    if (key === 'directAnswer') { box.append(p('', s.text), el('small', '', `${s.engine}${s.confidence != null ? ' · confidence ' + s.confidence + '%' : ''}`)); const d = s.transformerDraft; if (d) box.append(p('notice', d.available === false ? d.reason : d.error ? 'Transformer draft unavailable: ' + d.error : `Transformer draft (step ${d.trainingSteps}): ${d.text || '—'} — ${d.label}`)); }
    if (key === 'meaningGraph') { if (!s.entities.length) box.append(p('', 'No graph entities yet — a new atom will be proposed from research.')); for (const e of s.entities) box.append(p('', `${e.role === 'core' ? '◆' : e.role === 'cell' ? '⬢' : e.role === 'molecule' ? '⬡' : '◇'} ${e.label} · ${e.kind} · ${e.stage || e.status}${e.trust ? ' · ' + e.trust : ''}`)); if (s.relationships.length) box.append(el('small', '', `${s.relationships.length} relationships: ` + [...new Set(s.relationships.map(r => r.type))].join(', '))); }
    if (key === 'outcomes') box.append(p('', s.expected), p('', `Confidence ${s.confidence}% · validation: ${s.validation}`), p('', `Observed: ${s.observed.ratings} ratings (${s.observed.helpful} helpful)`), p('notice', s.prediction));
    if (key === 'capabilities') { if (!s.length) box.append(p('', 'No executable capabilities discovered on these entities yet.')); const row = el('div', 'actions'); for (const c of s.slice(0, 8)) row.append(button(`${c.skill} · ${c.entityLabel.slice(0, 30)}`, async () => { const out = await api('agents/run', { id: c.entity, skill: c.id, task: a.sections.directAnswer.text ? m.querySelector('.question').textContent : c.execute.body.task }); const pre = el('pre', 'draft', JSON.stringify(out, null, 2).slice(0, 4000)); box.append(pre); })); box.append(row); }
    if (key === 'actions') for (const x of s) box.append(p('', '→ ' + x.label));
    if (key === 'evidence') { for (const e of s.external) { const link = el('a', '', `[${e.citation}] ${e.title}`); link.href = e.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link, el('br')); } for (const e of s.internal) box.append(p('', `Internal: ${e.title} · ${e.source} · ${e.trust || ''}`)); for (const g of s.gaps) box.append(p('notice', g)); }
    if (key === 'evolution') { for (const l of s.learned) box.append(p('', '✧ ' + l)); if (s.transformer) box.append(el('small', '', `Core transformer at step ${s.transformer.steps}${s.transformer.loss != null ? ' · loss ' + s.transformer.loss.toFixed(3) : ''}`)); }
    return box;
  }
  window.kenuxaSeven = (m, a) => {
    const wrap = el('details', 'seven'); wrap.open = true; wrap.append(el('summary', '', 'KENUXA 7-part response'));
    const grid = el('div', 'seven-grid');
    for (const [key, label] of SECTIONS) { const c = el('section', 'seven-card'); c.append(el('h4', '', label), body(key, a.sections[key], a, m)); grid.append(c); }
    wrap.append(grid); m.append(wrap);
  };
  let wired = false;
  async function renderCore() {
    const [t, evo, net, st, org] = await Promise.all([api('transformer'), api('evolution'), api('network'), api('storage'), api('organism')]);
    $('#core-arch').textContent = `${t.layers} layers · ${t.heads} heads · ${t.grouping} · ${t.profile}`;
    $('#core-spec').replaceChildren(...[`${t.parameters.toLocaleString()} parameters · hidden ${t.hiddenDim} · FFN ${t.ffnDim} (${t.feedForward})`, `${t.positional} · ${t.norm} · ${t.contextWindow.toLocaleString()}-token context`, t.attention, `${t.precision} · gradient checkpointing ${t.gradientCheckpointing ? 'on' : 'off'}`, `Training steps ${t.trainingSteps} · tokens ${t.trainedTokens} · loss ${t.smoothedLoss != null ? t.smoothedLoss.toFixed(3) : '—'} · ${t.training ? 'training in background' : 'idle'}`, t.role].map(x => p('', x)));
    $('#core-bg').textContent = t.training ? 'Stop background training' : 'Start background training';
    $('#core-atom').replaceChildren(...org.atoms.filter(a => a.status === 'approved').map(a => { const o = el('option', '', a.title.slice(0, 80) + (a.dna.kernel?.prefix ? ' · kernel ✓' : '')); o.value = a.id; return o; }));
    $('#evo-title').textContent = `${evo.ticks || 0} ticks · last ${evo.lastTick ? new Date(evo.lastTick).toLocaleString() : 'never'}${evo.serverless ? ' · scheduled by cron' : ' · every ' + evo.intervalSeconds + 's'}`;
    $('#evo-log').replaceChildren(...(evo.log || []).slice(0, 8).map(e => { const c = el('div', 'event'); c.append(el('small', '', new Date(e.at).toLocaleTimeString()), el('span', '', e.actions.join(' · ') || 'No changes needed'), el('small', '', Object.entries(e.counts.stages || {}).map(([k, v]) => `${k} ${v}`).join(' · '))); return c; }));
    $('#storage-info').textContent = st.kind === 'supabase' ? `Supabase · ${st.project} · node ${st.nodeId} · mirror ${st.mirror.error ? 'error: ' + st.mirror.error : st.mirror.at ? 'synced ' + new Date(st.mirror.at).toLocaleTimeString() : 'pending'}` : `Local files · ${st.location}. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to store the graph in Supabase.`;
    $('#net-title').textContent = `${net.nodeId} · ${net.platform} · ${net.protocol}`;
    $('#net-info').textContent = `${net.publicUrl ? 'Public URL ' + net.publicUrl : 'No public URL (set PUBLIC_URL when hosted)'} · network secret ${net.secretConfigured ? 'configured' : 'missing — federation disabled'}${net.registryError ? ' · registry: ' + net.registryError : ''}`;
    const all = [...net.configuredPeers.map(o => ({ origin: o, via: 'configured' })), ...net.discovered];
    $('#net-peers').replaceChildren(...(all.length ? all.map(d => { const s = (net.peerStatus || []).find(x => x.peer === d.origin), c = el('article', 'card'); c.append(el('h3', '', d.origin), p('', `${d.nodeId || ''} · ${d.via}`), el('small', '', s ? (s.ok ? `✓ synced · ${s.imported} received · ${s.confirmed || 0} confirmations` : '✕ ' + s.error) : 'not yet contacted')); return c; }) : [p('', 'No peers yet.')]));
    if (wired) return; wired = true;
    $('#core-train').addEventListener('click', run(async () => { const b = $('#core-train'); b.disabled = true; try { const r = await api('transformer/train', { steps: 5 }); toast(`Trained to step ${r.step}, loss ${r.loss?.toFixed(3)}`); await renderCore(); } finally { b.disabled = false; } }));
    $('#core-bg').addEventListener('click', run(async () => { const t2 = await api('transformer'); await api('transformer/train', { action: t2.training ? 'stop' : 'start' }); await renderCore(); }));
    $('#core-gen').addEventListener('submit', run(async e => { e.preventDefault(); const r = await api('transformer/generate', { prompt: $('#core-prompt').value }); $('#core-out').textContent = `${r.text || '(no readable output yet)'}\n\n${r.label} · step ${r.trainingSteps}`; }));
    $('#core-kernel').addEventListener('submit', run(async e => { e.preventDefault(); const r = await api('kernel', { id: $('#core-atom').value }); toast(`Kernel grew: ${r.kernel.prefixTokens} vectors, loss ${r.kernel.kernelLoss?.toFixed(3)}`); await renderCore(); }));
    $('#evo-run').addEventListener('click', run(async () => { const b = $('#evo-run'); b.disabled = true; try { const r = await api('evolve', {}); toast(r.busy ? 'An evolution tick is already running.' : `Tick finished in ${r.ms} ms`); await renderCore(); } finally { b.disabled = false; } }));
    $('#peer-form').addEventListener('submit', run(async e => { e.preventDefault(); await api('peers', { url: $('#peer-url').value }); $('#peer-url').value = ''; await renderCore(); }));
  }
  window.kenuxaCore = renderCore;
})();
