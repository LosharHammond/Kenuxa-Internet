// Answer verification — the last stage before delivery. Each check is a real test of the drafted answer;
// failures are repaired where a safe repair exists (citations, duplicates, leaked errors, agreement) and
// otherwise disclosed. The check list is returned so the response plan shows what was verified.
const LEAK = /\b(getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|TypeError|ReferenceError|SyntaxError|at [\w.<>]+ \(|\.mjs:\d+|stack trace)\b/i;
const AGREE = [[/\bI (is|are|were)\b/g, (m, v) => `I ${v === 'were' ? 'was' : 'am'}`], [/\b(he|she|it) (are|am|were)\b/gi, (m, p, v) => `${p} ${v === 'were' ? 'was' : 'is'}`], [/\b(we|they|you) (is|am|was)\b/gi, (m, p, v) => `${p} ${v === 'was' ? 'were' : 'are'}`], [/\b(he|she|it) (have|do) (?!not\b)/gi, (m, p, v) => `${p} ${v === 'have' ? 'has' : 'does'} `]];
const HEDGE = /\b(may|might|not sure|uncertain|unverified|could not|couldn't|check|confirm|probably|likely|I don't know|not established)\b/i;
const words = s => (String(s).toLowerCase().match(/\p{L}{3,}/gu) || []);

export function verifyAnswer({ answer, sources = [], understanding = null, confidence = null }) {
  let text = String(answer || ''), revised = false; const checks = [];
  const record = (name, ok, detail = null, repaired = false) => { checks.push({ name, ok, ...(detail ? { detail } : {}), ...(repaired ? { repaired: true } : {}) }); if (repaired) revised = true; };
  // 1. Internal errors must never reach the person.
  if (LEAK.test(text)) { text = text.split(/\n/).map(l => LEAK.test(l) ? 'I could not reach my research sources just now, so I will not guess.' : l).join('\n'); record('no-internal-errors', false, 'an internal error message was replaced', true); } else record('no-internal-errors', true);
  // 2. Citations: every [n] must point to a real, distinct source; duplicates are merged and renumbered.
  const byUrl = new Map(), remap = new Map(), clean = [];
  for (const s of sources) { const key = s.url || s.title; if (!key) continue; if (!byUrl.has(key)) { byUrl.set(key, clean.length + 1); clean.push({ ...s, n: clean.length + 1 }); } remap.set(Number(s.n), byUrl.get(key)); }
  let invalid = 0; text = text.replace(/\[(\d{1,3})\]/g, (m, n) => { const to = remap.get(Number(n)); if (!to) { invalid++; return ''; } return `[${to}]`; }).replace(/(\[\d+\])(\s*\1)+/g, '$1');
  const dupSources = sources.length - clean.length;
  record('citations-valid', !invalid && !dupSources, invalid || dupSources ? `${invalid} citation(s) without a source removed; ${dupSources} duplicate source label(s) merged` : null, !!(invalid || dupSources));
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]))), unusedSources = clean.filter(s => !cited.has(s.n)).length;
  record('sources-used', !unusedSources || !cited.size, unusedSources && cited.size ? `${unusedSources} listed source(s) not cited in the text` : null);
  // 3. Repeated sentences or lines (the "same paragraph twice" failure).
  const seen = new Set(); let dups = 0;
  text = text.split('\n').filter(l => { const k = l.trim().toLowerCase().replace(/\s*\[\d+\]/g, ''); if (k.length < 25) return true; if (seen.has(k)) { dups++; return false; } seen.add(k); return true; }).join('\n');
  record('no-repetition', !dups, dups ? `${dups} repeated line(s) removed` : null, !!dups);
  // 4. Grammar: subject–verb agreement for pronoun subjects (rule:en:subject-verb-agreement).
  let fixes = 0; for (const [re, fn] of AGREE) text = text.replace(re, (...a) => { fixes++; return fn(...a); });
  record('subject-verb-agreement', !fixes, fixes ? `${fixes} agreement error(s) corrected` : null, !!fixes);
  // 5. Does it address the question? (focus terms must appear, unless it is a greeting/acknowledgement)
  const focus = words(understanding?.focus || ''), body = new Set(words(text)), hit = focus.filter(w => body.has(w) || body.has(w.replace(/s$/, '')));
  const applicable = focus.length && !['greeting', 'statement'].includes(understanding?.intent?.type);
  record('addresses-question', !applicable || hit.length > 0, applicable && !hit.length ? 'the answer does not mention what was asked about' : null);
  // 6. Uncertainty must be disclosed when confidence is low.
  if (confidence != null && confidence < 50 && !HEDGE.test(text) && text.trim()) { text += '\n\n_KENUXA is not confident about this answer; please check it against another source._'; record('uncertainty-disclosed', false, 'low confidence disclosed', true); } else record('uncertainty-disclosed', true);
  // 7. Not empty.
  record('non-empty', !!text.trim());
  return { answer: text.replace(/\n{3,}/g, '\n\n').trim(), sources: clean, checks, revised, passed: checks.every(c => c.ok || c.repaired) };
}
