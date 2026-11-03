// Byte-level tokenizer and fp16 checkpoint format for the KENUXA Core Transformer.
export const BOS = 256, EOS = 257, SEP = 258, PAD = 259;
export function encode(text, { bos = false, eos = false } = {}) {
  const b = [...Buffer.from(String(text), 'utf8')]; if (bos) b.unshift(BOS); if (eos) b.push(EOS); return b;
}
export function decode(tokens) { return Buffer.from(tokens.filter(t => t < 256)).toString('utf8').replace(/[�\u0000-\u0008\u000B-\u001F\u007F]/g, ''); }

// IEEE-754 half precision conversion (storage precision; compute stays fp32).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v; const x = u32[0], sign = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && m ? 0x200 : 0);
  if (e <= 0) { if (e < -10) return sign; m |= 0x800000; const s = 14 - e; let h = m >> s; if ((m >> (s - 1)) & 1) h++; return sign | h; }
  let h = sign | (e << 10) | (m >> 13); if (m & 0x1000) h++; return h;
}
export function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * Math.pow(2, -24);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
export function packHalf(arr) { const out = new Uint16Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = toHalf(arr[i]); return out; }
export function unpackHalf(u16) { const out = new Float32Array(u16.length); for (let i = 0; i < u16.length; i++) out[i] = fromHalf(u16[i]); return out; }
export const vecToB64 = arr => Buffer.from(packHalf(arr).buffer).toString('base64');
export const b64ToVec = s => { const b = Buffer.from(s, 'base64'); return unpackHalf(new Uint16Array(b.buffer, b.byteOffset, b.length / 2)); };

// Checkpoint: "KNXT" | u32 header length | JSON header | fp16 tensors in header.order
export function serialize(config, P, meta = {}) {
  const order = [...P.keys()], header = Buffer.from(JSON.stringify({ format: 'kenuxa-transformer/1', precision: 'fp16-storage/fp32-compute', config, order, sizes: order.map(k => P.get(k).length), ...meta }));
  const parts = [Buffer.from('KNXT'), Buffer.alloc(4), header]; parts[1].writeUInt32LE(header.length);
  for (const k of order) parts.push(Buffer.from(packHalf(P.get(k)).buffer));
  return Buffer.concat(parts);
}
export function deserialize(buf) {
  if (buf.subarray(0, 4).toString() !== 'KNXT') throw new Error('Not a KENUXA transformer checkpoint');
  const n = buf.readUInt32LE(4), header = JSON.parse(buf.subarray(8, 8 + n).toString()), P = new Map(); let off = 8 + n;
  header.order.forEach((k, i) => { const len = header.sizes[i], bytes = buf.subarray(off, off + len * 2); P.set(k, unpackHalf(new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)))); off += len * 2; });
  return { header, P };
}
