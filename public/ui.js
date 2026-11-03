// KENUXA v0.5 premium interface layer: living cosmos, comprehension UI, command palette, force graph.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  const appVisible = () => !$('#app').classList.contains('hidden');
  const landingVisible = () => !$('#login').classList.contains('hidden');
  const hashHue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return [158, 196, 256, 330, 42][h % 5]; };

  // ---------------- living cosmos (landing) ----------------
  const cosmos = { nodes: [], edges: [], pulses: [], labels: [], mx: 0, my: 0, rot: 0, ready: false };
  function seedCosmos(graph) {
    const N = 150, labels = (graph?.nodes || []).map(n => n.label).filter(Boolean).slice(0, 26);
    cosmos.nodes = Array.from({ length: N }, (_, i) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = i * 2.399963; return { x: Math.cos(t) * r, y, z: Math.sin(t) * r, hue: [158, 196, 256][i % 3], label: i % 6 === 0 ? labels[(i / 6) % Math.max(1, labels.length) | 0] : null }; });
    cosmos.edges = []; for (let i = 0; i < N; i++) { const a = cosmos.nodes[i]; const near = cosmos.nodes.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j > i).sort((p, q) => p[1] - q[1]).slice(0, 2); for (const [j, d] of near) if (d < 0.12) cosmos.edges.push([i, j]); }
    cosmos.ready = true;
  }
  function drawCosmos(t) {
    const c = $('#cosmos'); if (!c || !landingVisible()) return requestAnimationFrame(drawCosmos);
    const d = DPR(), w = c.clientWidth, h = c.clientHeight; if (c.width !== w * d || c.height !== h * d) { c.width = w * d; c.height = h * d; }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    if (!cosmos.ready) seedCosmos(null);
    cosmos.rot += reduce ? 0 : 0.0016; const ry = cosmos.rot + cosmos.mx * 0.4, rx = 0.35 + cosmos.my * 0.25;
    const R = Math.min(w, h) * (w < 760 ? 0.42 : 0.36), cx = w * (w < 760 ? 0.5 : 0.68), cy = h * 0.48, cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);
    const P = cosmos.nodes.map(n => { const x = n.x * cosY - n.z * sinY, z1 = n.x * sinY + n.z * cosY, y = n.y * cosX - z1 * sinX, z = n.y * sinX + z1 * cosX, s = 1.6 / (2.6 - z); return { sx: cx + x * R * s, sy: cy + y * R * s, z, s, n }; });
    g.lineWidth = 1;
    for (const [i, j] of cosmos.edges) { const a = P[i], b = P[j], alpha = Math.max(0, (a.z + b.z + 2) / 4) * 0.35; g.strokeStyle = `hsla(${a.n.hue},90%,70%,${alpha})`; g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke(); }
    if (!reduce && Math.random() < 0.18 && cosmos.edges.length) cosmos.pulses.push({ e: cosmos.edges[(Math.random() * cosmos.edges.length) | 0], p: 0 });
    cosmos.pulses = cosmos.pulses.filter(q => (q.p += 0.018) < 1);
    for (const q of cosmos.pulses) { const a = P[q.e[0]], b = P[q.e[1]], x = a.sx + (b.sx - a.sx) * q.p, y = a.sy + (b.sy - a.sy) * q.p; const gr = g.createRadialGradient(x, y, 0, x, y, 7); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(126,240,196,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
    P.sort((a, b) => a.z - b.z);
    for (const p of P) { const depth = (p.z + 1) / 2, r = 1.2 + depth * 2.6 * p.s; g.fillStyle = `hsla(${p.n.hue},95%,${60 + depth * 20}%,${0.25 + depth * 0.75})`; g.beginPath(); g.arc(p.sx, p.sy, r, 0, 7); g.fill();
      if (depth > 0.6) { g.fillStyle = `hsla(${p.n.hue},95%,70%,${(depth - 0.6) * 0.35})`; g.beginPath(); g.arc(p.sx, p.sy, r * 4, 0, 7); g.fill(); }
      if (p.n.label && depth > 0.55 && w > 760) { g.font = '500 11px ui-monospace,Menlo,monospace'; g.fillStyle = `rgba(220,235,245,${(depth - 0.55) * 1.6})`; g.fillText(p.n.label.slice(0, 28), p.sx + 9, p.sy + 4); } }
    requestAnimationFrame(drawCosmos);
  }
  addEventListener('pointermove', e => { cosmos.mx += ((e.clientX / innerWidth - 0.5) - cosmos.mx) * 0.08; cosmos.my += ((e.clientY / innerHeight - 0.5) - cosmos.my) * 0.08; }, { passive: true });

  function countUp(node, to) { if (!node) return; const from = Number(node.dataset.v || 0), start = performance.now(), dur = reduce ? 1 : 1400; node.dataset.v = to; const step = now => { const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3); node.textContent = Math.round(from + (to - from) * e).toLocaleString(); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
  async function loadPulse() {
    try { const r = await fetch('/pulse'); if (!r.ok) return; const p = await r.json(); seedCosmos(p.graph); for (const k of ['atoms', 'molecules', 'cells', 'specialists']) countUp(document.querySelector(`[data-count="${k}"]`), p.counts[k] || 0); } catch { /* offline: static landing */ }
  }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((n, i) => { n.style.transitionDelay = `${(i % 4) * 90}ms`; io.observe(n); });

  // Illustrative comprehension demo (static examples, clearly labelled on the page).
  const DEMOS = [
    { q: 'How do I start a solar company in Ghana with $5,000?', c: [['INTENT', 'Achieve a goal'], ['GOAL', 'start a solar company in Ghana'], ['CONSTRAINTS', 'location Ghana · budget $5,000'], ['ANSWER SHAPE', 'staged plan']] },
    { q: 'Compare shoe and dress', c: [['INTENT', 'Compare options'], ['MEANING ATOMS', 'Shoe · Dress'], ['FRAMES', 'footwear vs garment'], ['ANSWER SHAPE', 'comparison']] },
    { q: 'Why do plants need sunlight?', c: [['INTENT', 'Understand causes'], ['FOCUS', 'plants need sunlight'], ['MEANING ATOMS', 'photosynthesis · solar energy'], ['ANSWER SHAPE', 'reasons']] },
    { q: 'Tell me more about it', c: [['INTENT', 'Go deeper'], ['REFERENCE', '“it” → the last concept discussed'], ['GOAL', 'more detail and connections'], ['ANSWER SHAPE', 'explanation']] },
  ];
  async function demoLoop() {
    const q = $('#demo-question'), grid = $('#demo-grid'); if (!q) return; let i = 0;
    for (;;) { const d = DEMOS[i++ % DEMOS.length]; grid.replaceChildren(); q.textContent = '';
      for (const ch of d.q) { q.textContent += ch; await new Promise(r => setTimeout(r, reduce ? 0 : 34)); }
      for (const [k, v] of d.c) { const cell = el('div'); cell.append(el('b', '', k), el('span', '', v)); grid.append(cell); await new Promise(r => setTimeout(r, reduce ? 0 : 260)); }
      await new Promise(r => setTimeout(r, 3600)); }
  }

  // Showcase: owners can view the landing page from inside the app.
  $('#open-showcase')?.addEventListener('click', () => { document.body.classList.add('showcase'); $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#close-showcase').classList.remove('hidden'); scrollTo({ top: 0 }); });
  $('#close-showcase')?.addEventListener('click', () => { document.body.classList.remove('showcase'); $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#close-showcase').classList.add('hidden'); scrollTo({ top: 0 }); });

  // ---------------- comprehension UI ----------------
  function chips(u, box) {
    const add = (cls, label, value) => { const c = el('span', 'chip ' + cls); c.append(el('b', '', label), document.createTextNode(value)); box.append(c); };
    add('intent', 'intent', u.intent.label);
    if (u.focus) add('', 'focus', u.focus);
    if (u.action) add('', 'action', u.action);
    for (const [k, v] of Object.entries(u.constraints || {})) add('cons', k, v);
    for (const c of (u.concepts || []).slice(0, 4)) add('atom', c.match === 'exact' ? 'atom' : c.match, c.phrase);
    for (const r of u.references || []) add('ref', `“${r.pronoun}”`, '→ ' + r.to);
    for (const t of (u.unknownTerms || []).slice(0, 3)) add('warn', 'new', t);
  }
  let liveTimer = null, liveSeq = 0;
  $('#question')?.addEventListener('input', () => {
    clearTimeout(liveTimer); const v = $('#question').value.trim(), box = $('#understanding-live');
    if (v.length < 4) { box.replaceChildren(); return; }
    liveTimer = setTimeout(async () => { const seq = ++liveSeq; try { const u = await api('understand', { question: v }); if (seq !== liveSeq) return; box.replaceChildren(); chips(u, box); const m = el('span', 'chip'); m.append(el('b', '', 'understood'), document.createTextNode(Math.round(u.understood * 100) + '%')); box.append(m); } catch { /* preview is best-effort */ } }, 320);
  });
  $('#ask-form')?.addEventListener('submit', () => { clearTimeout(liveTimer); liveSeq++; setTimeout(() => $('#understanding-live').replaceChildren(), 30); });
  const baseSeven = window.kenuxaSeven;
  window.kenuxaSeven = (m, a) => {
    const u = a.understanding;
    const ansEl = m.querySelector('.answer'); if (ansEl && window.renderMarkdown) { ansEl.classList.add('md'); ansEl.replaceChildren(renderMarkdown(a.answer, { sources: (a.evidence || []).filter(e => e.url).map(e => ({ n: e.citation, title: e.title, url: e.url })) })); }
    if (u) { const card = el('div', 'comprehension'), head = el('div', 'c-head'), meter = el('div', 'meter'); meter.style.setProperty('--v', Math.round(u.understood * 100)); meter.append(el('span', '', Math.round(u.understood * 100) + '%'));
      const t = el('div'); t.append(el('p', 'overline', 'HOW KENUXA UNDERSTOOD YOU'), el('p', 'c-sum', u.summary)); head.append(meter, t); const cs = el('div', 'chips'); chips(u, cs); card.append(head, cs);
      if (u.goal?.successCriteria?.length) card.append(el('small', '', 'A good answer gives: ' + u.goal.successCriteria.join(' · ')));
      const ans = m.querySelector('.answer'); ans ? ans.before(card) : m.append(card); }
    baseSeven?.(m, a);
  };

  // ---------------- meaning frame on entity detail ----------------
  const FRAME_FIELDS = [['kind', 'Kind'], ['genus', 'Category'], ['value', 'Value'], ['differentia', 'Distinguished by'], ['purposes', 'Purpose'], ['parts', 'Made of'], ['examples', 'Examples'], ['causes', 'Caused by'], ['effects', 'Leads to'], ['places', 'Places'], ['properties', 'Domains'], ['members', 'Members']];
  let frameBusy = false;
  new MutationObserver(async () => {
    const box = $('#entity-detail'); if (frameBusy || !box || !box.children.length || box.querySelector('.frame-card')) return;
    const id = $('#entity-select')?.value; if (!id) return; frameBusy = true;
    try { const e = await api('entity?id=' + encodeURIComponent(id)); const f = e?.dna?.meaning?.frame; if (!f || box.querySelector('.frame-card')) return;
      const card = el('section', 'frame-card'), h = el('h3'); h.append(el('span', 'badge', 'MEANING FRAME'), document.createTextNode(f.label));
      const grid = el('div', 'frame-grid'); for (const [k, label] of FRAME_FIELDS) { const v = f[k]; if (!v || (Array.isArray(v) && !v.length)) continue; const c = el('div'); c.append(el('b', '', label), el('span', '', Array.isArray(v) ? v.slice(0, 6).join(' · ') : v)); grid.append(c); }
      const depth = el('div', 'depth'), bar = el('i'); bar.style.width = Math.round((f.depth || 0) * 100) + '%'; depth.append(bar);
      card.append(h, el('p', '', f.essence || ''), grid, el('small', '', `Meaning depth ${Math.round((f.depth || 0) * 100)}% · ${(f.provenance || []).join(' · ')}`), depth);
      if (e.status === 'approved' && !e.type) card.append(button('Ask teacher to enrich this meaning', async () => { const r = await api('meaning/enrich', { id }); toast(`Meaning enriched — depth ${Math.round(r.frame.depth * 100)}%`); box.querySelector('.frame-card')?.remove(); }));
      box.prepend(card);
    } catch { /* entity may have been removed */ } finally { frameBusy = false; }
  }).observe(document.body, { childList: true, subtree: true });

  // ---------------- living meaning graph ----------------
  let sim = null;
  window.drawGraph = async function drawGraph() {
    const data = await api('graph'), canvas = $('#graph-canvas'), panel = canvas.parentElement;
    const nodes = data.nodes.slice(0, 160).map((n, i) => ({ ...n, x: Math.cos(i) * 200 + Math.random() * 20, y: Math.sin(i) * 140 + Math.random() * 20, vx: 0, vy: 0, deg: 0, hue: hashHue(n.tags[0] || n.title) }));
    const byId = new Map(nodes.map(n => [n.id, n])), edges = data.edges.map(e => [byId.get(e.from), byId.get(e.to), e.tags]).filter(e => e[0] && e[1]);
    for (const [a, b] of edges) { a.deg++; b.deg++; }
    let tip = panel.querySelector('.graph-tip'); if (!tip) { tip = el('div', 'graph-tip hidden'); panel.append(tip); }
    if (!panel.querySelector('.graph-legend')) { const lg = el('div', 'graph-legend'); for (const [h, t] of [[158, 'atom'], [196, 'shared topic'], [256, 'similar meaning']]) { const s = el('span'); const i = el('i'); i.style.background = `hsl(${h},90%,65%)`; s.append(i, document.createTextNode(t)); lg.append(s); } panel.append(lg); }
    const view = { k: 1, ox: 0, oy: 0 }; let hover = null, drag = null, alpha = 1, userMoved = false;
    if (sim) cancelAnimationFrame(sim);
    function tick() {
      const d = DPR(), w = canvas.clientWidth, h = canvas.clientHeight; if (canvas.width !== w * d) { canvas.width = w * d; canvas.height = h * d; }
      if (alpha > 0.02) { alpha *= 0.985;
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01; if (d2 > 160000) continue; const f = 2200 / d2 * alpha; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy; }
        for (const [a, b] of edges) { const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, f = (dist - 140) * 0.004 * alpha; a.vx += dx / dist * f * dist * 0.1; a.vy += dy / dist * f * dist * 0.1; b.vx -= dx / dist * f * dist * 0.1; b.vy -= dy / dist * f * dist * 0.1; }
        for (const n of nodes) { if (n === drag) continue; n.vx -= n.x * 0.002 * alpha; n.vy -= n.y * 0.003 * alpha; n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; } }
      if (!userMoved && nodes.length) { // auto-fit the living graph into the frame
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const n of nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
        const k = Math.max(0.35, Math.min(1.6, Math.min((w - 120) / Math.max(1, x1 - x0), (h - 110) / Math.max(1, y1 - y0)))); view.k += (k - view.k) * 0.08; view.ox += (-(x0 + x1) / 2 - view.ox) * 0.08; view.oy += (-(y0 + y1) / 2 - view.oy) * 0.08; }
      const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
      const T = n => [w / 2 + (n.x + view.ox) * view.k, h / 2 + (n.y + view.oy) * view.k];
      const t = performance.now() / 1000;
      for (const [a, b, tags] of edges) { const [x1, y1] = T(a), [x2, y2] = T(b), on = hover && (hover === a || hover === b), sem = String(tags).includes('similar'); g.strokeStyle = on ? 'rgba(126,240,196,.85)' : sem ? 'rgba(166,139,255,.35)' : 'rgba(90,209,255,.16)'; g.lineWidth = on ? 1.6 : 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        if (on && !reduce) { const p = (t * 0.6) % 1; g.fillStyle = '#fff'; g.beginPath(); g.arc(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, 2.2, 0, 7); g.fill(); } }
      for (const n of nodes) { const [x, y] = T(n), r = (4 + Math.sqrt(n.deg) * 1.8) * Math.sqrt(view.k), lit = !hover || hover === n || edges.some(([a, b]) => (a === hover && b === n) || (b === hover && a === n));
        const gr = g.createRadialGradient(x, y, 0, x, y, r * 3.2); gr.addColorStop(0, `hsla(${n.hue},95%,70%,${lit ? 0.35 : 0.06})`); gr.addColorStop(1, `hsla(${n.hue},95%,70%,0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 3.2, 0, 7); g.fill();
        g.fillStyle = `hsla(${n.hue},90%,${lit ? 72 : 40}%,${lit ? 1 : 0.5})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        if (lit && (n.deg > 2 || hover === n || nodes.length < 40)) { g.font = `${hover === n ? 600 : 500} 11px ui-sans-serif,system-ui`; g.fillStyle = lit ? 'rgba(230,240,248,.92)' : 'rgba(230,240,248,.3)'; g.textAlign = 'center'; g.fillText(n.title.replace(/^What (is|are|does) /i, '').replace(/\?$/, '').slice(0, 30), x, y + r + 14); } }
      sim = requestAnimationFrame(tick);
    }
    const pick = (ev) => { const rect = canvas.getBoundingClientRect(), px = ev.clientX - rect.left, py = ev.clientY - rect.top, w = canvas.clientWidth, h = canvas.clientHeight; let best = null, bd = 400; for (const n of nodes) { const x = w / 2 + (n.x + view.ox) * view.k, y = h / 2 + (n.y + view.oy) * view.k, dd = (x - px) ** 2 + (y - py) ** 2; if (dd < bd) { bd = dd; best = n; } } return { best, px, py }; };
    canvas.onpointermove = ev => { const { best, px, py } = pick(ev); if (drag) { drag.x += ev.movementX / view.k; drag.y += ev.movementY / view.k; alpha = Math.max(alpha, 0.3); return; } if (ev.buttons === 1 && !best) { userMoved = true; view.ox += ev.movementX / view.k; view.oy += ev.movementY / view.k; } hover = best;
      if (best) { tip.classList.remove('hidden'); tip.style.left = px + 'px'; tip.style.top = py + 'px'; tip.replaceChildren(document.createTextNode(best.title), el('small', '', `${best.tags.join(' · ')} · ${best.deg} connections · ${best.origin}`)); } else tip.classList.add('hidden'); };
    canvas.onpointerdown = ev => { const { best } = pick(ev); drag = best; canvas.setPointerCapture(ev.pointerId); };
    canvas.onpointerup = ev => { if (drag && Math.abs(ev.movementX) + Math.abs(ev.movementY) < 2) { const id = drag.id; drag = null; await0(id); } drag = null; };
    canvas.onpointerleave = () => { hover = null; tip.classList.add('hidden'); };
    canvas.onwheel = ev => { ev.preventDefault(); userMoved = true; view.k = Math.min(3, Math.max(0.4, view.k * (ev.deltaY < 0 ? 1.1 : 0.9))); };
    async function await0(id) { await view_('organism', id); }
    tick();
    const list = $('#graph-list'); list.replaceChildren(); for (const n of [...nodes].sort((a, b) => b.deg - a.deg)) { const c = el('article', 'card'); c.append(el('h3', '', n.title), el('div', 'tags', n.tags.join(' · ')), el('small', '', `${n.deg} connections · ${n.source}`)); list.append(c); }
  };
  async function view_(name, entityId) { await view(name); if (entityId && $('#entity-select')) { $('#entity-select').value = entityId; $('#entity-select').dispatchEvent(new Event('change')); } }

  // ---------------- command palette ----------------
  const VIEWS = [['chat', 'Ask Kenuxa'], ['organism', 'Atoms & DNA'], ['graph', 'Meaning graph'], ['learn', 'Learning studio'], ['research', 'Web learning'], ['teachers', 'AI teachers'], ['core', 'Core & evolution'], ['network', 'Connected nodes'], ['activity', 'Memory & outcomes']];
  const commands = () => [
    ...VIEWS.map(([v, t]) => ({ label: `Go to ${t}`, hint: 'VIEW', run: () => view(v) })),
    { label: 'Run an evolution tick', hint: 'EVOLVE', run: async () => { const r = await api('evolve', {}); toast(r.busy ? 'Evolution is already running.' : `Evolution tick finished in ${r.ms} ms`); } },
    { label: 'Train the core transformer · 5 steps', hint: 'TRAIN', run: async () => { const r = await api('transformer/train', { steps: 5 }); toast(`Transformer step ${r.step}, loss ${r.loss?.toFixed(3)}`); } },
    { label: 'Sync with connected nodes', hint: 'MTP', run: async () => { await api('sync', {}); toast('Sync finished.'); } },
    { label: 'View the showcase page', hint: 'SHOW', run: () => $('#open-showcase').click() },
  ];
  let sel = 0, items = [];
  function renderPalette() {
    const q = $('#palette-input').value.trim(), list = $('#palette-list'); items = commands().filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
    if (q.length > 2) items[items.length ? 'push' : 'unshift']({ label: `Ask KENUXA: “${q}”`, hint: 'ASK', run: async () => { await view('chat'); $('#question').value = q; $('#ask-form').requestSubmit(); } });
    sel = Math.min(sel, Math.max(0, items.length - 1)); list.replaceChildren(...items.map((c, i) => { const b = el('button', 'p-item' + (i === sel ? ' sel' : '')); b.type = 'button'; b.append(el('span', '', c.label), el('small', '', c.hint)); b.addEventListener('click', () => exec(i)); return b; }));
  }
  function openPalette() { if (!appVisible()) return; $('#palette').classList.remove('hidden'); $('#palette-input').value = ''; sel = 0; renderPalette(); setTimeout(() => $('#palette-input').focus(), 10); }
  function closePalette() { $('#palette').classList.add('hidden'); }
  async function exec(i) { const c = items[i]; closePalette(); if (c) { try { await c.run(); } catch (e) { toast(e.message); } } }
  $('#open-palette')?.addEventListener('click', openPalette);
  $('#palette')?.addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });
  $('#palette-input')?.addEventListener('input', () => { sel = 0; renderPalette(); });
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').classList.contains('hidden') ? openPalette() : closePalette(); return; }
    if ($('#palette').classList.contains('hidden')) { if (e.key === '/' && appVisible() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#question')?.focus(); } return; }
    if (e.key === 'Escape') closePalette(); if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); renderPalette(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderPalette(); e.preventDefault(); } if (e.key === 'Enter') { e.preventDefault(); exec(sel); }
  });

  // ---------------- live status pill ----------------
  async function live() { if (appVisible()) { try { const s = await api('status'); $('#live-text').textContent = `${s.counts.approved} atoms · core step ${s.transformer.trainingSteps} · ${s.evolution.ticks} ticks`; } catch { /* token may be missing */ } } }
  setInterval(live, 30000); setTimeout(live, 1500);

  const baseView = view; window.view = async (...a) => { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return baseView(...a); };
  loadPulse(); requestAnimationFrame(drawCosmos); demoLoop();
})();
