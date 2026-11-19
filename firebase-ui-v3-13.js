const cfg=window.TURNI_FIREBASE_CONFIG;
if(cfg?.enabled){
 const gate=document.getElementById("pg_gate"),host=document.createElement("section");
 host.className="card";host.id="firebase-auth-ui";
 host.innerHTML='<h3>Account collaboratore</h3><p class="hint">Caricamento del servizio di accesso…</p>';
 const gateCard=gate?.querySelector(".card.gate");
 if(gateCard)gateCard.insertBefore(host,gateCard.querySelector("#rpend"));else if(gate)gate.append(host);
 let client,firestore;
 try{
  [client,firestore]=await Promise.all([import("./firebase-client.js"),import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")]);
 }catch(error){
  host.innerHTML='<h3>Account collaboratore</h3><p class="hint" style="color:var(--bad-tx)">Il servizio di accesso non è riuscito a caricarsi: '+String(error?.message||error).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))+'</p><p class="hint">Riprova più tardi o contatta l’amministratore.</p>';
  console.error("Turni GPG Firebase init:",error);
 } 
 const { register, login, logout, resetPassword, submitAccessRequest, watchAuth, getAccess, watchMyNotifications, markNotificationRead, watchAdminRequests, approveMember, suspendMember, db } = client||{};
 const { doc, getDoc, onSnapshot, collection, addDoc, deleteDoc, updateDoc } = firestore||{};
 if(client&&firestore){
 const eyeStyle=document.createElement("style");eyeStyle.textContent=".fb-pw{position:relative}.fb-pw input{padding-right:50px}.fb-eye{position:absolute;right:4px;top:4px;height:40px;width:40px;padding:0;background:transparent;border-radius:50%;color:var(--mu);display:grid;place-items:center;box-shadow:none}";document.head.appendChild(eyeStyle);
 host.innerHTML=`<h3>Account collaboratore</h3><p class="hint" id="fb-status">Connessione sicura…</p>
 <form id="fb-login" style="display:grid;gap:10px"><div><label for="fb-email">Email</label><input id="fb-email" type="email" autocomplete="username" required></div>
 <div><label for="fb-pass">Password</label><div class="fb-pw"><input id="fb-pass" type="password" autocomplete="current-password" minlength="6" required><button type="button" class="fb-eye" id="fb-eye" aria-label="Mostra password" title="Mostra password"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button></div></div>
 <div id="fb-reg-fields" hidden><label for="fb-name">Nome e cognome</label><input id="fb-name" maxlength="60" autocomplete="name"><label for="fb-role">Mansione</label><select id="fb-role"><option value="gpg">Guardia giurata (GPG)</option><option value="sicurezza">Sicurezza</option><option value="portierato">Portierato</option></select></div>
 <button class="pri" id="fb-submit">Accedi</button></form>
 <div class="row"><button id="fb-toggle">Crea account</button><button id="fb-reset">Password dimenticata</button><button id="fb-logout" hidden>Esci dall’account</button></div>
 <div id="fb-request" hidden><label for="fb-rname">Nome e cognome</label><input id="fb-rname" maxlength="60"><label for="fb-rrole">Mansione</label><select id="fb-rrole"><option value="gpg">Guardia giurata (GPG)</option><option value="sicurezza">Sicurezza</option><option value="portierato">Portierato</option></select><button class="pri" id="fb-send-request">Invia richiesta di accesso</button></div><div id="fb-notices"></div><div id="fb-admin"></div><p class="hint">Accesso solo con email e password. Dopo la verifica dell’indirizzo, l’amministratore deve approvare la richiesta. Notifiche solo interne all’app, nessuna push.</p>`;

 const $=id=>document.getElementById(id),safe=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 let registering=false,current=null,unsubNotes=null,unsubReq=null,unsubMember=null,itemsCache=[],memberCache=[];
 const status=t=>$("fb-status").textContent=t;
 $("fb-eye").onclick=()=>{const i=$("fb-pass"),show=i.type==="password";i.type=show?"text":"password";$("fb-eye").setAttribute("aria-label",show?"Nascondi password":"Mostra password");$("fb-eye").title=show?"Nascondi password":"Mostra password"};
 $("fb-toggle").onclick=()=>{registering=!registering;$("fb-reg-fields").hidden=!registering;$("fb-name").required=registering;$("fb-submit").textContent=registering?"Registrati":"Accedi";$("fb-toggle").textContent=registering?"Ho già un account":"Crea account";$("fb-pass").autocomplete=registering?"new-password":"current-password"};
 $("fb-login").onsubmit=async e=>{e.preventDefault();try{status(registering?"Creazione account…":"Accesso…");if(registering){await register($("fb-email").value.trim(),$("fb-pass").value,$("fb-name").value,$("fb-role").value);status("Account creato. Controlla la posta, verifica l’indirizzo e poi accedi.");}else await login($("fb-email").value.trim(),$("fb-pass").value);}catch(err){status(err.message||"Operazione non riuscita.")}};
 $("fb-reset").onclick=async()=>{const email=$("fb-email").value.trim();if(!email){status("Inserisci prima il tuo indirizzo email.");return}try{await resetPassword(email);status("Email per reimpostare la password inviata.")}catch(e){status(e.message||"Invio non riuscito.")}};
 $("fb-logout").onclick=()=>logout().catch(e=>status(e.message));
 $("fb-send-request").onclick=async()=>{if(!current)return;try{await submitAccessRequest(current,$("fb-rname").value,$("fb-rrole").value);$("fb-request").hidden=true;status("Richiesta inviata: attendi l’approvazione dell’amministratore.")}catch(e){status(e.message||"Invio richiesta non riuscito.")}};
 const emit=(u,a,m,r)=>window.dispatchEvent(new CustomEvent("turni-firebase-session",{detail:{uid:u?.uid||null,admin:a,member:m,request:r}}));
 const todayISO=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
 const memberValid=m=>!!(m&&m.active&&(!m.start||todayISO()>=m.start)&&(!m.end||todayISO()<=m.end));

 $("fb-notices").onclick=e=>{const b=e.target.closest("[data-read]");if(b&&current)markNotificationRead(current.uid,b.dataset.read).catch(()=>status("Aggiornamento notifica non riuscito."))};
 function notifications(ns){$("fb-notices").innerHTML=ns.length?"<h3>Notifiche interne</h3>"+ns.map(n=>'<div class="it"><div class="m"><b>'+safe(n.title)+'</b><small>'+safe(n.message)+'</small></div>'+(n.read?"":'<button data-read="'+safe(n.id)+'">Segna letta</button>')+"</div>").join(""):""}
 function renderAdmin(){
  const pending=itemsCache;
  $("fb-admin").innerHTML="<h3>Richieste di accesso</h3>"+(pending.length?pending.map(r=>'<div class="it"><div class="m"><b>'+safe(r.name)+'</b><small>'+safe(r.email)+' · '+safe(r.role)+' · '+safe(r.status)+'</small><label>Inizio</label><input type="date" id="fb-s-'+safe(r.uid)+'"><label>Fine</label><input type="date" id="fb-e-'+safe(r.uid)+'"></div><button data-approve="'+safe(r.uid)+'">Approva</button></div>').join(""):"<p class='hint'>Nessuna richiesta.</p>")+"<h3>Collaboratori approvati</h3>"+(memberCache.length?memberCache.map(m=>'<div class="it"><div class="m"><b>'+safe(m.name||m.email||m.id)+'</b><small>'+safe(m.email||"")+' · '+(m.active?"Attivo":"Disattivato")+'</small><label>Inizio</label><input type="date" id="fb-ms-'+safe(m.id)+'" value="'+safe(m.start||"")+'"><label>Fine</label><input type="date" id="fb-me-'+safe(m.id)+'" value="'+safe(m.end||"")+'"></div><button data-msave="'+safe(m.id)+'">Salva date</button><button data-mtoggle="'+safe(m.id)+'">'+(m.active?"Disattiva":"Attiva")+'</button><button data-mdelete="'+safe(m.id)+'">Rimuovi</button></div>').join(""):"<p class='hint'>Nessun collaboratore approvato.</p>");
 }
 function requests(rs){itemsCache=rs.filter(r=>r.status==="pending");renderAdmin()}
 const uf=document.getElementById("uf");
 uf.onsubmit=async e=>{e.preventDefault();try{await addDoc(collection(db,"updates"),{t:document.getElementById("ut").value.trim(),b:document.getElementById("ub").value.trim(),d:Date.now()});uf.reset();status("Aggiornamento pubblicato.")}catch(x){status(x.message||"Pubblicazione non riuscita.")}};
 document.getElementById("ulist").onclick=async e=>{const id=e.target.dataset.du;if(!id||!current||current.email.toLowerCase()!==String(cfg.ADMIN_EMAIL).toLowerCase())return;try{await deleteDoc(doc(db,"updates",id))}catch(x){status(x.message||"Eliminazione non riuscita.")}};
 $("fb-admin").onclick=async e=>{const b=e.target.closest("[data-approve],[data-msave],[data-mtoggle],[data-mdelete]");if(!b||!current)return;const uid=b.dataset.approve||b.dataset.msave||b.dataset.mtoggle||b.dataset.mdelete;try{
 if(b.dataset.approve){const r=itemsCache.find(x=>x.uid===uid);await approveMember(uid,{...r,start:$("fb-s-"+uid).value,end:$("fb-e-"+uid).value});status("Collaboratore approvato.")}
 else if(b.dataset.msave){await updateDoc(doc(db,"members",uid),{start:$("fb-ms-"+uid).value,end:$("fb-me-"+uid).value});status("Date aggiornate.")}
 else if(b.dataset.mtoggle){const m=memberCache.find(x=>x.id===uid);if(m?.active)await suspendMember(uid);else await updateDoc(doc(db,"members",uid),{active:true});status("Stato collaboratore aggiornato.")}
 else if(b.dataset.mdelete){if(!confirm("Vuoi rimuovere l’autorizzazione di questo collaboratore?"))return;await deleteDoc(doc(db,"members",uid));status("Autorizzazione rimossa.")}
 }catch(x){status(x.message||"Operazione non riuscita.")}};
 async function activate(u,a,m,r){
  emit(u,a,m,r);
  if(!window.__TURNI_UPDATES_WATCH){window.__TURNI_UPDATES_WATCH=true;onSnapshot(collection(db,"updates"),snap=>{const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((x,y)=>(y.d||0)-(x.d||0));window.dispatchEvent(new CustomEvent("turni-firebase-updates",{detail:{items}}))},()=>status("Aggiornamenti non disponibili al momento."))}
  if(a||memberValid(m)){status(a?"Accesso amministratore attivo.":"Accesso approvato. Turni e buste paga restano su questo dispositivo.");if(!unsubNotes)unsubNotes=watchMyNotifications(u.uid,notifications)}
  else { $("fb-request").hidden=!!r; status(r?"Richiesta ricevuta: attendi l’approvazione dell’amministratore.":"Inserisci nome e mansione per inviare la richiesta di accesso."); }
  if(a&&!unsubReq)unsubReq=watchAdminRequests(requests);if(a&&!window.__TURNI_MEMBERS_WATCH){window.__TURNI_MEMBERS_WATCH=true;onSnapshot(collection(db,"members"),snap=>{memberCache=snap.docs.map(d=>({id:d.id,...d.data()}));renderAdmin()},()=>status("Elenco collaboratori non disponibile."))}
 }
 watchAuth(async u=>{
  try{
  current=u||null;window.__TURNI_CLOUD_READY=false;preparedUid=null;$("fb-logout").hidden=!u;
  if(unsubNotes){unsubNotes();unsubNotes=null}if(unsubReq){unsubReq();unsubReq=null}if(unsubMember){unsubMember();unsubMember=null}
  if(!u){status("Accedi con email e password oppure crea un account.");emit(null,false,null,null);return}
  await u.reload();if(!u.emailVerified){status("Verifica l’indirizzo email dal messaggio ricevuto, poi torna qui ed effettua l’accesso.");emit(u,false,null,null);return}
  const admin=u.email.toLowerCase()===String(cfg.ADMIN_EMAIL).toLowerCase();
  if(admin){await activate(u,true,null,null);return}
  const m=await getAccess(u.uid),snap=await getDoc(doc(db,"accessRequests",u.uid)),r=snap.exists()?snap.data():null;
  await activate(u,false,m,r);
  unsubMember=onSnapshot(doc(db,"members",u.uid),async s=>{const fresh=s.exists()?s.data():null;if(memberValid(fresh)){emit(u,false,fresh,r);status("Accesso approvato. Il tuo account è attivo.")}else{emit(u,false,fresh,r);status(fresh?.active?"La collaborazione è scaduta o non è ancora iniziata. Contatta l’amministratore.":"La richiesta è in attesa oppure l’accesso è sospeso.")}});
  }catch(e){status(e.message||"Errore di collegamento Firebase.");console.error("Turni GPG: errore sessione Firebase",e)}
 });
 }
} else if(cfg){
 const gate=document.getElementById("pg_gate"),card=gate?.querySelector(".card.gate");
 if(card){const note=document.createElement("p");note.className="hint";note.textContent="Accesso collaboratori Firebase non ancora attivato. La PWA continua a funzionare in modalità locale; per attivare registrazione e approvazione occorre completare la configurazione descritta in FIREBASE_SETUP.md.";card.appendChild(note)}
}