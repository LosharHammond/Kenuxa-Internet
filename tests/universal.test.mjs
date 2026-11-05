// Universal robustness: whatever anyone sends — any question, any body to any route, any hostile value to any module —
// KENUXA answers safely and honestly, computes what it can compute correctly, and never crashes, leaks internals or
// secrets, or invents results. EVERY RUN USES NEW RANDOM INPUTS (seed printed; replay with TEST_SEED=<seed>).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rng, question, conversation, BROKEN_ANSWER, SEED } from './lib/gen.mjs';
import { createNode } from '../lib/node.mjs';
import { webRequest } from '../lib/adapters.mjs';
import { parseExpr, checkProcedure, runProcedure, runTask } from '../lib/peers/tasks.mjs';
import { parseQuantities } from '../lib/mind/quantities.mjs';
import { updateWorld, sanitizeWorld, emptyWorld } from '../lib/mind/world.mjs';
import { sanitizeCapsule, resolveContext } from '../lib/cognition/context.mjs';
import { Mind } from '../lib/mind/index.mjs';
import { validatePolicy, SCHEMAS, INVARIANTS, DEFAULTS } from '../lib/evolve/policies.mjs';
import { negotiate } from '../lib/evolve/protocols.mjs';
import { canvas, perceive, decodePNG, encodePNG, identify, parseLegend, visualAnswer } from '../lib/mind/vision.mjs';
import { makeAtom } from '../lib/mind/atoms.mjs';
import { solve, LIBRARY } from '../lib/mind/procedures.mjs';
import { goalOf, negations } from '../lib/mind/comprehend.mjs';
import { EvolutionEngineUniversal } from '../lib/evolve/engine.mjs';
import { ComputeNetwork, CONSENT_VERSION } from '../lib/peers/network.mjs';
import { AtomRegistry } from '../lib/atoms/registry.mjs';
import { CognitiveStore } from '../lib/mind/atoms.mjs';
import { EvolutionEngine } from '../lib/mind/evolution.mjs';

const ADMIN = 'universal-admin-token-1234567890-abcdef';
const ENV = { HOST: '127.0.0.1', ADMIN_TOKEN: ADMIN, CRAWLER_ENABLED: 'false', TRANSFORMER_TRAINING: 'false', RESEARCH_ENABLED: 'false', GROQ_API_KEY: '', SUPABASE_URL: '', KENUXA_NETWORK: 'off', REQUESTS_PER_MINUTE: '1000000', PUBLIC_QUESTIONS_PER_MINUTE: '1000000', PUBLIC_QUESTIONS_PER_DAY: '1000000' };
const mkNode = (id, extra = {}) => createNode({ env: { ...ENV, ...extra, NODE_ID: id, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kx-u-')) }, log: () => {} });
const close = (a, b, tol = 0.011) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const numbers = s => (String(s).replace(/(\d),(\d{3})/g, '$1$2').match(/-?\d+(\.\d+)?/g) || []).map(Number);
const isInternal = e => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || /Maximum call stack/.test(e?.message);

test(`any question gets a safe, honest, well-formed answer; computable ones are correct (seed ${SEED})`, { timeout: 240000 }, async () => {
  const node = await mkNode('u-chat'), r = rng(1), failures = [];
  const ask = (q, history = []) => webRequest(node, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history }) }), `10.${r.int(0, 250)}.${r.int(0, 250)}.7`).then(async x => ({ status: x.status, body: await x.json().catch(() => null) }));
  for (let i = 0; i < 140; i++) {
    const q = question(r), res = await ask(q.text), a = res.body?.answer, scrub = typeof a === 'string' ? a.split(q.text.trim() || '\u0000').join(' ') : '';
    if (!q.text.trim()) { if (res.status !== 400) failures.push(`${q.kind}: empty input should be refused politely, got ${res.status}`); continue; }
    if (res.status !== 200) { failures.push(`${q.kind} ${JSON.stringify(q.text).slice(0, 60)}: status ${res.status}`); continue; }
    if (typeof a !== 'string') { failures.push(`${q.kind}: no answer`); continue; }
    if (BROKEN_ANSWER.test(scrub)) failures.push(`${q.kind} ${JSON.stringify(q.text).slice(0, 60)}: broken text “${scrub.match(BROKEN_ANSWER)[0]}”`);
    if (a.includes(ADMIN)) failures.push(`${q.kind}: leaked the admin token`);
    if (a.length > 20000) failures.push(`${q.kind}: runaway answer (${a.length} chars)`);
    if (q.expect && !numbers(a).some(n => close(n, q.expect.value) || close(n, +q.expect.value.toPrecision(3)))) failures.push(`${q.kind} ${q.text}: expected ≈${+q.expect.value.toPrecision(4)}, answer: ${a.slice(0, 120)}`);
    if (q.kind === 'self' && /created|made|built/.test(q.text) && !/Loshar Hammond Kenku/.test(a)) failures.push(`self: creator missing in “${a.slice(0, 80)}”`);
    if (q.kind === 'counterfactual' && /solar panel produced|twice its|nodes? disappear/.test(q.text) && !/[Hh]ypothetical/.test(a)) failures.push(`counterfactual not labelled hypothetical: ${q.text}`);
  }
  for (let i = 0; i < 6; i++) { const hist = []; for (const t of conversation(r)) { const res = await ask(t, hist.slice()); if (res.status !== 200 || BROKEN_ANSWER.test(res.body?.answer || '')) failures.push(`conversation turn “${t}”: ${res.status}`); hist.push({ question: t, context: res.body?.context }); } }
  assert.deepEqual(failures, [], failures.slice(0, 10).join('\n'));
});

test(`any body to any route: never a crash or leaked internals, and the node stays correct afterwards (seed ${SEED})`, { timeout: 240000 }, async () => {
  const node = await mkNode('u-routes'), r = rng(2), src = fs.readFileSync(new URL('../lib/node.mjs', import.meta.url), 'utf8');
  const routes = [...new Set([...src.matchAll(/r === '(\/[a-z/._-]*)'/g)].map(m => m[1]))].filter(x => !/^\/(api\/(crawl|research|sync|learning\/run|train|transformer\/train|agents\/run|evolve|grow|preserve|mind\/evaluate)|cron\/tick|federation)/.test(x));
  const KEYS = [...new Set([...src.matchAll(/body\.([a-zA-Z_]\w*)/g)].map(m => m[1]))];
  const junk = d => [() => r.int(-1e12, 1e12), () => r.next(), () => 'x'.repeat(r.int(0, 40)), () => null, () => r.bool(), () => [...Array(r.int(0, 4))].map(() => d < 2 ? junk(d + 1) : 1),
    () => Object.fromEntries([...Array(r.int(0, 5))].map(() => [r.bool(0.85) ? r.pick(KEYS) : r.pick(['__proto__', 'constructor', 'toString', 'valueOf', 'value', 'claim']), d < 2 ? junk(d + 1) : 'v'])), () => '<img src=x onerror=alert(1)>', () => '😀'.repeat(r.int(1, 20))][r.int(0, 8)]();
  const fives = [];
  for (let i = 0; i < 1800; i++) {
    const route = r.pick(routes), method = r.pick(['GET', 'POST', 'POST']), auth = r.bool(0.7), raw = r.bool(0.1) ? r.pick(['{', 'null', '7', '"s"', '[1]', '']) : JSON.stringify(junk(0));
    const qs = method === 'GET' ? '?' + ['id', 'q', 'key', 'address', 'prefix'].map(k => `${k}=${encodeURIComponent(JSON.stringify(junk(1)) ?? '')}`).join('&') : '';
    const res = await webRequest(node, new Request('http://127.0.0.1' + route + qs, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + ADMIN } : {}) }, ...(method === 'POST' ? { body: raw } : {}) }), `10.2.${r.int(0, 250)}.${r.int(0, 250)}`);
    const text = await res.text();
    if (res.status >= 500) fives.push(`${method} ${route} ${raw.slice(0, 60)}`);
    if (/\bat [\w.<>]+ \(|node:internal|TypeError|ReferenceError/.test(text)) fives.push(`${route}: internal text leaked`);
  }
  const errs = await webRequest(node, new Request('http://127.0.0.1/api/errors', { headers: { Authorization: 'Bearer ' + ADMIN } }), '127.0.0.1').then(x => x.json());
  assert.deepEqual(fives, [], fives.slice(0, 8).join('\n') + '\n' + JSON.stringify(errs.internal.slice(-3)));
  // the node still works and its guarantees still hold after the storm
  const who = await webRequest(node, new Request('http://127.0.0.1/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Who created you?' }) }), '10.9.9.9').then(x => x.json());
  assert.match(who.answer, /Loshar Hammond Kenku/);
  const st = await webRequest(node, new Request('http://127.0.0.1/api/evolution', { headers: { Authorization: 'Bearer ' + ADMIN } }), '127.0.0.1').then(x => x.json());
  for (const [kind, p] of Object.entries(st.policies)) assert.ok(validatePolicy(kind, p.value).ok, `active ${kind} policy still valid`);
});

test(`any value into any module: deliberate errors only — no TypeError, RangeError or runaway recursion (seed ${SEED})`, { timeout: 120000 }, async () => {
  const r = rng(3), crashes = [];
  const junk = d => [() => r.int(-1e9, 1e9), () => r.next(), () => 'x'.repeat(r.int(0, 50)), () => null, () => undefined, () => [...Array(r.int(0, 5))].map(() => d < 3 ? junk(d + 1) : 1),
    () => Object.fromEntries([...Array(r.int(0, 5))].map((_, i) => [r.pick(['value', 'unit', 'states', 'entities', 'topic', 'world', 'plan', 'events', 'resources', 'constraints', 'body', 'id', 'category', 'k' + i]), d < 3 ? junk(d + 1) : 'v'])), () => NaN, () => Infinity, () => '<script>'][r.int(0, 9)]();
  const str = () => { const c = 'abcxyz019+-*/^().,% WkhmAVmin$₵€😀\u0000\n'; return [...Array(r.int(0, 60))].map(() => c[r.int(0, c.length - 1)]).join(''); };
  const run = async (name, f) => { try { await f(); } catch (e) { if (isInternal(e)) crashes.push(`${name}: ${e.constructor.name}: ${e.message}`); } };
  const mind = new Mind({ state: {} });
  for (let i = 0; i < 1200; i++) {
    await run('parseExpr', () => parseExpr(str()).eval({ a: 1, b: 2 }));
    await run('parseQuantities', () => parseQuantities(str() + ` ${r.int(0, 1e6)} ${r.pick(['W', 'kWh', '%', 'mAh', 'GH₵', 'minutes', ''])}`));
    await run('updateWorld', () => updateWorld(junk(0), str()));
    await run('sanitizeWorld', () => sanitizeWorld(junk(0)));
    await run('capsule+context', () => resolveContext(str(), [junk(0), junk(0)].map(sanitizeCapsule).filter(Boolean)));
    await run('checkProcedure', () => checkProcedure(junk(0)));
    await run('runProcedure', () => runProcedure({ inputs: [{ name: 'a', dim: 'power', unit: 'W' }], steps: [{ as: 'b', expr: str() }], outputs: [{ name: 'b' }] }, { a: junk(0) }));
    await run('makeAtom', () => makeAtom(junk(0)));
    await run('validatePolicy', () => validatePolicy(r.pick(Object.keys(SCHEMAS)), junk(0)));
    await run('negotiate', () => negotiate(junk(0), junk(0)));
    await run('decodePNG', () => decodePNG(Buffer.from([0x89, 0x50, 0x4e, 0x47, ...[...Array(r.int(0, 300))].map(() => r.int(0, 255))])));
    await run('solve', () => solve(`${str()} how long ${r.int(1, 999)} Wh ${r.int(0, 99)} W`));
    await run('comprehend', () => { goalOf(str()); negations(str()); });
    if (i < 400) { await run('mind.think', () => mind.think(str(), { world: junk(0) })); await run('runTask', () => runTask(r.pick(['atom-validate/1', 'relation-check/1', 'procedure-test/1', 'graph-metrics/1', 'claim-consistency/1', 'lexical-consistency/1', 'isa-closure/1']), junk(0))); }
  }
  assert.deepEqual(crashes, [], [...new Set(crashes)].slice(0, 8).join('\n'));
});

test(`procedures compute random problems exactly as the physics says, in any units (seed ${SEED})`, () => {
  const r = rng(4), bad = [];
  for (let i = 0; i < 250; i++) {
    const kind = r.pick(['energy', 'cost', 'runtime', 'phone', 'panels', 'charge']);
    let text, want;
    if (kind === 'energy') { const kw = r.bool(), p = kw ? r.num(0.1, 9, 2) : r.int(1, 5000), min = r.bool(), t = min ? r.int(1, 600) : r.num(0.5, 48, 1); text = `How much energy does a ${p} ${kw ? 'kW' : 'W'} ${r.pick(['pump', 'oven', 'fan', 'tv'])} use in ${t} ${min ? 'minutes' : 'hours'}?`; want = p * (kw ? 1000 : 1) * t / (min ? 60 : 1); }
    if (kind === 'cost') { const p = r.int(1, 4000), t = r.int(1, 24), c = r.num(0.1, 5, 2); text = `A ${p} W heater runs for ${t} hours. Electricity costs GH₵${c} per kWh. How much will it cost?`; want = p * t / 1000 * c; }
    if (kind === 'runtime') { const kwh = r.bool(), e = kwh ? r.num(0.2, 20, 1) : r.int(10, 9000), p = r.int(1, 2000); text = `How long will a ${e} ${kwh ? 'kWh' : 'Wh'} battery last running a ${p} W fridge?`; want = e * (kwh ? 1000 : 1) / p; }
    if (kind === 'phone') { const mah = r.int(1000, 9000), v = r.num(3.6, 3.9, 2), pct = r.int(1, 100), w = r.num(0.3, 6, 1); text = `My phone has a ${mah} mAh ${v} V battery at ${pct}% and uses ${w} W. How long will it last?`; want = mah / 1000 * v * pct / 100 / w; }
    if (kind === 'panels') { const kwh = r.num(0.5, 30, 1), wp = r.pick([100, 200, 300, 400, 550]), sun = r.num(2, 7, 1); text = `How many ${wp} W panels do I need for ${kwh} kWh a day with ${sun} hours of peak sun?`; want = Math.ceil(kwh * 1000 / (wp * sun * 0.75)); }
    if (kind === 'charge') { const e = r.int(5, 3000), c = r.int(5, 1500); text = `How long does it take to charge a ${e} Wh battery with a ${c} W charger?`; want = e / (c * 0.85); }
    const s = solve(text); if (!s.ok || !close(s.answer.value, want, 1e-9)) bad.push(`${text} → ${s.ok ? s.answer.value : s.reason} (expected ${want})`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 6).join('\n'));
});

test(`random corrections: one verified example of a hidden rule transfers to unseen numbers (seed ${SEED})`, () => {
  const r = rng(5), fams = [
    { q: (e, p, f) => `How long will a ${e} Wh battery run a ${p} W load through an inverter that is ${f}% efficient?`, f: (e, p, f) => e * f / 100 / p, unit: 'h' },
    { q: (e, p, f) => `How long will a ${e} Wh battery run a ${p} W load with a ${f}% usable depth of discharge?`, f: (e, p, f) => e * f / 100 / p, unit: 'h' },
  ];
  for (let k = 0; k < 2; k++) {
    const fam = fams[k], store = new CognitiveStore({}), ev = new EvolutionEngine({ store, procedures: () => [...LIBRARY, ...store.usable('procedure')] });
    const ex = [r.int(200, 5000), r.int(10, 900), r.int(50, 99)], out = ev.learn({ problem: fam.q(...ex), expected: { value: fam.f(...ex), unit: fam.unit }, verifiedBy: 'test' });
    // A verified example can either teach a missing procedure or confirm that
    // an existing one already solves the family. No new rule is needed then.
    assert.ok(out.promoted || (out.ok && out.status === 'already-correct' &&
      close(out.answer?.value, fam.f(...ex), 1e-9)),
      JSON.stringify(out).slice(0, 300));
    for (let i = 0; i < 8; i++) { const x = [r.int(100, 9000), r.int(5, 1500), r.int(30, 100)]; const s = solve(fam.q(...x), { procedures: [...LIBRARY, ...store.usable('procedure')] }); assert.ok(s.ok && close(s.answer.value, fam.f(...x), 1e-9), `${fam.q(...x)} → ${s.answer?.value} vs ${fam.f(...x)}`); }
  }
});

test(`ambiguous evidence is refused, not guessed: two rules fit one example; a second example decides (seed ${SEED})`, async () => {
  const { synthesize } = await import('../lib/mind/procedures.mjs'), r = rng(10), a = r.int(2, 900), t = r.int(1, 20);
  const base = { names: ['load', 'first', 'second'], dims: { load: 'power', first: 'time', second: 'time' }, outDim: 'energy', outUnit: 'Wh' };
  const one = synthesize({ ...base, train: [{ inputs: { load: a, first: t, second: t }, output: { value: a * t } }] });
  assert.equal(one.ok, false); assert.ok(one.ambiguous, JSON.stringify(one).slice(0, 200)); assert.match(one.reason, /one more verified example/);
  const t2 = t + r.int(1, 9), two = synthesize({ ...base, train: [{ inputs: { load: a, first: t, second: t }, output: { value: a * t } }, { inputs: { load: a, first: t, second: t2 }, output: { value: a * t2 } }] });
  assert.ok(two.ok); assert.match(two.expr, /second/); assert.doesNotMatch(two.expr, /first/);
});

test(`random evolution histories never activate an invalid, unauthorized or invariant-breaking policy (seed ${SEED})`, () => {
  const r = rng(6), eng = new EvolutionEngineUniversal({ state: {} }), kinds = Object.keys(SCHEMAS);
  const mutate = (kind, base) => { const v = JSON.parse(JSON.stringify(base)), fs0 = SCHEMAS[kind].fields, k = r.pick(Object.keys(fs0)), f = fs0[k];
    if (f.type === 'number') v[k] = r.bool(0.8) ? r.num(f.min, f.max, 2) : r.pick([f.min - 1, f.max + 5, -1, 'x', null]);
    else if (f.type === 'boolean') v[k] = r.bool(0.9) ? r.bool() : 'yes'; else if (f.type === 'enum') v[k] = r.bool(0.9) ? r.pick(f.values) : 'other';
    else if (f.type === 'string') v[k] = r.bool(0.8) ? 'label ' + r.int(0, 9) : '<script>x</script>'; else if (f.type === 'array') v[k] = r.bool(0.8) ? (f.of === 'number' ? [r.int(1, 9)] : [r.pick(['ATP/1.0', 'ATP/2.0', 'kunpp/2', 'kenuxa-mind/1', 'MTP/0.5-open'])]) : 'nope';
    if (r.bool(0.05)) v[r.pick(['skipRegression', 'bypassAuth', 'autoApproveHighRisk'])] = true; return v; };
  for (let step = 0; step < 400; step++) {
    const op = r.pick(['propose', 'propose', 'propose', 'approve', 'approve-unauth', 'observe', 'rollback']);
    if (op === 'propose') { const kind = r.pick(kinds); eng.propose({ kind: 'policy', target: kind, value: mutate(kind, eng.policies.get(kind)), reason: 'random' }); }
    if (op.startsWith('approve')) { const c = r.pick(eng.S.records.filter(x => ['awaiting-authorization', 'canary'].includes(x.status)) || []); if (c) eng.approve(c.id, { by: 'random', authorized: op === 'approve' }); }
    if (op === 'observe') { const k = r.pick(Object.keys(eng.S.monitors)); if (k) eng.observe(k, r.pick(['candidate', 'baseline']), r.bool(0.7)); }
    if (op === 'rollback') { const c = r.pick(eng.S.records.filter(x => ['deployed', 'canary'].includes(x.status))); if (c) eng.rollback(c.id); }
    for (const kind of kinds) { const v = eng.policies.get(kind), val = validatePolicy(kind, v); assert.ok(val.ok, `step ${step}: active ${kind} invalid: ${val.issues}`); for (const inv of INVARIANTS.filter(i => i.kind === kind)) assert.ok(inv.check(v), `step ${step}: invariant ${inv.id} broken`); }
    for (const rec of eng.S.records.filter(x => x.risk === 'high' && x.status === 'deployed')) assert.equal(rec.approval?.by, 'random', 'high-risk only through authorized approval');
  }
});

test(`volunteer peers of random honesty never get a wrong result accepted (seed ${SEED})`, async () => {
  const r = rng(7); let t = 2e9;
  const net = new ComputeNetwork({ state: {}, registry: new AtomRegistry(), rules: {}, now: () => t, random: () => r.next(), options: { distinctNetworks: true, powBits: 0, registrationsPerIpHour: 1e6, mix: { 'atom-validate/1': 2, 'relation-check/1': 1, 'graph-metrics/1': 1 }, replicate: 0.5, spotCheck: 0.3 } });
  const peers = [...Array(8)].map((_, i) => { const g = net.register({ consent: true, consentVersion: CONSENT_VERSION, capabilities: { workers: true, subtleCrypto: true, cores: 4 }, profile: 'balanced', ipKey: 'net' + i }); return { ...g, mode: r.pick(['honest', 'honest', 'liar', 'dropper']) }; });
  net.fill();
  for (let round = 0; round < 120; round++) { t += 2100;
    for (const pr of peers) { let p; try { p = net.auth(pr.peerId, pr.token); } catch { continue; } const l = net.lease(p); if (!l.task) continue;
      if (pr.mode === 'dropper' && r.bool(0.5)) continue; let res = await runTask(l.task.kind, l.task.payload);
      if (pr.mode === 'liar') res = { ...res, issues: r.bool() ? [] : [{ id: l.task.payload.atoms?.[0]?.id || 'x', kind: 'corrupted', detail: 'invented' }], digest: '0'.repeat(64) };
      await net.submit(p, { leaseId: l.task.leaseId, taskId: l.task.taskId, result: res }); }
    if (round % 20 === 0) { t += 61000; net.expire(); }
  }
  let checked = 0; for (const task of Object.values(net.S.tasks).filter(x => x.state === 'accepted' && x.acceptedBy?.length && !x.acceptedBy.includes('core'))) {
    const truth = await net.coreRun(task, task.atomIds); for (const pid of task.acceptedBy) { const res = task.results[pid]; if (res?.digest) assert.equal(res.digest, truth.digest, `task ${task.id} accepted a wrong result from ${pid}`); } checked++; }
  assert.ok(checked > 0, 'some peer work was accepted');
  for (const pr of peers.filter(x => x.mode === 'liar')) assert.ok(net.S.peers[pr.peerId].rejected > 0 || net.S.peers[pr.peerId].accepted === 0, 'liars are caught');
});

test(`random scenes: perception reports exactly what is drawn, and never names an object without evidence (seed ${SEED})`, () => {
  const r = rng(8), COLS = { blue: [40, 80, 220], yellow: [240, 210, 40], red: [220, 40, 40], green: [40, 170, 60], purple: [140, 60, 180] }, SH = ['rectangle', 'circle', 'triangle'];
  for (let k = 0; k < 15; k++) {
    const n = r.int(2, 4), cols = r.shuffle(Object.keys(COLS)).slice(0, n), c = canvas(80 * n + 20, 140), placed = [];
    for (let i = 0; i < n; i++) { const shape = r.pick(SH), x = 10 + i * 80, y = r.int(10, 70), s = r.int(26, 40); if (shape === 'rectangle') c.rect(x, y, s, r.int(20, 40), COLS[cols[i]]); else if (shape === 'circle') { const rad = Math.floor(s / 2); c.ellipse(x + rad, y + rad, rad, rad, COLS[cols[i]]); } else c.triangle(x, y, s, s, COLS[cols[i]]); placed.push({ shape, colour: cols[i], x, y, s }); }
    const linked = r.bool(0.6); if (linked) c.line(placed[0].x + placed[0].s, placed[0].y + 8, placed[1].x - 2, placed[1].y + 8, [0, 0, 0], 2);
    const p = perceive(decodePNG(encodePNG(c)));
    assert.deepEqual(p.objects.map(o => `${o.colour} ${o.shape}`).sort(), placed.map(o => `${o.colour} ${o.shape}`).sort(), `scene ${k}`);
    assert.equal(p.connections.length, linked ? 1 : 0, `scene ${k} connections`);
    assert.deepEqual(identify(p), {}, 'no identity without a legend or verified examples');
    const ids = identify(p, { legend: parseLegend(`the ${placed[0].colour} ${placed[0].shape} is the inverter, the ${placed[1].colour} ${placed[1].shape} is the battery`) });
    assert.deepEqual(visualAnswer('Which component appears connected to the inverter?', p, ids).answer, linked ? ['battery'] : []);
  }
});

test(`random conversations keep the world model consistent and the capsule faithful (seed ${SEED})`, () => {
  const r = rng(9);
  for (let k = 0; k < 40; k++) {
    let w = emptyWorld(); const pct = r.int(1, 90), hrs = r.int(1, 12); w = updateWorld(w, `My phone battery is at ${pct}%, and I need to travel for ${hrs} hours.`).world;
    const last = {};
    for (let i = 0; i < r.int(1, 6); i++) { const res = r.pick(['power bank', 'charger']), has = r.bool(); w = updateWorld(w, has ? `I have a ${res}.` : `I don't have a ${res}.`).world; last[res === 'power bank' ? 'powerBank' : 'chargerAvailable'] = has; }
    const mins = r.bool() ? r.int(1, 59) : null; if (mins) w = updateWorld(w, `I have only ${mins} minutes before leaving.`).world;
    assert.equal(w.entities.phone.states.charge.value, pct); assert.equal(w.events[0].durationH, hrs);
    for (const [k2, v] of Object.entries(last)) assert.equal(w.resources[k2]?.available, v, `${k2} follows the latest statement`);
    if (mins) assert.ok(close(w.constraints.timeBeforeDeparture.value, mins / 60, 1e-9));
    assert.deepEqual(sanitizeCapsule({ topic: { focus: 'x' }, world: JSON.parse(JSON.stringify(w)) }).world.resources, sanitizeWorld(w).resources, 'capsule round-trip');
  }
});
