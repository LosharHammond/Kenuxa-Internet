// Process a bounded wbgetentities JSON snapshot obtained from Wikidata. Never downloads automatically.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const input=process.argv[2];if(!input)throw new Error('Pass a local Wikidata wbgetentities JSON snapshot');
const raw=fs.readFileSync(input);if(raw.length>5000000)throw new Error('Use incremental source subsets below 5 MB');
const data=JSON.parse(raw);if(!data.entities||Object.keys(data.entities).length>500)throw new Error('Expected at most 500 Wikidata entities');
const entities=Object.values(data.entities).filter(e=>e.labels?.en&&/^Q\d+$/.test(e.id)).map(e=>({id:'concept:wikidata:'+e.id,wikidataId:e.id,label:e.labels.en.value,description:e.descriptions?.en?.value||'',revision:e.lastrevid,claims:Object.fromEntries(['P31','P279','P361','P527'].filter(p=>e.claims[p]).map(p=>[p,e.claims[p].map(c=>({id:c.id,rank:c.rank,value:c.mainsnak?.datavalue?.value?.id,references:c.references||[]})).filter(c=>c.value)])),source:'https://www.wikidata.org/wiki/'+e.id,license:'CC0-1.0'}));
fs.writeFileSync(process.argv[3]||'foundation/core/world.json',JSON.stringify({format:'kenuxa-world-pack/1',version:1,sourceHash:createHash('sha256').update(raw).digest('hex'),entities},null,2)+'\n');console.log(`Imported ${entities.length} CC0 source entities; review before rebuilding core manifest.`);
