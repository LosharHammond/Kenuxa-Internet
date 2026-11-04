// Visual Perception and Interpretation (CPU only, no models, no downloads).
// What is implemented is real image processing: PNG decoding, background estimation, colour segmentation into
// connected components, shape measurement (rectangle / ellipse / triangle / line by fill ratio and elongation),
// line-based connections between objects, spatial relations, and perception atoms that carry the measurements.
// Object IDENTITY ("this is an inverter") is never invented: it comes from (a) a legend the person gives for this
// image, or (b) a nearest-neighbour labeller trained on VERIFIED labelled examples and evaluated on unseen images.
// Not implemented (documented as optional): OCR, photographs of real scenes, learned object detectors.
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// ---------- PNG ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function decodePNG(buf) {
  const b = Buffer.from(buf); if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (or truncated)');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0; const idat = []; let palette = null;
  while (o + 8 <= b.length) { const len = b.readUInt32BE(o), kind = b.toString('latin1', o + 4, o + 8); if (o + 12 + len > b.length) throw new Error('truncated PNG chunk ' + kind); const data = b.subarray(o + 8, o + 8 + len); o += 12 + len;
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; inter = data[12]; }
    else if (kind === 'PLTE') palette = data; else if (kind === 'IDAT') idat.push(data); else if (kind === 'IEND') break; }
  if (!w || !h) throw new Error('PNG without a valid header');
  if (depth !== 8 || inter) throw new Error('only 8-bit, non-interlaced PNGs are supported');
  if (w * h > 4e6) throw new Error('image too large (max 4 megapixels)');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]; if (!ch) throw new Error('unsupported colour type ' + type);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(w * h * ch), rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= ch ? px[y * stride + x - ch] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0; let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255; } }
  for (let i = 0; i < w * h; i++) { const s = i * ch, d = i * 4;
    if (type === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; } else if (type === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else if (type === 3) { const p = px[s] * 3; rgba[d] = palette[p]; rgba[d + 1] = palette[p + 1]; rgba[d + 2] = palette[p + 2]; rgba[d + 3] = 255; }
    else { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = ch === 4 ? px[s + 3] : 255; } }
  return { width: w, height: h, rgba };
}
export function encodePNG({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const chunk = (k, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const kd = Buffer.concat([Buffer.from(k, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(kd)); return Buffer.concat([l, kd, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(width, 0); ih.writeUInt32BE(height, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// tiny raster for building test images
export function canvas(width, height, bg = [255, 255, 255]) {
  const rgba = new Uint8ClampedArray(width * height * 4); for (let i = 0; i < width * height; i++) rgba.set([...bg, 255], i * 4);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < width && y < height) rgba.set([...c, 255], (y * width + x) * 4); };
  return { width, height, rgba,
    rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); return this; },
    ellipse(cx, cy, rx, ry, c) { for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1) set(cx + i, cy + j, c); return this; },
    triangle(x, y, w, h, c) { for (let j = 0; j < h; j++) { const half = Math.round((w / 2) * (j / h)); for (let i = -half; i <= half; i++) set(x + Math.round(w / 2) + i, y + j, c); } return this; },
    line(x0, y0, x1, y1, c, t = 2) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k <= n; k++) { const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n); for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) set(x + a, y + b, c); } return this; },
  };
}

// ---------- segmentation and measurement ----------
const NAMED = { black: [0, 0, 0], white: [255, 255, 255], red: [220, 40, 40], green: [40, 170, 60], blue: [40, 80, 220], yellow: [240, 210, 40], orange: [245, 140, 30], purple: [140, 60, 180], grey: [128, 128, 128], brown: [130, 80, 40], cyan: [40, 200, 220] };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const colourName = c => Object.entries(NAMED).sort((a, b) => dist(c, a[1]) - dist(c, b[1]))[0][0];
export function perceive(img, { tolerance = 40, minArea = 12 } = {}) {
  const { width: W, height: H, rgba } = img, N = W * H, at = i => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
  // background = most common colour (quantised)
  const counts = new Map(); for (let i = 0; i < N; i += 1) { const c = at(i), k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4); counts.set(k, (counts.get(k) || 0) + 1); }
  const bk = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0], bg = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  const label = new Int32Array(N).fill(-1), comps = [];
  for (let s = 0; s < N; s++) { if (label[s] !== -1 || dist(at(s), bg) <= tolerance) continue;
    const seed = at(s), id = comps.length, q = [s]; label[s] = id; let area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0;
    while (q.length) { const p = q.pop(), x = p % W, y = (p / W) | 0, c = at(p); area++; sx += x; sy += y; sr += c[0]; sg += c[1]; sb += c[2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [x > 0 && p - 1, x < W - 1 && p + 1, y > 0 && p - W, y < H - 1 && p + W]) if (n !== false && label[n] === -1 && dist(at(n), seed) <= tolerance) { label[n] = id; q.push(n); } }
    comps.push({ id, area, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, centroid: { x: sx / area, y: sy / area }, rgb: [sr / area, sg / area, sb / area].map(Math.round) }); }
  const objects = [], lines = [];
  for (const c of comps.filter(c => c.area >= minArea)) {
    const { w, h } = c.bbox, fill = c.area / (w * h), aspect = w / h, thin = Math.min(w, h), long = Math.max(w, h);
    let shape, conf;
    const length = Math.hypot(w, h), stroke = c.area / length; /* stroke width = area ÷ length: slope-independent */
    if ((thin <= 4 && long >= 8) || (stroke <= 4 && length >= 10 && Math.max(aspect, 1 / aspect) >= 3) || (fill < 0.35 && long > 3 * Math.sqrt(c.area))) { shape = 'line'; conf = 0.9; }
    else if (fill >= 0.9) { shape = 'rectangle'; conf = Math.min(1, (fill - 0.9) * 5 + 0.5); }
    else if (fill >= 0.68 && fill < 0.88) { shape = Math.abs(aspect - 1) < 0.15 ? 'circle' : 'ellipse'; conf = 1 - Math.abs(fill - Math.PI / 4) * 4; }
    else if (fill >= 0.4 && fill < 0.65) { shape = 'triangle'; conf = 1 - Math.abs(fill - 0.5) * 4; }
    else { shape = 'irregular'; conf = 0.3; }
    const o = { id: 'o' + c.id, shape, colour: colourName(c.rgb), rgb: c.rgb, bbox: c.bbox, centroid: { x: +c.centroid.x.toFixed(1), y: +c.centroid.y.toFixed(1) }, area: c.area, fill: +fill.toFixed(3), aspect: +aspect.toFixed(3), confidence: +Math.max(0.1, Math.min(1, conf)).toFixed(2) };
    (shape === 'line' ? lines : objects).push(o);
  }
  // a line connects the objects whose (slightly enlarged) boxes it touches at its two ends
  const near = (o, x, y, pad = 3) => x >= o.bbox.x - pad && x <= o.bbox.x + o.bbox.w + pad && y >= o.bbox.y - pad && y <= o.bbox.y + o.bbox.h + pad;
  const connections = [];
  for (const l of lines) { const pts = []; const L = comps[Number(l.id.slice(1))];
    for (let y = l.bbox.y; y < l.bbox.y + l.bbox.h; y++) for (let x = l.bbox.x; x < l.bbox.x + l.bbox.w; x++) if (label[y * W + x] === L.id) pts.push([x, y]);
    const touching = objects.filter(o => pts.some(([x, y]) => near(o, x, y))); if (touching.length >= 2) connections.push({ via: l.id, objects: touching.map(o => o.id), evidence: `line ${l.id} (${l.colour}) touches ${touching.map(o => o.id).join(' and ')}` }); }
  const relations = [];
  for (const a of objects) for (const b of objects) { if (a === b) continue;
    const inside = a.bbox.x >= b.bbox.x && a.bbox.y >= b.bbox.y && a.bbox.x + a.bbox.w <= b.bbox.x + b.bbox.w && a.bbox.y + a.bbox.h <= b.bbox.y + b.bbox.h; if (inside) relations.push([a.id, 'inside', b.id]);
    else { if (a.bbox.x + a.bbox.w <= b.bbox.x) relations.push([a.id, 'left-of', b.id]); if (a.bbox.y + a.bbox.h <= b.bbox.y) relations.push([a.id, 'above', b.id]); } }
  const hash = createHash('sha256').update(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)).digest('hex').slice(0, 16);
  return { image: { hash, width: W, height: H, background: colourName(bg) }, objects, lines, connections, relations, method: 'colour segmentation (4-connected components) + shape by fill ratio + line contact' };
}
export function perceptionAtoms(p) { return p.objects.map(o => ({ id: `perc:${p.image.hash}:${o.id}`, category: 'perception', label: `${o.colour} ${o.shape} in image ${p.image.hash}`, status: 'tested', confidence: o.confidence, visibility: 'private', body: { ...o, image: p.image.hash, connectedTo: p.connections.filter(c => c.objects.includes(o.id)).flatMap(c => c.objects.filter(x => x !== o.id)) }, evidence: [{ kind: 'observation', ref: p.image.hash, detail: p.method }] })); }

// ---------- identity: legend for this image, or a labeller trained on verified examples ----------
// legend: "the blue rectangle is the inverter, the yellow circle is the battery"
export function parseLegend(text) { const out = []; for (const m of String(text || '').matchAll(/\b(?:the )?(black|white|red|green|blue|yellow|orange|purple|grey|gray|brown|cyan)\s+(rectangle|square|box|circle|ellipse|oval|triangle)\s+(?:is|=|shows|represents)\s+(?:the |an? )?([a-z][a-z -]{1,30}?)(?=[,.;]|$| and )/gi)) out.push({ colour: m[1].toLowerCase().replace('gray', 'grey'), shape: { square: 'rectangle', box: 'rectangle', oval: 'ellipse' }[m[2].toLowerCase()] || m[2].toLowerCase(), label: m[3].trim().toLowerCase() }); return out; }
const vec = (o, img) => [o.shape === 'rectangle', o.shape === 'circle' || o.shape === 'ellipse', o.shape === 'triangle'].map(Number).concat([Math.min(3, o.aspect) / 3, o.fill, ...o.rgb.map(v => v / 255), Math.sqrt(o.area / (img.width * img.height))]);
export class Labeller {
  constructor({ state = {} } = {}) { this.S = state; this.S.examples ||= []; }
  learn(perception, labels, { verifiedBy = 'human' } = {}) { if (!['human', 'test'].includes(verifiedBy)) return 0; let n = 0; for (const [oid, label] of Object.entries(labels)) { const o = perception.objects.find(x => x.id === oid); if (o) { this.S.examples.push({ v: vec(o, perception.image), label, image: perception.image.hash }); n++; } } if (this.S.examples.length > 5000) this.S.examples.splice(0, this.S.examples.length - 5000); return n; }
  predict(o, img, { k = 3, maxDist = 0.6 } = {}) { const v = vec(o, img), d = this.S.examples.map(e => ({ e, d: Math.hypot(...v.map((x, i) => x - e.v[i])) })).sort((a, b) => a.d - b.d).slice(0, k); if (!d.length || d[0].d > maxDist) return null; const votes = {}; for (const x of d.filter(x => x.d <= maxDist)) votes[x.e.label] = (votes[x.e.label] || 0) + 1 / (x.d + 0.05); const [label, s] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]; return { label, confidence: +(s / Object.values(votes).reduce((a, b) => a + b, 0)).toFixed(2), nearest: +d[0].d.toFixed(3) }; }
}
export function identify(p, { legend = [], labeller = null } = {}) {
  const ids = {};
  for (const o of p.objects) { const l = legend.find(x => x.colour === o.colour && (x.shape === o.shape || (x.shape === 'circle' && o.shape === 'ellipse') || (x.shape === 'ellipse' && o.shape === 'circle'))); if (l) { ids[o.id] = { label: l.label, source: 'legend given for this image' }; continue; }
    const g = labeller?.predict(o, p.image); if (g) ids[o.id] = { label: g.label, source: `labeller trained on verified examples (confidence ${g.confidence})` }; }
  return ids;
}
// "Which component appears connected to the inverter?" — answered only from detected connections and known labels
export function visualAnswer(question, p, ids) {
  const q = String(question || '').toLowerCase(), name = o => ids[o]?.label || null, byLabel = l => Object.entries(ids).filter(([, v]) => v.label === l).map(([k]) => k);
  const m = q.match(/connected (?:to|with) (?:the |an? )?([a-z][a-z -]{1,30}?)\??$/);
  if (m) { const targets = byLabel(m[1].trim()); if (!targets.length) return { answer: null, why: `no object in the image is identified as “${m[1].trim()}” (give a legend or labelled examples); I will not guess` };
    const linked = [...new Set(p.connections.filter(c => c.objects.some(o => targets.includes(o))).flatMap(c => c.objects.filter(o => !targets.includes(o))))];
    if (!linked.length) return { answer: [], why: `no line in the image touches the ${m[1].trim()}` };
    return { answer: linked.map(o => name(o) || `an unidentified ${p.objects.find(x => x.id === o).colour} ${p.objects.find(x => x.id === o).shape}`), evidence: p.connections.filter(c => c.objects.some(o => targets.includes(o))).map(c => c.evidence) }; }
  const cnt = q.match(/how many (\w+?)s?\b/); if (cnt) { const s = cnt[1]; const n = p.objects.filter(o => o.shape === s || o.colour === s || name(o.id) === s).length; return { answer: n, why: `counted detected objects matching “${s}”` }; }
  return { answer: null, why: 'question type not supported by the perception layer (supported: connections, counts)' };
}
