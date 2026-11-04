// Protocol versioning and transport abstraction.
// Each node advertises, per protocol family, the versions it speaks (newest first) and which are deprecated.
// negotiate() picks the newest version both sides speak; if there is none, the result is an explicit, safe failure
// (never a silent downgrade to something the node no longer supports). Deprecated versions still work but are
// reported, so operators can see who must upgrade before removal.

const parse = v => { const m = String(v).match(/^([A-Za-z-]+)\/(\d+)(?:\.(\d+))?/); return m ? { family: m[1].toLowerCase(), major: +m[2], minor: +(m[3] || 0) } : null; };
const newer = (a, b) => { const x = parse(a), y = parse(b); return x.major - y.major || x.minor - y.minor; };

const list = x => Array.isArray(x) ? x.filter(v => typeof v === 'string').slice(0, 20) : []; /* advertisements come from remote nodes: never trust their shape */
export function negotiate(mine, theirs, { deprecated = [] } = {}) {
  mine = list(mine); theirs = list(theirs); deprecated = list(deprecated);
  const ours = mine.filter(v => parse(v)), common = ours.filter(v => theirs.includes(v)).sort((a, b) => newer(b, a));
  if (!common.length) return { ok: false, reason: `no common version (we speak ${ours.join(', ') || 'nothing'}, the peer speaks ${(theirs || []).join(', ') || 'nothing'})`, action: 'refuse-safely' };
  const v = common[0]; return { ok: true, version: v, deprecated: deprecated.includes(v), warning: deprecated.includes(v) ? `${v} is deprecated — the peer should upgrade` : null, alternatives: common.slice(1) };
}
// negotiate every family at once (e.g. { atp: [...], kunpp: [...], mind: [...] })
export function negotiateAll(mine, theirs, { deprecated = [] } = {}) {
  const out = {}; theirs = theirs && typeof theirs === 'object' ? theirs : {}; for (const fam of Object.keys(mine || {})) out[fam] = negotiate(mine[fam], theirs?.[fam] || [], { deprecated }); return out;
}

// Transports: what exists, what each is good for, and the fallback order. Selection is by requirement, not by name.
export const TRANSPORTS = {
  https: { available: true, properties: ['request-response', 'signed', 'server-to-server', 'browser-to-server'], note: 'ATP, KUNPP and chat' },
  webrtc: { available: true, properties: ['peer-to-peer', 'browser-to-browser', 'bulk-public-data'], note: 'KUNPP replica payloads between consenting browsers; HTTPS fallback counted' },
  websocket: { available: false, properties: ['push', 'browser-to-server'], note: 'not implemented — free hosting may sleep idle sockets; listed as an extension point' },
};
export function selectTransport(required = [], { exclude = [] } = {}) {
  const fits = Object.entries(TRANSPORTS).filter(([n, t]) => t.available && !exclude.includes(n) && required.every(r => t.properties.includes(r))).map(([n]) => n);
  return fits.length ? { transport: fits[0], fallbacks: fits.slice(1).concat(fits[0] !== 'https' && TRANSPORTS.https.available && !exclude.includes('https') ? ['https'] : []) } : { transport: null, reason: `no available transport offers ${required.join(' + ')}` };
}
