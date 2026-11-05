// Time-budget the asynchronous answer pipeline without leaking an unhandled
// rejection after the HTTP response. Does not promise to preempt blocking CPU
// instructions in the JavaScript main thread.
export async function withinAnswerBudget(run,{timeoutMs=18000}={}){
 const budget=Math.max(10,Math.min(22000,Number(timeoutMs)||18000));
 let timer;
 const work=Promise.resolve().then(run).then(
  value=>({value,timedOut:false}),
  error=>({value:null,timedOut:false,error}));
 const deadline=new Promise(resolve=>{
  timer=setTimeout(()=>resolve({value:null,timedOut:true}),budget);
  timer.unref?.();
 });
 const outcome=await Promise.race([work,deadline]);
 clearTimeout(timer);
 if(outcome.error)throw outcome.error;
 return outcome;
}
