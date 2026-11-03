// Long-running KENUXA node: local PC, Render, Railway, Fly.io, any VPS or container host.
import http from 'node:http';
import { createNode } from './lib/node.mjs';
import { nodeHttp } from './lib/adapters.mjs';

const node = await createNode();
const PORT = Number(process.env.PORT || 3210), HOST = node.host === '127.0.0.1' && node.platform !== 'self-hosted' ? '0.0.0.0' : node.host;
export const server = http.createServer((req, res) => nodeHttp(node, req, res).catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }));
server.requestTimeout = 60000; server.headersTimeout = 15000;
server.listen(PORT, HOST, () => {
  const t = node.transformer.status();
  console.log(`KENUXA ${node.nodeId} [${node.platform}] at http://${HOST}:${PORT} | storage: ${node.store.kind} | answer model: ${node.trainingInfo().examples} examples | transformer: ${t.layers}L/${t.heads}H ${t.profile}, step ${t.trainingSteps}`);
  node.start();
});
async function shutdown() { server.close(); await node.stop(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
