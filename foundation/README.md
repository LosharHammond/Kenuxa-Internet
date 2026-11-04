# KENUXA offline foundation

This directory ships data, not private runtime learning or a global database.

`wordnet-3.0/` contains the complete processed Princeton WordNet 3.0 English data files: 147,306 normalized lemmas, 117,659 synsets, 5,940 exception forms, definitions, usage examples, synonyms, original typed pointers (including lexical source/target word indices), and verb frames. The 513 gzip data shards total 12,512,673 bytes. Stable synset identities are `sense:wn30:<part-of-speech>:<source-offset>`; synonyms share the same synset, rather than generating duplicate meanings. Existing curated KENUXA senses keep their identities. Cross-source equivalence is not asserted automatically.

The full original [WordNet licence](wordnet-3.0/LICENSE) applies to all derived WordNet assets. Copyright 2006 Princeton University. The software/database is supplied as is; no endorsement is implied. Source: https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz . Preserve the notice when redistributing or copying shards.

`core/` contains the existing KENUXA-authored grammar, morphology, idioms, concept seeds, starter lessons, cited knowledge packs, cognitive assumptions/rules, and executable declarative procedure specifications under the repository MIT licence. Third-party cited sources retain their rights. Existing seed labels and historical assumptions have been preserved; moving them into data does not independently validate them. Executable interpreters, type systems, mathematical operators, and security controls remain in code.

`core/world.json` is a small 30-entity Wikidata structured-data snapshot covering mathematics, science, technology, living things, time, society and everyday concepts. Each entity retains its Wikidata ID, source URL, source revision, label/description, selected statements and references. [Wikidata structured data is CC0](https://www.wikidata.org/wiki/Wikidata:Licensing). Treat the snapshot as source-attested and potentially incomplete or dated, not independently verified truth.

Manifests contain versions, source identifiers, byte counts and SHA-256 checksums. Reads verify compressed bytes before decoding. Eight decoded dictionary shards and 512 constructed atom entries are cached at most; dictionary contents are not eagerly loaded into every registry or copied to every provider. The whole WordNet import is an offline build step; runtime hydration is on demand.

## Rebuild

Download the official archive yourself, retain its licence, and extract it into an ignored local directory. Then run from the repository root:

```
node scripts/build-wordnet.mjs data/bootstrap-source/WordNet-3.0
node scripts/import-wikidata-foundation.mjs data/bootstrap-source/wikidata-educational.json
node scripts/build-core-manifest.mjs
```

The Wikidata input is a bounded `wbgetentities` response (up to 500 entities / 5 MB). Review source content before publishing a new foundation release. The importer does not crawl, create accounts, update cloud databases or commit to Git. Dictionary import deduplicates synset IDs; repeated builds produce the same shard content. Downloaded archives and intermediate files stay under ignored `data/`.

## Scope

This is an English lexical foundation plus a small educational and procedural baseline. It is not all knowledge, a modern multilingual dictionary, or proof of universal comprehension. WordNet 3.0 is historical and can contain obsolete or biased descriptions. Unknown words remain knowledge gaps. Grammar and lexical evidence do not guarantee correct word-sense selection.

No Wiktionary or ConceptNet dump is bundled in this release. Their attribution/share-alike obligations and dump scale require a separate reviewed data package; do not treat their contents as MIT because this repository uses MIT for its code. Wikidata's general text pages also have a different licence from its structured data.

Live knowledge and validated procedures continue to evolve through the existing journals and graph, independently of foundation releases. Public repository updates remain an explicit review step; private knowledge is never automatically exported here.
