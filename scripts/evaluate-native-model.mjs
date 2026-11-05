// Execute against a real local KENUXA transformer checkpoint, not a mocked
// interpreter. Slow by design; do not run on a free Render web request.
import {FileStore} from '../lib/store.mjs';
import {TransformerService} from '../lib/transformer/index.mjs';
import path from 'node:path';
const dataDir=path.resolve(process.env.DATA_DIR||'./data');
const store=await new FileStore(dataDir).init();
const service=await new TransformerService({env:{...process.env,RENDER:'',RENDER_SERVICE_ID:''},
  blobs:store.blobs,log:msg=>console.error(String(msg).slice(0,160))}).init();
const report=await service.assessNativeComprehension({seed:825617,perKind:6});
console.log(JSON.stringify({node:'local-checkpoint',profile:service.profile,
 checkpoint:service.release.live.version,trainingSteps:service.step,
 evaluation:report,approvedForInference:service.release.live.comprehension?.passed===true},null,2));
if(!report.ok||!report.passed)process.exitCode=1;
