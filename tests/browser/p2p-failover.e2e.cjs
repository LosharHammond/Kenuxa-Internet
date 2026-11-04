// End-to-end browser check (Chromium via Playwright), run manually: node tests/browser/p2p-failover.e2e.cjs
// 1) two real browser peers opt in through the chat UI; the second fetches atoms from the first over a WebRTC
//    DataChannel (content hashes verified), the server measures the bytes it did not have to send;
// 2) the first coordinator is killed; a browser peer fails over to a second KENUXA coordinator and keeps working.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..', '..'), admin = 'e2e-admin-token-1234567890-abcdefghijk';
function start(port, extra = {}) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ID: 'e2e-' + port, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), ADMIN_TOKEN: admin, KENUXA_NETWORK: 'off', CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', COMPUTE_REPLICATE: '1', COMPUTE_SPOT_CHECK: '0', COMPUTE_DISTINCT_NETWORKS: 'off', COMPUTE_POW_BITS: '10', COMPUTE_REG_PER_NET_HOUR: '100', ...extra } });
  return new Promise(async (res) => { for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return res(child); } catch {} await new Promise(r => setTimeout(r, 100)); } res(child); });
}
const api = (port, p) => fetch(`http://127.0.0.1:${port}/api/${p}`, { headers: { Authorization: 'Bearer ' + admin } }).then(r => r.json());
(async () => {
  const A = 8831, B = 8832, out = {};
  const nodeB = await start(B, { COMPUTE_COORDINATORS: `http://127.0.0.1:${A}` }), nodeA = await start(A, { COMPUTE_COORDINATORS: `http://127.0.0.1:${B}` });
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const open = async () => { const ctx = await browser.newContext(); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto(`http://127.0.0.1:${A}/chat`); await p.waitForTimeout(800); await p.click('#compute-btn'); await p.selectOption('#compute-panel [data-k=profile]', 'balanced'); await p.click('#compute-panel [data-k=toggle]'); return { p, errs }; };
  try {
    const one = await open(); await one.p.waitForTimeout(9000); const two = await open(); await two.p.waitForTimeout(25000);
    const s1 = await one.p.evaluate(() => window.kenuxaPeer.state.stats), s2 = await two.p.evaluate(() => window.kenuxaPeer.state.stats), c = await api(A, 'compute');
    out.p2p = { browser1: { tasks: s1.tasks, served: s1.p2pServed, received: s1.p2pReceived, fallbacks: s1.p2pFallbacks }, browser2: { tasks: s2.tasks, served: s2.p2pServed, received: s2.p2pReceived, fallbacks: s2.p2pFallbacks }, server: c.p2p, gzip: { before: c.metrics.bytesBeforeGzip, onWire: c.metrics.bytesOnWire }, accepted: c.metrics.accepted, rejected: c.metrics.rejected, rejections: c.peers.map(x => x.lastRejection).filter(Boolean) };
    // failover: kill A; browser 2 should switch to B
    nodeA.kill('SIGKILL'); await two.p.waitForTimeout(30000);
    const f = await two.p.evaluate(() => ({ failovers: window.kenuxaPeer.state.stats.failovers, base: window.kenuxaPeer.state.coordinators, at: window.kenuxaPeer.state.at, status: window.kenuxaPeer.state.status, tasks: window.kenuxaPeer.state.stats.tasks }));
    const b = await api(B, 'compute'); out.failover = { browser: f, coordinatorB: { peers: b.peers.length, accepted: b.metrics.accepted } };
    out.errors = [...one.errs, ...two.errs];
  } finally { await browser.close(); nodeA.kill(); nodeB.kill(); }
  console.log(JSON.stringify(out, null, 2));
})();
