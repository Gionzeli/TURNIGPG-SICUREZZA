// Lettore documenti locale: estrazione PDF e OCR Tesseract. Nessun modello generativo e nessun upload dei documenti.
let _ocrModule=null;
async function loadOCR(onProgress){
 if(!window.Tesseract||typeof window.Tesseract.createWorker!=="function"){
  if(!_ocrModule){_ocrModule=new Promise((resolve,reject)=>{const s=document.createElement("script");let done=false;const timer=setTimeout(()=>{if(done)return;done=true;s.remove();reject(new Error("Tempo scaduto nel download del componente OCR"))},20000);s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.async=true;s.onload=()=>{if(done)return;done=true;clearTimeout(timer);window.Tesseract&&typeof window.Tesseract.createWorker==="function"?resolve(window.Tesseract):reject(new Error("OCR non disponibile"))};s.onerror=()=>{if(done)return;done=true;clearTimeout(timer);reject(new Error("Download componente OCR non riuscito"))};document.head.appendChild(s)}).catch(e=>{_ocrModule=null;throw e})}
  await _ocrModule;
 }
 return window.Tesseract.createWorker(["ita","eng"],1,{workerPath:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",corePath:"https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",langPath:"https://tessdata.projectnaptha.com/4.0.0",logger:m=>onProgress?.({phase:"ocr",progress:Number.isFinite(m?.progress)?Math.round(m.progress*100):null,status:m?.status||"",detail:m?.status?("OCR: "+m.status):"Preparazione OCR…" })});
}
function rowsFromWords(words){
 const clean=(words||[]).filter(w=>String(w.text||"").trim()&&w.bbox),hs=clean.map(w=>Math.max(1,w.bbox.y1-w.bbox.y0)).sort((a,b)=>a-b),tol=Math.max(2.5,(hs[Math.floor(hs.length/2)]||14)*.34),rows=[];
 clean.sort((a,b)=>((a.bbox.y0+a.bbox.y1)/2)-((b.bbox.y0+b.bbox.y1)/2)||a.bbox.x0-b.bbox.x0);
 // Raggruppa rispetto alla coordinata della prima parola, non alla media:
 // la media mobile poteva trascinare parole di righe vicine nello stesso turno.
 for(const w of clean){const y=(w.bbox.y0+w.bbox.y1)/2;let r=rows.find(x=>Math.abs(x.anchor-y)<=tol);if(!r){r={anchor:y,y,words:[]};rows.push(r)}r.words.push(w)}
 return rows.sort((a,b)=>a.y-b.y).map((r,i)=>"RIGA "+(i+1)+": "+r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>String(w.text).trim()).join(" | ")).join("\n");
}
async function ocrImages(images,onProgress){
 if(!images?.length)return "";const w=await loadOCR(onProgress),pages=[];
 try{for(let i=0;i<images.length;i++){onProgress?.({phase:"ocr-page",page:i+1,total:images.length});const r=await w.recognize(images[i]),t=rowsFromWords(r?.data?.words)||String(r?.data?.text||"").trim();if(t)pages.push("PAGINA "+(i+1)+":\n"+t)}}finally{try{await w.terminate()}catch(e){}}
 return pages.join("\n\n").slice(0,60000);
}
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function italianNumber(s){let t=String(s||"").replace(/[^0-9,.-]/g,"");if(t.includes(","))t=t.replace(/\./g,"").replace(",",".");else if((t.match(/\./g)||[]).length>1)t=t.replace(/\./g,"");const n=Number(t);return Number.isFinite(n)?n:null}
function labeledValue(lines,aliases){
 const keys=aliases.map(norm).sort((a,b)=>b.length-a.length);
 const raw=lines.join("\n").replace(/\u00a0/g," ").replace(/\s*\|\s*/g," ").replace(/^RIGA\s+\d+\s*:\s*/gim,"");
 const flat=norm(raw);
 for(const alias of keys){
  const pattern=alias.split(/\s+/).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\function labeledValue(lines,aliases){
 const keys=aliases.map(norm).sort((a,b)=>b.length-a.length);
 for(let i=0;i<lines.length;i++){
  const line=lines[i],n=norm(line);
  for(const key of keys){
   const at=n.indexOf(key);if(at<0)continue;
   // La normalizzazione rimuove gli accenti: ricava la posizione nella riga originale.
   let end=line.length;for(let j=0;j<=line.length;j++){if(norm(line.slice(0,j)).length>=at+key.length){end=j;break}}
   const tail=line.slice(end);
   const m=tail.match(/(?:€\s*)?[:=|]?\s*([-+]?\s*\d[\d.\s]*(?:,\d{1,5}|\.\d{1,5})?)/);
   if(m){const v=italianNumber(m[1]);if(v!==null)return v}
   // Nei cedolini a colonne il valore può comparire nella riga subito successiva.
   for(let j=i+1;j<Math.min(lines.length,i+3);j++){
    const next=lines[j].replace(/^RIGA\s+\d+:\s*/i,"").trim();
    const nm=next.match(/^(?:€\s*)?[:=|]?\s*([-+]?\s*\d[\d.\s]*(?:,\d{1,5}|\.\d{1,5})?)(?:\s*[|;].*)?$/);
    if(nm){const v=italianNumber(nm[1]);if(v!==null)return v}
   }
  }
 }
 // Ultimo tentativo sul testo appiattito: alcuni PDF spezzano l'etichetta
 // tra righe (es. "Paga" / "base") o usano spazi Unicode.
 const flat=norm(lines.join(" "));
 for(const alias of keys){
  const pattern=alias.split(/\s+/).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("\\s+");
  const re=new RegExp(pattern+"\\s*(?:€\\s*)?[:=|]?\\s*([-+]?\\s*\\d[\\d.\\s]*(?:,\\d{1,5}|\\.\\d{1,5})?)","i");
  const m=flat.match(re);
  if(m){const v=italianNumber(m[1]);if(v!==null)return v}
 }
 return null;
}")).join("\\s+");
  const re=new RegExp(pattern,"i"), hit=re.exec(flat);
  if(!hit)continue;
  // Normalizza gli spazi introdotti dall'OCR dentro importi come
  // "1 . 468 , 88000" o "1.468, 88000".
  const tail=flat.slice(hit.index+hit[0].length,hit.index+hit[0].length+100)
   .replace(/\s*([.,])\s*/g,"$1")
   .replace(/(\d)\s+(\d)/g,"$1$2");
  const m=tail.match(/^\s*[:=€]?\s*([-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,5})?)/);
  if(m){const v=italianNumber(m[1]);if(v!==null&&v>0)return v}
 }
 // Seconda lettura sulle singole righe, utile quando l'etichetta e il valore
 // sono stati separati dall'estrazione PDF.
 for(let i=0;i<lines.length;i++){
  const n=norm(lines[i]);
  for(const key of keys){
   const at=n.indexOf(key);if(at<0)continue;
   const tail=[lines[i].slice(Math.min(lines[i].length,at+key.length)),...lines.slice(i+1,i+3)].join(" ")
    .replace(/\u00a0/g," ").replace(/\s*([.,])\s*/g,"$1").replace(/(\d)\s+(\d)/g,"$1$2");
   const m=tail.match(/^\s*[:=€|]?\s*([-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,5})?)/);
   if(m){const v=italianNumber(m[1]);if(v!==null&&v>0)return v}
  }
 }
 return null;
}
function parsePayslip(text,fields){
 const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").replace(/\s*\|\s*/g," ").trim()).filter(Boolean),aliases={
 paga_base:["paga base","minimo tabellare","minimo contrattuale","retribuzione base","retribuzione tabellare","stipendio base","minimo ccnl","minimo contrattuale mensile"],scatti:["scatti","scatti anzianita","scatti di anzianita"],altre_fisse:["superminimo","elemento distinto","indennita fissa","altre voci fisse"],ore_mensili:["ore mensili","orario mensile","ore contrattuali"],ore_turno:["ore turno","durata turno","ore giornaliere"],straordinario_perc:["maggiorazione straordinario","straordinario %","maggiorazione straord"],straordinario_ora:["straordinario euro ora","straordinario orario","compenso straordinario"],notturno_turno:["indennita notturna","maggiorazione notturno","notturno turno"],piantonato_turno:["piantonamento","indennita piantonamento"],domenica_ora:["maggiorazione domenicale","lavoro domenicale","domenica ora"],riposo_non_goduto:["riposo non goduto","riposo lavorato","festivita non goduta"],buono_pasto:["buono pasto","ticket restaurant","ticket"],inps_rate:["aliquota inps","inps %","contributi ivs"],irpef_rate:["aliquota irpef","irpef %","ritenuta irpef"],sindacato:["trattenuta sindacale","sindacato"],cessione:["cessione quinto","cessione del quinto"],altre_trattenute:["altre trattenute","totale trattenute"]};
 const out={};
 for(const [key] of fields){const v=labeledValue(lines,aliases[key]||[key.replace(/_/g," ")]);if(v!==null)out[key]=v}
 // Nei cedolini la riga LAVORO ORDINARIO può essere spezzata dall'OCR
 // in colonne separate o distribuita su più righe. Unisci la riga e le due
 // successive, quindi usa il totale finale (non la quantità o la tariffa).
 // Nessun importo è preimpostato: il valore viene letto dal cedolino corrente.
 if(!(Number(out.paga_base)>0)){
  for(let i=0;i<lines.length;i++){
   const row=lines.slice(i,Math.min(lines.length,i+3)).join(" ");
   if(!/\blavoro\s+ordinario\b/i.test(norm(row)))continue;
   const nums=[...row.matchAll(/\d[\d.]*,\d{1,5}|\d{1,3}(?:\.\d{3})+(?:,\d{1,5})?/g)]
    .map(m=>italianNumber(m[0])).filter(v=>v!==null&&v>0);
   if(nums.length>=2){out.paga_base=nums[nums.length-1];break}
  }
 }
 return out;
}
function fullDate(line){
 const s=String(line||"").replace(/\s*([/.])\s*/g,"$1").replace(/\s*-\s*/g,"-");
 let m=s.match(/\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{2}|\d{4})\b/);
 if(!m)m=s.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{2}|\d{4})\b/);
 if(m){const d=+m[1],mo=+m[2],rawYear=+m[3],y=m[3].length===2?(rawYear>=70?1900+rawYear:2000+rawYear):rawYear,dt=new Date(y,mo-1,d);if(dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d)return y+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0")}
 m=s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);if(m){const d=+m[3],mo=+m[2],y=+m[1],dt=new Date(y,mo-1,d);if(dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d)return m[0]}return "";
}
function parseTurns(text){
 const out=[],seen=new Set(),dateRe=/\b(?:\d{1,2}[/. -]\d{1,2}[/. -](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b/g;
 const timeRe=/\b([01]?\d|2[0-3])\s*[:,.]\s*([0-5]\d)\b/g;
 const lines=String(text||"").replace(/\r/g,"\n").split("\n");let currentDate="",periodStart="";
 const addRest=(date,type,raw)=>{const x={date,type,post:"",start_time:"",end_time:"",piantonamento:false,notturno:false,ore:0};const key=[date,type,norm(raw)].join("|");if(!seen.has(key)){seen.add(key);out.push(x)}};
 const addShift=(date,segment,start,end,postRaw)=>{
  let post=String(postRaw||"").replace(/\s*\|\s*/g," ").replace(/\bVIGILANZA\s+FISSA\b/ig," ").replace(/\bAOUC\s+POLICLINICO\s+BARI\b/ig," ").replace(/\b(?:lun|mar|mer|gio|ven|sab|dom)(?:ed[iì])?\.?\b/ig," ").replace(/\s+/g," ").replace(/^[\s|,:;.-]+|[\s|,:;.-]+$/g,"").trim();
  if(!post)return;const n=norm(segment),x={date,type:"turno",post:post.slice(0,120),start_time:start,end_time:end,piantonamento:/piant/i.test(n+" "+norm(post)),notturno:false,ore:0};x.notturno=+end.slice(0,2)<+start.slice(0,2);
  const key=[date,"turno",start,end,norm(post)].join("|");if(!seen.has(key)){seen.add(key);out.push(x)}
 };
 for(const raw of lines){
  const line=raw.replace(/^\s*(?:RIGA|Riga)\s+\d+\s*:\s*/i,"").trim();if(!line)continue;
  const period=line.match(/\bDAL\s+(\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4})\s+AL\b/i);if(period){periodStart=fullDate(period[1]);continue}
  dateRe.lastIndex=0;const found=[];let dm;while((dm=dateRe.exec(line))!==null){const d=fullDate(dm[0]);if(d)found.push({date:d,end:dm.index+dm[0].length})}
  let segment=line;
  if(found.length){currentDate=found[0].date;segment=line.slice(found[0].end);if(found.length>1)continue}
  else{const day=line.match(/^\s*(\d{1,2})\s+(?:lun|mar|mer|gio|ven|sab|dom)\b/i);if(day&&periodStart){const d=+day[1],p=periodStart.split("-").map(Number);let y=p[0],mo=p[1];if(d<p[2]){mo++;if(mo>12){mo=1;y++}}const dt=new Date(y,mo-1,d);if(dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d){currentDate=y+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0");segment=line.replace(day[0],"")}}}
  if(!currentDate||!segment.trim())continue;
  const matches=[...segment.matchAll(timeRe)];
  if(matches.length>=2){for(let i=0;i+1<matches.length;i+=2){const a=matches[i],b=matches[i+1],next=matches[i+2],start=String(a[1]).padStart(2,"0")+":"+a[2],end=String(b[1]).padStart(2,"0")+":"+b[2];addShift(currentDate,segment,start,end,segment.slice(b.index+b[0].length,next?next.index:segment.length))}continue}
  const n=norm(segment.replace(/\s*\|\s*/g," "));
  if(/\briposo\s+compensativo\b/.test(n)){addRest(currentDate,"riposo_compensativo",segment);continue}
  if(/\bferie\b/.test(n)){addRest(currentDate,"ferie",segment);continue}
  if(/\b(?:turno\s+di\s+riposo|riposo\s+semplice|\briposo\b)/.test(n)){addRest(currentDate,"riposo",segment);continue}
  if(/\bpermesso\b/.test(n)){addRest(currentDate,"permesso",segment);continue}
  if(/\bmalattia\b/.test(n)){addRest(currentDate,"malattia",segment);continue}
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
