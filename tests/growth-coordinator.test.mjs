import test from 'node:test';
import assert from 'node:assert/strict';
import {GrowthCoordinator} from '../lib/mind/growth-coordinator.mjs';
import {hydrateAtom,growAtom,rebuildOrganism} from '../lib/organism.mjs';
const atom=(id,tags)=>hydrateAtom({id,title:id,answer:id+' is a fictional test concept',
 questions:['Explain '+id],tags,status:'approved',visibility:'public',origin:'test',createdAt:new Date(0).toISOString()});
const setup=()=>{
 const state={atoms:[atom('alpha',['x','y']),atom('beta',['x']),atom('gamma',['y'])],
   formations:{molecules:[],cells:[]},organism:{molecules:[],cells:[]},outcomes:[],memory:[]};
 let rebuilt=0;
 const growth=new GrowthCoordinator({state,rebuild:s=>{rebuilt++;rebuildOrganism(s);}});
 growth.initialize();
 return {growth,state,rebuilds:()=>rebuilt};
};
test('read-only questions and saved conversation counters never rebuild the organism',()=>{
 const {growth,state,rebuilds}=setup();
 const before=rebuilds(),epoch=growth.status().epoch;
 for(let i=0;i<10;i++){
  state.outcomes.push({type:'answer',i});state.memory.push({question:'Who?',i});
  assert.equal(growth.reconcile().changed,false);
 }
 assert.equal(rebuilds(),before);assert.equal(growth.status().epoch,epoch);
});
test('new atom knowledge cascades to molecule, cell, every specialist, and learning invalidation',()=>{
 const {growth,state}=setup();
 const originalM=state.organism.molecules.map(m=>({id:m.id,revision:m.dna.evolution.revision}));
 assert.equal(originalM.length,2);
 assert.equal(state.organism.cells.length,1);
 const cellBefore=state.organism.cells[0].dna.evolution.revision;
 const agentBefore=state.atoms[0].dna.agent.dnaRevision;
 growAtom(state.atoms[0],{meaning:'Now also applicable to related knowledge.'});
 const changed=growth.reconcile({reason:'verified atom extension'});
 assert.equal(changed.changed,true);
 assert.ok(changed.counts.molecule>=2);
 assert.ok(changed.counts.cell>=1);
 assert.ok(state.organism.cells[0].dna.evolution.revision>cellBefore);
 assert.ok(state.atoms[0].dna.agent.dnaRevision>agentBefore);
 assert.ok(state.organism.cells[0].dna.agent.memberSpecialists.length>0);
 assert.equal(growth.status().pendingEvaluation,true);
 assert.equal(growth.reconcile().changed,false,'growth cascade must converge without an infinite cycle');
});
test('private changes recompute dependent cells but do not enqueue global model training',()=>{
 const {growth,state}=setup();
 state.atoms.forEach(a=>a.visibility='private');
 growth.reconcile();
 growth.acknowledgedEvaluation();
 growAtom(state.atoms[0],{tag:'new'});
 const changed=growth.reconcile();
 assert.equal(changed.changed,true);
 assert.equal(growth.status().pendingEvaluation,false);
});
test('new approved atom births grow the organism instead of creating disconnected agents',()=>{
 const {growth,state}=setup();
 state.atoms.push(atom('delta',['x']));
 const r=growth.reconcile();
 assert.equal(r.changed,true);
 assert.equal(r.counts.atom,1);
 assert.ok(state.organism.molecules.find(m=>m.id==='mol://auto-x').atomIds.includes('delta'));
 assert.ok(state.atoms.at(-1).dna.agent.skills.length>0);
});
