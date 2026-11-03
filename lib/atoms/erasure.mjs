// Systematic Reed–Solomon erasure coding over GF(2^8) (primitive polynomial 0x11d).
// encode(data, k, m) → k data shards + m parity shards; any k shards reconstruct the original.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
const div = (a, b) => { if (b === 0) throw new Error('division by zero'); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };
const pow = (a, n) => n === 0 ? 1 : a === 0 ? 0 : EXP[(LOG[a] * n) % 255];

function invert(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; while (p < n && A[p][c] === 0) p++; if (p === n) throw new Error('singular matrix');
    [A[c], A[p]] = [A[p], A[c]]; const inv = div(1, A[c][c]); for (let j = 0; j < 2 * n; j++) A[c][j] = mul(A[c][j], inv);
    for (let r = 0; r < n; r++) if (r !== c && A[r][c]) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] ^= mul(f, A[c][j]); }
  }
  return A.map(r => r.slice(n));
}
const matmul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s ^ mul(v, B[k][j]), 0)));
const cache = new Map();
function matrix(k, m) {
  const key = k + ':' + m; if (cache.has(key)) return cache.get(key);
  const V = Array.from({ length: k + m }, (_, i) => Array.from({ length: k }, (_, j) => pow(i, j)));
  const S = matmul(V, invert(V.slice(0, k))); cache.set(key, S); return S; // top k rows = identity (systematic)
}
export function encode(data, k = 4, m = 2) {
  if (k + m > 255) throw new Error('k + m must be ≤ 255');
  const size = Math.ceil(Math.max(1, data.length) / k), shards = Array.from({ length: k + m }, () => Buffer.alloc(size));
  for (let i = 0; i < k; i++) if (i * size < data.length) data.copy(shards[i], 0, i * size, Math.min(data.length, (i + 1) * size));
  const M = matrix(k, m);
  for (let p = 0; p < m; p++) { const row = M[k + p], out = shards[k + p]; for (let j = 0; j < k; j++) { const c = row[j]; if (!c) continue; const src = shards[j], lc = LOG[c]; for (let b = 0; b < size; b++) { const v = src[b]; if (v) out[b] ^= EXP[lc + LOG[v]]; } } }
  return { shards, shardSize: size, length: data.length, k, m };
}
// available: array of {index, data}; needs at least k distinct shards.
export function decode(available, { k, m, length, shardSize }) {
  const got = [...new Map(available.map(s => [s.index, s])).values()].slice(0, k);
  if (got.length < k) throw new Error(`Need ${k} shards, only ${got.length} available`);
  const M = matrix(k, m), sub = got.map(s => M[s.index]), inv = invert(sub), data = Array.from({ length: k }, () => Buffer.alloc(shardSize));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const c = inv[i][j]; if (!c) continue; const src = got[j].data, out = data[i], lc = LOG[c]; for (let b = 0; b < shardSize; b++) { const v = src[b]; if (v) out[b] ^= EXP[lc + LOG[v]]; } }
  return Buffer.concat(data).subarray(0, length);
}
export function rebuildShard(available, index, meta) { const full = decode(available, meta); return encode(full, meta.k, meta.m).shards[index]; }
