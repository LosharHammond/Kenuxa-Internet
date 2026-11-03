// Compact binary serialization for atoms: a dependency-free MessagePack subset + raw DEFLATE.
// Measured against JSON in bench/atoms.bench.mjs; canonical encoding (sorted keys) makes content hashes stable.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export function encode(value) {
  const parts = []; let size = 0;
  const push = b => { parts.push(b); size += b.length; };
  const u8 = (...a) => push(Buffer.from(a));
  function w(v) {
    if (v === null || v === undefined) return u8(0xc0);
    if (v === false) return u8(0xc2); if (v === true) return u8(0xc3);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v < 128) return u8(v);
      if (Number.isInteger(v) && v < 0 && v >= -32) return u8(0x100 + v);
      if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0xce; b.writeUInt32BE(v, 1); return push(b); }
      if (Number.isInteger(v) && v < 0 && v >= -0x80000000) { const b = Buffer.alloc(5); b[0] = 0xd2; b.writeInt32BE(v, 1); return push(b); }
      const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(v, 1); return push(b);
    }
    if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'), n = s.length; if (n < 32) u8(0xa0 | n); else if (n < 256) u8(0xd9, n); else if (n < 65536) { const b = Buffer.alloc(3); b[0] = 0xda; b.writeUInt16BE(n, 1); push(b); } else { const b = Buffer.alloc(5); b[0] = 0xdb; b.writeUInt32BE(n, 1); push(b); } return push(s); }
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) { const n = v.length; const b = Buffer.alloc(5); b[0] = 0xc6; b.writeUInt32BE(n, 1); push(b); return push(Buffer.from(v)); }
    if (Array.isArray(v)) { const n = v.length; if (n < 16) u8(0x90 | n); else { const b = Buffer.alloc(5); b[0] = 0xdd; b.writeUInt32BE(n, 1); push(b); } for (const x of v) w(x); return; }
    if (typeof v === 'object') { const keys = Object.keys(v).filter(k => v[k] !== undefined).sort(), n = keys.length; if (n < 16) u8(0x80 | n); else { const b = Buffer.alloc(5); b[0] = 0xdf; b.writeUInt32BE(n, 1); push(b); } for (const k of keys) { w(k); w(v[k]); } return; }
    throw new Error('Unsupported type: ' + typeof v);
  }
  w(value); return Buffer.concat(parts, size);
}
export function decode(buf) {
  let o = 0;
  const str = n => { const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const arr = n => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = r(); return a; };
  const map = n => { const m = {}; for (let i = 0; i < n; i++) { const k = r(); m[k] = r(); } return m; };
  function r() {
    const t = buf[o++];
    if (t < 0x80) return t; if (t >= 0xe0) return t - 0x100;
    if ((t & 0xf0) === 0x80) return map(t & 0x0f); if ((t & 0xf0) === 0x90) return arr(t & 0x0f); if ((t & 0xe0) === 0xa0) return str(t & 0x1f);
    switch (t) {
      case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
      case 0xce: { const v = buf.readUInt32BE(o); o += 4; return v; } case 0xd2: { const v = buf.readInt32BE(o); o += 4; return v; }
      case 0xcb: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 0xd9: return str(buf[o++]); case 0xda: { const n = buf.readUInt16BE(o); o += 2; return str(n); } case 0xdb: { const n = buf.readUInt32BE(o); o += 4; return str(n); }
      case 0xc6: { const n = buf.readUInt32BE(o); o += 4; const b = Buffer.from(buf.subarray(o, o + n)); o += n; return b; }
      case 0xdd: { const n = buf.readUInt32BE(o); o += 4; return arr(n); } case 0xdf: { const n = buf.readUInt32BE(o); o += 4; return map(n); }
      default: throw new Error('Corrupt encoding at byte ' + (o - 1));
    }
  }
  const v = r(); if (o !== buf.length) throw new Error('Trailing bytes in encoding'); return v;
}
export const pack = v => deflateRawSync(encode(v), { level: 9 });
export const unpack = b => decode(inflateRawSync(b));
export const hashBytes = b => createHash('sha256').update(b).digest('hex');
export const contentHash = v => hashBytes(encode(v)); // canonical: sorted keys
