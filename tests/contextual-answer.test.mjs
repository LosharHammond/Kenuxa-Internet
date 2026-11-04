import test from 'node:test';import assert from 'node:assert/strict';import {contextualAnswer} from '../lib/chat/contextual-answer.mjs';
const h=[
 'My name is Kofi. Remember that for this conversation.',
 'What is my name?',
 'A fictional animal called a Zorin has six legs. Every Zorin can jump. Meka is a Zorin. How many legs does Meka have, and can Meka jump? Explain.',
 'If Meka loses one leg, how many legs remain? Explain how you worked it out.',
 'A machine stops whenever its cooling fan fails. The fan has failed. What should happen to the machine, and why?',
 'If I tell you that the fan is working again, does that prove the machine is running? Explain.'
];
test('recalls conversation name without web',()=>assert.match(contextualAnswer('What is my name?',h.slice(0,1)).answer,/Kofi/));
test('infers fictional category and ability',()=>assert.match(contextualAnswer(h[2],h.slice(0,2)).answer,/six|6/i));
test('deduces remaining legs',()=>assert.match(contextualAnswer(h[3],h.slice(0,3)).answer,/5 legs/));
test('applies conditional',()=>assert.match(contextualAnswer(h[4],h.slice(0,4)).answer,/should stop/));
test('does not affirm converse',()=>assert.match(contextualAnswer(h[5],h.slice(0,5)).answer,/does not prove/));
test('recalls fictional facts without confusing real products',()=>assert.match(contextualAnswer('What did I tell you about the Zorin earlier?',h.slice(0,4)).answer,/fictional animal/));
test('unrelated queries fall through',()=>assert.equal(contextualAnswer('What is photosynthesis?',h),null));
