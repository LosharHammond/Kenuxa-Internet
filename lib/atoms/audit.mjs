// Atomic correctness audit (LAW 2). Scans the registry incrementally and reports — never silently "fixes" —
// invalid relationships, broken references, corrupted revisions, contradictory relations, IS_A cycles,
// duplicate identities, missing provenance and genesis atoms whose content drifted.
import { contentHash } from './codec.mjs';
import { RELATIONS, checkDNA, norm } from './schema.mjs';

export function auditRegistry(registry, { limit = Infinity, from = 0 } = {}) {
  const issues = [], add = (kind, id, detail) => issues.push({ kind, id, detail }), ids = [...registry.manifests.keys()].slice(from, from + limit);
  const forms = new Map();
  for (const id of ids) {
    const m = registry.manifests.get(id), d = registry.revisions.get(m.head);
    if (!d) { add('missing-revision', id, `head ${m.head.slice(0, 12)} not stored`); continue; }
    if (contentHash(d) !== m.head) add('corrupted', id, 'revision content does not match its hash');
    try { checkDNA(d); } catch (e) { add('invalid-schema', id, e.message); }
    if (d.identity.id !== id) add('identity-mismatch', id, `DNA says ${d.identity.id}`);
    for (const e of d.relational || []) {
      const rel = RELATIONS[e.type], target = registry.get(e.target);
      if (!rel) { add('unknown-relation', id, e.type); continue; }
      if (!target) { if (!/^(lex|sense|concept|rule|phr|sym|fact|rel):/.test(e.target) || registry.has(e.target) === false) add('broken-reference', id, `${e.type} → ${e.target}`); continue; }
      if (!rel.from.includes(d.identity.type) || !rel.to.includes(target.identity.type)) add('invalid-relationship', id, `${e.type} cannot connect ${d.identity.type} → ${target.identity.type}`);
    }
    for (const s of d.semantic?.senses || []) if (!registry.has(s)) add('broken-reference', id, `sense ${s} missing`);
    const isA = new Set((d.relational || []).filter(e => e.type === 'IS_A').map(e => e.target));
    for (const e of d.relational || []) if (e.type === 'CONTRADICTS' && isA.has(e.target)) add('contradiction', id, `both IS_A and CONTRADICTS ${e.target}`);
    if (d.identity.originNode !== 'genesis' && !(d.identity.provenance || []).length && !(d.epistemic?.evidence || []).length && d.identity.type !== 'symbol') add('missing-provenance', id, 'no provenance and no evidence');
    if (d.identity.type === 'lexical') { const k = `${d.identity.language}:${norm(d.identity.normalized)}`; if (forms.has(k) && forms.get(k) !== id) add('duplicate-identity', id, `same form as ${forms.get(k)}`); forms.set(k, id); }
  }
  // IS_A cycles (a kind of itself through a chain) — DFS with colouring over the scanned atoms.
  const colour = new Map(), cycle = (id, stack) => { colour.set(id, 1); for (const e of registry.get(id)?.relational || []) { if (e.type !== 'IS_A') continue; const c = colour.get(e.target); if (c === 1) { add('isa-cycle', id, [...stack, id, e.target].slice(-6).join(' → ')); continue; } if (!c && registry.has(e.target)) cycle(e.target, [...stack, id]); } colour.set(id, 2); };
  for (const id of ids) if (!colour.has(id)) cycle(id, []);
  const byKind = {}; for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  return { scanned: ids.length, next: from + ids.length < registry.manifests.size ? from + ids.length : null, ok: !issues.length, byKind, issues: issues.slice(0, 200) };
}
