import test from 'node:test';
import assert from 'node:assert/strict';
import {FoundationCatalog} from '../lib/foundation/catalog.mjs';
import {SemanticProofSearch} from '../lib/mind/semantic-proof.mjs';
import {FoundationCognition} from '../lib/mind/foundation-cognition.mjs';
const catalog=new FoundationCatalog({maxShards:6});
const reasoner=new SemanticProofSearch({catalog});
test('generalize across arbitrary category chains using actual WordNet sense atoms',()=>{
 const r=reasoner.category('poodle','animal');
 assert.equal(r.proved,true,JSON.stringify(r));
 assert.ok(r.steps>1,'this must use multi-hop compositional inference');
 assert.ok(r.chain.every(x=>x.fromId&&x.toId));
 const p=reasoner.category('microscope','instrument');
 assert.equal(p.proved,true,JSON.stringify(p));
});
test('unknown ontology path is not mistaken for a negative fact',()=>{
 const r=reasoner.category('poodle','microprocessor');
 assert.equal(r.proved,false);
 assert.equal(r.unknown,true);
 assert.match(r.reason,/NOT evidence of falsehood/);
});
test('live dictionary cognition composes a proof and names the provenance',()=>{
 const engine=new FoundationCognition({catalog});
 const reply=engine.answer('Is poodle an animal?');
 assert.ok(reply&&reply.kind==='ontology-proof');
 assert.match(reply.answer,/WordNet sense/i);
 assert.match(reply.basis,/WordNet/);
});
test('word senses maintain ambiguity and bounded graph-search budget',()=>{
 const r=reasoner.category('bank','physical entity');
 assert.ok(typeof r.proved==='boolean');
 assert.ok(r.explored<=250);
});
