# DSM Firebase adapter — contract tecnico e test di sicurezza

**Stato:** adapter e percorso Firebase-to-DSM implementati e testati in forma isolata; non collegati all'interfaccia operativa e non autorizzati per dati reali.
**Branch:** dsm-enterprise/core-v1

## Obiettivo

Definire come una futura integrazione DSM possa ricevere un'identità autenticata dal Firebase SDK senza considerare attendibili eventi UI o dati controllati dal client. Questo documento non abilita login, scritture, import, sincronizzazione o accesso a dati reali.

## Confini di fiducia

- L'evento turni-firebase-session prodotto dall'interfaccia UI è un segnale UI e non costituisce prova di autenticazione o autorizzazione.
- UID, admin, member, request, email, date di validità o stato copiati da payload UI non devono essere accettati come credenziali.
- Un futuro adapter deve ascoltare lo stato auth del Firebase SDK e gestire null/sign-out, errori, refresh e cambi identità.
- Autenticazione (identità) e autorizzazione (accesso DSM) sono distinte: email verificata da sola non conferisce accesso.
- La membership/ruolo deve derivare da una fonte autorizzativa affidabile, con regole di backend e Firestore Security Rules verificate; campi client modificabili non sono autorità.
- Non passare token, password, OTP, PIN, claim sensibili o dati personali in IndexedDB, audit, log o BroadcastChannel.
- Non creare un contesto account DSM finché tutti i controlli sono conclusi; ogni errore deve lasciare DSM disattivato.

## Percorso Firebase-to-DSM isolato attualmente implementato

1. `createFirebaseAuthAdapter()` osserva direttamente il Firebase Auth SDK; non considera attendibile il CustomEvent emesso dalla UI legacy.
2. Per un utente presente, l'adapter richiede un token aggiornato e chiama il resolver server con verifica del token revocato (`checkRevoked=true` nel verificatore iniettato). Verifica UID, email verificata, membership attiva e scadenza.
3. L'adapter restituisce un principal minimizzato e congelato con origine Firebase e autorizzazione server; token e claim UI non vengono esposti al contesto.
4. `createDSMCoreSession()` sottoscrive gli eventi dell'adapter, serializza l'invalidazione e usa una revisione auth per impedire la ripresa di principal obsoleti.
5. `accountContext.activateFirebase()` accetta solo il principal congelato previsto dal contratto. Il controllo client riduce gli errori d'integrazione ma non sostituisce l'autorizzazione server su ogni operazione.
6. `session.dispose()` dismette definitivamente la sessione: contesto terminale, listener rimossi, nessuna riattivazione; cleanup incompleto resta bloccato e può essere soltanto riprovato.
7. Il percorso è coperto da test sintetici isolati. `index.html` e la UI Firebase operativa non istanziano `createDSMCoreSession()`; non esiste migrazione o sincronizzazione di dati reali.

## Test sintetici e copertura residua

- Payload UI falsificato (UID/admin/member/request) non crea un contesto remoto.
- Utente non autenticato, email non verificata, membership mancante/inattiva, ruolo insufficiente, accesso scaduto o revocato: DSM resta disattivato.
- SDK auth error/rete/timeout: fail-closed, niente sessione DSM parziale.
- Cambio account A→B: A invalidato; le operazioni pendenti di A non possono scrivere dopo la transizione.
- Logout: invalidazione, dispose listener, pulizia retry testata.
- Dati membership manipolati dal client non autorizzano l'accesso.
- Non vengono registrati token/credenziali nei log, audit o messaggi cross-tab.
- Test unitari con stub/mock e browser integration su account demo; mai credenziali o dati reali in CI.

## Gate di revisione

- Documentare schema membership e policy di ruolo.
- Verificare Firestore Security Rules e ogni query di membership; le rules devono limitare letture/scritture e impedire self-grant.
- Decidere se l'autorità è una claim firmata o un documento membership protetto, con revoca e scadenza definite.
- Progettare un API del contesto che non consenta a chiamanti arbitrari di dichiararsi autenticati.
- Revisione indipendente di sicurezza prima di collegare il runtime.
- CI verde sul commit esatto, test negative e positive coperti, PR non merged finché non autorizzato.

## Decisione

Il percorso isolato adapter → principal server-authorized → account context/lifecycle → session factory è implementato. Non bypassa l'evento UI legacy e non autorizza integrazione operativa. Qualsiasi wiring UI, adapter Firestore, modifica alle Rules, migrazione o accesso a dati reali richiede revisione e approvazione separate.

## Riscontro sul codice Firebase esistente (audit statico)

File esaminati: `firebase-client.js`, `firebase-ui-v3-13.js`, `firestore.rules`.

- Il client usa Firebase Auth SDK 10.14.1, espone `watchAuth` basato su `onAuthStateChanged`, esegue `reload()` e controlla `emailVerified` nel flusso UI.
- La UI legge `members/{uid}` tramite `getAccess` e calcola `active/start/end` in `memberValid`; questi dati possono essere un input per una futura policy, ma il CustomEvent `turni-firebase-session` rimane non attendibile per DSM.
- Le Firestore Rules consentono la scrittura di `members` solo all'amministratore, mentre il proprietario può leggere il proprio documento. Questo è il confine autorizzativo attualmente visibile e va verificato con emulator/security-rules tests prima di riutilizzarlo.
- La regola `isAdmin()` si basa sull'email amministratore hardcoded nelle rules. Prima di un uso produttivo valutare una custom claim o un'autorità server gestita, con procedura di bootstrap e revoca documentata.
- Le rules per `accessRequests` consentono al proprietario di aggiornare alcuni campi, incluso `status`, entro il vincolo `status == "pending"`. Verificare con test emulator che un utente non possa alterare stati/ruoli o ottenere privilegi; le rules devono essere la fonte effettiva del blocco, non la UI.
- L'ispezione di `firebase-client.js`, `firebase-ui-v3-13.js` e `firestore.rules` descritta sopra è statica. Separatamente, Firebase Emulator Suite è stata eseguita in CI con esito success sul commit `1563262904f191a73ca60d71796820dae0bc5347` ([run 45465628237](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465628237)) e nuovamente sul commit `b804cd2d50b9642612191a6bf9cb2492bc484044` ([run 45465935709](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465935709)); quest'ultima esecuzione riporta 38 test superati e 0 falliti. Non sono state eseguite prove con account Firebase reali. I test adapter e lifecycle DSM usano esclusivamente fixture sintetiche e non dimostrano l'integrazione operativa.

Questi rilievi non modificano il codice Firebase operativo, le Firestore Rules o l'interfaccia legacy e non autorizzano un'integrazione operativa.
