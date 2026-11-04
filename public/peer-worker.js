// KUNPP browser worker: runs ONLY the audited task vocabulary from /peer-tasks.mjs on public data, plus the
// registration proof-of-work. No network access is used here. Each run has a time budget.
import { runTask, sha256hex, encodeCanonical, TASK_VOCABULARY } from '/peer-tasks.mjs';
const zeros = hex => { let n = 0; for (const ch of hex) { const v = parseInt(ch, 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; } return n; };
self.onmessage = async ev => {
  const { id, op = 'task', kind, payload, budgetMs } = ev.data || {}, t0 = performance.now();
  try {
    if (op === 'pow') { const te = new TextEncoder(); for (let n = 0; n < 1e8; n++) { if (zeros(await sha256hex(te.encode(`${payload.challenge}:${n}`))) >= payload.bits) { self.postMessage({ id, ok: true, result: { challenge: payload.challenge, nonce: String(n) }, ms: performance.now() - t0 }); return; } } throw new Error('no proof found'); }
    if (op === 'verify') { const bad = []; for (const a of payload.atoms) if ((await sha256hex(encodeCanonical(a.dna))) !== a.head) bad.push(a.head); self.postMessage({ id, ok: true, result: { bad }, ms: performance.now() - t0 }); return; }
    const result = await runTask(kind, payload, { deadline: Date.now() + Math.max(1000, Math.min(Number(budgetMs) || 20000, 60000)) }); self.postMessage({ id, ok: true, result, ms: performance.now() - t0, vocabulary: TASK_VOCABULARY });
  } catch (e) { self.postMessage({ id, ok: false, error: String(e && e.message || e), ms: performance.now() - t0 }); }
};
