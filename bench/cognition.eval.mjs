// Before/after evaluation of conversation quality through the public /chat/ask API (works on any KENUXA version).
// Usage: node bench/cognition.eval.mjs [path-to-kenuxa-root]   — runs offline (no internet, no teacher).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const { createNode } = await import(pathToFileURL(path.join(root, 'lib/node.mjs'))); const { webRequest } = await import(pathToFileURL(path.join(root, 'lib/adapters.mjs')));
const env = { HOST: '0.0.0.0', RENDER: 'true', ADMIN_TOKEN: 'eval-admin-token-1234567890-abcdefgh', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', PUBLIC_QUESTIONS_PER_MINUTE: '500' };
const mk = n => createNode({ env: { ...env, NODE_ID: n, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-eval-')) }, log: () => {} });
const nodes = [await mk('eval-a'), await mk('eval-b')]; // consecutive turns alternate between two nodes
const CONV = [
  { name: 'solar', turns: [['How do I start a solar company in Ghana?', /solar/i, /energy commission|licen[cs]e/i], ["What if I don't have money?", /solar/i, /money|capital|cost/i], ['Which one should I start with?', /start with|begin with/i, /solar|install|referral|sales/i], ['What about the licenses?', /licen[cs]e/i, /energy commission/i]] },
  { name: 'atoms', turns: [['Explain how atoms survive node failure.', /node/i, /fragment|copies|replica|segment/i], ['What happens if two nodes disappear?', /two|2 /i, /fragment|lost|copies|rebuil/i]] },
  { name: 'feeling', turns: [['I finally finished my project!', /congrat|great|well done/i, /./]] },
  { name: 'frustration', turns: [["I've been trying to fix this for hours and nothing works.", /draining|frustrat|sorry|let's|step/i, /error|what/i]] },
];
const out = { root, turns: 0, followUps: 0, followUpsBound: 0, firstTurnsOk: 0, firstTurns: 0, errorLeaks: 0, duplicateSources: 0, invalidCitations: 0, latencyMs: [] };
for (const c of CONV) { const hist = []; let i = 0;
  for (const [q, must1, must2] of c.turns) { const t = Date.now(); const r = await (await webRequest(nodes[i % 2], new Request('https://k.example/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: hist.slice(-8), conversation: 'eval-' + c.name }) }), '198.51.100.99')).json(); out.latencyMs.push(Date.now() - t);
    const a = String(r.answer || ''), ok = must1.test(a) && must2.test(a); out.turns++;
    if (i === 0) { out.firstTurns++; if (ok) out.firstTurnsOk++; } else { out.followUps++; if (ok) out.followUpsBound++; }
    if (/getaddrinfo|ENOTFOUND|ECONNREFUSED/.test(a)) out.errorLeaks++;
    const urls = (r.sources || []).map(s => s.url); out.duplicateSources += urls.length - new Set(urls).size;
    out.invalidCitations += [...a.matchAll(/\[(\d+)\]/g)].filter(m => Number(m[1]) > (r.sources || []).length).length;
    hist.push({ question: q, entityIds: r.entityIds, ...(r.context ? { context: r.context } : {}) }); i++; } }
out.latencyMs = { median: out.latencyMs.sort((a, b) => a - b)[Math.floor(out.latencyMs.length / 2)], max: Math.max(...out.latencyMs) };
console.log(JSON.stringify(out, null, 2)); process.exit(0);
