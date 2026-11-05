// Only KENUXA's fixed, deterministic public task vocabulary runs here.
// A disposable worker isolates memory and CPU from the interactive chatbot.
import {parentPort,workerData} from 'node:worker_threads';
import {runTask} from './tasks.mjs';
const deadline=Date.now()+Math.max(100,Math.min(12000,Number(workerData?.budgetMs)||5000));
try{
 if(!workerData||typeof workerData.kind!=='string'||!workerData.payload)
   throw new Error('Invalid worker task');
 const result=await runTask(workerData.kind,workerData.payload,{deadline});
 if(Date.now()>deadline)throw new Error('Task exceeded execution deadline');
 parentPort.postMessage({ok:true,result});
}catch(error){
 parentPort.postMessage({ok:false,error:String(error?.message||error).slice(0,180)});
}
