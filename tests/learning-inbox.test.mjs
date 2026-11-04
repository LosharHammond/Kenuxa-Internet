import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningInbox } from '../lib/mind/learning-inbox.mjs';
test('consent required and raw conversation not persisted',()=>{
 const state={},inbox=new LearningInbox({state});
 assert.equal(inbox.capture({text:'My secret'}).ok,false);
 const r=inbox.capture({text:'My secret',consent:true,conversationId:'private'});
 assert.equal(r.status,'quarantined');
 assert.equal(JSON.stringify(state).includes('My secret'),false);
 assert.equal(JSON.stringify(state).includes('private'),false);
});
