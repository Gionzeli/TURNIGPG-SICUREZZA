const cfg=window.TURNI_FIREBASE_CONFIG;
if(cfg?.enabled){
 const { register, login, logout, resetPassword, watchAuth, getAccess, loadPrivateData, savePrivateData, watchMyNotifications, markNotificationRead, watchAdminRequests, approveMember, db } = await import("./firebase-client.js");
 const { doc, getDoc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
 const gate=document.getElementById("pg_gate"),host=document.createElement("section");
 host.className="card";host.id="firebase-auth-ui";
 host.innerHTML=`<h3>Account collaboratore</h3><p class="hint" id="fb-status">Connessione sicura…</p>
 <form id="fb-login" style="display:grid;gap:10px"><div><label for="fb-email">Email</label><input id="fb-email" type="email" autocomplete="username" required></div>
 <div><label for="fb-pass">Password</label><input id="fb-pass" type="password" autocomplete="current-password" minlength="6" required></div>
 <div id="fb-reg-fields" hidden><label for="fb-name">Nome e cognome</label><input id="fb-name" maxlength="60" autocomplete="name"><label for="fb-role">Mansione</label><select id="fb-role"><option value="gpg">Guardia giurata (GPG)</option><option value="sicurezza">Sicurezza</option><option value="portierato">Portierato</option></select></div>
 <button class="pri" id="fb-submit">Accedi</button></form>
 <div class="row"><button id="fb-toggle">Crea account</button><button id="fb-reset">Password dimenticata</button><button id="fb-logout" hidden>Esci dall’account</button></div>
 <div id="fb-notices"></div><div id="fb-admin"></div><p class="hint">Accesso solo con email e password. Dopo la verifica dell’indirizzo, l’amministratore deve approvare la richiesta. Notifiche solo interne all’app, nessuna push.</p>`;
 gate.insertBefore(host,gate.querySelector("#rpend"));
 const $=id=>document.getElementById(id),safe=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 let registering=false,current=null,unsubNotes=null,unsubReq=null,unsubMember=null,preparedUid=null,itemsCache=[],saveListener=null;
 const status=t=>$("fb-status").textContent=t;
 $("fb-toggle").onclick=()=>{registering=!registering;$("fb-reg-fields").hidden=!registering;$("fb-name").required=registering;$("fb-submit").textContent=registering?"Registrati":"Accedi";$("fb-toggle").textContent=registering?"Ho già un account":"Crea account";$("fb-pass").autocomplete=registering?"new-password":"current-password"};
 $("fb-login").onsubmit=async e=>{e.preventDefault();try{status(registering?"Creazione account…":"Accesso…");if(registering){await register($("fb-email").value.trim(),$("fb-pass").value,$("fb-name").value,$("fb-role").value);status("Account creato. Controlla la posta, verifica l’indirizzo e poi accedi.");}else await login($("fb-email").value.trim(),$("fb-pass").value);}catch(err){status(err.message||"Operazione non riuscita.")}};
 $("fb-reset").onclick=async()=>{const email=$("fb-email").value.trim();if(!email){status("Inserisci prima il tuo indirizzo email.");return}try{await resetPassword(email);status("Email per reimpostare la password inviata.")}catch(e){status(e.message||"Invio non riuscito.")}};
 $("fb-logout").onclick=()=>logout().catch(e=>status(e.message));
 const emit=(u,a,m,r)=>window.dispatchEvent(new CustomEvent("turni-firebase-session",{detail:{uid:u?.uid||null,admin:a,member:m,request:r}}));
 async function prepare(u){
  if(preparedUid===u.uid)return;preparedUid=u.uid;
  const key="tg_online_v1_user_"+u.uid,legacy=localStorage.getItem("tg_online_v1");let local=null;
  try{local=JSON.parse(localStorage.getItem(key)||"null")}catch(_){}
  const cloud=await loadPrivateData(u.uid);
  if(!local&&legacy){
   const yes=confirm("Su questo dispositivo sono presenti dati locali precedenti. Vuoi importarli nel tuo account personale? L’archivio originale non sarà cancellato.");
   if(yes){const old=JSON.parse(legacy);await savePrivateData(u.uid,old);localStorage.setItem(key,JSON.stringify(old));window.dispatchEvent(new CustomEvent("turni-firebase-data-load",{detail:{data:old}}))}
   else if(cloud)window.dispatchEvent(new CustomEvent("turni-firebase-data-load",{detail:{data:cloud}}));
   else window.dispatchEvent(new CustomEvent("turni-firebase-data-load",{detail:{data:{params:{},shifts:[]}}}));
  }else if(local&&cloud){
   if(confirm("Sono presenti dati sia sul dispositivo sia nel cloud. OK: usa il cloud. Annulla: mantieni i dati locali."))window.dispatchEvent(new CustomEvent("turni-firebase-data-load",{detail:{data:cloud}}));
   else await savePrivateData(u.uid,local);
  }else if(cloud)window.dispatchEvent(new CustomEvent("turni-firebase-data-load",{detail:{data:cloud}}));
  else if(local)await savePrivateData(u.uid,local);
  window.__TURNI_CLOUD_READY=true;
  if(saveListener)window.removeEventListener("turni-data-save",saveListener);saveListener=e=>{if(current?.uid===u.uid&&window.__TURNI_CLOUD_READY)savePrivateData(u.uid,e.detail.data).catch(()=>status("Salvataggio cloud non riuscito: verifica la connessione."))};window.addEventListener("turni-data-save",saveListener);
 }
 $("fb-notices").onclick=e=>{const b=e.target.closest("[data-read]");if(b&&current)markNotificationRead(current.uid,b.dataset.read).catch(()=>status("Aggiornamento notifica non riuscito."))};
 function notifications(ns){$("fb-notices").innerHTML=ns.length?"<h3>Notifiche interne</h3>"+ns.map(n=>'<div class="it"><div class="m"><b>'+safe(n.title)+'</b><small>'+safe(n.message)+'</small></div>'+(n.read?"":'<button data-read="'+safe(n.id)+'">Segna letta</button>')+"</div>").join(""):""}
 function requests(rs){itemsCache=rs;$("fb-admin").innerHTML="<h3>Richieste di accesso</h3>"+(rs.length?rs.map(r=>'<div class="it"><div class="m"><b>'+safe(r.name)+'</b><small>'+safe(r.email)+' · '+safe(r.role)+' · '+safe(r.status)+'</small><label>Inizio</label><input type="date" id="fb-s-'+safe(r.uid)+'"><label>Fine</label><input type="date" id="fb-e-'+safe(r.uid)+'"></div><button data-approve="'+safe(r.uid)+'">Approva</button></div>').join(""):"<p class='hint'>Nessuna richiesta.</p>")}
 $("fb-admin").onclick=async e=>{const b=e.target.closest("[data-approve]");if(!b||!current)return;try{const r=itemsCache.find(x=>x.uid===b.dataset.approve);await approveMember(r.uid,{...r,start:$("fb-s-"+r.uid).value,end:$("fb-e-"+r.uid).value});status("Collaboratore approvato.")}catch(x){status(x.message||"Approvazione non riuscita.")}};
 async function activate(u,a,m,r){
  emit(u,a,m,r);
  if(a||m?.active){status(a?"Accesso amministratore attivo.":"Accesso approvato. I tuoi dati sono separati.");await prepare(u);if(!unsubNotes)unsubNotes=watchMyNotifications(u.uid,notifications)}
  else status(r?"Richiesta ricevuta: attendi l’approvazione dell’amministratore.":"Account verificato: la richiesta di accesso non risulta ancora presente.");
  if(a&&!unsubReq)unsubReq=watchAdminRequests(requests);
 }
 watchAuth(async u=>{
  current=u||null;window.__TURNI_CLOUD_READY=false;preparedUid=null;$("fb-logout").hidden=!u;
  if(unsubNotes){unsubNotes();unsubNotes=null}if(unsubReq){unsubReq();unsubReq=null}if(unsubMember){unsubMember();unsubMember=null}
  if(!u){status("Accedi con email e password oppure crea un account.");emit(null,false,null,null);return}
  await u.reload();if(!u.emailVerified){status("Verifica l’indirizzo email dal messaggio ricevuto, poi torna qui ed effettua l’accesso.");emit(u,false,null,null);return}
  const admin=u.email.toLowerCase()===String(cfg.ADMIN_EMAIL).toLowerCase();
  if(admin){await activate(u,true,null,null);return}
  const m=await getAccess(u.uid),snap=await getDoc(doc(db,"accessRequests",u.uid)),r=snap.exists()?snap.data():null;
  await activate(u,false,m,r);
  unsubMember=onSnapshot(doc(db,"members",u.uid),async s=>{const fresh=s.exists()?s.data():null;if(fresh?.active&&preparedUid!==u.uid)await activate(u,false,fresh,r);else if(!fresh?.active){window.__TURNI_CLOUD_READY=false;emit(u,false,fresh,r);status("La richiesta è in attesa oppure l’accesso è sospeso.")}});
 }).catch(e=>status(e.message||"Errore di collegamento Firebase."));
}
