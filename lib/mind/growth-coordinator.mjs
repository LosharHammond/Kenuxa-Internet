// KENUXA organism-wide growth coordination.
// No independent cognition engine: reconciles mutations in the one canonical node
// state and tracks the effects on atom DNA, molecules, cells and their specialists.
// Read-only calls do not trigger expensive regeneration or unbounded retraining.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const entityRevisions=state=>new Map([
 ...(state.atoms||[]),...(state.organism?.molecules||[]),...(state.organism?.cells||[])
].map(a=>[a.id,a.dna?.evolution?.revision||0]));
function signatures(state){
 const atoms=(state.atoms||[]).map(a=>[
  a.id,a.dna?.evolution?.revision||0,a.status,a.visibility,
  a.title,a.answer,(a.tags||[]).join('|'),(a.questions||[]).length,
  a.dna?.trust?.status||null
 ]);
 const forms=(state.formations?.molecules||[]).concat(state.formations?.cells||[])
  .map(f=>[f.id,f.title,(f.memberIds||[]).join('|')]);
 return hash([atoms,forms]);
}
export class GrowthCoordinator {
 constructor({state,rebuild,notify=()=>{}}={}){
  if(!state||typeof rebuild!=='function')throw Error('GrowthCoordinator requires node state and organism rebuilder');
  this.state=state;this.rebuild=rebuild;this.notify=notify;
  state.growth??={epoch:0,history:[],pendingEvaluation:false,lastRebuiltAt:null};
  this.lastSignature=null;this.lastVersions=null;
 }
 initialize(){
  this.rebuild(this.state);
  this.lastSignature=signatures(this.state);
  this.lastVersions=entityRevisions(this.state);
  return this.status();
 }
 reconcile({reason='state update'}={}){
  const sig=signatures(this.state);
  if(sig===this.lastSignature)return {changed:false,epoch:this.state.growth.epoch};
  const before=this.lastVersions||entityRevisions(this.state);
  this.rebuild(this.state);
  const after=entityRevisions(this.state);
  const revised=[];
  for(const [id,revision] of after)if(!before.has(id)||before.get(id)!==revision)
   revised.push({id,revision,kind:id.startsWith('mol://')?'molecule':id.startsWith('cell://')?'cell':'atom'});
  const removed=[...before.keys()].filter(id=>!after.has(id));
  this.lastSignature=signatures(this.state);this.lastVersions=after;
  const g=this.state.growth;
  g.epoch++;g.lastRebuiltAt=new Date().toISOString();
  const counts={atom:0,molecule:0,cell:0};
  for(const r of revised)counts[r.kind]++;
  const publicApproved=(this.state.atoms||[]).some(a=>revised.some(r=>r.kind==='atom'&&r.id===a.id)&&a.status==='approved'&&a.visibility==='public');
  if(publicApproved)g.pendingEvaluation=true;
  const record={epoch:g.epoch,at:g.lastRebuiltAt,reason:String(reason).slice(0,100),counts,removed:removed.length,
    agentsAndExpertsUpdated:revised.filter(x=>x.kind==='atom'||x.kind==='molecule'||x.kind==='cell').length*2,
    curriculumPending:g.pendingEvaluation};
  g.history.push(record);g.history=g.history.slice(-60);
  this.notify({revised,removed,record,publicApproved});
  return {changed:true,...record};
 }
 acknowledgedEvaluation(){this.state.growth.pendingEvaluation=false;}
 status(){return {epoch:this.state.growth.epoch,pendingEvaluation:this.state.growth.pendingEvaluation,lastRebuiltAt:this.state.growth.lastRebuiltAt,history:this.state.growth.history.slice(-10)};}
}
