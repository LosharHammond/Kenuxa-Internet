import test from 'node:test';
import assert from 'node:assert/strict';
import { Mind } from '../lib/mind/index.mjs';
test('Mind shares curriculum state across instances', () => {
  const state={};
  const a=new Mind({state});
  assert.equal(a.curriculumRecord({domain:'language-relation',subject:'token-1',relation:'follows',object:'token-2'}).ok,true);
  const b=new Mind({state});
  assert.equal(b.curriculumPredict({domain:'language-relation',subject:'token-1',relation:'follows'}).object,'token-2');
  assert.ok(b.curriculumNextLesson().next.domain);
});
