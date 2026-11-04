// Cognitive benchmark: runs the same self-evaluation a live node runs (/api/mind/evaluate), on a fresh mind.
// Run: node bench/mind.bench.mjs
import { Mind } from '../lib/mind/index.mjs';
import { runEvaluation } from '../lib/mind/evaluate.mjs';
const r = runEvaluation(Mind);
const f = x => x && typeof x === 'object' && 'passed' in x ? `${x.passed}/${x.total} (${Math.round(100 * x.rate)}%)` : x;
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !('passed' in v) && !Array.isArray(v) ? flat(v, p + k + '.') : [[p + k, f(v)]]);
for (const [k, v] of flat(r)) console.log(k.padEnd(48), v);
