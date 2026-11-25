/* Modello AI locale opzionale. I documenti non vengono inviati a servizi di inferenza. */
const MODEL_ID="onnx-community/Qwen2.5-0.5B-Instruct";
let pipePromise=null,pipe=null,backend="";
const notify=(cb,detail)=>{try{cb&&cb({detail})}catch(e){}};
async function createPipeline(progress){
  notify(progress,"Caricamento del motore AI locale…");
  const {pipeline,env}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0");
  env.allowRemoteModels=true;
  env.allowLocalModels=false;
  env.useBrowserCache=true;
  const hasGPU=!!(navigator.gpu&&await navigator.gpu.requestAdapter().catch(()=>null));
  const modes=hasGPU?[{device:"webgpu",label:"GPU del dispositivo"},{device:"wasm",label:"CPU del dispositivo"}]:[{device:"wasm",label:"CPU del dispositivo"}];
  let lastError;
  for(const mode of modes){
    try{
      notify(progress,"Connessione al repository del modello ("+mode.label+")…");
      const generator=await pipeline("text-generation",MODEL_ID,{
        device:mode.device,dtype:"q4",
        progress_callback:p=>{
          if(!p)return;
          if(p.status==="progress"){
            const pct=Number.isFinite(p.progress)?Math.round(p.progress):null;
            const loaded=Number.isFinite(p.loaded)?p.loaded:null;
            const total=Number.isFinite(p.total)?p.total:null;
            const size=loaded!==null&&total? " · "+(loaded/1048576).toFixed(0)+"/"+(total/1048576).toFixed(0)+" MB":"";
            notify(progress,(p.file||"File modello")+(pct!==null?" · "+pct+"%":"")+size);
          }else if(p.status)notify(progress,p.file||"Preparazione: "+p.status);
        }
      });
      backend=mode.label;
      return generator;
    }catch(e){
      lastError=e;
      if(mode.device==="webgpu")notify(progress,"GPU non compatibile: provo la modalità CPU locale…");
    }
  }
  throw lastError||new Error("Modello non disponibile");
}
async function init(progress){
  if(pipe)return {ready:true,backend};
  if(!pipePromise)pipePromise=createPipeline(progress).then(p=>(pipe=p,{ready:true,backend})).catch(e=>{pipePromise=null;throw e});
  return pipePromise;
}
async function selfTest(progress){
  await init(progress);
  notify(progress,"Modello caricato. Verifico che risponda…");
  const result=await pipe("Rispondi in italiano con la frase: AI locale attiva.",{max_new_tokens:24,do_sample:false});
  const answer=String(result?.[0]?.generated_text||"").trim();
  if(!answer)throw new Error("Il modello è stato caricato ma non ha prodotto una risposta");
  return {ready:true,backend,answer};
}
window.LocalDeepSeek={init,selfTest,get ready(){return !!pipe},get backend(){return backend}};
function bindLocalAI(){
 const button=document.getElementById("deepseekInit");
 const status=document.getElementById("deepseekStatus");
 if(!button||!status||button.dataset.bound==="1")return;
 button.dataset.bound="1";
 button.addEventListener("click",async()=>{
  button.disabled=true;
  button.textContent="Caricamento…";
  status.textContent="Avvio del download. Lascia aperta questa pagina…";
  try{
   const result=await selfTest(m=>{if(m?.detail)status.textContent=m.detail});
   status.textContent="AI locale pronta ("+result.backend+"). Verifica completata.";
   button.textContent="AI locale pronta";
  }catch(error){
   console.error("Errore AI locale:",error);
   const reason=error?.message||String(error)||"errore sconosciuto";
   status.textContent="Download o avvio non riuscito: "+reason+". Il lettore OCR locale continua a funzionare.";
   button.disabled=false;
   button.textContent="Riprova download";
  }
 });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bindLocalAI,{once:true});
else bindLocalAI();
