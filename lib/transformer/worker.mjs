// Background training thread: keeps the HTTP server responsive while the transformer learns.
import { parentPort, workerData } from 'node:worker_threads';
import { Trainer, trainKernel } from './train.mjs';
import { encode } from './io.mjs';

const { config, weights, corpus, options } = workerData;
const P = new Map(Object.entries(weights).map(([k, buf]) => [k, new Float32Array(buf)]));
const trainer = new Trainer(config, P, options); trainer.step = options.startStep || 0; trainer.setCorpus(corpus);
let running = true, paused = false, pausedUntil = 0, budget = options.maxSteps ?? Infinity;
const throttleMs = Math.max(5,Math.min(3000,Number(options.throttleMs)||20));
parentPort.on('message', msg => {
  if (msg.type === 'corpus') trainer.setCorpus(msg.corpus);
  if (msg.type === 'stop') running = false;
  if (msg.type === 'pressure') {
    paused = msg.active === true;
    // Do not race the next user request for a free Render CPU immediately after
    // one answer finishes. Resume candidate training after a short idle window.
    pausedUntil = Date.now() + Math.max(1000,Math.min(30000,Number(options.idleResumeMs)||5000));
  }
  if (msg.type === 'kernel') { // atom kernels grow here so the HTTP thread never blocks
    try { const k = trainKernel(trainer.model, msg.texts, { steps: msg.steps, init: msg.init ? new Float32Array(msg.init) : null }); const emb = trainer.model.embed(encode(msg.embedText, { bos: true }), k.prefix);
      parentPort.postMessage({ type: 'kernel', id: msg.id, prefix: k.prefix, loss: k.loss, tokens: k.tokens, embedding: emb }); }
    catch (e) { parentPort.postMessage({ type: 'kernel', id: msg.id, error: e.message }); }
  }
});
const report = () => parentPort.postMessage({ type: 'weights', step: trainer.step, loss: trainer.loss, ema: trainer.ema, tokens: trainer.tokens, weights: Object.fromEntries([...trainer.model.P].map(([k, a]) => [k, a.slice()])) });
async function loop() {
  let since = 0, started = Date.now();
  while (running && budget > 0) {
    if (paused || Date.now() < pausedUntil) { await new Promise(r=>setTimeout(r,200)); continue; }
    const loss = trainer.trainStep(); budget--;
    if (loss == null) { await new Promise(r => setTimeout(r, 5000)); continue; }
    since++;
    if (since >= (options.reportEvery || 25) || Date.now() - started > 120000) { report(); since = 0; started = Date.now(); }
    await new Promise(r => setTimeout(r, throttleMs)); // bound CPU load and yield to interactive work
  }
  report(); parentPort.postMessage({ type: 'done' });
}
loop();
