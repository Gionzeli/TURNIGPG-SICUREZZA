// Lettore documenti locale: OCR Tesseract + modello Qwen ONNX nel browser.
// I documenti e il testo OCR non vengono inviati a servizi AI esterni.
let _generator=null,_generatorPromise=null,_ocrModule=null;
const MODEL_ID="onnx-community/Qwen2.5-0.5B-Instruct";
const MODEL_SIZE="circa 800 MB";

async function loadTransformers(){
  if(!_transformersPromise){
    _transformersPromise=import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm")
      .then(m=>{m.env.useBrowserCache=true;m.env.allowRemoteModels=true;m.env.allowLocalModels=false;return m})
      .catch(e=>{_transformersPromise=null;throw e});
  }
  return _transformersPromise;
}
let _transformersPromise=null;

async function loadModel(onProgress){
  if(_generator)return _generator;
  if(_generatorPromise)return _generatorPromise;
  _generatorPromise=(async()=>{
    const m=await loadTransformers();
    const progress_callback=x=>{
      if(!onProgress)return;
      const p=Number.isFinite(x?.progress)?Math.round(x.progress<=1?x.progress*100:x.progress):null;
      onProgress({phase:x?.status||"download",progress:p,file:x?.file||""});
    };
    const opts={dtype:"q4",progress_callback};
    if(!navigator.gpu)onProgress?.({phase:"cpu",progress:null});
    try{
      opts.device=navigator.gpu?"webgpu":"wasm";
      _generator=await m.pipeline("text-generation",MODEL_ID,opts);
    }catch(first){
      if(opts.device!=="webgpu")throw first;
      onProgress?.({phase:"fallback",progress:null});
      _generator=await m.pipeline("text-generation",MODEL_ID,{dtype:"q4",device:"wasm",progress_callback});
    }
    return _generator;
  })().catch(e=>{_generatorPromise=null;_generator=null;throw e});
  return _generatorPromise;
}

async function loadOCR(onProgress){
  if(!window.Tesseract || typeof window.Tesseract.createWorker!=="function"){
    if(!_ocrModule){
      _ocrModule=new Promise((resolve,reject)=>{
        const script=document.createElement("script");
        script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        script.async=true;
        script.onload=()=>{
          if(window.Tesseract && typeof window.Tesseract.createWorker==="function")resolve(window.Tesseract);
          else reject(new Error("Il file OCR è stato caricato ma l'API Tesseract non è disponibile."));
        };
        script.onerror=()=>reject(new Error("Impossibile scaricare il componente OCR da jsDelivr."));
        document.head.appendChild(script);
      }).catch(e=>{_ocrModule=null;throw e});
    }
    await _ocrModule;
  }
  const T=window.Tesseract;
  if(!T || typeof T.createWorker!=="function"){
    _ocrModule=null;
    throw new Error("Componente OCR non pronto: manca createWorker.");
  }
  const worker=await T.createWorker(["ita","eng"],1,{
    workerPath:"https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js",
    corePath:"https://unpkg.com/tesseract.js-core@5.1.1",
    langPath:"https://tessdata.projectnaptha.com/4.0.0",
    logger:m=>onProgress?.({phase:"ocr",progress:Number.isFinite(m?.progress)?Math.round(m.progress*100):null,status:m?.status||"",detail:m?.status?("OCR: "+m.status):"Preparazione OCR…" })
  });
  return worker;
}

function rowsFromWords(words){
  const clean=(words||[]).filter(w=>String(w.text||"").trim()&&w.bbox);
  const heights=clean.map(w=>Math.max(1,(w.bbox.y1||0)-(w.bbox.y0||0))).sort((a,b)=>a-b);
  const tol=Math.max(7,(heights[Math.floor(heights.length/2)]||14)*0.7);
  const rows=[];
  clean.sort((a,b)=>((a.bbox.y0+a.bbox.y1)/2)-((b.bbox.y0+b.bbox.y1)/2)||a.bbox.x0-b.bbox.x0);
  for(const w of clean){
    const y=(w.bbox.y0+w.bbox.y1)/2;
    let row=rows.find(r=>Math.abs(r.y-y)<=tol);
    if(!row){row={y,words:[]};rows.push(row)}
    row.words.push(w);
  }
  return rows.sort((a,b)=>a.y-b.y).map((r,i)=>
    "RIGA "+(i+1)+": "+r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>String(w.text).trim()).join(" | ")
  ).join("\n");
}

async function ocrImages(images,onProgress){
  if(!images?.length)return "";
  const worker=await loadOCR(onProgress);
  const pages=[];
  try{
    for(let i=0;i<images.length;i++){
      onProgress?.({phase:"ocr-page",page:i+1,total:images.length});
      const result=await worker.recognize(images[i]);
      const rows=rowsFromWords(result?.data?.words);
      const text=rows||String(result?.data?.text||"").trim();
      if(text)pages.push("PAGINA "+(i+1)+" (OCR locale):\n"+text);
    }
  }finally{try{await worker.terminate()}catch(e){}}
  return pages.join("\n\n").slice(0,60000);
}

function extractJSON(raw){
  let t=typeof raw==="string"?raw:String(raw??"");
  t=t.replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/,"").trim();
  for(let start=0;start<t.length;start++){
    const open=t[start];if(open!=="{"&&open!=="[")continue;
    const close=open==="{"?"}":"]";let depth=0,inString=false,escape=false;
    for(let i=start;i<t.length;i++){
      const ch=t[i];
      if(inString){if(escape)escape=false;else if(ch==="\\")escape=true;else if(ch==='"')inString=false;continue}
      if(ch==='"'){inString=true;continue}
      if(ch===open)depth++;
      else if(ch===close&&--depth===0){try{return JSON.parse(t.slice(start,i+1))}catch(e){break}}
    }
  }
  throw Object.assign(new Error("Risposta del modello non in formato JSON"),{code:"invalid_json"});
}

async function readJSON(prompt,onProgress){
  const generator=await loadModel(onProgress);
  const messages=[
    {role:"system",content:"Sei un lettore di documenti italiani. Estrai solo i dati esplicitamente presenti. Non inventare, non completare valori mancanti e non confondere righe o colonne. Restituisci esclusivamente JSON valido, senza spiegazioni."},
    {role:"user",content:prompt}
  ];
  const result=await generator(messages,{max_new_tokens:900,do_sample:false,return_full_text:false});
  let answer=result?.[0]?.generated_text;
  if(Array.isArray(answer)){const last=answer[answer.length-1];answer=last?.content??last?.text??""}
  else if(answer&&typeof answer==="object")answer=answer.content??answer.text??JSON.stringify(answer);
  return extractJSON(answer);
}

window.LocalDocAI={
  modelId:MODEL_ID,
  modelSize:MODEL_SIZE,
  ocrImages,
  readJSON,
  isReady:()=>!!_generator
};
