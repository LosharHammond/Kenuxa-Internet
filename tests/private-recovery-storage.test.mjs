import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseStore} from '../lib/store.mjs';

test('private recovery bundles use authenticated object download, not public access',async()=>{
 const urls=[],bytes=Buffer.from('signed recovery only');
 const node=new SupabaseStore({url:'https://example-ref.supabase.co',
  key:'eyJ'+'a'.repeat(40),nodeId:'test-owner',
  fetcher:async(url,options={})=>{
    urls.push([url,options.method||'GET',options.headers||{}]);
    if(url.includes('/authenticated/'))return {ok:true,status:200,arrayBuffer:async()=>bytes};
    if(url.includes('/kenuxa_nodes'))return {ok:true,status:200,text:async()=>'[]'};
    return {ok:true,status:200};
  }});
 const reply=await node.publicKnowledge.read('test-peer');
 assert.deepEqual(reply,bytes);
 assert.ok(urls[0][0].endsWith('/storage/v1/object/authenticated/kenuxa/public-recovery/test-peer.json'));
 assert.ok(urls[0][2].Authorization?.startsWith('Bearer '));
});
