import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeCurriculum} from '../lib/mind/knowledge-curriculum.mjs';

test('new lexical atoms are reviewed incrementally and drained without inventing missing word meanings',()=>{
 const state={atoms:[],lexicon:{queue:[]},growth:{lexicalPending:['lex:en:dog','lex:en:invented-velon'],lexicalEpoch:1}};
 const catalog={lookup:word=>({senses:word==='dog'?[{id:'sense:wn30:n:02084071'}]:[]}),status:()=>({dataset:'test',counts:{lemmas:1,senses:1}})};
 const c=new KnowledgeCurriculum({state,catalog,registry:null,learning:null});
 const first=c.tick({limit:1});
 assert.equal(first.processed,1);assert.equal(first.known,1);assert.equal(state.growth.lexicalPending.length,1);
 const second=c.tick({limit:1});
 assert.equal(second.processed,1);assert.equal(second.unknown,1);
 assert.equal(state.growth.lexicalPending.length,0);
 assert.equal(state.foundationCurriculum.cycles,2);
 assert.equal(state.foundationCurriculum.seen,2);
});
