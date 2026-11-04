// Controlled storage migration (v1.10). Moves data between storage implementations through their common interfaces
// only (state stores: load/save; chunk stores: putChunk/getChunk + their key index), so no service is coupled to one
// backend. Every copy is verified by content hash; chunk migration is resumable from a cursor; the source is never
// deleted — switching over is a separate, explicit step after verification.
import { createHash } from 'node:crypto';
import { contentHash } from '../atoms/codec.mjs';

const stateHash = s => createHash('sha256').update(JSON.stringify(s)).digest('hex');

export async function migrateState(from, to) {
  const t0 = performance.now(), src = await from.load(); if (!src) return { ok: false, reason: 'source store is empty' };
  await to.save(src); const back = await to.load();
  const ok = stateHash(back) === stateHash(src);
  return { ok, reason: ok ? 'state copied and read back identically' : 'read-back differs from the source — do not switch', sourceHash: stateHash(src).slice(0, 16), targetHash: back ? stateHash(back).slice(0, 16) : null, ms: +(performance.now() - t0).toFixed(1) };
}

// progress: a plain object persisted by the caller ({ cursor, copied, failed }) so an interrupted run resumes
export async function migrateChunks(from, to, { progress = {}, batch = 500, budgetMs = 20000 } = {}) {
  const t0 = performance.now(), keys = [...from.sizes.keys()].sort(); progress.cursor ||= 0; progress.copied ||= 0; progress.skipped ||= 0; progress.failed ||= [];
  while (progress.cursor < keys.length && performance.now() - t0 < budgetMs) {
    for (const key of keys.slice(progress.cursor, progress.cursor + batch)) {
      try { if (to.sizes.has(key)) { progress.skipped++; continue; } const b = await from.getChunk(key); if (!b) { progress.failed.push({ key, why: 'missing in source' }); continue; } await to.putChunk(key, b); progress.copied++; } /* putChunk re-verifies the content hash */
      catch (e) { progress.failed.push({ key, why: e.message }); }
    }
    progress.cursor = Math.min(keys.length, progress.cursor + batch);
  }
  const done = progress.cursor >= keys.length;
  const verify = done ? await verifyChunks(from, to) : null;
  return { done, total: keys.length, ...progress, failed: progress.failed.slice(0, 20), verify, ms: +(performance.now() - t0).toFixed(1) };
}
export async function verifyChunks(from, to) {
  let ok = 0, missing = 0, corrupt = 0;
  for (const key of from.sizes.keys()) { let b; try { b = await to.getChunk(key); } catch { corrupt++; continue; } /* the store refuses corrupted chunks */ if (!b) { missing++; continue; } if (createHash('sha256').update(b).digest('hex') !== key.split(':').pop()) corrupt++; else ok++; }
  return { ok: missing === 0 && corrupt === 0, verified: ok, missing, corrupt };
}
export { contentHash };
