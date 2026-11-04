// KUNPP browser peer — voluntary, explicit opt-in, revocable at any moment.
// Nothing runs until the person presses "Start contributing". Work happens in a Web Worker, only while this tab is
// open and visible, within the chosen profile. Atoms this tab has processed are kept in a small, temporary cache
// (memory + IndexedDB, capped by the person's storage limit) so another volunteer can fetch them directly over
// WebRTC instead of from the server; every atom received that way is checked against its content hash, and the
// server path is always used as a fallback. If this node's server becomes unreachable, the peer fails over to
// another KENUXA coordinator listed by the network.
(() => {
  const CONSENT = 'compute-consent/1', KEY = 'kenuxa-compute', $ = s => document.querySelector(s);
  const st = { on: false, paused: false, peer: null, worker: null, timer: null, profile: 'light', custom: { maxMBPerHour: 20, maxTasksPerHour: 120, cacheMB: 20 }, stats: { tasks: 0, atoms: 0, accepted: 0, rejected: 0, bytesIn: 0, bytesOut: 0, cpuMs: 0, p2pReceived: 0, p2pServed: 0, p2pFallbacks: 0, failovers: 0, since: null }, status: 'off', hour: [], coordinators: [location.origin], at: 0, failures: 0, proto: null, cache: new Map(), cacheBytes: 0, pcs: new Map(), lastLease: 0 };
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); if (v.profile) st.profile = v.profile; if (v.custom) st.custom = { ...st.custom, ...v.custom }; } catch { /* storage unavailable */ } };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ profile: st.profile, custom: st.custom })); } catch { /* storage unavailable */ } };
  const base = () => st.coordinators[st.at % st.coordinators.length];
  function capabilities() { const n = navigator, c = n.connection || {}; return { workers: typeof Worker === 'function', wasm: typeof WebAssembly === 'object', subtleCrypto: !!(globalThis.crypto && crypto.subtle), indexedDB: typeof indexedDB !== 'undefined', webrtc: typeof RTCPeerConnection === 'function', cores: n.hardwareConcurrency || 1, memoryGB: n.deviceMemory || null, mobile: /Mobi|Android|iPhone|iPad/i.test(n.userAgent || ''), saveData: !!c.saveData, agent: 'browser' }; }
  async function post(path, body = {}, method = 'POST') {
    const headers = { 'Content-Type': 'application/json' }; if (st.peer && method === 'POST') { headers['x-kunpp-peer'] = st.peer.peerId; headers['x-kunpp-token'] = st.peer.token; }
    const raw = method === 'POST' ? JSON.stringify(body) : ''; st.stats.bytesOut += raw.length;
    const r = await fetch(base() + path, { method, headers, ...(method === 'POST' ? { body: raw } : {}), credentials: base() === location.origin ? 'same-origin' : 'omit' });
    const text = await r.text(); st.stats.bytesIn += text.length; const data = text ? JSON.parse(text) : {};
    if (!r.ok) throw Object.assign(new Error(data.error || 'HTTP ' + r.status), { status: r.status }); return data;
  }
  const overDataCap = () => { const now = Date.now(); st.hour = st.hour.filter(x => now - x.at < 3600000); return st.profile === 'custom' && st.hour.reduce((a, x) => a + x.bytes, 0) / 1e6 >= st.custom.maxMBPerHour; };
  function inWorker(msg, budget = 20000) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2), to = setTimeout(() => { reject(new Error('task exceeded its time budget')); restartWorker(); }, budget + 2000);
      const onMsg = ev => { if (ev.data.id !== id) return; st.worker.removeEventListener('message', onMsg); clearTimeout(to); st.stats.cpuMs += ev.data.ms; ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error)); };
      st.worker.addEventListener('message', onMsg); st.worker.postMessage({ id, ...msg });
    });
  }
  function restartWorker() { try { st.worker?.terminate(); } catch { /* gone */ } st.worker = st.on ? new Worker('/peer-worker.js', { type: 'module' }) : null; }
  // ---------- temporary cache (never treated as durable) ----------
  let db = null;
  const openDb = () => new Promise(res => { try { const q = indexedDB.open('kenuxa-peer-cache', 1); q.onupgradeneeded = () => q.result.createObjectStore('atoms'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch { res(null); } });
  function cachePut(atoms) { for (const a of atoms) { if (!a.dna || st.cache.has(a.head)) continue; const size = JSON.stringify(a.dna).length; st.cache.set(a.head, a.dna); st.cacheBytes += size; } while (st.cacheBytes > st.custom.cacheMB * 1e6 && st.cache.size) { const [h, d] = st.cache.entries().next().value; st.cache.delete(h); st.cacheBytes -= JSON.stringify(d).length; } if (db) try { const tx = db.transaction('atoms', 'readwrite'); for (const a of atoms.slice(0, 200)) if (a.dna) tx.objectStore('atoms').put(a.dna, a.head); } catch { /* quota or private mode */ } }
  // ---------- WebRTC: fetch atoms from the peer that processed them first ----------
  const ice = () => ({ iceServers: st.proto?.p2p?.iceServers || [] });
  async function fetchViaPeer(task) {
    const { pairId } = task.p2p, pc = new RTCPeerConnection(ice()), ch = pc.createDataChannel('atoms'), got = new Map(), want = task.payload.atoms.map(a => a.head);
    st.pcs.set(pairId, pc); pc.onicecandidate = e => { if (e.candidate) post('/peer/signal', { pairId, data: { candidate: e.candidate } }).catch(() => {}); };
    const done = new Promise((resolve, reject) => {
      ch.onopen = () => ch.send(JSON.stringify({ want }));
      ch.onmessage = ev => { const m = JSON.parse(ev.data); if (m.atom) got.set(m.atom.head, m.atom.dna); if (m.done) resolve(); };
      setTimeout(() => reject(new Error('p2p timeout')), 9000);
    });
    await pc.setLocalDescription(await pc.createOffer()); await post('/peer/signal', { pairId, data: { sdp: pc.localDescription } });
    const poller = setInterval(() => answerSignals(), 400); // fast signalling only while a pairing is open
    try { await done; } finally { clearInterval(poller); try { pc.close(); } catch { /* closed */ } st.pcs.delete(pairId); }
    const atoms = task.payload.atoms.map(a => ({ ...a, dna: got.get(a.head) })); if (atoms.some(a => !a.dna)) throw new Error('peer did not have every atom');
    const { bad } = await inWorker({ op: 'verify', payload: { atoms } }); if (bad.length) throw new Error(bad.length + ' atoms failed the content-hash check');
    st.stats.p2pReceived += atoms.length; return atoms;
  }
  async function answerSignals() {
    if (!st.on || !st.peer) return; let msgs = [];
    try { msgs = (await post('/peer/poll', {})).messages || []; } catch { return; }
    for (const m of msgs) {
      if (m.type === 'pair') { st.fastUntil = Date.now() + 12000; continue; } if (m.type !== 'signal') continue; const d = m.data || {};
      if (d.sdp?.type === 'offer') { const pc = new RTCPeerConnection(ice()); st.pcs.set(m.pairId, pc); pc.onicecandidate = e => { if (e.candidate) post('/peer/signal', { pairId: m.pairId, data: { candidate: e.candidate } }).catch(() => {}); };
        pc.ondatachannel = ev => { const ch = ev.channel; ch.onmessage = e2 => { const q = JSON.parse(e2.data); for (const h of q.want || []) if (st.cache.has(h)) { ch.send(JSON.stringify({ atom: { head: h, dna: st.cache.get(h) } })); st.stats.p2pServed++; } ch.send(JSON.stringify({ done: true })); setTimeout(() => { try { pc.close(); } catch { /* closed */ } st.pcs.delete(m.pairId); }, 3000); }; };
        await pc.setRemoteDescription(d.sdp); await pc.setLocalDescription(await pc.createAnswer()); await post('/peer/signal', { pairId: m.pairId, data: { sdp: pc.localDescription } }).catch(() => {}); }
      else if (d.sdp?.type === 'answer') { const pc = st.pcs.get(m.pairId); if (pc) await pc.setRemoteDescription(d.sdp).catch(() => {}); }
      else if (d.candidate) { const pc = st.pcs.get(m.pairId); if (pc) await pc.addIceCandidate(d.candidate).catch(() => {}); }
    }
  }
  async function loop() {
    clearTimeout(st.timer); if (!st.on) return; let wait = 5000;
    try {
      if (document.hidden) st.status = 'paused while this tab is in the background';
      else if (st.paused) st.status = 'paused';
      else if (overDataCap()) { st.status = 'hourly data limit reached'; wait = 60000; }
      else if (await lowBattery()) { st.status = 'paused: battery low'; wait = 60000; }
      else {
        if (!st.peer) await register();
        const before = st.stats.bytesIn + st.stats.bytesOut, l = await post('/peer/lease', {}); st.lastLease = Date.now(); st.failures = 0;
        if (l.task) {
          const t = l.task; st.status = `working: ${t.kind}`; render();
          if (t.payload.dnaVia === 'p2p') { try { t.payload.atoms = await fetchViaPeer(t); } catch (e) { st.stats.p2pFallbacks++; t.payload = (await post('/peer/payload', { leaseId: t.leaseId })).payload; } }
          const result = await inWorker({ kind: t.kind, payload: t.payload, budgetMs: t.budgetMs }, t.budgetMs || 20000);
          const r = await post('/peer/result', { leaseId: t.leaseId, taskId: t.taskId, result }); if (t.payload.atoms) cachePut(t.payload.atoms);
          st.stats.tasks++; st.stats.atoms += t.payload.atoms?.length || t.payload.claims?.length || 0; if (r.status === 'accepted') st.stats.accepted++; if (r.status === 'rejected') st.stats.rejected++;
          st.status = `last task: ${r.status}${r.reason ? ' — ' + r.reason : ''}`; wait = st.peer.limits.minIntervalMs;
        } else { st.status = l.reason || 'no work right now'; wait = Math.max(st.peer.limits.minIntervalMs, Math.min(l.retryAfterMs || 10000, 60000)); }
        st.hour.push({ at: Date.now(), bytes: st.stats.bytesIn + st.stats.bytesOut - before });
      }
    } catch (e) {
      st.status = 'error: ' + e.message;
      if (e.status === 401) st.peer = null; // revoked or a new coordinator: register again on the next round
      else if (!e.status && ++st.failures >= 2 && st.coordinators.length > 1) { st.at++; st.peer = null; st.failures = 0; st.stats.failovers++; st.status = 'server unreachable — switching to ' + base(); }
      wait = 5000;
    }
    render(); st.timer = setTimeout(loop, wait);
  }
  async function lowBattery() { try { if (!navigator.getBattery) return false; const b = await navigator.getBattery(); return !b.charging && b.level < 0.2; } catch { return false; } }
  async function register() {
    st.proto = await post('/peer/protocol', null, 'GET'); for (const c of st.proto.coordinators || []) if (!st.coordinators.includes(c)) st.coordinators.push(c);
    const pow = st.proto.powBits ? await inWorker({ op: 'pow', payload: await post('/peer/challenge', null, 'GET') }, 120000) : null;
    st.peer = await post('/peer/register', { consent: true, consentVersion: CONSENT, capabilities: capabilities(), profile: st.profile, custom: { maxTasksPerHour: st.custom.maxTasksPerHour }, pow });
  }
  async function start() {
    const caps = capabilities(); if (!caps.workers || !caps.subtleCrypto) { st.status = 'this browser cannot run network tasks'; render(); return; }
    st.on = true; st.paused = false; st.stats.since = new Date().toISOString(); restartWorker(); db = db || await openDb(); st.status = 'joining (solving a small anti-spam puzzle)…'; render();
    try { await register(); } catch (e) { st.on = false; st.status = 'could not join: ' + e.message; render(); return; }
    loop(); signalLoop();
  }
  function signalLoop() { if (!st.on) return; answerSignals().finally(() => { st.sigTimer = setTimeout(signalLoop, (st.fastUntil || 0) > Date.now() ? 400 : st.cache.size ? 2500 : 15000); }); }
  async function stop() { const p = st.peer; st.on = false; clearTimeout(st.timer); clearTimeout(st.sigTimer); for (const pc of st.pcs.values()) try { pc.close(); } catch { /* closed */ } st.pcs.clear(); try { st.worker?.terminate(); } catch { /* gone */ } st.worker = null; st.status = 'stopped — nothing is running'; render(); if (p) try { await post('/peer/leave', {}); } catch { /* offline */ } st.peer = null; render(); }
  function render() {
    const box = $('#compute-panel'); if (!box) return; const set = (sel, t) => { const e = box.querySelector(sel); if (e) e.textContent = t; };
    set('[data-k=status]', st.on ? (st.paused ? 'Paused' : 'Contributing') + ' · ' + st.status : 'Not contributing' + (st.status && st.status !== 'off' ? ' · ' + st.status : ''));
    set('[data-k=tasks]', `${st.stats.tasks} tasks · ${st.stats.atoms} items checked · ${st.stats.accepted} accepted · ${st.stats.rejected} rejected`);
    set('[data-k=data]', `${Math.round((st.stats.bytesIn + st.stats.bytesOut) / 1024)} KB via server · ${st.stats.p2pReceived} atoms received and ${st.stats.p2pServed} served directly (peer-to-peer) · cache ${Math.round(st.cacheBytes / 1024)} KB · ${Math.round(st.stats.cpuMs)} ms worker time${st.stats.failovers ? ' · ' + st.stats.failovers + ' coordinator failovers' : ''}`);
    const b = box.querySelector('[data-k=toggle]'); if (b) b.textContent = st.on ? 'Stop now' : 'Start contributing';
    const pz = box.querySelector('[data-k=pause]'); if (pz) { pz.disabled = !st.on; pz.textContent = st.paused ? 'Resume' : 'Pause'; }
    const btn = document.getElementById('compute-label'); if (btn) btn.textContent = st.on ? 'Contributing computing' : 'Contribute computing';
  }
  function wire() {
    load(); const box = $('#compute-panel'); if (!box) return;
    const sel = box.querySelector('[data-k=profile]'); if (sel) { sel.value = st.profile; sel.addEventListener('change', () => { st.profile = sel.value; keep(); box.querySelector('[data-k=custom]')?.classList.toggle('hidden', st.profile !== 'custom'); }); box.querySelector('[data-k=custom]')?.classList.toggle('hidden', st.profile !== 'custom'); }
    for (const [k, f, lo, hi, d] of [['mb', 'maxMBPerHour', 1, 500, 20], ['tph', 'maxTasksPerHour', 10, 1200, 120], ['cache', 'cacheMB', 0, 200, 20]]) { const el = box.querySelector(`[data-k=${k}]`); if (el) { el.value = st.custom[f]; el.addEventListener('change', () => { st.custom[f] = Math.max(lo, Math.min(hi, Number(el.value) || d)); keep(); }); } }
    box.querySelector('[data-k=toggle]')?.addEventListener('click', () => (st.on ? stop() : start()));
    box.querySelector('[data-k=pause]')?.addEventListener('click', async () => { st.paused = !st.paused; render(); try { await post('/peer/heartbeat', { paused: st.paused }); } catch { /* ignore */ } });
    box.querySelector('[data-k=clear]')?.addEventListener('click', async () => { st.cache.clear(); st.cacheBytes = 0; try { indexedDB.deleteDatabase('kenuxa-peer-cache'); db = null; } catch { /* ignore */ } render(); });
    document.getElementById('compute-btn')?.addEventListener('click', () => document.getElementById('compute-dialog')?.showModal?.());
    const beat = async () => { let next = 30000; if (st.on && st.peer && (st.paused || document.hidden || Date.now() - (st.lastLease || 0) > 25000)) { try { const r = await post('/peer/heartbeat', { paused: st.paused || document.hidden }); next = r.heartbeatMs || next; } catch { /* offline */ } } setTimeout(beat, Math.max(30000, next)); }; setTimeout(beat, 30000);
    render();
  }
  window.kenuxaPeer = { start, stop, state: st, capabilities };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
