import test from 'node:test';import assert from 'node:assert/strict';import {contextualAnswer as ask} from '../lib/chat/contextual-answer.mjs';
const turns=['My name is Kofi. Remember that for this conversation.','What is my name?','A fictional animal called a Zorin has six legs. Every Zorin can jump. Meka is a Zorin. How many legs does Meka have, and can Meka jump? Explain.','If Meka loses one leg, how many legs remain? Explain how you worked it out.','A machine stops whenever its cooling fan fails. The fan has failed. What should happen to the machine, and why?','If I tell you that the fan is working again, does that prove the machine is running? Explain.'];
const previous=n=>turns.slice(0,n).reverse().map(question=>({question}));
test('remembers conversation name',()=>assert.match(ask(turns[1],previous(1)).answer,/Kofi/));
test('inherits numeric properties and abilities from a category',()=>assert.match(ask(turns[2],previous(2)).answer,/6 legs and can jump/));
test('subtracts from previous stated quantity',()=>assert.match(ask(turns[3],previous(3)).answer,/5 legs remaining/));
test('conditional consequences',()=>assert.match(ask(turns[4],previous(4)).answer,/should stop/));
test('rejects reverse conditional implication',()=>assert.match(ask(turns[5],previous(5)).answer,/does not prove/));
test('recalls previous invented category',()=>assert.match(ask('What did I tell you about the Zorin earlier?',previous(4)).answer,/Zorin has 6 legs/));
test('does not hijack unrelated requests',()=>assert.equal(ask('Explain photosynthesis',previous(4)),null));
test('works with numeric digits and arbitrary object types',()=>assert.match(ask('A fictional vehicle called a Taval has 12 wheels. Unit7 is a Taval. How many wheels does Unit7 have?',[]).answer,/12 wheels/));
test('contradictions are not treated as verified',()=>assert.equal(ask('How many legs does Meka have?',[{question:'Meka is a Zorin. Zorin has 4 legs.'},{question:'Zorin has 6 legs.'}]).kind,'unknown'));


test('explains supplied premises, inherited properties and subtraction without web research',()=>{
 const history=[
  {question:'If Nova loses three rotors, how many are left? Show the calculation.'},
  {question:'A fictional machine called a Tarvek has eleven rotors. Every Tarvek can hover. Nova is a Tarvek. How many rotors does Nova have, and can Nova hover? Explain.'},
  {question:'What is my name?'},
  {question:'My name is Kofi. Use that name for this conversation.'}
 ];
 const askText='Which of your earlier conclusions were statements I supplied, which were deductions, and which remain uncertain?';
 const start=performance.now(),out=ask(askText,history);
 assert.ok(performance.now()-start<500,'conversation evidence reasoning should be synchronous and bounded');
 assert.equal(out.kind,'provenance');assert.match(out.answer,/Tarvek has 11 rotors/i);
 assert.match(out.answer,/Nova inherits 11 rotors/i);
 assert.match(out.answer,/Nova has 8 rotors remaining/i);
 assert.match(out.answer,/uncertain/i);
});
test('preserves original and corrected statements with a sourced conflict instead of searching web',()=>{
 const history=[
  {question:'Which of your earlier conclusions were statements I supplied, which were deductions, and which remain uncertain?'},
  {question:'What did I tell you about the Tarvek earlier?'},
  {question:'If Nova loses three rotors, how many are left? Show the calculation.'},
  {question:'A fictional machine called a Tarvek has eleven rotors. Every Tarvek can hover. Nova is a Tarvek. How many rotors does Nova have, and can Nova hover? Explain.'}
 ];
 const start=performance.now(),out=ask('Correction: A Tarvek has nine rotors, not eleven. How many rotors did I originally say it had, and can you identify the conflict?',history);
 assert.ok(performance.now()-start<500);
 assert.equal(out.kind,'contradiction');assert.match(out.answer,/originally.*11 rotors/i);
 assert.match(out.answer,/latest.*9 rotors/i);
 assert.match(out.answer,/conflict/i);
 assert.ok(out.proof.every(x=>x.source),'each cited premise must identify its conversation source');
});
test('unknown original quantities remain unknown without made-up contradictions',()=>{
 const out=ask('Correction: A Fenlor has nine rotors, not eleven. What did I originally say and where is the conflict?',[]);
 assert.equal(out.kind,'unknown');assert.match(out.answer,/cannot establish/i);
});
