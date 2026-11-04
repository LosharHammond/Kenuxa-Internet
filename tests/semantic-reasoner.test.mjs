import test from 'node:test';
import assert from 'node:assert/strict';
import {SemanticReasoner} from '../lib/mind/semantic-reasoner.mjs';
import {FoundationCatalog} from '../lib/foundation/catalog.mjs';
test('WordNet inference follows multiple category atoms without a hardcoded subject',()=>{
 const r=new SemanticReasoner({catalog:new FoundationCatalog()});
 const x=r.proveIsA('dog','animal');
 assert.equal(x.status,'supported',JSON.stringify(x));
 assert.ok(x.proof.length>=2);assert.equal(x.source,'Princeton WordNet 3.0');
});
test('unrelated or unknown terms remain uncertain, never inferred false',()=>{
 const r=new SemanticReasoner({catalog:new FoundationCatalog(),maxExpanded:70});
 const x=r.proveIsA('zzzxqplmnunknown','animal');
 assert.equal(x.status,'unknown');assert.equal(r.answer('What is the weather?'),null);
});
test('supported conclusions carry a checkable chain of exact dictionary sense IDs',()=>{
 const r=new SemanticReasoner({catalog:new FoundationCatalog()});
 const x=r.proveIsA('dog','animal');
 assert.equal(x.proof[0].id.startsWith('sense:wn30:'),true);
 assert.equal(x.proof.at(-1).id.startsWith('sense:wn30:'),true);
});
