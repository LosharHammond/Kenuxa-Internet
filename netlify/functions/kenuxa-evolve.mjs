// Netlify Scheduled Function: the node keeps evolving (crawl, grow, federate) without visitors.
import { nodeOnce } from '../../lib/adapters.mjs';
export default async () => { const node = await nodeOnce({ serverless: true }); const r = await node.tick(); return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } }); };
export const config = { schedule: '*/10 * * * *' };
