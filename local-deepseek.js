/* DeepSeek locale opzionale per Turni GPG/sicurezza.
   Il testo dei documenti non viene inviato a un servizio di inferenza.
   I pesi vengono scaricati dal repository pubblico Hugging Face e memorizzati nella cache del browser. */
const MODEL_ID="onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX";
let pipePromise=null,pipe=null,backend="";
const say=(cb,msg)=>{try{cb&&cb(msg)}catch(e){}};
async function createPipeline(progress){
  const {pipeline,env}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
  env.allowRemoteModels=true;
  env.allowLocalModels=false;
  const hasGPU=!!(navigator.gpu&&await navigator.gpu.requestAdapter().catch(()=>null));
  const choices=hasGPU?[{device:"webgpu",dtype:"q4f16",label:"WebGPU"},{device:"wasm",dtype:"q4",label:"CPU/WASM"}]:[{device:"wasm",dtype:"q4",label:"CPU/WASM"}];
  let last;
  for(const choice of choices){
    try{
      say(progress,{status:"download",detail:"Scaricamento modello DeepSeek ("+choice.label+")…"});
      const p=await pipeline("text-generation",MODEL_ID,{
        device:choice.device,dtype:choice.dtype,
        progress_callback:x=>{
          if(x&&x.status==="progress"){
            const pct=Number.isFinite(x.progress)?Math.round(x.progress):null;
            say(progress,{status:"download",detail:(x.file||"Modello")+(pct!==null?" · "+pct+"%":"")});
          }else if(x&&x.status)say(progress,{status:"download",detail:x.file||x.status});
        }
      });
      backend=choice.label;return p;
    }catch(e){last=e;if(choice.device==="webgpu")say(progress,{status:"fallback",detail:"WebGPU non disponibile: provo la modalità CPU locale…"});}
  }
  throw last||new Error("Modello non disponibile su questo dispositivo");
}
async function init(progress){
  if(pipe)return {ready:true,backend};
  if(!pipePromise)pipePromise=createPipeline(progress).then(p=>(pipe=p,{ready:true,backend})).catch(e=>{pipePromise=null;throw e});
  return pipePromise;
}
async function selfTest(progress){
  await init(progress);
  say(progress,{status:"test",detail:"Verifica del modello in esecuzione sul dispositivo…"});
  const out=await pipe([{role:"user",content:"Rispondi esclusivamente con queste parole: DeepSeek locale attivo."}],{max_new_tokens:24,do_sample:false});
  const msg=out?.[0]?.generated_text;
  const answer=Array.isArray(msg)?String(msg[msg.length-1]?.content||""):String(msg||"");
  if(!answer.trim())throw new Error("Il modello non ha prodotto una risposta");
  return {ready:true,backend,answer:answer.replace(/<think>[\s\S]*?<\/think>/g,"").trim()};
}
window.LocalDeepSeek={init,selfTest,get ready(){return !!pipe},get backend(){return backend}};
document.addEventListener("DOMContentLoaded",()=>{
 const btn=document.getElementById("deepseekInit"),status=document.getElementById("deepseekStatus");
 if(!btn||!status)return;
 const show=m=>{if(m&&m.detail)status.textContent=m.detail};
 btn.addEventListener("click",async()=>{
  btn.disabled=true;status.textContent="Preparazione DeepSeek locale…";
  try{
   const result=await selfTest(show);
   status.textContent="DeepSeek pronto ("+result.backend+"). Test locale completato. "+result.answer;
   btn.textContent="DeepSeek pronto";
  }catch(e){
   console.warn("DeepSeek locale non avviato",e);
   status.textContent="Non è stato possibile avviare DeepSeek su questo dispositivo: "+(e?.message||"errore non specificato")+". La lettura OCR locale esistente resta disponibile.";
   btn.disabled=false;btn.textContent="Riprova DeepSeek";
  }
 });
});
