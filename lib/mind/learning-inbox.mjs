// Safe conversation ingestion: store *questions to investigate*, never treat chat as truth.
// Pure data, bounded and serializable in the node's existing Postgres-backed state.
import { createHash } from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export class LearningInbox {
 constructor({state={},limit=1000}={}){this.S=state;this.S.items ||= [];this.limit=Math.max(1,Math.min(10000,limit));}
 capture({text,conversationId=null,consent=false}={}){
  if(!consent)return {ok:false,reason:'explicit learning consent required'};
  if(typeof text!=='string'||!text.trim()||text.length>4000)return {ok:false,reason:'invalid bounded text'};
  if(this.S.items.length>=this.limit)return {ok:false,reason:'inbox full'};
  const id='candidate:'+hash(text.trim());
  if(this.S.items.some(x=>x.id===id))return {ok:true,id,duplicate:true,status:'quarantined'};
  // Store a content digest and investigation metadata, not raw private chat.
  this.S.items.push({id,conversationId:typeof conversationId==='string'?hash(conversationId):null,status:'quarantined',kind:'unverified-conversation',evidence:[],createdAt:new Date().toISOString()});
  return {ok:true,id,status:'quarantined'};
 }
 list(){return this.S.items.map(({id,status,kind,createdAt})=>({id,status,kind,createdAt}));}
}
