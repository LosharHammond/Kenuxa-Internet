// Isolated offline verification server. Never loads .env or production credentials.
import http from 'node:http';
import {createNode} from '../lib/node.mjs';
import {nodeHttp} from '../lib/adapters.mjs';
const node=await createNode({env:{HOST:'127.0.0.1',NODE_ID:'foundation-preview',DATA_DIR:'data/foundation-preview',TRANSFORMER_ENABLED:'false',TRANSFORMER_TRAINING:'false',KENUXA_NETWORK:'off',RESEARCH_ENABLED:'false',CRAWLER_ENABLED:'false',COMPUTE_PEERS:'off'},log:()=>{}});
const server=http.createServer((req,res)=>nodeHttp(node,req,res));server.listen(3299,'127.0.0.1',()=>console.log('Isolated foundation studio: http://127.0.0.1:3299'));
process.on('SIGINT',()=>server.close(async()=>{await node.stop();process.exit(0);}));
