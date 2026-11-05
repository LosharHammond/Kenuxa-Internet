// KENUXA public chat. Conversations live in this browser (localStorage). When you sign in, they also sync privately
// to your account so your other devices see them; signing out removes your synced chats from a shared device.
(() => {
  const $ = s => document.querySelector(s);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svg = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const p of d.split('|')) { const e = document.createElementNS('http://www.w3.org/2000/svg', 'path'); e.setAttribute('d', p); s.append(e); } return s; };
  const ICON = {
    copy: 'M9 9h10v10H9z|M5 15V5h10', ok: 'M5 12.5l4.5 4.5L19 7.5', up: 'M7 11v9H4v-9z|M7 11l4-7a2 2 0 0 1 3 1.7V10h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7', down: 'M17 13V4h3v9z|M17 13l-4 7a2 2 0 0 1-3-1.7V14H5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.2 4H17',
    redo: 'M20 11a8 8 0 1 0-2.3 5.7|M20 4v7h-7', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', arrow: 'M5 12h14|M13 6l6 6-6 6', trash: 'M5 7h14|M10 7V5h4v2|M7 7l1 12h8l1-12',
    bulb: 'M9 18h6|M10 21h4|M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z|M9 4v14|M15 6v14', scale: 'M12 4v16|M5 20h14|M6 8h12|M6 8l-3 6a3 3 0 0 0 6 0z|M18 8l-3 6a3 3 0 0 0 6 0z', book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z|M4 19a2 2 0 0 1 2-2h13',
  };
  const STARTERS = [
    ['bulb', 'Explain simply', 'Explain photosynthesis in simple terms'],
    ['map', 'Plan a goal', 'How do I start a solar company in Ghana?'],
    ['scale', 'Compare ideas', 'Compare shoe and dress'],
    ['book', 'Learn something', 'What is a knowledge graph?'],
  ];
  const KEY = 'kenuxa.chats.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 200))); } catch { /* private mode: in-memory only */ } if (typeof scheduleSync === 'function') scheduleSync(); };
  let chats = load(), current = null, busy = false, stopTyping = null, config = { name: 'KENUXA', mode: 'chat' };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- theme ----------
  const THEMES = ['system', 'light', 'dark'];
  let theme = (() => { try { return localStorage.getItem('kenuxa.theme') || 'system'; } catch { return 'system'; } })();
  function applyTheme() { if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme; $('#theme-label').textContent = `Theme: ${theme[0].toUpperCase() + theme.slice(1)}`; }
  $('#theme').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { localStorage.setItem('kenuxa.theme', theme); } catch {} applyTheme(); });
  applyTheme();

  // ---------- sidebar ----------
  const shell = $('#shell'), small = () => innerWidth <= 820;
  if (small()) shell.classList.add('closed');
  $('#collapse').addEventListener('click', () => shell.classList.add('closed'));
  $('#open-side').addEventListener('click', () => shell.classList.remove('closed'));
  $('#scrim').addEventListener('click', () => shell.classList.add('closed'));
  function groupOf(t) { const d = (Date.now() - t) / 86400000, day = new Date(t).toDateString() === new Date().toDateString(); return day ? 'Today' : d < 2 ? 'Yesterday' : d < 7 ? 'Previous 7 days' : d < 30 ? 'Previous 30 days' : 'Older'; }
  function renderHistory() {
    const q = $('#search').value.trim().toLowerCase(), box = $('#history'); box.replaceChildren(); let last = null;
    const list = chats.filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) { box.append(h('div', 'group', q ? 'No matching chats' : 'Your chats will appear here')); return; }
    for (const c of list) {
      const g = groupOf(c.updatedAt); if (g !== last) { box.append(h('div', 'group', g)); last = g; }
      const item = h('div', 'item' + (current?.id === c.id ? ' active' : '')), a = h('a', '', c.title); a.href = '#' + c.id;
      a.addEventListener('click', e => { e.preventDefault(); openChat(c.id); if (small()) shell.classList.add('closed'); });
      const del = h('button', 'del'); del.type = 'button'; del.title = 'Delete chat'; del.setAttribute('aria-label', 'Delete chat'); del.append(svg(ICON.trash));
      del.addEventListener('click', () => { if (c.owner) tombstones.push({ id: c.id, deleted: true, updatedAt: Date.now() }); chats = chats.filter(x => x.id !== c.id); persist(); if (current?.id === c.id) newChat(); else renderHistory(); });
      item.append(a, del); box.append(item);
    }
  }
  $('#search').addEventListener('input', renderHistory);

  // ---------- conversation ----------
  function greet() { const hr = new Date().getHours(); return hr < 5 ? 'Up late?' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; }
  function showEmpty(on) { $('#empty').classList.toggle('hidden', !on); }
  function newChat() { if (stopTyping) stopTyping(); current = null; $('#messages').replaceChildren(); showEmpty(true); $('#top-title').textContent = config.name; history.replaceState(null, '', location.pathname); renderHistory(); $('#input').focus(); }
  function openChat(id) { const c = chats.find(x => x.id === id); if (!c) return newChat(); if (stopTyping) stopTyping(); current = c; $('#messages').replaceChildren(); showEmpty(false); for (const m of c.messages) m.role === 'user' ? addUser(m.content) : addAI(m, { animate: false }); markLast(); $('#top-title').textContent = c.title; history.replaceState(null, '', '#' + c.id); renderHistory(); scrollDown(false); }
  function scrollDown(smooth = true) { const t = $('#thread'); t.scrollTo({ top: t.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' }); }
  function addUser(text) { const row = h('div', 'msg user'); row.append(h('div', 'bubble', text)); $('#messages').append(row); return row; }
  function markLast() { document.querySelectorAll('.msg.ai').forEach((n, i, all) => n.classList.toggle('last', i === all.length - 1)); }
  function thinking() {
    const row = h('div', 'msg ai thinking'), av = h('div', 'avatar'), col = h('div'), t = h('div', 'thinking-text', 'Understanding your question…'); col.append(t); row.append(av, col); $('#messages').append(row);
    const steps = ['Understanding your question…', 'Connecting meaning…', 'Checking what I know…', 'Composing an answer…']; let i = 0;
    const timer = setInterval(() => { i = Math.min(steps.length - 1, i + 1); t.textContent = steps[i]; }, 1100);
    return { row, done: () => { clearInterval(timer); row.remove(); } };
  }
  function typeInto(el, md, sources, onDone) {
    const words = md.split(/(\s+)/); let n = 0, stopped = false;
    const finish = () => { stopped = true; el.replaceChildren(renderMarkdown(md, { sources })); stopTyping = null; onDone?.(); };
    if (reduce || md.length < 40) return finish();
    stopTyping = finish;
    const step = () => { if (stopped) return; n = Math.min(words.length, n + Math.max(2, Math.round(words.length / 90))); const frag = renderMarkdown(words.slice(0, n).join(''), { sources }); const last = frag.lastElementChild || frag; const caret = h('span', 'caret'); (last.lastElementChild && last.lastElementChild.tagName === 'LI' ? last.lastElementChild : last).append(caret); el.replaceChildren(frag); if (n >= words.length) return finish(); if (nearBottom()) scrollDown(false); setTimeout(step, 22); };
    step();
  }
  const nearBottom = () => { const t = $('#thread'); return t.scrollHeight - t.scrollTop - t.clientHeight < 160; };
  function addAI(m, { animate = true } = {}) {
    const row = h('div', 'msg ai'), av = h('div', 'avatar'), col = h('div');
    if (m.understanding?.summary && !m.error) {
      const u = h('div', 'understood'); u.append(svg(ICON.spark), h('span', '', m.understanding.intent + (m.understanding.focus ? ' · ' + m.understanding.focus : '')));
      let open = false, detail = null; u.title = 'How KENUXA understood your question';
      u.addEventListener('click', () => { open = !open; if (open) { detail = h('div', 'understood-detail', m.understanding.summary + ` (understanding ${Math.round((m.understanding.understood || 0) * 100)}%)`); u.after(detail); } else detail?.remove(); });
      col.append(u);
    }
    const prose = h('div', 'prose' + (m.error ? ' error-text' : '')); col.append(prose);
    const after = () => {
      if (m.sources?.length && config?.ui?.showSources !== false) { const s = h('div', 'sources'); for (const src of m.sources.slice(0, 6)) { const a = h('a', 'source'); try { const u = new URL(src.url); if (!['https:', 'http:'].includes(u.protocol)) continue; a.href = u.href; } catch { continue; } a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(h('b', '', String(src.n)), h('span', '', src.title)); s.append(a); } col.append(s); }
      if (m.performance?.teacherDerived) col.append(h('div', 'engine-label', 'Teacher-assisted' + (m.performance.newTeacherCall ? ' · new teacher call' : ' · includes retained teacher knowledge')));
      else if (m.performance) col.append(h('div', 'engine-label', m.performance.mode === 'native-procedure' ? 'Native procedure · ' + m.performance.outcome : 'Local pipeline · correctness depends on available evidence'));
      if (config?.ui?.showEngine && m.engine) col.append(h('div', 'engine-label', String(m.engine).slice(0, 80))); /* text only (textContent), never markup */
      if (!m.error) col.append(actions(m));
      if (m.followups?.length && animate && (config?.ui?.maxFollowups ?? 3) > 0) { const f = h('div', 'followups'); m.followups.slice(0, config?.ui?.maxFollowups ?? 3).forEach((q, i) => { const b = h('button', 'follow'); b.type = 'button'; b.style.animationDelay = `${i * 70}ms`; b.append(svg(ICON.arrow), h('span', '', q)); b.addEventListener('click', () => { f.remove(); send(q); }); f.append(b); }); col.append(f); }
      markLast();
    };
    row.append(av, col); $('#messages').append(row);
    if (animate) typeInto(prose, m.content, m.sources, after); else { prose.append(renderMarkdown(m.content, { sources: m.sources })); after(); }
    return row;
  }
  function actions(m) {
    const bar = h('div', 'actions'), btn = (icon, label, fn) => { const b = h('button', 'act'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.append(svg(icon)); b.addEventListener('click', () => fn(b)); bar.append(b); return b; };
    btn(ICON.copy, 'Copy', async b => { try { await navigator.clipboard.writeText(m.content); b.replaceChildren(svg(ICON.ok)); setTimeout(() => b.replaceChildren(svg(ICON.copy)), 1500); } catch { toast('Copy is not available here'); } });
    const fb = helpful => async b => { bar.querySelectorAll('.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); try { await post('/chat/feedback', { helpful, entityIds: m.entityIds || [], question: m.question || '', episode: m.episode || null, uiArm: config?.uiArm || null }); toast(helpful ? 'Thanks for the feedback' : "Thanks — I'll use this to improve"); } catch {} };
    btn(ICON.up, 'Good response', fb(true)); btn(ICON.down, 'Bad response', fb(false));
    btn(ICON.redo, 'Regenerate', () => regenerate(m));
    return bar;
  }
  async function post(url, body, { timeoutMs = 0 } = {}) {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const r = await fetch(url, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      return data;
    } catch (e) {
      if (controller.signal.aborted) throw new Error('KENUXA exceeded the 25-second answer limit. The request was stopped on this device. Please try again; this delay has been recorded for investigation.');
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }
  function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600); }
  async function send(text, { refresh = false } = {}) {
    text = text.trim(); if (!text || busy) return; busy = true; updateSend();
    if (!current) { current = { id: Math.random().toString(36).slice(2, 10), title: text.slice(0, 60), messages: [], createdAt: Date.now(), updatedAt: Date.now(), ...(me ? { owner: me.id } : {}) }; chats.unshift(current); history.replaceState(null, '', '#' + current.id); $('#top-title').textContent = current.title; }
    showEmpty(false); document.querySelectorAll('.followups').forEach(f => f.remove());
    if (!refresh) { current.messages.push({ role: 'user', content: text, at: Date.now() }); addUser(text); }
    scrollDown(); const think = thinking(); scrollDown();
    const hist = []; for (let i = 0; i < current.messages.length - 1; i++) { const m = current.messages[i]; if (m.role === 'user') hist.push({ question: m.content, entityIds: current.messages[i + 1]?.entityIds || [], context: current.messages[i + 1]?.context || null }); }
    let msg;
    try { const r = await post('/chat/ask', { question: text, history: hist.slice(-8), refresh, conversation: current.id, ...(locOn() && lastLoc ? { location: lastLoc } : {}) }, { timeoutMs: 25000 });
      msg = { role: 'ai', content: r.answer, sources: r.sources, understanding: r.understanding, followups: r.followups, entityIds: r.entityIds, context: r.context || null, episode: r.episode || null, engine: r.engine || null, performance: r.performance || null, at: Date.now(), question: text };
    } catch (e) { msg = { role: 'ai', content: e.message, error: true, at: Date.now(), question: text }; }
    think.done(); if (!msg.error) current.messages.push(msg); current.updatedAt = Date.now(); persist(); renderHistory();
    addAI(msg); busy = false; updateSend(); scrollDown();
  }
  function regenerate(m) { if (busy || !current) return; const idx = current.messages.lastIndexOf(m); if (idx < 0) return; current.messages.splice(idx, 1); const rows = [...document.querySelectorAll('.msg.ai')]; rows[rows.length - 1]?.remove(); send(m.question || current.messages.filter(x => x.role === 'user').at(-1)?.content || '', { refresh: true }); }

  // ---------- composer ----------
  const input = $('#input');
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(220, input.scrollHeight) + 'px'; }
  function updateSend() { $('#send').disabled = busy || !input.value.trim(); }
  input.addEventListener('input', () => { grow(); updateSend(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').addEventListener('submit', e => { e.preventDefault(); const v = input.value; if (!v.trim() || busy) return; input.value = ''; grow(); updateSend(); send(v); });
  for (const b of ['#new-chat', '#new-chat-top']) $(b).addEventListener('click', () => { newChat(); if (small()) shell.classList.add('closed'); });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); } if (e.key === 'Escape' && stopTyping) stopTyping(); });

  // ---------- account, private memory and consented location ----------
  let me = null; const dlg = $('#acct'), err = t => { $('#acct-err').textContent = t || ''; };
  const locOn = () => { try { return localStorage.getItem('kx_loc') === '1'; } catch { return false; } };
  let lastLoc = null;
  function readLocation() { const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(); lastLoc = { timeZone: tz }; if (!navigator.geolocation) return Promise.resolve(lastLoc);
    return new Promise(res => navigator.geolocation.getCurrentPosition(p => { lastLoc = { timeZone: tz, lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }; res(lastLoc); }, () => res(lastLoc), { maximumAge: 3600000, timeout: 8000, enableHighAccuracy: false })); }
  async function account(action, extra = {}) { err(''); try { const r = await post('/chat/account', { action, ...extra }); return r; } catch (e) { err(e.message); throw e; } }
  function renderAccount() {
    $('#account-label').textContent = me ? me.username : 'Sign in'; $('#acct-out').classList.toggle('hidden', !!me); $('#acct-in').classList.toggle('hidden', !me);
    if (me) { $('#acct-name').textContent = me.username; $('#acct-loc').checked = locOn(); $('#acct-loc-state').textContent = locOn() ? (me.settings?.location ? `Using: ${me.settings.location.country || 'nearby area'} (${me.settings.location.accuracy || me.settings.location.source})` : 'Location sharing is on.') : 'Location is not shared.'; }
  }
  // ---- private cross-device sync (signed-in only) ----
  var tombstones = [], syncTimer = null, lastSync = 0;
  function scheduleSync() { try { if (!me) return; } catch { return; } clearTimeout(syncTimer); syncTimer = setTimeout(syncChats, 1500); }
  async function syncChats() {
    if (!me) return;
    const mine = chats.filter(c => c.owner === me.id && (c.updatedAt || 0) > lastSync); // chats made while signed out stay on this device only
    try { const r = await post('/chat/account', { action: 'chats', chats: [...mine, ...tombstones] }); tombstones = []; lastSync = Date.now();
      for (const rc of r.chats || []) { const i = chats.findIndex(c => c.id === rc.id); if (rc.deleted) { if (i >= 0 && current?.id !== rc.id) chats.splice(i, 1); continue; } rc.owner = me.id; if (i < 0) chats.push(rc); else if ((rc.updatedAt || 0) > (chats[i].updatedAt || 0) && current?.id !== rc.id) chats[i] = rc; }
      chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 200))); } catch {} renderHistory();
    } catch { /* offline: retry on next change */ }
  }
  function forgetOwned(id) { chats = chats.filter(c => c.owner !== id); if (current && current.owner === id) newChat(); try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 200))); } catch {} renderHistory(); }
  async function refreshMe() { try { me = (await (await fetch('/chat/me')).json()).user; } catch { me = null; } renderAccount(); if (me) { lastSync = 0; syncChats(); } }
  $('#account-btn').addEventListener('click', async () => { renderAccount(); if (me) { try { const m = await account('memory'); const box = $('#acct-mem'); box.replaceChildren(); box.append(h('b', '', m.facts.length ? 'What you asked me to remember' : 'Nothing remembered yet — say “remember that …” in a chat.')); if (m.facts.length) { const ul = h('ul'); for (const f of m.facts) ul.append(h('li', '', f.text)); box.append(ul); } } catch {} } dlg.showModal(); });
  $('#acct-login').addEventListener('click', async () => { try { const r = await account('login', { username: $('#acct-user').value, passphrase: $('#acct-pass').value }); me = r.user; $('#acct-pass').value = ''; renderAccount(); lastSync = 0; syncChats(); toast('Signed in'); } catch {} });
  $('#acct-create').addEventListener('click', async () => { try { const r = await account('create', { username: $('#acct-user').value, passphrase: $('#acct-pass').value }); me = r.user; $('#acct-pass').value = ''; renderAccount(); lastSync = 0; syncChats(); toast('Account created'); } catch {} });
  $('#acct-logout').addEventListener('click', async () => { const id = me?.id; try { await syncChats(); await account('logout'); } catch {} me = null; if (id) forgetOwned(id); renderAccount(); toast('Signed out — your synced chats were removed from this device'); });
  $('#acct-forget').addEventListener('click', async () => { try { await account('forget-all'); $('#acct-mem').replaceChildren(h('b', '', 'Memory erased.')); toast('Memory erased'); } catch {} });
  $('#acct-export').addEventListener('click', async () => { try { const d = await account('export'); const a = h('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'kenuxa-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } catch {} });
  $('#acct-delete').addEventListener('click', async () => { try { const id = me?.id; await account('delete', { passphrase: $('#acct-del-pass').value }); me = null; if (id) forgetOwned(id); renderAccount(); dlg.close(); toast('Account deleted'); } catch {} });
  $('#acct-loc').addEventListener('change', async e => { try { localStorage.setItem('kx_loc', e.target.checked ? '1' : '0'); } catch {} if (e.target.checked) { const l = await readLocation(); try { const r = await account('location', { location: l }); me.settings = { ...me.settings, location: r.location }; } catch {} if (l && l.lat == null) toast('Using your time zone only (approximate)'); } else { lastLoc = null; try { await account('location', { enabled: false }); me.settings = { ...me.settings, location: null }; } catch {} } renderAccount(); });
  if (locOn()) readLocation();
  refreshMe();

  // ---------- start ----------
  $('#greet').textContent = greet();
  const st = $('#starters'); STARTERS.forEach(([icon, title, q], i) => { const b = h('button', 'starter'); b.type = 'button'; b.style.animationDelay = `${120 + i * 70}ms`; const ic = h('i'); ic.append(svg(ICON[icon])); const t = h('div'); t.append(h('b', '', title), h('span', '', q)); b.append(ic, t); b.addEventListener('click', () => send(q)); st.append(b); });
  fetch('/chat/config').then(r => r.json()).then(c => { config = c; document.title = c.name; $('#brand-name').textContent = c.name; if (!current) $('#top-title').textContent = c.name; if (c.mode === 'studio' && c.studio) $('#studio-link').classList.remove('hidden'); }).catch(() => {});
  renderHistory();
  const fromHash = location.hash.slice(1); if (fromHash && chats.some(c => c.id === fromHash)) openChat(fromHash); else input.focus();
})();
