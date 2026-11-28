import { createLocalLearning } from "./local-learning.js";
import { createLocalQwen } from "./local-qwen.js";

const ocrLearning = createLocalLearning();
let ocrLearningAvailable = true;
try { await ocrLearning.ready; } catch { ocrLearningAvailable = false; }
const localQwen = createLocalQwen();

// Lettore locale: OCR PaddleOCR/Tesseract, parser deterministici e suggerimenti Qwen facoltativi. Nessun upload dei documenti.
let _ocrModule=null;
async function loadOCR(onProgress){
 // Strict offline mode: SDK, worker, WASM core and language data must be
 // packaged with the application. Never inject scripts or fetch OCR assets.
 if(!window.Tesseract||typeof window.Tesseract.createWorker!=="function"){
  throw new Error("Tesseract offline non installato: SDK locale assente.");
 }
 onProgress?.({phase:"ocr",detail:"Avvio Tesseract con componenti locali…"});
 return window.Tesseract.createWorker(["ita","eng"],1,{
  workerPath:"./vendor/tesseract/worker.min.js",
  corePath:"./vendor/tesseract/",
  langPath:"./vendor/tesseract/lang/",
  logger:m=>onProgress?.({phase:"ocr",progress:Number.isFinite(m?.progress)?Math.round(m.progress*100):null,status:m?.status||"",detail:m?.status?("OCR: "+m.status):"Preparazione OCR…"})
 });
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
 try{for(let i=0;i<images.length;i++){onProgress?.({phase:"ocr-page",page:i+1,total:images.length});const r=await w.recognize(images[i]),structured=rowsFromWords(r?.data?.words),plain=String(r?.data?.text||"").trim(),t=[structured,plain?"TESTO OCR COMPLETO:\n"+plain:""].filter(Boolean).join("\n");if(t)pages.push("PAGINA "+(i+1)+":\n"+t)}}finally{try{await w.terminate()}catch(e){}}
 return pages.join("\n\n").slice(0,60000);
}

let _paddleCtor=null,_paddleInstance=null;
async function loadPaddleOCR(onProgress){
 // PaddleOCR is accepted only from a locally bundled module exposed by the app.
 // No dynamic CDN import, remote model resolution or network fallback is allowed.
 if(!_paddleCtor){
  _paddleCtor=Promise.resolve(window.PaddleOCR||null).then(m=>{
   if(!m||typeof m.create!=="function")throw new Error("SDK PaddleOCR offline non installato.");
   return m;
  }).catch(e=>{_paddleCtor=null;throw e});
 }
 const PaddleOCR=await _paddleCtor;
 if(!_paddleInstance){
  onProgress?.({phase:"paddle",detail:"Caricamento modello PaddleOCR italiano sul dispositivo…"});
  _paddleInstance=PaddleOCR.create({lang:"it",ocrVersion:"PP-OCRv6",ortOptions:{backend:"wasm"}})
   .catch(e=>{_paddleInstance=null;throw e});
 }
 return await _paddleInstance;
}
function rowsFromPaddle(items){
 const clean=(items||[]).filter(x=>String(x?.text||"").trim()).map((x,i)=>{
  const pts=(Array.isArray(x.poly)?x.poly:[]).map(p=>Array.isArray(p)?{x:Number(p[0]),y:Number(p[1])}:{x:Number(p?.x),y:Number(p?.y)}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const x0=xs.length?Math.min(...xs):i,x1=xs.length?Math.max(...xs):i+String(x.text).length;
  const y0=ys.length?Math.min(...ys):i,y1=ys.length?Math.max(...ys):i+14;
  return{text:String(x.text).trim(),x0,x1,y0,y1,y:(y0+y1)/2,h:Math.max(3,y1-y0)};
 });
 if(!clean.length)return "";
 const hs=clean.map(x=>x.h).sort((a,b)=>a-b),medH=hs[Math.floor(hs.length/2)]||14,tol=Math.max(2,medH*.42),rows=[];
 clean.sort((a,b)=>a.y-b.y||a.x0-b.x0);
 // Ricostruzione stabile delle righe: ogni parola viene confrontata con
 // l'ancora e il riquadro ORIGINALE della riga, mai con il riquadro allargato
 // dalle parole già aggiunte. In questo modo una sequenza di box parzialmente
 // sovrapposti non trascina più righe contigue dentro un'unica riga.
 for(const item of clean){
  let best=null,bestDistance=Infinity;
  for(const candidate of rows){
   const overlap=Math.max(0,Math.min(candidate.anchorY1,item.y1)-Math.max(candidate.anchorY0,item.y0));
   const minHeight=Math.min(candidate.anchorY1-candidate.anchorY0,item.h);
   const distance=Math.abs(candidate.anchor-item.y);
   if(distance<=tol||(minHeight>0&&overlap>=minHeight*.5)){
    if(distance<bestDistance){best=candidate;bestDistance=distance}
   }
  }
  let row=best;
  if(!row){row={anchor:item.y,anchorY0:item.y0,anchorY1:item.y1,y0:item.y0,y1:item.y1,items:[]};rows.push(row)}
  row.items.push(item);row.y0=Math.min(row.y0,item.y0);row.y1=Math.max(row.y1,item.y1);
 }
 rows.sort((a,b)=>a.anchor-b.anchor);
 const labelRules=[
  {re:/\b(?:paga\s*base|minimo\s*tabellare|minimo\s*contrattuale|retribuzione\s*base|retribuzione\s*tabellare|stipendio\s*base|minimo\s*ccnl)\b/i,name:"Paga base"},
  {re:/\bscatti(?:\s+(?:di\s+)?anzianita)?\b/i,name:"Scatti"}
 ];
 const otherLabelRe=/\b(?:paga\s*base|minimo\s*tabellare|minimo\s*contrattuale|retribuzione\s*base|retribuzione\s*tabellare|stipendio\s*base|minimo\s*ccnl|scatti|superminimo|elemento\s+distinto|indennita|ore\s+mensili|ore\s+contrattuali|straordinario|notturno|piantonamento|domenicale|buono\s+pasto|aliquota|trattenute)\b/i;
 const amountRe=/^\s*[€]?\s*[-+]?(?:[0-9OIl]{1,3}(?:[.\s][0-9OIl]{3})+|[0-9OIl]+)[,.][0-9OIl]{2,5}\s*[€]?\s*$/;
 const hints=[];
 for(const row of rows){
  const it=row.items.sort((a,b)=>a.x0-b.x0);
  const labelPositions=[];
  for(let j=0;j<it.length;j++)for(const rule of labelRules){
   if(rule.re.test(it[j].text))labelPositions.push({index:j,name:rule.name});
   else if(j+1<it.length&&rule.re.test(it[j].text+" "+it[j+1].text))labelPositions.push({index:j+1,name:rule.name});
  }
  const firstAmountIndex=it.findIndex(x=>amountRe.test(x.text));
  const labelsBefore=firstAmountIndex<0?[]:labelPositions.filter(x=>x.index<firstAmountIndex);
  const labelTypesBefore=new Set(labelsBefore.map(x=>x.name));
  // Se entrambe le etichette precedono la prima cifra, la riga non consente
  // un abbinamento sicuro: non associare nessuno dei due importi per posizione.
  if(labelTypesBefore.size>1)continue;
  for(const rule of labelRules)for(let i=0;i<it.length;i++){
   let labelEnd=i,labelText=it[i].text,labelX1=it[i].x1;
   if(!rule.re.test(labelText)&&i+1<it.length&&rule.re.test(labelText+" "+it[i+1].text)){
    labelEnd=i+1;labelText+=" "+it[i+1].text;labelX1=it[i+1].x1;
   }
   if(!rule.re.test(labelText))continue;
   const inline=labelText.match(rule.re);
   if(inline){
    const tail=labelText.slice(inline.index+inline[0].length);
    const stop=otherLabelRe.exec(tail);
    const part=stop?tail.slice(0,stop.index):tail;
    const m=part.match(/[-+]?(?:[0-9OIl]{1,3}(?:[.\s][0-9OIl]{3})+|[0-9OIl]+)[,.][0-9OIl]{2,5}/);
    if(m){hints.push(rule.name+": "+m[0]);continue}
   }
   const nextLabel=it.slice(labelEnd+1).find(x=>otherLabelRe.test(x.text));
   const boundary=nextLabel?nextLabel.x0:Infinity;
   const sameRow=it.slice(labelEnd+1).filter(x=>x.x0>=labelX1-2&&x.x0<boundary&&amountRe.test(x.text));
   if(sameRow.length===1){hints.push(rule.name+": "+sameRow[0].text.trim().replace(/€|\s/g,""));continue;}
   if(sameRow.length>1)continue;
   // Importo nella riga sottostante della stessa tabella: ricerca limitata
   // alla stessa fascia orizzontale e alle righe immediatamente vicine.
   const maxGap=Math.max(18,(hs[Math.floor(hs.length/2)]||14)*3.2);
   for(let ri=rows.indexOf(row)+1;ri<rows.length;ri++){
    const rr=rows[ri];if(rr.anchor-row.anchor>maxGap)break;
    const cells=rr.items.slice().sort((a,b)=>a.x0-b.x0);
    if(cells.some(x=>otherLabelRe.test(x.text)))break;
    // Nei cedolini l'etichetta è spesso nella colonna sinistra e l'importo
    // nella colonna destra: non limitare l'associazione alla larghezza della label.
    // Accetta la riga successiva solo se contiene un unico importo e nessun'altra voce.
    const nums=cells.filter(x=>amountRe.test(x.text));
    if(nums.length===1){hints.push(rule.name+": "+nums[0].text.trim().replace(/€|\s/g,""));break;}
    if(nums.length>1)break;
   }
  }
 } // Se Paga base e Scatti sono sulla stessa riga come intestazioni di due
 // colonne, abbina la prima riga numerica sottostante solo se contiene
 // esattamente due importi e nessun altro testo.
 const medianHeight=hs[Math.floor(hs.length/2)]||14;
 for(const row of rows){
  const labels=[],cells=row.items.slice().sort((a,b)=>a.x0-b.x0);
  for(let i=0;i<cells.length;i++)for(const rule of labelRules){
   let txt=cells[i].text,x0=cells[i].x0;
   if(!rule.re.test(txt)&&i+1<cells.length&&rule.re.test(txt+" "+cells[i+1].text)){txt+=" "+cells[i+1].text;x0=Math.min(x0,cells[i+1].x0)}
   if(rule.re.test(txt)&&!labels.some(x=>x.name===rule.name))labels.push({name:rule.name,x0});
  }
  if(labels.length!==2||new Set(labels.map(x=>x.name)).size!==2)continue;
  labels.sort((a,b)=>a.x0-b.x0);
  const rowIndex=rows.indexOf(row),maxGap=Math.max(45,medianHeight*7);
  for(let ri=rowIndex+1;ri<rows.length;ri++){
   const candidate=rows[ri];if(candidate.anchor-row.anchor>maxGap)break;
   const nextCells=candidate.items.slice().sort((a,b)=>a.x0-b.x0);
   if(nextCells.some(x=>otherLabelRe.test(x.text)))break;
   const amounts=nextCells.filter(x=>amountRe.test(x.text));
   if(!amounts.length)continue;
   if(amounts.length!==2||nextCells.some(x=>!amountRe.test(x.text)))break;
   labels.forEach((label,index)=>hints.push(label.name+": "+amounts[index].text.trim().replace(/€|\s/g,"")));
   break;
  }
 }
 const lines=[];
 // Le associazioni basate sulle coordinate vengono prima del testo lineare:
 // il parser può così preferirle senza indebolire i controlli sulle etichette.
 for(const h of new Set(hints))lines.push("ASSOCIAZIONE OCR POSIZIONALE: "+h);
 rows.forEach((r,i)=>lines.push("RIGA "+(i+1)+": "+r.items.map(x=>x.text).join(" | ")));
 return lines.join("\n");
}
async function ocrPayslipImages(images,onProgress){
 if(!images?.length)return "";
 const ocr=await loadPaddleOCR(onProgress),pages=[];
 for(let i=0;i<images.length;i++){
  onProgress?.({phase:"paddle-page",page:i+1,total:images.length});
  const results=await ocr.predict(images[i]),result=results?.[0],text=rowsFromPaddle(result?.items);
  if(text)pages.push("PAGINA "+(i+1)+":\n"+text);
 }
 return pages.join("\n\n").slice(0,60000);
}

const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function italianNumber(s){let t=String(s||"").replace(/[Oo]/g,"0").replace(/[Il]/g,"1").replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(t.includes(","))t=t.replace(/\./g,"").replace(",",".");else if((t.match(/\./g)||[]).length>1)t=t.replace(/\./g,"");const n=Number(t);return Number.isFinite(n)?n:null}
function labeledValue(lines,aliases,requireCents=false,detail=null){
 const keys=aliases.map(norm).sort((a,b)=>b.length-a.length);
 // Paga base e Scatti devono avere i centesimi: non accettare cifre isolate o "1,2".
 const number=requireCents
  ? /[-+]?(?:[0-9OIl]{1,3}(?:(?:\s*\.\s*|\s+)[0-9OIl]{3})+|[0-9OIl]+)(?:\s*,\s*[0-9OIl]{2,5}|\s*\.\s*[0-9OIl]{2})(?![0-9OIl])/
  : /[-+]?(?:[0-9OIl]{1,3}(?:(?:\s*\.\s*|\s+)[0-9OIl]{3})+|[0-9OIl]+)(?:\s*,\s*[0-9OIl]{2,5}|\s*\.\s*[0-9OIl]{2})?/;
 const stop=/\b(?:data assunzione|assunzione|matricola|codice fiscale|periodo paga|paga base|minimo tabellare|minimo contrattuale|retribuzione base|retribuzione tabellare|stipendio base|minimo ccnl|scatti|superminimo|elemento distinto|indennita fissa|ore mensili|orario mensile|ore contrattuali|ore turno|durata turno|maggiorazione straordinario|straordinario|indennita notturna|piantonamento|maggiorazione domenicale|riposo non goduto|buono pasto|aliquota inps|aliquota irpef|sindacato|cessione del quinto|altre trattenute|ferie maturate|ferie godute|ferie residue|residuo ferie|permessi maturati|permessi goduti|permessi usufruiti|permessi utilizzati|permessi residui|residuo permessi)\b/i;
 const rows=lines.map(x=>norm(String(x||"").replace(/^\s*(?:PAGINA|PAG\.)\s*\d+\s*:?\s*/i,"").replace(/^\s*RIGA\s*\d+\s*:?\s*/i,"").replace(/\u00a0/g," ").replace(/\s*\|\s*/g," ")));
 const valueOf=s=>{const m=String(s||"").match(number);if(!m)return null;const n=italianNumber(m[0]);return n!==null&&n>0?n:null};
 for(const alias of keys){
  const safeAlias=alias.replace(/[.*+?^${}()|[\]]/g,"\\$&").replace(/\\/g,"\\\\");const label=new RegExp("(^|[^a-z])"+safeAlias.split(/\s+/).join("\\s+")+"(?=$|[^a-z])","i");
  for(let i=0;i<rows.length;i++){
   const hit=label.exec(rows[i]);if(!hit)continue;
   // Quando più etichette precedono tutti gli importi nella stessa riga,
   // il testo lineare non permette di sapere quale cifra appartenga a quale voce.
   // In tal caso si accettano soltanto eventuali associazioni posizionali certe.
   const pLabel=rows[i].search(/\bpaga\s*base\b/i),sLabel=rows[i].search(/\bscatti\b/i),firstAmount=rows[i].search(number);
   if(pLabel>=0&&sLabel>=0&&firstAmount>=0&&Math.max(pLabel,sLabel)<firstAmount)continue;
   let tail=rows[i].slice(hit.index+hit[0].length).replace(/^[\s|:;=€]+/,"");
   const sameRowBoundary=stop.exec(tail);
   if(sameRowBoundary)tail=tail.slice(0,sameRowBoundary.index);
   // Accetta solo un importo immediatamente dopo l'etichetta:
   // se OCR ha inserito parole (Giorni, Residuo AP, INPS, ecc.)
   // il numero successivo può appartenere a un'altra colonna/voce.
   const immediate=/^[-+]?(?:[0-9OIl]{1,3}(?:(?:\s*\.\s*|\s+)[0-9OIl]{3})+|[0-9OIl]+)(?:\s*,\s*[0-9OIl]{2,5}|\s*\.\s*[0-9OIl]{2})(?![0-9OIl])/.test(tail);
   let value=immediate?valueOf(tail):null;if(value!==null){if(detail)Object.assign(detail,{matchedAlias:alias,source:lines[i],value});return value;}
   if(sameRowBoundary)continue;
   // Accetta la riga immediatamente successiva solo se contiene esclusivamente
   // un importo: evita di confondere Paga base con Scatti o altre voci.
   const next=rows[i+1]||"";
   if(next&&!/[a-z]/i.test(next)){
    const nextValue=valueOf(next);
    if(nextValue!==null){if(detail)Object.assign(detail,{matchedAlias:alias,source:lines[i]+" / "+next,value:nextValue});return nextValue;}
   }
   // Non cercare importi più lontani: potrebbero appartenere a un'altra voce.
  }
 }
 return null;
}
function parseContractProfile(text){
 const raw=String(text||""),n=norm(raw),profile={};
 // Il codice CNEL o la denominazione contrattuale completa hanno priorità:
 // la sola mansione "portiere" non determina il CCNL applicato.
 if(/\bhv17\b/.test(n)||/ccnl\s+vigilanza privata\b/.test(n)||/vigilanza privata e servizi di sicurezza/.test(n)||/vigilanza privata e servizi fiduciari/.test(n))profile.ccnl="HV17";
 if(profile.ccnl==="HV17"){
  if(/guardia particolare giurata|\bgpg\b|vigilanza privata armata|servizi di vigilanza armata/.test(n))profile.section="vigilanza_armata";
  else if(/servizi fiduciari|portierato|vigilanza non armata/.test(n))profile.section="servizi_fiduciari";
  else if(/servizi di sicurezza/.test(n))profile.section="servizi_sicurezza";
 }
 const level=raw.match(/\b(?:livello|inquadramento)\s*(?:contrattuale)?\s*[:\-]?\s*(Q|[1-6]|[A-E])\b/i);
 if(level)profile.level=level[1].toUpperCase();
 const role=raw.match(/^\s*(?:mansione|qualifica|profilo professionale)\s*[:\-]\s*([^\r\n|]{2,90})/im);
 if(role)profile.role=role[1].trim().replace(/\s+/g," ").slice(0,90);
 return profile;
}
function findPayrollLabelCandidates(text,customAliases){
 const known=["paga base","minimo tabellare","minimo contrattuale","retribuzione base","retribuzione tabellare","stipendio base","minimo ccnl","scatti","superminimo","elemento distinto","indennita fissa","ore mensili","orario mensile","ore contrattuali","ore turno","durata turno","maggiorazione straordinario","straordinario","indennita notturna","notturno","piantonamento","maggiorazione domenicale","lavoro domenicale","riposo non goduto","buono pasto","ticket restaurant","aliquota inps","inps","aliquota irpef","irpef","sindacato","cessione del quinto","altre trattenute","retribuzione","lavoro ordinario","totale competenze","totale trattenute","imponibile","contributi","irpef lorda","netto in busta","totale netto","ferie godute","permessi","tfr","data assunzione","matricola","codice fiscale","periodo paga","ore lavorate"];
 Object.values(customAliases||{}).forEach(a=>{if(Array.isArray(a))known.push(...a)});
 const normLabel=s=>norm(s).replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
 const isAmount=s=>/^\s*[€]?\s*[-+]?(?:[0-9OIl]{1,3}(?:[.\s][0-9OIl]{3})+|[0-9OIl]+)(?:[,.][0-9OIl]{2,5})\s*[€]?\s*$/.test(s);
 const raw=String(text||"").split(/\r?\n/).map(x=>x.replace(/^\s*(?:PAGINA|PAG\.)\s*\d+\s*:?\s*/i,"").replace(/^\s*RIGA\s*\d+\s*:?\s*/i,"").replace(/\s*\|\s*/g," ").trim()).filter(Boolean);
 const out=[],seen=new Set();
 const add=s=>{const label=String(s||"").replace(/[€£$]/g," ").replace(/[-+]?(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:[,.]\d+)?/g," ").replace(/[:;=|]+/g," ").replace(/\s+/g," ").trim().replace(/^[^a-zà-ÿ]+|[^a-zà-ÿ]+$/gi,"").slice(0,55);const n=normLabel(label);if(label.length<3||label.length>55||!/[a-zà-ÿ]{3}/i.test(label)||known.some(k=>{const q=normLabel(k);return q&&(" "+n+" ").includes(" "+q+" ")} )||seen.has(n))return;seen.add(n);out.push(label)};
 for(let i=0;i<raw.length;i++){const line=raw[i],letters=(line.match(/[a-zà-ÿ]/gi)||[]).length;if(letters<3||letters>55)continue;if(isAmount(line)){if(i>0)add(raw[i-1]);continue}if(/\d/.test(line)){const stripped=line.replace(/[-+]?(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:[,.]\d+)?/g," ");if(stripped!==line)add(stripped);continue}if(i+1<raw.length&&isAmount(raw[i+1]))add(line)}
 return out.slice(0,12);
}
function parsePayslip(text,fields,customAliases){
 if(ocrLearningAvailable&&ocrLearning.applyEnabled){
  text=ocrLearning.applyAliases(text,"payroll");
  const merged={...(customAliases||{})};
  for(const rule of ocrLearning.list("payroll"))(merged[rule.field]||(merged[rule.field]=[])).push(rule.alias);
  customAliases=merged;
 }
 const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").replace(/\s*\|\s*/g," ").trim()).filter(Boolean),aliases={
 paga_base:["paga base","minimo tabellare","minimo contrattuale","retribuzione base","retribuzione tabellare","stipendio base","minimo ccnl","minimo contrattuale mensile"],scatti:["scatti","scatti anzianita","scatti di anzianita"],altre_fisse:["superminimo","elemento distinto","indennita fissa","altre voci fisse"],ore_mensili:["ore mensili","orario mensile","ore contrattuali"],ore_turno:["ore turno","durata turno","ore giornaliere"],straordinario_perc:["maggiorazione straordinario","straordinario %","maggiorazione straord"],straordinario_ora:["straordinario euro ora","straordinario orario","compenso straordinario"],notturno_turno:["indennita notturna","maggiorazione notturno","notturno turno"],piantonato_turno:["piantonamento","indennita piantonamento"],domenica_ora:["maggiorazione domenicale","lavoro domenicale","domenica ora"],riposo_non_goduto:["riposo non goduto","riposo lavorato","festivita non goduta"],buono_pasto:["buono pasto","ticket restaurant","ticket"],inps_rate:["aliquota inps","inps %","contributi ivs"],irpef_rate:["aliquota irpef","irpef %","ritenuta irpef"],sindacato:["trattenuta sindacale","sindacato"],cessione:["cessione quinto","cessione del quinto"],altre_trattenute:["altre trattenute","totale trattenute"]};
 // Alcuni PDF/OCR spezzano anche le etichette su righe consecutive
 // (ad esempio "Paga" / "base" / "1.468,88000"). Aggiunge finestre
 // di righe adiacenti senza cambiare l'ordine del testo originale.
 const scanLines=lines.slice();
 for(let width=2;width<=4;width++)for(let i=0;i+width<=lines.length;i++)scanLines.push(lines.slice(i,i+width).join(" "));
 const out={};
 out.details={};
 out.leave={ferie:{maturate:null,godute:null,residue:null},permessi:{maturate:null,godute:null,residue:null}};
 const leaveLabels={ferie:{maturate:['ferie maturate','maturazione ferie','maturato ferie'],godute:['ferie godute','godimento ferie','goduto ferie'],residue:['ferie residue','residuo ferie','saldo ferie']},permessi:{maturate:['permessi maturati','maturazione permessi','maturato permessi'],godute:['permessi goduti','godimento permessi','permessi usufruiti','permessi utilizzati'],residue:['permessi residui','residuo permessi','saldo permessi']}};
 for(const [group,items] of Object.entries(leaveLabels))for(const [kind,names] of Object.entries(items)){const detail={};const value=labeledValue(scanLines,names,false,detail);if(value!==null){out.leave[group][kind]=value;out.details['leave_'+group+'_'+kind]=detail}}
 const cellRows=String(text||"").split(/\r?\n/).map((line,index)=>({line:line.trim(),index,cells:String(line).replace(/^\s*RIGA\s*\d+\s*:\s*/i,"").split("|").map(x=>x.trim()).filter(Boolean)})).filter(x=>x.line);
 const amountCell=s=>/^\s*[€]?\s*[-+]?(?:[0-9OIl]{1,3}(?:[.\s][0-9OIl]{3})+|[0-9OIl]+)[,.][0-9OIl]{2,5}\s*[€]?\s*$/.test(String(s||""));
 const headerPositions=row=>{const found={},cells=row.cells;for(let i=0;i<cells.length;i++){const one=norm(cells[i]),two=norm(cells[i]+" "+(cells[i+1]||""));if(found.paga_base===undefined&&(/\bpaga\s+base\b/.test(one)||/\bpaga\s+base\b/.test(two)))found.paga_base=i;if(found.scatti===undefined&&/\bscatti(?:\s+(?:di\s+)?anzianita)?\b/.test(one))found.scatti=i}return found};
 // Prima modalità tabellare: etichetta e importo sono celle adiacenti
 // sulla stessa riga OCR. Se entrambe le intestazioni precedono tutti gli
 // importi, si tratta di una riga-intestazione: usa la logica per righe sotto.
 const tableLabelAt=(cells,i)=>{
  const one=norm(cells[i]||""),two=norm((cells[i]||"")+" "+(cells[i+1]||""));
  if(/\bpaga\s+base\b/.test(one))return {key:"paga_base",end:i};
  if(/\bpaga\s+base\b/.test(two))return {key:"paga_base",end:i+1};
  if(/\bscatti(?:\s+(?:di\s+)?anzianita)?\b/.test(one))return {key:"scatti",end:i};
  return null;
 };
 for(const row of cellRows){
  const cells=row.cells,labelPositions=[];
  for(let i=0;i<cells.length;i++){const label=tableLabelAt(cells,i);if(label)labelPositions.push(label)}
  const firstAmountIndex=cells.findIndex(amountCell);
  const headerOnly=labelPositions.some(x=>x.key==="paga_base")&&labelPositions.some(x=>x.key==="scatti")&&firstAmountIndex>=0&&labelPositions.every(x=>x.end<firstAmountIndex);
  if(headerOnly)continue;
  for(let i=0;i<cells.length;i++){
   const label=tableLabelAt(cells,i);if(!label||out[label.key]!==undefined)continue;
   const valueCell=cells[label.end+1];if(!amountCell(valueCell))continue;
   const value=italianNumber(valueCell);if(value===null||value<=0)continue;
   out[label.key]=value;
   out.details[label.key]={matchedAlias:label.key==="paga_base"?"Paga base":"Scatti",source:row.line,value,method:"celle adiacenti sulla stessa riga"};
  }
 }
 for(let i=0;i<cellRows.length;i++){const row=cellRows[i],heads=headerPositions(row);if(heads.paga_base===undefined||heads.scatti===undefined||heads.paga_base===heads.scatti)continue;for(let j=i+1;j<Math.min(cellRows.length,i+5);j++){const candidate=cellRows[j],cells=candidate.cells;if(cells.some(c=>/\b(?:data\s+assunzione|assunzione|matricola|codice\s+fiscale|periodo\s+paga)\b/i.test(norm(c))))break;if(cells.some(c=>/\b(?:superminimo|indennita|straordinario|notturno|piantonamento|domenicale|buono\s+pasto|trattenute|retribuzione|ferie|permessi|totale)\b/i.test(norm(c))))break;const amounts=cells.filter(amountCell);if(amounts.length!==2)continue;const values=amounts.map(italianNumber);if(values.some(v=>v===null||v<=0))continue;const pairs=heads.paga_base<heads.scatti?{paga_base:values[0],scatti:values[1]}:{paga_base:values[1],scatti:values[0]};Object.entries(pairs).forEach(([key,value])=>{if(out[key]===undefined){out[key]=value;out.details[key]={matchedAlias:key==="paga_base"?"Paga base":"Scatti",source:row.line+" / "+candidate.line,value,method:"associazione per colonne"}}});break}}
 for(const [key] of fields){if(out[key]!==undefined)continue;const custom=Array.isArray(customAliases?.[key])?customAliases[key].filter(x=>typeof x==="string"&&x.trim()).slice(0,40):[],detail={};const v=labeledValue(scanLines,[...(aliases[key]||[key.replace(/_/g," ")]),...custom],key==="paga_base"||key==="scatti",detail);if(v!==null){out[key]=v;out.details[key]=detail}}
 // La paga base si legge solo da un'etichetta contrattuale esplicita.
 // Non usare il totale di LAVORO ORDINARIO: può riferirsi a pochi giorni e non alla base mensile.
 out.profile=parseContractProfile(text);
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
 // Turni: nessuna etichetta appresa può trasformare note/flag in campi calendario.
 const out=[],seen=new Set(),dateRe=/\b(?:\d{1,2}[/. -]\d{1,2}[/. -](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b/g;
 const timeRe=/\b([01]?\d|2[0-3])\s*[:,.]\s*([0-5]\d)\b/g;
 const lines=String(text||"").replace(/\r/g,"\n").split("\n");let currentDate="",periodStart="";
 const addShift=(date,segment,start,end,postRaw)=>{
  // Residual row text is not proof of a Postazione column: accept only an explicit label.
  const labelled=String(postRaw||"").match(/POSTAZIONE\s*:\s*([^|;]+)/i);
  const post=labelled?labelled[1].replace(/\s+/g," ").trim().slice(0,120):"";
  const x={date,type:"turno",post,start_time:start,end_time:end,piantonamento:false,notturno:false,ore:0};
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
  if(matches.length>=2){const sharedPost=segment.replace(timeRe," ").replace(/\s+/g," ").trim();for(let i=0;i+1<matches.length;i+=2){const a=matches[i],b=matches[i+1],next=matches[i+2],start=String(a[1]).padStart(2,"0")+":"+a[2],end=String(b[1]).padStart(2,"0")+":"+b[2],localPost=segment.slice(b.index+b[0].length,next?next.index:segment.length);addShift(currentDate,segment,start,end,localPost.trim()?localPost:sharedPost)}continue}
 }
 return out;
}
function parseTraining(text){
 if(ocrLearningAvailable&&ocrLearning.applyEnabled)text=ocrLearning.applyAliases(text,"training");
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
 const normalizedTitle=ocrLearning.normalizeWrittenValue("text",title||(/formazione/.test(norm(all))?"Formazione":""));
 const normalizedProvider=ocrLearning.normalizeWrittenValue("text",provider);
 return{title:normalizedTitle,provider:normalizedProvider,date:ocrLearning.normalizeWrittenValue("date",date),expiry:ocrLearning.normalizeWrittenValue("date",expiry),hours:hm?italianNumber(hm[1]):null};
}
window.LocalDocAI={
 ocrImages,ocrPayslipImages,parsePayslip,findPayrollLabelCandidates,parseTurns,parseTraining,
 learning:{
  available:()=>ocrLearningAvailable,
  list:kind=>ocrLearningAvailable?ocrLearning.list(kind):[],
  addAlias:input=>ocrLearningAvailable?ocrLearning.addAlias(input):Promise.reject(new Error("Archivio apprendimento non disponibile")),
  removeAlias:id=>ocrLearningAvailable?ocrLearning.removeAlias(id):Promise.reject(new Error("Archivio apprendimento non disponibile")),
  clear:()=>ocrLearningAvailable?ocrLearning.clear():Promise.reject(new Error("Archivio apprendimento non disponibile")),
  setApplyEnabled:value=>ocrLearningAvailable&&ocrLearning.setApplyEnabled(value),
  normalizeWrittenValue:(type,value)=>ocrLearning.normalizeWrittenValue(type,value)
 }
};

function mountLocalLearningUI(){
 const anchor=document.getElementById("aistat");
 if(!anchor||document.getElementById("ocrLearningPanel"))return;
 const kinds={
  payroll:{label:"Busta paga",fields:[["paga_base","Paga base"],["scatti","Scatti"],["altre_fisse","Altre voci fisse"],["ore_mensili","Ore mensili"],["ore_turno","Ore turno"],["straordinario_perc","Maggiorazione straordinario"],["straordinario_ora","Compenso straordinario"],["notturno_turno","Indennità notturna"],["piantonato_turno","Piantonamento"],["domenica_ora","Maggiorazione domenicale"],["riposo_non_goduto","Riposo non goduto"],["buono_pasto","Buono pasto"],["inps_rate","Aliquota INPS"],["irpef_rate","Aliquota IRPEF"],["sindacato","Trattenuta sindacale"],["cessione","Cessione del quinto"],["altre_trattenute","Altre trattenute"]]},
  turns:{label:"Turni",fields:[["turno","Turno"],["riposo","Riposo"],["riposo_compensativo","Riposo compensativo"],["ferie","Ferie"],["permesso","Permesso"],["malattia","Malattia"]]},
  training:{label:"Formazione",fields:[["title","Titolo corso"],["issuer","Ente"],["date","Data"],["expiry","Scadenza"],["hours","Durata"]]}
 };
 const panel=document.createElement("details");
 panel.id="ocrLearningPanel";
 panel.className="upc";
 panel.style.marginTop="10px";
 const summary=document.createElement("summary");
 summary.textContent="Modalità apprendimento locale";
 panel.append(summary);
 const intro=document.createElement("p");
 intro.className="hint";
 intro.textContent="Impara solo etichette generiche e formati. Non salva PDF, foto, testo OCR, importi o dati personali. Le correzioni vengono applicate ai documenti successivi solo tramite i parser e le anteprime già esistenti.";
 panel.append(intro);
 const applyLabel=document.createElement("label");
 const apply=document.createElement("input");apply.type="checkbox";apply.checked=true;apply.disabled=!ocrLearningAvailable;
 apply.addEventListener("change",()=>ocrLearning.setApplyEnabled(apply.checked));
 applyLabel.append(apply,document.createTextNode(" Usa le regole locali approvate"));
 panel.append(applyLabel);
 const kind=document.createElement("select");
 Object.entries(kinds).forEach(([value,item])=>{const option=document.createElement("option");option.value=value;option.textContent=item.label;kind.append(option)});
 const field=document.createElement("select");
 const updateFields=()=>{field.replaceChildren();for(const [value,label] of kinds[kind.value].fields){const option=document.createElement("option");option.value=value;option.textContent=label;field.append(option)}};
 kind.addEventListener("change",updateFields);updateFields();
 const alias=document.createElement("input");alias.type="text";alias.maxLength=48;alias.autocomplete="off";alias.placeholder="Etichetta generica letta dal documento";
 const save=document.createElement("button");save.type="button";save.textContent="Salva regola";
 const form=document.createElement("div");form.className="row";form.style.marginTop="8px";
 form.append(kind,field,alias,save);panel.append(form);
 const note=document.createElement("p");note.className="hint";note.textContent="Esempio: associa “retribuzione contrattuale” a “Paga base”. Non inserire nomi, codici, date o importi.";
 panel.append(note);
 const qwenRow=document.createElement("div");qwenRow.className="row";qwenRow.style.marginTop="8px";
 const qwenInit=document.createElement("button");qwenInit.type="button";qwenInit.textContent="Prepara Qwen locale";
 const qwenAutoLabel=document.createElement("label");const qwenAuto=document.createElement("input");qwenAuto.type="checkbox";qwenAuto.disabled=true;
 qwenAutoLabel.append(qwenAuto,document.createTextNode(" Suggerisci etichette durante la lettura"));
 qwenRow.append(qwenInit,qwenAutoLabel);panel.append(qwenRow);
 const qwenStatus=document.createElement("p");qwenStatus.className="hint";qwenStatus.textContent="Qwen è facoltativo e funziona soltanto con runtime e modello già installati localmente. Nessun download, CDN o servizio remoto è consentito.";
 panel.append(qwenStatus);
 const suggestions=document.createElement("div");suggestions.className="hint";panel.append(suggestions);
 const status=document.createElement("p");status.className="hint";status.setAttribute("role","status");panel.append(status);
 const rules=document.createElement("div");panel.append(rules);
 const clear=document.createElement("button");clear.type="button";clear.textContent="Cancella tutte le regole apprese";clear.className="ic";panel.append(clear);
 anchor.parentElement?.after(panel);
 let lastKind="payroll";
 const fieldLabel=(k,f)=>kinds[k]?.fields.find(x=>x[0]===f)?.[1]||f;
 const renderRules=()=>{
  rules.replaceChildren();
  if(!ocrLearningAvailable){status.textContent="Archivio locale non disponibile: la modalità apprendimento è disattivata.";return}
  const all=ocrLearning.list();
  if(!all.length){const empty=document.createElement("p");empty.className="hint";empty.textContent="Nessuna regola appresa. Puoi aggiungere un'etichetta corretta o approvare un suggerimento Qwen.";rules.append(empty);return}
  for(const rule of all){
   const row=document.createElement("div");row.className="row";row.style.justifyContent="space-between";
   const text=document.createElement("span");text.textContent=rule.alias+" → "+fieldLabel(rule.kind,rule.field);
   const remove=document.createElement("button");remove.type="button";remove.className="ic";remove.textContent="Rimuovi";
   remove.addEventListener("click",async()=>{try{await ocrLearning.removeAlias(rule.id);renderRules();status.textContent="Regola rimossa."}catch{status.textContent="Non sono riuscito a rimuovere la regola."}});
   row.append(text,remove);rules.append(row);
  }
 };
 save.addEventListener("click",async()=>{
  try{await ocrLearning.addAlias({kind:kind.value,field:field.value,alias:alias.value});alias.value="";status.textContent="Regola salvata solo in IndexedDB su questo dispositivo.";renderRules()}
  catch(error){status.textContent=error?.message||"Etichetta non valida."}
 });
 clear.addEventListener("click",async()=>{
  if(!confirm("Cancellare tutte le regole generiche apprese su questo dispositivo?"))return;
  try{await ocrLearning.clear();suggestions.replaceChildren();status.textContent="Regole locali cancellate.";renderRules()}
  catch{status.textContent="Non sono riuscito a cancellare l'archivio locale."}
 });
 qwenInit.addEventListener("click",async()=>{
  qwenInit.disabled=true;qwenStatus.textContent="Avvio Qwen locale…";
  try{const result=await localQwen.init(message=>{qwenStatus.textContent=message});qwenStatus.textContent="Qwen pronto su "+result.backend+". Il testo dei documenti viene elaborato localmente.";qwenAuto.disabled=false;qwenInit.textContent="Qwen locale pronto"}
  catch(error){qwenStatus.textContent="Qwen non disponibile: "+String(error?.message||error).slice(0,160);qwenInit.disabled=false}
 });
 const originalRead=window.readDocumentText;
 if(typeof originalRead==="function"&&!originalRead.__ocrLearningWrapped){
  const wrappedRead=async function(file,readerStatus,documentKind){
   const text=await originalRead.apply(this,arguments);
   lastKind=documentKind==="p"?"payroll":documentKind==="t"?"turns":"training";
   suggestions.replaceChildren();
   if(qwenAuto.checked&&localQwen.ready){
    try{
     const proposed=await localQwen.suggestAliases(text,lastKind,message=>{qwenStatus.textContent=message});
     if(proposed.length){
      const heading=document.createElement("p");heading.textContent="Etichette candidate da verificare (nessuna viene salvata automaticamente):";suggestions.append(heading);
      for(const item of proposed){
       const row=document.createElement("div");row.className="row";row.style.justifyContent="space-between";
       const label=document.createElement("span");label.textContent=item.alias+" → "+fieldLabel(item.kind,item.field);
       const accept=document.createElement("button");accept.type="button";accept.textContent="Approva";
       accept.addEventListener("click",async()=>{try{await ocrLearning.addAlias(item);accept.disabled=true;accept.textContent="Salvata";renderRules()}catch(error){status.textContent=error?.message||"Suggerimento non salvato"}});
       row.append(label,accept);suggestions.append(row);
      }
     }else{suggestions.textContent="Qwen non ha trovato etichette generiche nuove e verificabili."}
    }catch(error){qwenStatus.textContent="Suggerimenti non disponibili: "+String(error?.message||error).slice(0,140)}
   }
   return text;
  };
  wrappedRead.__ocrLearningWrapped=true;
  window.readDocumentText=wrappedRead;
 }
 renderRules();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountLocalLearningUI,{once:true});
else mountLocalLearningUI();

