// Bounded native operators. No eval, network, teacher, or invented world facts.
// These methods transfer to fresh inputs; they are not a universal language model.
import {loadCore} from './foundation/data.mjs';
const units = loadCore('basic-qa.json').units;
export const BASIC_QA_CAPABILITIES = Object.freeze({version:1,universal:false,
  native:['bounded arithmetic','arithmetic correction','same-dimension unit conversion','explicit passage locations','passage sentence retrieval','extractive summary','fact-based email, announcement, paragraph and bullet drafts'],
  limitations:['No guarantee for arbitrary questions or languages.','Passage evidence is user-supplied, not independently verified.','Writing is constrained composition, not general creative writing.','Teacher-derived answers and methods remain teacher-assisted when reused.','Surface verification is not a factual truth test.'],
  examples:['Calculate 47 * (23 - 4)','Convert 3.5 kilometers to meters','Check: 17 * 8 = 137','Write an email using these facts: The meeting starts Tuesday; Bring a notebook.']});
const fmt = n => Number.isSafeInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
export function basicUnderstanding(native) {
  const method=native.native.method;
  const writing=method==='fact-based-writing', correction=method==='arithmetic-correction', numeric=/arithmetic|conversion/.test(method);
  return {intent:{type:writing?'task':correction?'verify':numeric?'quantity':'explain',label:writing?'Draft from supplied facts':correction?'Check an arithmetic claim':numeric?'Compute from supplied inputs':'Read supplied evidence'},
    speechAct:writing||correction?'command':'question',answerType:writing?'artifact':numeric?'quantity':'explanation',
    summary:`Apply ${method} within its supported scope.`,goal:{statement:native.native.scope}};
}
export function calculate(expression) {
  const s = String(expression).trim();
  if (!s || s.length > 200 || /[^\d.\s+*/()%−×÷-]/u.test(s)) throw new Error('Use numbers, parentheses, +, -, *, / and postfix %.');
  const tokens = s.replaceAll('−','-').replaceAll('×','*').replaceAll('÷','/').match(/\d+(?:\.\d+)?|\.\d+|[^\s]/g) || [];
  let i = 0, depth = 0;
  const bounded = n => { if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw new Error('Result is undefined or exceeds the supported numeric range.'); return n; };
  function factor() {
    if (++depth > 32) throw new Error('Expression is too deeply nested.');
    let n;
    if (tokens[i] === '+' || tokens[i] === '-') { const sign = tokens[i++]; n = factor() * (sign === '-' ? -1 : 1); }
    else if (tokens[i] === '(') { i++; n = sum(); if (tokens[i++] !== ')') throw new Error('Unmatched parentheses.'); }
    else { const t = tokens[i++]; if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t || '')) throw new Error('Expected a number.'); n = Number(t); }
    if (tokens[i] === '%') { i++; n /= 100; }
    depth--; return bounded(n);
  }
  function product() { let n = factor(); while (['*','/'].includes(tokens[i])) { const op = tokens[i++], b = factor(); if (op === '/' && b === 0) throw new Error('Division by zero is undefined.'); n = bounded(op === '*' ? n*b : n/b); } return n; }
  function sum() { let n = product(); while (['+','-'].includes(tokens[i])) { const op = tokens[i++], b = product(); n = bounded(op === '+' ? n+b : n-b); } return n; }
  const n = sum(); if (i !== tokens.length) throw new Error('Unexpected token or missing operator.'); return bounded(n);
}
const terms = s => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>!new Set('the a an is was were are did does do who what when where why how in on to of for it'.split(' ')).has(t)));
const sentences = s => s.split(/(?<=[.!?])\s+|\n+|;\s*/u).map(s=>s.trim()).filter(Boolean);
function answer(answer, method, {status='answered', basis=[], checks=[], confidence=90, scope='computed from supplied inputs'}={}) {
  return {answer, engine:'KENUXA native basic QA · '+method, confidence, teacherUsed:false, evidence:[], trace:[scope],
    native:{method,version:1,status,scope,basis,checks}, structure:'basic-'+method};
}
export function basicAnswer(question) {
  const q = String(question).trim(); if (q.length > 4000) return null;
  // Exact-expression scope prevents dates, phone numbers or prose being guessed as math.
  let m = q.match(/^(?:(?:what is|what's|calculate|compute|evaluate)\s+)?([\d.(+−-][\d.\s+*/()%−×÷-]*)[?!.]*$/i);
  const correction = q.match(/^(?:check|correct|verify)(?: this)?\s*:\s*([^=]+)=\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))[.!?]*$/i);
  if (m || correction) {
    const expr = (correction?.[1] || m[1]).trim().replace(/\.$/, '');
    try { const value=calculate(expr), expected=correction?Number(correction[2]):null;
      const correct=expected===null || (Number.isInteger(value)&&Number.isInteger(expected) ? value===expected : Math.abs(value-expected)<=Number.EPSILON*4*Math.max(1,Math.abs(value),Math.abs(expected)));
      return answer(`${correction ? correct?'Correct: ':'Correction: ':''}${expr} = ${fmt(value)}.${correction&&!correct?` The supplied result ${expected} is incorrect.`:''}`,correction?'arithmetic-correction':'arithmetic',{basis:[expr],checks:[{name:'parsed-without-code-execution',ok:true},{name:'finite-bounded-result',ok:true}],scope:'Locally evaluated arithmetic; decimal results are rounded to 12 significant digits.'});
    } catch(e) { return answer(`I cannot calculate this expression: ${e.message}`,'arithmetic',{status:'insufficient',confidence:0,scope:'Invalid or unsupported arithmetic input.'}); }
  }
  m=q.match(/^(?:convert\s+)?([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+([a-z]+)\s+(?:to|in)\s+([a-z]+)[.!?]*$/i);
  if(m){const a=units[m[2].toLowerCase()],b=units[m[3].toLowerCase()];
    if(!a||!b||a.dimension!==b.dimension)return answer('I cannot convert these units: both units must be supported and have the same dimension.','unit-conversion',{status:'insufficient',confidence:0});
    const n=Number(m[1]),v=(n*a.scale+(a.offset||0)-(b.offset||0))/b.scale;
    if(!Number.isFinite(v)||Math.abs(v)>1e15)return answer('I cannot convert this value within the supported numeric range.','unit-conversion',{status:'insufficient',confidence:0});
    if(a.dimension==='temperature'&&n*a.scale+(a.offset||0)<-1e-10)return answer('This temperature is below absolute zero; the input needs correction.','unit-conversion',{status:'insufficient',confidence:0});
    return answer(`${m[1]} ${m[2]} = ${fmt(v)} ${m[3]}.`,'unit-conversion',{basis:[`${m[2]} → base: x × ${a.scale} + ${a.offset||0}`,`base → ${m[3]}: (x − ${b.offset||0}) / ${b.scale}`]});
  }
  // Quoted context is evidence supplied by the user, never a verified global fact.
  m=q.match(/^(?:passage|context|text):\s*([\s\S]+?)\s+question:\s*([\s\S]+)$/i);
  if(m){const passage=m[1].trim(),ask=m[2].trim(), lines=sentences(passage);
    if(/^(?:summarize|summarise|give (?:a )?summary)\b/i.test(ask))return answer(lines.slice(0,3).join(' '),'extractive-summary',{basis:lines.slice(0,3),scope:'Extractive summary of supplied text; no independent fact verification.'});
    const location=ask.match(/^where did ([\p{L}][\p{L}\p{N} -]{0,40}?) (store|place|put|leave) (.+?)[?!.]*$/iu);
    if(location){const past={store:'stored',place:'placed',put:'put',leave:'left'},subject=location[1].toLowerCase(),object=location[3].toLowerCase();
      const matches=lines.flatMap(line=>{const fact=line.match(/^([\p{L}][\p{L}\p{N} -]{0,40}?) (stored|placed|put|left) (.+?) (in|on|under|inside|beside) (.+?)[.!]*$/iu);
        return fact&&fact[1].toLowerCase()===subject&&fact[2].toLowerCase()===past[location[2].toLowerCase()]&&fact[3].toLowerCase()===object?[{line,value:fact[4]+' '+fact[5]}]:[];});
      // A second statement, negation, later update, or indirect reading requires fuller reasoning.
      const relevant=lines.filter(line=>line.toLowerCase().includes(subject)&&line.toLowerCase().includes(object));
      if(matches.length===1&&relevant.length===1)return answer(`According to your passage, ${location[3]} was ${matches[0].value}.`,'passage-location',{status:'answered-relative-to-text',basis:[matches[0].line],confidence:80,scope:'One explicit affirmative subject/action/object/location relation in supplied text; not independently verified.'});
      return answer('I cannot establish a unique location from this passage; it may contain missing, conflicting, or negated information.','passage-location',{status:'insufficient',confidence:0});
    }
    const ts=terms(ask),ranked=lines.map(text=>({text,score:[...terms(text)].filter(t=>ts.has(t)).length})).sort((a,b)=>b.score-a.score),best=ranked[0];
    // Conservative supporting sentence retrieval; lexical overlap is not proof of entailment.
    if(!best||best.score<2||best.score<Math.ceil(ts.size*0.6)||!/^(who|what|where|when|which)\b/i.test(ask))return answer('I cannot establish that answer from the supplied passage. Please provide the missing information.','passage-evidence',{status:'insufficient',confidence:0,scope:'No sufficient matching sentence in the supplied text.'});
    return answer(`Relevant passage: “${best.text}”\n\nThis is a quotation from your text, not an independently verified answer.`,'passage-evidence',{status:'evidence-only',confidence:60,basis:[best.text],scope:'Matching sentence retrieval only; it may not entail the requested answer.'});
  }
  m=q.match(/^(?:write|draft|compose)\s+(?:an?\s+)?(email|announcement|paragraph|bullet list)\s+(?:using|from)\s+(?:only\s+)?(?:these\s+)?facts:\s*([\s\S]+)$/i);
  if(m){const facts=sentences(m[2]);if(!facts.length)return null;const body=facts.map(s=>s.replace(/[.!?]+$/,'')+'.');
    const kind=m[1].toLowerCase(),out=kind==='email'?`Hello,\n\n${body.join(' ')}\n\nKind regards`:kind==='bullet list'?body.map(x=>'- '+x).join('\n'):body.join(' ');
    return answer(out,'fact-based-writing',{status:'draft',confidence:85,basis:facts,scope:'Template-based draft from supplied facts; no additional factual claims.'});
  }
  return null;
}

// Attribution follows dependency origin, even if a teacher result was cached.
export function performanceAttribution({result, interpretation, composedBy, assistance=[], offline=false}) {
  const inherited=(result.evidence||[]).some(e=>/teacher|groq|openai|anthropic|claude|deepseek|gemini|xai/i.test(String(e.source||'')));
  const teacherDerived=!!(composedBy||interpretation?.teacherAnalysis||result.teacherDerived||result.teacherUsed||result.methodTeacher||inherited||assistance.length);
  return {mode:teacherDerived?'teacher-assisted':result.native?'native-procedure':result.cached?'local-cache':'local-pipeline',teacherDerived,
    newTeacherCall:assistance.some(a=>!a.reused)||!!result.teacherCallAttempted,assistance,offline,
    lineage:teacherDerived?'identified teacher dependency':result.native?'native operator; no teacher dependency':'historical dependency lineage not completely audited',
    outcome:result.native?.status||(!result.construction?.grounded||result.construction?.framework?'limited':'answered'),
    correctness:'not universally verified',scope:result.native?.scope||'Local knowledge, retrieved evidence, and bounded procedures; coverage varies by task.'};
}
