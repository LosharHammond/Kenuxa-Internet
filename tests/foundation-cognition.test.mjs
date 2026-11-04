import test from 'node:test';
import assert from 'node:assert/strict';
import {FoundationCognition} from '../lib/mind/foundation-cognition.mjs';
import {FoundationCatalog} from '../lib/foundation/catalog.mjs';
test('licensed WordNet foundation is present with indexed lemmas and senses',()=>{
 const c=new FoundationCatalog();assert.ok(c.status().counts.lemmas>100000);assert.ok(c.status().counts.senses>100000);
});
test('unknown words do not get invented dictionary definitions',()=>{
 const f=new FoundationCognition({catalog:new FoundationCatalog()});
 assert.equal(f.explain('zzzxqplmnunknown'),null);
});
test('dictionary atoms contribute definitions and sense candidates',()=>{
 const f=new FoundationCognition({catalog:new FoundationCatalog()});
 const x=f.explain('dog');assert.ok(x);assert.ok(x.definition.length>10);
 assert.equal(x.provenance,'licensed dictionary');
});
test('sentence construction is compositional and does not assert factual truth',()=>{
 const f=new FoundationCognition({catalog:new FoundationCatalog()});
 assert.equal(f.construct({subject:'They',verb:'walk',object:'home'}).sentence,'They walk home.');
 assert.equal(f.construct({subject:'They',verb:'walk',object:'home',tense:'future'}).sentence,'They will walk home.');
 assert.equal(f.construct({subject:'They',verb:'walk',object:'home',question:true}).sentence,'Do They walk home?');
});
test('analysis reports coverage without promoting unknown terms',()=>{
 const f=new FoundationCognition({catalog:new FoundationCatalog()});
 const x=f.analyze('dog zzzxqplmnunknown');assert.ok(x.concepts.some(y=>y.word==='dog'));assert.ok(x.unknown.includes('zzzxqplmnunknown'));
});
