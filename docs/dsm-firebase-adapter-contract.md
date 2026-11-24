# DSM Firebase adapter — contract tecnico e test di sicurezza

**Stato:** progettazione; non implementato e non operativo.
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

## Flusso futuro (non eseguibile)

1. Listener Firebase SDK osserva il cambio stato autenticazione.
2. In assenza di utente: invalidare/clear il contesto DSM e chiudere sessione/lifecycle.
3. Per utente presente: richiedere al SDK i dati necessari; verificare autenticazione e verifica email secondo policy.
4. Verificare l'autorizzazione membership attraverso la fonte designata e protetta; non fidarsi di eventi UI.
5. Validare e minimizzare l'identificativo account. Evitare di usare UID/email in messaggi cross-tab.
6. Solo dopo autorizzazione, creare un contesto con una capability/contratto non costruibile da input arbitrario. Il contesto attuale accetta esclusivamente identitySource: local; non aggirare questo fail-closed.
7. Cambi identità, token invalidato, revoca, scadenza, errori o logout devono invalidare il contesto e cancellare listener/risorse DSM.
8. Nessun import/migrazione automatica in questo flusso.

## Test sintetici obbligatori prima dell'implementazione

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

Il prossimo lavoro può sviluppare solo test harness e revisione documentale. L'adapter non è autorizzato a bypassare il guard locale esistente. Nessuna integrazione con app operativa o dati reali.

## Riscontro sul codice Firebase esistente (audit statico)

File esaminati: `firebase-client.js`, `firebase-ui-v3-13.js`, `firestore.rules`.

- Il client usa Firebase Auth SDK 10.14.1, espone `watchAuth` basato su `onAuthStateChanged`, esegue `reload()` e controlla `emailVerified` nel flusso UI.
- La UI legge `members/{uid}` tramite `getAccess` e calcola `active/start/end` in `memberValid`; questi dati possono essere un input per una futura policy, ma il CustomEvent `turni-firebase-session` rimane non attendibile per DSM.
- Le Firestore Rules consentono la scrittura di `members` solo all'amministratore, mentre il proprietario può leggere il proprio documento. Questo è il confine autorizzativo attualmente visibile e va verificato con emulator/security-rules tests prima di riutilizzarlo.
- La regola `isAdmin()` si basa sull'email amministratore hardcoded nelle rules. Prima di un uso produttivo valutare una custom claim o un'autorità server gestita, con procedura di bootstrap e revoca documentata.
- Le rules per `accessRequests` consentono al proprietario di aggiornare alcuni campi, incluso `status`, entro il vincolo `status == "pending"`. Verificare con test emulator che un utente non possa alterare stati/ruoli o ottenere privilegi; le rules devono essere la fonte effettiva del blocco, non la UI.
- L'audit è statico: non sono stati eseguiti Firebase Emulator Suite, test delle rules o prove con account. Non si afferma quindi che le regole siano state validate dinamicamente.

Questi rilievi non modificano il codice Firebase e non autorizzano l'adapter DSM.
