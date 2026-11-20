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
 try{for(let i=0;i<images.length;i++){onProgress?.({phase:"ocr-page",page:i+1,total:images.length});const r=await w.recognize(images[i]),structured=rowsFromWords(r?.data?.words),plain=String(r?.data?.text||"").trim(),t=[structured,plain?"TESTO OCR COMPLETO:\n"+plain:""].filter(Boolean).join("\n");if(t)pages.push("PAGINA "+(i+1)+":\n"+t)}}finally{try{await w.terminate()}catch(e){}}
 return pages.join("\n\n").slice(0,60000);
}

let _paddleCtor=null,_paddleInstance=null;
async function loadPaddleOCR(onProgress){
 if(!_paddleCtor){
  _paddleCtor=import("https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm")
   .then(m=>{if(!m.PaddleOCR)throw new Error("SDK PaddleOCR non disponibile");return m.PaddleOCR})
   .catch(e=>{_paddleCtor=null;throw e});
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
 const hs=clean.map(x=>x.h).sort((a,b)=>a-b),tol=Math.max(2,(hs[Math.floor(hs.length/2)]||14)*.28),rows=[];
 clean.sort((a,b)=>a.y-b.y||a.x0-b.x0);
 // Le righe sono raggruppate con sovrapposizione verticale delle caselle,
 // non con una tolleranza ampia che può fondere due voci contigue.
 for(const item of clean){
  let row=rows.find(r=>{
   const overlap=Math.max(0,Math.min(r.y1,item.y1)-Math.max(r.y0,item.y0));
   return overlap>=Math.min(r.y1-r.y0,item.h)*.32||Math.abs(r.anchor-item.y)<=tol;
  });
  if(!row){row={anchor:item.y,y0:item.y0,y1:item.y1,items:[]};rows.push(row)}
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
   if(sameRow.length===1){hints.push(rule.name+": "+sameRow[0].text.trim().replace(/€|\\s/g,""));continue;}
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
    if(nums.length===1){hints.push(rule.name+": "+nums[0].text.trim().replace(/€|\\s/g,""));break;}
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
   labels.forEach((label,index)=>hints.push(label.name+": "+amounts[index].text.trim().replace(/€|\\s/g,"")));
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
 const stop=/\b(?:data assunzione|assunzione|matricola|codice fiscale|periodo paga|paga base|minimo tabellare|minimo contrattuale|retribuzione base|retribuzione tabellare|stipendio base|minimo ccnl|scatti|superminimo|elemento distinto|indennita fissa|ore mensili|orario mensile|ore contrattuali|ore turno|durata turno|maggiorazione straordinario|straordinario|indennita notturna|piantonamento|maggiorazione domenicale|riposo non goduto|buono pasto|aliquota inps|aliquota irpef|sindacato|cessione del quinto|altre trattenute)\b/i;
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
   let value=valueOf(tail);if(value!==null){if(detail)Object.assign(detail,{matchedAlias:alias,source:lines[i],value});return value;}
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
 const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/^RIGA \d+:\s*/i,"").replace(/^Riga \d+:\s*/i,"").replace(/\s*\|\s*/g," ").trim()).filter(Boolean),aliases={
 paga_base:["paga base","minimo tabellare","minimo contrattuale","retribuzione base","retribuzione tabellare","stipendio base","minimo ccnl","minimo contrattuale mensile"],scatti:["scatti","scatti anzianita","scatti di anzianita"],altre_fisse:["superminimo","elemento distinto","indennita fissa","altre voci fisse"],ore_mensili:["ore mensili","orario mensile","ore contrattuali"],ore_turno:["ore turno","durata turno","ore giornaliere"],straordinario_perc:["maggiorazione straordinario","straordinario %","maggiorazione straord"],straordinario_ora:["straordinario euro ora","straordinario orario","compenso straordinario"],notturno_turno:["indennita notturna","maggiorazione notturno","notturno turno"],piantonato_turno:["piantonamento","indennita piantonamento"],domenica_ora:["maggiorazione domenicale","lavoro domenicale","domenica ora"],riposo_non_goduto:["riposo non goduto","riposo lavorato","festivita non goduta"],buono_pasto:["buono pasto","ticket restaurant","ticket"],inps_rate:["aliquota inps","inps %","contributi ivs"],irpef_rate:["aliquota irpef","irpef %","ritenuta irpef"],sindacato:["trattenuta sindacale","sindacato"],cessione:["cessione quinto","cessione del quinto"],altre_trattenute:["altre trattenute","totale trattenute"]};
 // Alcuni PDF/OCR spezzano anche le etichette su righe consecutive
 // (ad esempio "Paga" / "base" / "1.468,88000"). Aggiunge finestre
 // di righe adiacenti senza cambiare l'ordine del testo originale.
 const scanLines=lines.slice();
 for(let width=2;width<=4;width++)for(let i=0;i+width<=lines.length;i++)scanLines.push(lines.slice(i,i+width).join(" "));
 const out={};
 out.details={};
 const cellRows=String(text||"").split(/\r?\n/).map((line,index)=>({line:line.trim(),index,cells:String(line).replace(/^\s*RIGA\s*\d+\s*:\s*/i,"").split("|").map(x=>x.trim()).filter(Boolean)})).filter(x=>x.line);
 const amountCell=s=>/^\s*[€]?\s*[-+]?(?:[0-9OIl]{1,3}(?:[.\s][0-9OIl]{3})+|[0-9OIl]+)[,.][0-9OIl]{2,5}\s*[€]?\s*$/.test(String(s||""));
 const headerPositions=row=>{const found={},cells=row.cells;for(let i=0;i<cells.length;i++){const one=norm(cells[i]),two=norm(cells[i]+" "+(cells[i+1]||""));if(found.paga_base===undefined&&(/\bpaga\s+base\b/.test(one)||/\bpaga\s+base\b/.test(two)))found.paga_base=i;if(found.scatti===undefined&&/\bscatti(?:\s+(?:di\s+)?anzianita)?\b/.test(one))found.scatti=i}return found};
 for(let i=0;i<cellRows.length;i++){const row=cellRows[i],heads=headerPositions(row);if(heads.paga_base===undefined||heads.scatti===undefined||heads.paga_base===heads.scatti)continue;for(let j=i+1;j<Math.min(cellRows.length,i+5);j++){const candidate=cellRows[j],cells=candidate.cells;if(cells.some(c=>/\b(?:data\s+assunzione|assunzione|matricola|codice\s+fiscale|periodo\s+paga)\b/i.test(norm(c))))break;const amounts=cells.filter(amountCell);if(amounts.length!==2||cells.some(c=>!amountCell(c)))continue;const values=amounts.map(italianNumber);if(values.some(v=>v===null||v<=0))continue;const pairs=heads.paga_base<heads.scatti?{paga_base:values[0],scatti:values[1]}:{paga_base:values[1],scatti:values[0]};Object.entries(pairs).forEach(([key,value])=>{if(out[key]===undefined){out[key]=value;out.details[key]={matchedAlias:key==="paga_base"?"Paga base":"Scatti",source:row.line+" / "+candidate.line,value,method:"associazione per colonne"}}});break}}
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
 const out=[],seen=new Set(),dateRe=/\b(?:\d{1,2}[/. -]\d{1,2}[/. -](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b/g;
 const timeRe=/\b([01]?\d|2[0-3])\s*[:,.]\s*([0-5]\d)\b/g;
 const lines=String(text||"").replace(/\r/g,"\n").split("\n");let currentDate="",periodStart="";
 const addRest=(date,type,raw)=>{const x={date,type,post:"",start_time:"",end_time:"",piantonamento:false,notturno:false,ore:0};const key=[date,type,norm(raw)].join("|");if(!seen.has(key)){seen.add(key);out.push(x)}};
 const addShift=(date,segment,start,end,postRaw)=>{
  let post=String(postRaw||"").replace(/\s*\|\s*/g," ").replace(/\bVIGILANZA\s+FISSA\b/ig," ").replace(/\bAOUC\s+POLICLINICO\s+BARI\b/ig," ").replace(/\b(?:lun|mar|mer|gio|ven|sab|dom)(?:ed[iì])?\.?\b/ig," ").replace(/\s+/g," ").replace(/^[\s|,:;.-]+|[\s|,:;.-]+$/g,"").trim();
  const n=norm(segment),x={date,type:"turno",post:post.slice(0,120),start_time:start,end_time:end,piantonamento:/piant/i.test(n+" "+norm(post)),notturno:false,ore:0};x.notturno=+end.slice(0,2)<+start.slice(0,2);
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
window.LocalDocAI={ocrImages,ocrPayslipImages,parsePayslip,findPayrollLabelCandidates,parseTurns,parseTraining};
