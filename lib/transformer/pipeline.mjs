// Controlled training & release pipeline for the KENUXA Core Transformer (PART 14).
// Atom/knowledge updates never touch weights. Weights change only through this pipeline:
//   curate dataset (dedupe, length, privacy scrub) → deterministic train / eval split →
//   train a CANDIDATE (never served) → evaluate on held-out data + frozen regression set →
//   promotion gate (policy: gated | manual | off) → versioned release → rollback.
import { createHash } from 'node:crypto';
import { Transformer } from './core.mjs';
import { encode } from './io.mjs';

// Privacy safeguards: documents that look like they contain personal data or secrets are excluded.
const PRIVATE = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'email address'],
  [/(?:\+?\d[\s-]?){9,}/, 'phone or account number'],
  [/\b(?:sk|gsk|pk|rk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{12,}/, 'API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(?:password|passwd|secret)\s*[:=]\s*\S+/i, 'credential'],
];
export function privacyIssue(text) { for (const [re, what] of PRIVATE) if (re.test(text)) return what; return null; }
const h = s => createHash('sha256').update(s).digest();

export function curateDataset(texts, { evalShare = 0.1, minChars = 12, maxChars = 2000, maxDocs = 5000 } = {}) {
  const seen = new Set(), train = [], evalSet = [], dropped = { duplicates: 0, length: 0, privacy: 0 }, privacy = {};
  for (const raw of texts) {
    const t = String(raw || '').replace(/\s+\n/g, '\n').trim(), key = t.toLowerCase().replace(/\s+/g, ' ');
    if (t.length < minChars || t.length > maxChars) { dropped.length++; continue; }
    if (seen.has(key)) { dropped.duplicates++; continue; } seen.add(key);
    const issue = privacyIssue(t); if (issue) { dropped.privacy++; privacy[issue] = (privacy[issue] || 0) + 1; continue; }
    // Deterministic split: the same document always lands in the same set on every node and run.
    (h(key).readUInt16BE(0) / 65536 < evalShare ? evalSet : train).push(t);
    if (train.length + evalSet.length >= maxDocs) break;
  }
  if (!evalSet.length && train.length > 1) evalSet.push(train.pop()); // always hold something out
  return { train, eval: evalSet, dropped, privacy, fingerprint: h(JSON.stringify([train.length, evalSet.length, ...evalSet.slice(0, 50)])).toString('hex').slice(0, 16) };
}

// Mean next-token loss on held-out documents (forward pass only — no weight change).
export function evaluate(config, P, docs, { maxDocs = 32, seq = 64 } = {}) {
  if (!docs?.length) return null;
  const m = new Transformer(config, P, { checkpointing: false }); let total = 0, n = 0;
  for (const d of docs.slice(0, maxDocs)) {
    const toks = encode(d, { bos: true, eos: true }).slice(0, seq + 1); if (toks.length < 3) continue;
    const f = m.forward(toks.slice(0, -1), { keep: false }); total += m.loss(f.logits, f.T, f.pre, toks.slice(1)).loss; n++;
  }
  return n ? +(total / n).toFixed(5) : null;
}

export const DEFAULT_RELEASE_POLICY = { mode: 'gated', tolerance: 0.0, regressionTolerance: 0.02, minStepsBetween: 25, keepVersions: 3 };

// Decides whether a candidate may replace the live model. Pure function → easy to test and audit.
export function gate({ candidate, live, policy = DEFAULT_RELEASE_POLICY }) {
  const reasons = [];
  if (candidate.evalLoss == null) reasons.push('no held-out evaluation data');
  if (live && candidate.step - (live.step || 0) < policy.minStepsBetween) reasons.push(`only ${candidate.step - (live.step || 0)} steps since the live version (needs ${policy.minStepsBetween})`);
  if (live?.evalLoss != null && candidate.evalLoss != null && candidate.evalLoss > live.evalLoss * (1 + policy.tolerance)) reasons.push(`held-out loss ${candidate.evalLoss} is not better than live ${live.evalLoss}`);
  if (live?.regressionLoss != null && candidate.regressionLoss != null && candidate.regressionLoss > live.regressionLoss * (1 + policy.regressionTolerance)) reasons.push(`regression set got worse (${candidate.regressionLoss} vs ${live.regressionLoss})`);
  if (!Number.isFinite(candidate.evalLoss ?? 0) || !Number.isFinite(candidate.regressionLoss ?? 0)) reasons.push('non-finite loss (diverged)');
  const passes = !reasons.length;
  const decision = !passes ? 'rejected' : policy.mode === 'off' ? 'held (promotion disabled)' : policy.mode === 'manual' ? 'awaiting-approval' : 'promote';
  return { passes, decision, reasons };
}
