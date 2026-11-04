// Non-invasive static audit of the real application dependency graph.
// A module is "connected" only if reachable from an executable entry point,
// not merely present in the repository.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exists=p=>fs.existsSync(path.join(root,p));
const walk=(dir,out=[])=>{
  for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    const p=path.posix.join(dir,e.name);
    if(e.isDirectory())walk(p,out);
    else if(/\.(?:mjs|js)$/.test(p))out.push(p);
  }
  return out;
};
const files=walk('lib'),all=new Set([...files,'server.mjs']);
const edges=new Map(),missing=[];
for(const file of all){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const imports=[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)['"](\.[^'"]+)['"]/g)].map(x=>x[1]);
  const deps=[];
  for(const spec of imports){
    let dest=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
    if(!path.posix.extname(dest))dest+='.mjs';
    if(!all.has(dest)){
      if(!exists(dest))missing.push({file,import:spec,expected:dest});
      continue;
    }
    deps.push(dest);
  }
  edges.set(file,deps);
}
const reachable=new Set(),visit=p=>{
  if(reachable.has(p)||!edges.has(p))return;
  reachable.add(p);for(const child of edges.get(p))visit(child);
};
visit('server.mjs');
const critical=[
 'lib/node.mjs','lib/mind/index.mjs','lib/atoms/registry.mjs','lib/mind/unified-cognition.mjs',
 'lib/mind/developmental-learning-core.mjs','lib/mind/program-induction.mjs',
 'lib/mind/autonomous-learning.mjs','lib/mind/grammar-induction.mjs',
 'lib/mind/foundation-training.mjs','lib/transformer/index.mjs','lib/store.mjs',
 'lib/mind/semantic-reasoner.mjs','lib/mind/foundation-cognition.mjs'
];
const disconnected=critical.filter(x=>!reachable.has(x));
const report={
  scanned:files.length,reachable:reachable.size-1,unreachable:files.filter(x=>!reachable.has(x)),
  criticalConnected:critical.length-disconnected.length,missing,disconnected,
  entry:'server.mjs',valid:!missing.length&&!disconnected.length
};
console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=1;
