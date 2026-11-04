// Network agreement on live updates (v1.4.2).
// When a node activates a PUBLIC learning event (e.g. a new word sense), it sends a signed ATP proposal carrying the
// semantic content (not its local DNA) to its trusted peers. Each peer re-validates that content with its OWN validators
// against its OWN registry and decides locally: accept (and, unless LIVE_ADOPT=off, activate it through its own ledger),
// reject (validation failed) or conflict (it already holds a different meaning under the same identity).
// The origin tallies the signed votes. Signatures prove who voted — not that the content is true — and agreement is a
// quorum of independent local validations, never instantaneous global consistency: unreachable peers stay "pending"
// and are retried later, a single dissent is recorded, and a quorum of rejections or any conflict marks the update
// "contested" so that people can see it.
export const LIVE_PROTOCOL = 'kenuxa-live/1';

export function proposalFor(event, { origin }) {
  if (!event?.content || event.privacy !== 'public') return null;
  return { protocol: LIVE_PROTOCOL, key: event.key, kind: event.kind, content: event.content, summary: event.summary, origin, activatedAt: event.activation?.at || null };
}
export function validProposal(p) {
  return !!p && p.protocol === LIVE_PROTOCOL && typeof p.key === 'string' && /^[0-9a-f]{64}$/.test(p.key) && ['new-sense'].includes(p.kind) && p.content && typeof p.content === 'object' && JSON.stringify(p.content).length < 8000;
}
// votes: [{peer, vote: accept|reject|conflict|unreachable, reasons?, localEvent?, localState?}]
export function tally(votes) {
  const reached = votes.filter(v => v.vote !== 'unreachable'), accept = reached.filter(v => v.vote === 'accept').length, reject = reached.filter(v => v.vote === 'reject').length, conflict = reached.filter(v => v.vote === 'conflict').length;
  const voters = reached.length + 1, quorum = Math.floor(voters / 2) + 1, yes = accept + 1; // the origin's own validated activation counts once
  let status;
  if (!votes.length) status = 'local-only';
  else if (conflict > 0 || reject >= quorum) status = 'contested';
  else if (!reached.length) status = 'pending';
  else if (yes >= quorum && accept >= 1) status = 'agreed';
  else status = 'pending';
  return { status, voters, quorum, accept, reject, conflict, unreachable: votes.length - reached.length, at: new Date().toISOString() };
}
export async function announce(proposal, { peers, send, max = 6 }) {
  const targets = peers.slice(0, max);
  const settled = await Promise.allSettled(targets.map(p => send(p, proposal)));
  return settled.map((s, i) => s.status === 'fulfilled' ? { peer: targets[i].fingerprint || targets[i].url, ...s.value } : { peer: targets[i].fingerprint || targets[i].url, vote: 'unreachable', reasons: [String(s.reason?.message || s.reason).slice(0, 120)] });
}
