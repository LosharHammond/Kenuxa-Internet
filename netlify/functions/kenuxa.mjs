// Netlify Functions (v2) entry: serves the whole KENUXA node.
import { nodeOnce, webRequest } from '../../lib/adapters.mjs';
export default async (request, context) => webRequest(await nodeOnce({ serverless: true }), request, context?.ip);
export const config = { path: ['/*'], preferStatic: false };
