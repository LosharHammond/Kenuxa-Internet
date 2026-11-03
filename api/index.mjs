// Vercel serverless entry. Every path is rewritten here by vercel.json.
import { nodeOnce, nodeHttp } from '../lib/adapters.mjs';
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  const node = await nodeOnce({ serverless: true });
  return nodeHttp(node, req, res);
}
