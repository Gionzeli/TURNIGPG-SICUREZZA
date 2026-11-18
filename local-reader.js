// Lettore documenti locale: estrazione PDF e OCR Tesseract. Nessun modello generativo e nessun upload dei documenti.
let _ocrModule=null;
async function loadOCR(onProgress){
 if(!window.Tesseract||typeof window.Tesseract.createWorker!=="function"){
  if(!_ocrModule){_ocrModule=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.async=true;s.onload=()=>window.Tesseract&&typeof window.Tesseract.createWorker==="function"?resolve(window.Tesseract):reject(new Error("OCR non disponibile"));s.onerror=()=>reject(new Error("Download componente OCR non riuscito"));document.head.appendChild(s)}).catch(e=>{_ocrModule=null;throw e})}
  await _ocrModule;
 }
 return window.Tesseract.createWorker(["ita","eng"],1,{workerPath:"https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js",corePath:"https://unpkg.com/tesseract.js-core@5.1.1",langPath:"https://tessdata.projectnaptha.com/4.0.0",logger:m=>onProgress?.({phase:"ocr",progress:Number.isFinite(m?.progress)?Math.round(m.progress*100):null,status:m?.status||"",detail:m?.status?("OCR: "+m.status):"Preparazione OCR…" })});
}
function rowsFromWords(words){
 const clean=(words||[]).filter(w=>String(w.text||"").trim()&&w.bbox),hs=clean.map(w=>Math.max(1,w.bbox.y1-w.bbox.y0)).sort((a,b)=>a-b),tol=Math.max(7,(hs[Math.floor(hs.length/2)]||14)*.7),rows=[];
 clean.sort((a,b)=>((a.bbox.y0+a.bbox.y1)/2)-((b.bbox.y0+b.bbox.y1)/2)||a.bbox.x0-b.bbox.x0);
 for(const w of clean){const y=(w.bbox.y0+w.bbox.y1)/2;let r=rows.find(x=>Math.abs(x.y-y)<=tol);if(!r){r={y,words:[]};rows.push(r)}r.words.push(w)}
 return rows.sort((a,b)=>a.y-b.y).map((r,i)=>"RIGA "+(i+1)+": "+r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>String(w.text).trim()).join(" | ")).join("\n");
}
async function ocrImages(images,onProgress){
 if(!images?.length)return "";const w=await loadOCR(onProgress),pages=[];
 try{for(let i=0;i<images.length;i++){onProgress?.({phase:"ocr-page",page:i+1,total:images.length});const r=await w.recognize(images[i]),t=rowsFromWords(r?.data?.words)||String(r?.data?.text||"").trim();if(t)pages.push("PAGINA "+(i+1)+":\n"+t)}}finally{try{await w.terminate()}catch(e){}}
 return pages.join("\n\n").slice(0,60000);
}
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
function italianNumber(s){let t=String(s||"").replace(/[^0-9,.-]/g,"");if(t.includes(","))t=t.replace(/\./g,"").replace(",",".");else if((t.match(/\./g)||[]).length>1)t=t.replace(/\./g,"");const n=Number(t);return Number.isFinite(n)?n:null}
function labeledValue(lines,aliases){
 const keys=aliases.map(norm).sort((a,b)=>b.length-a.length);
 for(let i=0;i<lines.length;i++){
  const line=lines[i],n=norm(line);
  for(const key of keys){
   const at=n.indexOf(key);if(at<0)continue;
   const tail=line.slice(Math.min(line.length,at+key.length));
   const m=tail.match(/(?:€\s*)?[:=]?\s*([-+]?\s*\d[\d.\s]*(?:,\d{1,2}|\.\d{1,2})?)/);
   if(m){const v=italianNumber(m[1]);if(v!==null)return v}
   // Alcuni cedolini riportano l'etichetta e il valore nella riga successiva.
   if(i+1<lines.length&&/^\s*(?:€\s*)?[-+]?\s*\d[\d.\s]*(?:,\d{1,2}|\.\d{1,2})?\s*$/.test(lines[i+1])){
    const v=italianNumber(lines[i+1]);if(v!==null)return v;
   }
  }
 }
 return null;
}
function parsePayslip(text,fields){
 const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").trim()).filter(Boolean),aliases={
 paga_base:["paga base","minimo tabellare","minimo contrattuale","retribuzione base"],scatti:["scatti anzianita","scatti di anzianita"],altre_fisse:["superminimo","elemento distinto","indennita fissa","altre voci fisse"],ore_mensili:["ore mensili","orario mensile","ore contrattuali"],ore_turno:["ore turno","durata turno","ore giornaliere"],straordinario_perc:["maggiorazione straordinario","straordinario %","maggiorazione straord"],straordinario_ora:["straordinario euro ora","straordinario orario","compenso straordinario"],notturno_turno:["indennita notturna","maggiorazione notturno","notturno turno"],piantonato_turno:["piantonamento","indennita piantonamento"],domenica_ora:["maggiorazione domenicale","lavoro domenicale","domenica ora"],riposo_non_goduto:["riposo non goduto","riposo lavorato","festivita non goduta"],buono_pasto:["buono pasto","ticket restaurant","ticket"],inps_rate:["aliquota inps","inps %","contributi ivs"],irpef_rate:["aliquota irpef","irpef %","ritenuta irpef"],sindacato:["trattenuta sindacale","sindacato"],cessione:["cessione quinto","cessione del quinto"],altre_trattenute:["altre trattenute","totale trattenute"]};
 const out={};
 for(const [key] of fields){const v=labeledValue(lines,aliases[key]||[key.replace(/_/g," ")]);if(v!==null)out[key]=v}
 return out;
}
function fullDate(line){
 let m=line.match(/\b(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})\b/);if(m){const d=+m[1],mo=+m[2],y=+m[3],dt=new Date(y,mo-1,d);if(dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d)return y+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0")}
 m=line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);if(m){const d=+m[3],mo=+m[2],y=+m[1],dt=new Date(y,mo-1,d);if(dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d)return m[0]}return "";
}
function parseTurns(text){
 const lines=String(text||"").split(/\r?\n/),out=[],seen=new Set();
 for(const raw of lines){
  const line=raw.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").trim();if(!line)continue;
  const date=fullDate(line);if(!date)continue;
  const times=[...line.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(m=>String(m[1]).padStart(2,"0")+":"+m[2]);
  const n=norm(line);let type="";
  if(/\b(rc|riposo compensativo)\b/.test(n))type="riposo_compensativo";
  else if(/\b(rl|riposo lavorato|riposo non goduto)\b/.test(n))type="turno_riposo";
  else if(/\b(ferie|fer)\b/.test(n))type="ferie";
  else if(/\b(malattia|mal)\b/.test(n))type="malattia";
  else if(/\b(permesso|rol)\b/.test(n))type="permesso";
  else if(/\b(riposo|rp)\b/.test(n))type="riposo";
  else if(times.length>=2)type="turno";
  if(!type)continue;
  const x={date,type,post:"",start_time:"",end_time:"",piantonamento:/piant|portier/i.test(n),notturno:false,ore:0};
  if(times.length>=2){x.start_time=times[0];x.end_time=times[1];x.notturno=+times[1].slice(0,2)<+times[0].slice(0,2)}
  // Mantiene le colonne OCR: la postazione è cercata dopo l'ultima colonna con un orario.
  const parts=line.split(/\s*\|\s*/).map(v=>v.replace(/^[A-Z]=/i,"").trim()).filter(Boolean);
  let lastTime=-1;
  parts.forEach((p,i)=>{if(times.some(t=>p.includes(t)))lastTime=i});
  if(lastTime>=0){
   const candidate=parts.slice(lastTime+1).find(p=>p&&!/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b/.test(p)&&!/^\d{1,2}[:.]\d{2}$/.test(p));
   if(candidate)x.post=candidate.replace(/^(?:postazione|posto|servizio)\s*[:=-]\s*/i,"").slice(0,70);
  }
  if((type==="turno"||type==="turno_riposo")&&(!x.start_time||!x.end_time||x.start_time===x.end_time))continue;
  const key=[x.date,x.type,x.start_time,x.end_time,norm(x.post)].join("|");
  if(seen.has(key))continue;seen.add(key);out.push(x);
 }
 return out;
}
function parseTraining(text){
 const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").trim()).filter(Boolean);
 const dateLines=lines.map(x=>({line:x,date:fullDate(x)})).filter(x=>x.date);
 const expiryLine=lines.find(x=>/scadenz|valido fino|da rinnovare|validita fino/i.test(norm(x)))||"";
 const expiry=fullDate(expiryLine);
 const dateEntry=dateLines.find(x=>x.line!==expiryLine)||dateLines[0];
 const date=dateEntry?.date||"";
 const titleLine=lines.find(x=>/corso|formazione|attestato|aggiornamento|addestramento|abilitazione/i.test(norm(x)))||"";
 const title=titleLine.replace(/^(.*?)(corso|formazione|attestato|aggiornamento|addestramento|abilitazione)\s*[:\-]?/i,"$2 ").trim().slice(0,140);
 const providerLine=lines.find(x=>/ente|organizzat|azienda|formatore|istituto/i.test(norm(x)))||"";
 const provider=providerLine.replace(/^.*?(ente|organizzatore|azienda|formatore|istituto)\s*[:\-]?/i,"").slice(0,100);
 const all=lines.join(" "),hm=all.match(/(\d+(?:[,.]\d+)?)\s*(?:ore|h\b)/i);
 return{title:title||(/formazione/.test(norm(all))?"Formazione":""),provider,date,expiry,hours:hm?italianNumber(hm[1]):null};
}
window.LocalDocAI={ocrImages,parsePayslip,parseTurns,parseTraining};
