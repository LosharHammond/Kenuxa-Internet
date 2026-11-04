// Licensed, bounded training stream over the *existing* imported WordNet dataset.
// No mass import: each pass opens one integrity-checked compressed shard and advances a
// durable cursor. This is actual language-model training data, not a collection of canned answers.
import { corpusFromState } from '../transformer/train.mjs';
import { privacyIssue } from '../transformer/pipeline.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const clamp = (x, low, high) => Math.max(low, Math.min(high, Math.trunc(Number(x) || low)));
export class FoundationTrainingCorpus {
  constructor({ catalog, state, registry = null, maxDocuments = 1200 } = {}) {
    this.catalog = catalog;
    this.state = state || {};
    this.registry = registry;
    this.maxDocuments = clamp(maxDocuments, 32, 5000);
    this.files = catalog ? Object.keys(catalog.manifest.files).filter(n => /^senses-[0-9a-f]{2}\.json\.gz$/.test(n)).sort() : [];
    this.state.foundationTraining ||= { shard: 0, offset: 0, scanned: 0, documents: 0, examples: 0, epochs: 0, lastAt: null, errors: 0 };
    this.recent = [];
  }
  doc(s) {
    if (!s || !Array.isArray(s.words) || typeof s.definition !== 'string') return null;
    const term = clean(s.words[0]?.replaceAll('_', ' '));
    const definition = clean(s.definition);
    if (!term || !definition || term.length > 100 || definition.length > 500) return null;
    const pos = ({ n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' })[s.pos] || 'word';
    const examples = Array.isArray(s.examples) ? s.examples.map(clean).filter(x => x.length > 12 && x.length < 300 && !privacyIssue(x)).slice(0, 2) : [];
    // One document per sense prevents a sense's definition appearing independently in train and held-out sets.
    const text = 'Word: ' + term + '. Part of speech: ' + pos +
      '. Meaning: ' + definition + '. Question: What does ' + term + ' mean? Answer: ' +
      definition + (examples.length ? '. Usage: ' + examples.join(' ') : '') + '.';
    return privacyIssue(text) ? null : { text: text.slice(0, 1500), examples, term, pos, id: s.id, relations: (s.pos==='n'?(s.pointers||[]).filter(p=>['@','@i'].includes(p.symbol)).slice(0,4).map(p=>({parentId:'sense:wn30:'+(p.pos==='s'?'a':p.pos)+':'+p.offset})):[]) };
  }
  next({ limit = 80 } = {}) {
    if (!this.catalog || !this.files.length) return { documents: [], examples: [], scanned: 0, status: 'unavailable' };
    const n = clamp(limit, 1, 256), cur = this.state.foundationTraining, documents = [], examples = [], relations = [];
    let scanned = 0;
    while (documents.length < n && scanned < n * 5) {
      const f = this.files[cur.shard % this.files.length];
      let rows;
      try { rows = this.catalog.shard(f); }
      catch (err) { cur.errors++; throw err; } // corrupted or inaccessible shards fail closed
      const keys = Object.keys(rows).sort();
      if (cur.offset >= keys.length) {
        cur.offset = 0;
        cur.shard = (cur.shard + 1) % this.files.length;
        if (cur.shard === 0) cur.epochs++;
        if (!keys.length) break;
        continue;
      }
      const rec = rows[keys[cur.offset++]];
      scanned++;
      const d = this.doc(rec);
      if (!d) continue;
      documents.push(d.text);
      examples.push(...d.examples);
      for(const rel of d.relations){
        const parent=this.catalog.sense(rel.parentId)?.words?.[0]?.replaceAll('_',' ');
        if(parent&&parent.length<=120)relations.push({subject:d.term,relation:'is-a',object:parent,sourceSense:d.id,parentSense:rel.parentId});
      }
      cur.documents++;
      cur.examples += d.examples.length;
    }
    cur.scanned += scanned;
    cur.lastAt = new Date().toISOString();
    this.recent = documents.slice(-256);
    return { documents, examples, relations, scanned, status: 'ok', cursor: { shard: cur.shard, offset: cur.offset, epochs: cur.epochs } };
  }
  combined({ limit = 96, includeRecent = true, allowPrivate = false } = {}) {
    const batch = this.next({ limit });
    const approved = corpusFromState(this.state, { allowPrivate });
    const docs = [...approved.slice(-this.maxDocuments / 2), ...batch.documents, ...(includeRecent ? this.recent : [])];
    return { ...batch, corpus: [...new Set(docs)].slice(-this.maxDocuments), otherApproved: approved.length };
  }
  status() {
    return { source: this.catalog?.manifest?.dataset || null, indexedSenses: this.catalog?.manifest?.counts?.senses || 0,
      ...this.state.foundationTraining, shards: this.files.length, inMemoryDocuments: this.recent.length,
      capability: 'incremental word-sense and usage training for the existing KENUXA transformer' };
  }
}
