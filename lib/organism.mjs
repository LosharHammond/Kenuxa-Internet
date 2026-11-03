import {createHash} from 'node:crypto';
import {features, AnswerModel} from './model.mjs';
import {extractFrame,compositeFrame} from './meaning.mjs';

export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=()=>new Date().toISOString();
function role(id,level,kind,specialty){return {id:`${id}/${kind}`,kind,level,specialty,genesis:'intrinsic: generated from entity DNA',engine:'KENUXA local graph runtime',runs:0,lastRun:null};}
export function nativeSkills(a){
 const text=[a.title,...a.tags,a.answer,...(a.dna?.meaning?.claims||[]).map(c=>c.text)].join(' ').toLowerCase();
 const skills=['explain','inspect-evidence','compare-members','grounded-plan'];
 if(/fashion|dress|shoe|outfit|clothing|apparel/.test(text))skills.push('design-outfit','design-brand');
 if(/perfume|body spray|fragrance|scent/.test(text))skills.push('design-scent-concept','design-brand');
 if(/wisdom|decision|judgment|judgement/.test(text))skills.push('decision-framework');
 return [...skills,...(a.dna?.programs||[]).map(p=>p.id)];
}
function develop(a){
 const d=a.dna;d.programs??=[];d.pendingPrograms??=[];const skills=nativeSkills(a),evidence=d.evidence.length,claims=d.meaning.claims.length;
 d.meaning.frame=extractFrame(a);d.capabilities=skills;d.kernel.scope=[a.id];d.kernel.trainingExamples=1+a.questions.length;
 for(const key of ['agent','expert']){
  const previous=d[key]||{};d[key]={...role(a.id,'basic',key,`${key==='agent'?'Create and execute':'Evaluate and improve'} within ${a.title}`),runs:previous.runs||0,lastRun:previous.lastRun||null,
   bornFromDNA:a.id,dnaRevision:d.evolution.revision,domain:a.title,skills:[...skills],knowledgeUnits:claims,experience:d.outcomes.length,evidenceCount:evidence,developmentScore:claims+a.questions.length+evidence*2+d.outcomes.length+d.programs.length*3};
 }
}
export function hydrateAtom(a){
 if(a.dna?.schema==='kenuxa-dna/1'){develop(a);return a;}
 a.dna={schema:'kenuxa-dna/1',identity:{id:a.id,uri:`sge://${encodeURIComponent(a.origin)}/${encodeURIComponent(a.id)}`,type:'meaning-atom',origin:a.origin,bornAt:a.createdAt},
  meaning:{label:a.title,definition:a.answer,aliases:[...a.questions],claims:[{text:a.answer,kind:'definition',addedAt:a.createdAt}]},
  context:{domains:[...a.tags],layers:[],language:'en'},relationships:[],attachments:[],evidence:[],
  trust:{status:a.status==='approved'?'owner-approved':'unreviewed',score:a.status==='approved'?0.4:0,limitations:['Approval does not establish factual truth.'],reviews:[],contradictions:[]},
  capabilities:['answer-from-approved-knowledge','inspect-evidence','propose-growth'],outcomes:[],memory:[],
  evolution:{revision:1,stage:a.visibility==='public'?'shared':'local',updatedAt:a.createdAt,history:[]},
  kernel:{architecture:'sparse-softmax-v1',scope:[a.id],trainingExamples:1+a.questions.length,parameterTraining:'shared local answer model; no per-atom transformer'},
  agent:role(a.id,'basic','agent','Retrieve and connect this atom'),expert:role(a.id,'basic','expert','Check evidence, scope and contradictions')};
 a.dna.evolution.history.push({revision:1,reason:'Atom birth',at:a.createdAt,meaning:structuredClone(a.dna.meaning),evidenceIds:[]});develop(a);return a;
}
export function touchAtom(a,reason){
 hydrateAtom(a);const d=a.dna;
 d.meaning.label=a.title;d.meaning.definition=a.answer;d.meaning.aliases=[...a.questions];d.context.domains=[...a.tags];
 d.kernel.trainingExamples=1+a.questions.length;d.evolution.revision++;d.evolution.updatedAt=now();lifecycle(a);
 d.evolution.history.unshift({revision:d.evolution.revision,reason,at:now(),meaning:structuredClone(d.meaning),context:structuredClone(d.context),programs:structuredClone(d.programs),trustStatus:d.trust.status,evidenceIds:d.evidence.map(e=>e.id)});
 d.evolution.history=d.evolution.history.slice(0,50);
 develop(a);
}
export function growAtom(a,input){
 hydrateAtom(a);const d=a.dna;
 if(input.meaning){if(typeof input.meaning!=='string'||input.meaning.length>2000)throw new Error('Meaning must be at most 2000 characters');d.meaning.claims.push({text:input.meaning,kind:'extension',addedAt:now()});d.meaning.claims=d.meaning.claims.slice(-50);}
 if(input.question){if(typeof input.question!=='string'||input.question.length>240)throw new Error('Question too long');a.questions=[...new Set([...a.questions,input.question])].slice(-16);}
 if(input.tag){if(typeof input.tag!=='string'||input.tag.length>50)throw new Error('Topic too long');a.tags=[...new Set([...a.tags,input.tag.toLowerCase()])].slice(-12);}
 if(input.context){if(typeof input.context!=='string'||input.context.length>1000)throw new Error('Context too long');d.context.layers.push({text:input.context,at:now()});d.context.layers=d.context.layers.slice(-30);}
 if(!input.meaning&&!input.question&&!input.tag&&!input.context)throw new Error('Provide meaning, question, topic or context to grow');
 // Extensions enrich DNA; the approved answer is not silently replaced.
 touchAtom(a,'Owner added meaning/context/examples');return a;
}
export function validateProgram(input){
 if(!input||typeof input!=='object'||typeof input.name!=='string'||!/^[a-z][a-z0-9-]{2,59}$/.test(input.name)||typeof input.label!=='string'||!input.label.trim()||input.label.length>120)throw new Error('Capability requires a short lowercase-hyphen name and a label');
 const lines=(value,max)=>{if(!Array.isArray(value)||!value.length||value.length>12||value.some(s=>typeof s!=='string'||!s.trim()||s.length>max))throw new Error('Provide 1 to 12 nonempty capability steps/checks');return value.map(s=>s.trim());};
 return {name:input.name,label:input.label.trim(),steps:lines(input.steps,500),checks:lines(input.checks,300)};
}
export function learnProgram(a,input,source='owner-authored'){
 hydrateAtom(a);const p=validateProgram(input),id=`${a.id}/capability/${p.name}`,old=a.dna.programs.find(x=>x.id===id);
 const program={...p,id,revision:(old?.revision||0)+1,source,createdAt:old?.createdAt||now(),updatedAt:now(),runtime:'declarative-text-workflow; no code or external actions'};
 if(!old&&a.dna.programs.length>=30)throw new Error('An atom supports at most 30 native capabilities');a.dna.programs=a.dna.programs.filter(p=>p.id!==id).concat(program);
 touchAtom(a,`Native capability learned: ${p.label}`);return program;
}
function composite(id,title,type,members,old){
 const fingerprint=digest(members.map(m=>[m.id,m.dna.evolution.revision]));
 const d=old?.dna||{schema:'kenuxa-dna/1',identity:{id,type,bornAt:now()},evolution:{revision:0,history:[]},agent:role(id,type==='molecule'?'medium':'advanced','agent','Coordinate member knowledge'),expert:role(id,type==='molecule'?'medium':'advanced','expert','Inspect composite consistency'),memory:[],outcomes:[]};
 const changed=fingerprint!==old?.fingerprint;
 const atomIds=[...new Set(members.flatMap(m=>m.atomIds||[m.id]))];
 if(changed){d.evolution.revision++;d.evolution.updatedAt=now();d.evolution.history.unshift({revision:d.evolution.revision,at:now(),reason:'Member composition or DNA revision changed',fingerprint});d.evolution.history=d.evolution.history.slice(0,50);}
 d.meaning={label:title,definition:`${members.length} connected ${type==='molecule'?'atoms':'molecules'}; ${atomIds.length} unique atoms`,claims:[]};d.meaning.frame=compositeFrame(title,type,members);
 d.relationships=members.map(m=>({predicate:'contains',target:m.id,revision:m.dna.evolution.revision}));
 d.evidenceIds=[...new Set(members.flatMap(m=>m.dna.evidence?.map(e=>e.id)||m.dna.evidenceIds||[]))];
 d.capabilities=[...new Set(members.flatMap(m=>m.dna.capabilities))];
 d.learning={methodIds:[...new Set(members.flatMap(m=>m.dna.learning?.methodIds||[]))]};
 d.programs=[...new Map(members.flatMap(m=>m.dna.programs||[]).map(p=>[p.id,p])).values()];
 for(const key of ['agent','expert'])Object.assign(d[key],{bornFromDNA:id,dnaRevision:d.evolution.revision,domain:title,skills:[...d.capabilities],developmentScore:members.reduce((s,m)=>s+(m.dna.agent.developmentScore||0),0)+d.outcomes.length,memberSpecialists:members.map(m=>m.dna[key].id)});
 d.trust={status:'aggregate-not-independently-verified',score:Math.min(...members.map(m=>m.dna.trust.score)),limitations:['Membership and size are not evidence of truth.']};
 if(type==='cell'&&!d.council)d.council=['evidence','consistency','domain'].map(s=>role(id,'advanced',`council-${s}`,s));
 if(type==='cell')for(const r of d.council)Object.assign(r,{bornFromDNA:id,dnaRevision:d.evolution.revision,domain:title,memberSpecialists:members.map(m=>m.dna.expert.id)});
 return {id,title,type,memberIds:members.map(m=>m.id),atomIds,fingerprint,dna:d};
}
export function rebuildOrganism(state){
 state.organism??={molecules:[],cells:[]};
 const atoms=state.atoms.map(hydrateAtom);
 // Explicit relation records; tag connections are a transparent clustering baseline.
 for(const a of atoms){lifecycle(a);a.dna.relationships=[...atoms.filter(b=>b.id!==a.id&&b.status===a.status&&a.tags.some(t=>b.tags.includes(t))).slice(0,40).map(b=>({predicate:'shares-topic',target:b.id})),...(a.dna.semanticLinks||[]).filter(l=>atoms.some(b=>b.id===l.target))];}
 const groups=new Map();for(const a of atoms.filter(a=>a.status==='approved'))for(const tag of a.tags){if(!groups.has(tag))groups.set(tag,[]);groups.get(tag).push(a);}
 const molecules=[];for(const [tag,members] of groups)if(members.length>=2){const id=`mol://auto-${encodeURIComponent(tag)}`;molecules.push(composite(id,`${tag} molecule`,'molecule',members,state.organism.molecules.find(m=>m.id===id)));}
 for(const formation of state.formations?.molecules||[]){const members=formation.memberIds.map(id=>atoms.find(a=>a.id===id)).filter(a=>a&&a.status==='approved');if(members.length>=2)molecules.push(composite(formation.id,formation.title,'molecule',members,state.organism.molecules.find(m=>m.id===formation.id)));}
 // Cells are connected components of overlapping molecules. Stable cell ID is
 // anchored to the lexically first molecule; membership retains atom references.
 const remaining=new Set(molecules.map(m=>m.id)),cells=[];
 while(remaining.size){const first=[...remaining].sort()[0],ids=[first];remaining.delete(first);for(let i=0;i<ids.length;i++){const m=molecules.find(x=>x.id===ids[i]);for(const id of [...remaining]){const other=molecules.find(x=>x.id===id);if(m.atomIds.some(a=>other.atomIds.includes(a))){remaining.delete(id);ids.push(id);}}}if(ids.length>=2){const id=`cell://auto-${encodeURIComponent(first.slice(6))}`;cells.push(composite(id,`${decodeURIComponent(first.slice(6)).replace(/^auto-/,'')} knowledge cell`,'cell',ids.map(id=>molecules.find(m=>m.id===id)),state.organism.cells.find(c=>c.id===id)));}}
 for(const formation of state.formations?.cells||[]){const members=formation.memberIds.map(id=>molecules.find(m=>m.id===id)).filter(Boolean);if(members.length>=2)cells.push(composite(formation.id,formation.title,'cell',members,state.organism.cells.find(c=>c.id===formation.id)));}
 state.organism={molecules,cells};return state.organism;
}
export function entity(state,id){return [...state.atoms,...state.organism.molecules,...state.organism.cells].find(e=>e.id===id);}
export function inspectAtom(a){
 hydrateAtom(a);const issues=[];const d=a.dna;
 if(!d.evidence.length)issues.push('No captured external evidence');
 if(d.trust.contradictions.some(c=>!c.resolved))issues.push('Unresolved contradictions');
 if(a.status!=='approved')issues.push('Not approved for answering');
 for(const e of d.evidence)if(e.quote && (!e.excerpt||!e.excerpt.includes(e.quote)))issues.push('Evidence quotation does not match captured source');
 if(!d.trust.reviews.some(r=>r.verdict==='supported'))issues.push('No supporting teacher inspection');
 return {atomId:a.id,status:issues.length?'needs-review':'evidence-supported',issues,evidenceCount:d.evidence.length,revision:d.evolution.revision};
}
export function runEntity(state,id,question){
 const e=entity(state,id);if(!e)throw new Error('Entity not found');
 const ids=e.atomIds||[e.id],atoms=state.atoms.filter(a=>ids.includes(a.id)&&a.status==='approved');
 const model=new AnswerModel(atoms);const p=model.predict(question);
 const inspections=atoms.map(inspectAtom);
 e.dna.agent.runs++;e.dna.agent.lastRun=now();e.dna.expert.runs++;e.dna.expert.lastRun=now();
 const council=(e.dna.council||[]).map(r=>{r.runs++;r.lastRun=now();return {expert:r.kind,assessment:r.kind==='council-evidence'?`${inspections.filter(x=>x.evidenceCount).length}/${atoms.length} atoms carry external evidence`:r.kind==='council-consistency'?`${atoms.filter(a=>a.dna.trust.contradictions.length).length} atoms have recorded contradictions`:`${new Set(atoms.flatMap(a=>a.tags)).size} topic domains represented`,engine:'local rule-based inspection'};});
 const result={entityId:id,question,answer:p?p.atom.answer:'No reliable answer in this entity’s approved members.',engine:'KENUXA scoped own model',answerAtomId:p?.atom.id||null,inspections,council,level:e.dna.agent.level,at:now()};
 e.dna.memory.unshift({question,answerAtomId:result.answerAtomId,at:result.at});e.dna.memory=e.dna.memory.slice(0,30);e.dna.outcomes.unshift({answered:!!p,at:result.at});e.dna.outcomes=e.dna.outcomes.slice(0,30);
 if(state.atoms.includes(e))touchAtom(e,'Native specialists gained task experience');else recordCompositeExperience(e);
 return result;
}
export function executeSkill(state,id,skill,brief){
 const e=entity(state,id);if(!e)throw new Error('Entity not found');
 if(!e.dna.capabilities.includes(skill))throw new Error('This DNA has not developed that capability');
 const ids=e.atomIds||[e.id],atoms=state.atoms.filter(a=>ids.includes(a.id)&&a.status==='approved');
 if(!atoms.length)throw new Error('This entity has no approved knowledge');
 const task=typeof brief==='string'?brief.slice(0,1500):'';if(!task.trim())throw new Error('Describe the task');
 const context=atoms.flatMap(a=>a.dna.meaning.claims.map(c=>({atomId:a.id,text:c.text}))).slice(0,16);
 let sections;
 const program=e.dna.programs?.find(p=>p.id===skill);
 const render=s=>s.replaceAll('{{brief}}',task).replaceAll('{{domain}}',e.title);
 if(program)sections=[{title:program.label,items:program.steps.map(render)},{title:'Native expert checks',items:program.checks.map(render)}];
 else if(skill==='inspect-evidence')sections=[{title:'Native expert evidence inspection',items:atoms.map(a=>{const r=inspectAtom(a);return `${a.title}: ${r.status}. ${r.issues.join('; ')||'Captured-source and teacher checks passed; truth is not guaranteed.'}`;})}];
 else if(skill==='compare-members')sections=[{title:'Member knowledge comparison',items:atoms.map(a=>`${a.title}: ${a.answer} · domains: ${a.tags.join(', ')} · DNA revision ${a.dna.evolution.revision}`)},{title:'Unresolved contradictions',items:atoms.flatMap(a=>a.dna.trust.contradictions.map(c=>`${a.title}: ${c.reason}`)).concat(['Different domain members are complementary, not automatically evidence for one another.'])}];
 else if(skill==='design-outfit'){
  const formal=/formal|office|business|wedding/i.test(task),warm=/ghana|warm|hot|summer/i.test(task),casual=/casual|weekend|relax/i.test(task);
  sections=[{title:'Outfit direction',items:[formal?'A coordinated tailored look with a clear silhouette.':casual?'A relaxed, coordinated everyday look.':'A balanced capsule look, adjusted to the occasion in your brief.',`Brief: ${task}`]},
   {title:'Pieces to combine',items:[/dress/i.test(task)?'A coordinated dress with a silhouette and length chosen for the wearer and occasion.':formal?'Tailored trousers or a midi skirt, with a structured shirt or blouse.':'Comfortable trousers or a skirt with a simple top.',warm?'Choose lightweight, breathable fabric; check fabric composition and feel before purchase.':'Choose layers for the climate and your comfort.',formal?'Clean comfortable closed shoes or another dress-code-appropriate option.':'Comfortable shoes that suit the activity.','Use one accent colour and coordinate the remaining pieces.']},
   {title:'Fit and personalisation',items:['Confirm measurements, preferred coverage, mobility and sensory needs.','Check the actual occasion, available wardrobe and spending limit before buying.','Offer alternative silhouettes; personal preference determines the final choice.']},
   {title:'Expert review',items:['This is a design proposal, not a guarantee of perfect fit.','A physical fitting and the wearer’s feedback are needed.']}];
 }else if(skill==='design-brand')sections=[{title:'Brand concept',items:[`Design brief: ${task}`,'Define one target customer and the practical problem your first collection solves.','Choose three visual principles, a consistent palette and a recognisable silhouette.']},{title:'First collection',items:['Start with three complementary products, not a broad catalogue.','Create sketches, size specifications and material samples.','Test prototypes with intended customers and record their feedback.']},{title:'Commercial plan',items:['Obtain real supplier quotes; calculate materials, labour, packaging, transport and margin.','Check name availability, trademarks and local business requirements before launching.','Use approved samples and customer feedback to decide what to produce.']},{title:'Expert checks',items:['Validate fit, quality, differentiation and unit economics.','Brand names, prices, market demand and legal availability are not verified by this proposal.']}];
 else if(skill==='design-scent-concept')sections=[{title:'Scent direction',items:[`Brief: ${task}`,'Create a mood board with a desired scent family, audience and occasion.','Compare existing samples and record perceived opening, middle and lasting notes.']},{title:'Prototype requirements',items:['Use a qualified formulator for concentrations, ingredient compatibility, testing and regulatory compliance.','This capability creates a concept brief; it does not provide a safe chemical formulation.','Test packaging, stability and intended usage with appropriate expertise.']}];
 else if(skill==='decision-framework')sections=[{title:'Clarify the decision',items:[task,'Separate known facts, assumptions, values and uncertainties.']},{title:'Compare options',items:['List at least three options, including waiting or doing nothing.','For each option, identify likely benefits, harms, reversibility and who is affected.']},{title:'Choose and learn',items:['Seek missing evidence and a relevant human perspective.','Choose a small reversible next step where possible.','Record what happened and revise your judgment from the outcome.']}];
 else sections=[{title:'Grounded knowledge',items:context.map(c=>c.text)},{title:'Working steps',items:[`Define the intended outcome for: ${task}`,'Identify which member claims and evidence support it.','List missing information before execution.','Take a reversible, measurable step and record its outcome.']}];
 const relevant=program?atoms.filter(a=>program.id.startsWith(a.id+'/capability/')):skill==='design-outfit'?atoms.filter(a=>a.dna.capabilities.includes('design-outfit')):skill==='design-scent-concept'?atoms.filter(a=>a.dna.capabilities.includes('design-scent-concept')):atoms;
 sections.push({title:'Knowledge inherited from DNA',items:relevant.flatMap(a=>a.dna.meaning.claims.map(c=>`${a.title}: ${c.text}`)).slice(0,12)});
 if(e.dna.council)sections.push({title:'Native council inspection',items:[`Evidence expert: ${relevant.filter(a=>a.dna.evidence.length).length}/${relevant.length} relevant atoms carry external evidence.`,`Consistency expert: ${relevant.reduce((s,a)=>s+a.dna.trust.contradictions.length,0)} recorded unresolved contradictions.`,`Domain expert: ${relevant.map(a=>a.title).join(', ')} contributes to this capability. These are local rule-based checks, not independent AI model opinions.`]});
 const at=now();for(const r of [e.dna.agent,e.dna.expert,...(e.dna.council||[])]){r.runs++;r.lastRun=at;}
 const output={entityId:id,skill,brief:task,engine:'KENUXA native procedural capability runtime',sections,knowledgeBasis:context,limitations:['Local domain templates and stored knowledge; no external model was called.','A capability catalogue is not unlimited subject expertise.'],at};
 e.dna.memory.unshift({skill,brief:task,at});e.dna.memory=e.dna.memory.slice(0,30);e.dna.outcomes.unshift({skill,status:'proposal-produced',at});e.dna.outcomes=e.dna.outcomes.slice(0,30);if(state.atoms.includes(e))touchAtom(e,'Native capability execution experience');else recordCompositeExperience(e);return output;
}
function recordCompositeExperience(e){const d=e.dna;d.evolution.revision++;d.evolution.updatedAt=now();d.evolution.history.unshift({revision:d.evolution.revision,at:now(),reason:'Native specialist task experience',memberIds:[...e.memberIds]});d.evolution.history=d.evolution.history.slice(0,50);}
export function addAnswerOutcome(a,answerId){hydrateAtom(a);a.dna.outcomes.unshift({answerId,at:now(),validation:'not-yet-rated'});a.dna.outcomes=a.dna.outcomes.slice(0,30);}

// Spec 4-stage life cycle: LOCAL (private) → SHARED (network-visible) → VERIFIED (external evidence +
// validation, trust scoring) → GLOBAL (verified and independently confirmed by ≥2 other nodes).
export function lifecycle(a){
 const d=a.dna;if(!d)return 'local';d.network??={confirmations:[]};
 const ev=d.evidence||[],domains=new Set(ev.flatMap(e=>{try{return [new URL(e.url||e.source).hostname];}catch{return [];}})).size;
 const open=(d.trust.contradictions||[]).some(c=>!c.resolved),teacher=d.trust.status==='teacher-supported'||(d.trust.reviews||[]).some(r=>r.verdict==='supported'&&r.quoteMatches);
 const confirmations=new Set(d.network.confirmations).size,approved=a.status==='approved';
 const verified=approved&&ev.length>0&&!open&&(teacher||domains>=2);
 const stage=verified&&confirmations>=2?'global':verified?'verified':(a.visibility==='public'||a.upstreamId)?'shared':'local';
 d.evolution.stage=stage;
 d.trust.score=Math.max(0,Math.min(1,Math.round(((approved?0.2:0)+(ev.length?0.2:0)+(teacher?0.2:0)+Math.min(0.2,Math.max(0,domains-1)*0.1)+Math.min(0.2,confirmations*0.1)-(open?0.3:0))*100)/100));
 return stage;
}
