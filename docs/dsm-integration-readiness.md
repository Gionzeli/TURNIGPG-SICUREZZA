# DSM integration readiness — audit

## Current state
- DSM core resta isolato dall'app operativa. Esistono un adapter Firebase-to-DSM, un contesto remoto capability-gated e una session factory testati con fixture sintetiche; non sono collegati alla UI operativa.
- Il riferimento SHA riportato nei log storici di questo documento non è l'HEAD corrente; verificare PR/branch prima di usare risultati CI.
- CI browser IndexedDB / Playwright: https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45485825286 — **89 superati, 0 falliti**, eseguita sullo stesso SHA.
- CI Firebase Rules Emulator: https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45485825297 — **38 superati, 0 falliti, 0 saltati**, eseguita sullo stesso SHA.
- PR #1 resta aperta e draft. Non eseguire merge, deploy o modifiche a `main`.

## Integration audit findings
1. The operational UI in `index.html` still reads and writes legacy operational data using `LocalStorage` (including `tg_online_v1`).
2. The Firebase UI event remains untrusted. Separately, an isolated Firebase Auth SDK adapter resolves server authorization and supplies a frozen principal to `createDSMCoreSession()`; this path is not wired to the operational UI.
3. `createDSMCoreSession()` is a library/factory and is not instantiated by the operational UI. No operational view or write path is migrated to DSM.
4. The legacy application and DSM remain separate. This is currently a safe separation; do not bridge them by passing a UID as if it were proof of authorization.

## Safe next steps (synthetic-only)
- Complete the approved identity-to-employee binding and organizational schema decisions before implementing Firestore resource loaders; current employee records do not yet have an authoritative UID/profile linkage.
- Implement protected data endpoints only after schema and permission decisions are approved; each endpoint must reverify token revocation, reload canonical membership, resolve canonical resources, and authorize the requested operation server-side.
- Test the adapter with mocked Firebase auth states: unauthenticated, unverified email, pending member, approved member, inactive/expired member, admin, token/session changes, and late async callbacks.
- Keep any integration harness non-operational, opening only `DSM_ENTERPRISE_TEST_DB`, with synthetic accounts/records and cleanup across transitions.
- Add a read-only preview integration first. Do not change operational data reads or writes until the preview tests and security review pass.
- Before any operational integration: review Firebase security rules, privacy/data classification, encryption and key lifecycle, backup/restore, retention/deletion, and XSS/CSP/dependency risk.

## Release gates
- [ ] Verified Firebase identity adapter and authorization tests
- [ ] Synthetic integration harness only (test database name)
- [ ] Read-only preview with no writes to operational LocalStorage or Firestore
- [ ] Regression tests against current operational behavior
- [ ] Security/privacy review and explicit user approval
- [ ] Separate approval for merge/deploy

**Status:** Not operationally integrated. DSM remains isolated; no real data migration or synchronization is enabled. A supported Firebase-to-DSM capability path exists in the isolated adapter/session factory and is covered by synthetic tests, but no operational UI uses it.

## Work log — adapter boundary investigation
- Confirmed `firebase-ui-v3-13.js` emits a UI session event with UID/admin/member/request, but the event is not a trusted auth boundary for DSM.
- Confirmed `createAccountContext()` accepts local identity through `activate()` and a separate frozen server-authorized Firebase principal through `activateFirebase()`. A raw Firebase UID or UI event is not sufficient.
- The isolated adapter consumes Firebase SDK auth state (`onAuthStateChanged`), refreshes the token, and resolves current server authorization before creating the frozen principal. It must not be bypassed with event payloads or direct UID injection.
- The isolated adapter, capability path, session factory and synthetic tests exist. Operational UI wiring, Firestore data adapter and any real-data path remain out of scope and require separate review/approval.

## CI scope and limits
The two successful workflows above establish that the browser IndexedDB suite and the local Firestore Rules Emulator suite passed on the recorded commit. They do not establish production integration, Firebase authentication, authorization of real users, data migration, or overall security certification.


## Work log — verifica readonly e stato aggiornato (2026-11-24)

- PR #1 HEAD verificato: `9e635e2b0718ee3bdad050de88083d440f768ff8`; PR resta aperta, draft e non unita.
- La suite browser sullo stesso SHA riporta **89 superati, 0 falliti**. AUTH-005 verifica l'abort osservabile delle transazioni readonly pendenti e il rifiuto dei risultati stale durante il cambio account.
- La suite Firestore Rules Emulator sullo stesso SHA riporta **38 superati, 0 falliti, 0 saltati**.
- Questi esiti sono test automatizzati con fixture sintetiche; non costituiscono audit indipendente, certificazione o prova di autenticazione Firebase operativa.
- L'adapter Firebase DSM e `createDSMCoreSession()` sono implementati e testati in forma isolata; non sono collegati all'UI operativa e `index.html` continua a usare il percorso legacy.
- Nessuna modifica a `main`, entrypoint operativo, Firebase UI, Firebase client o Firestore Rules; nessun merge, deploy, import o sync di dati reali.
- Decisione invariata: mantenere il core isolato e la PR in draft. Ogni integrazione operativa richiede revisione e approvazione separate.


## Correzione di stato — adapter isolato e dispose terminale (2026-11-25)

- Le descrizioni precedenti che dichiarano inesistente l'adapter Firebase-to-DSM sono superate: `firebase-auth-adapter.js`, `account-context.activateFirebase()`, il lifecycle coordinator e `createDSMCoreSession()` costituiscono già un percorso isolato.
- Il percorso usa un principal congelato derivato da autorizzazione server-side e test sintetici; `firebase-lifecycle.test.js` viene eseguito dalla suite browser CI. Non è integrato in `index.html` o nella UI Firebase legacy.
- `session.dispose()` è una dismissione terminale, non un semplice unsubscribe: invalida il contesto, blocca ogni riattivazione e permette soltanto retry del cleanup incompleto. Non cancella i dati persistenti.
- Queste capability non modificano Firebase operativo, Firestore Rules, dati reali, `main` o deployment.

## Audit mirato — refresh e revoca Firebase (2026-11-25)

- Il resolver server controlla la revoca del token e rilegge la membership canonica a ogni chiamata. Il controllo non è un push verso il browser.
- L'adapter ascolta onAuthStateChanged, non onIdTokenChanged; forza un refresh solo quando getPrincipal() viene chiamato.
- Il principal client ha una scadenza di cinque minuti. Il lifecycle blocca nuove catture dopo la scadenza, ma non rinnova o cancella automaticamente il contesto.
- La revoca membership dopo l'attivazione è rilevata dal resolver alla successiva richiesta; non è garantita invalidazione immediata della sessione locale.
- Non esistono ancora API protette per i dati DSM: health riporta protectedDataApisImplemented: false e authorizationImplemented: false. Nessuna operazione IndexedDB deve essere descritta come autorizzata dal server.
- Refresh coordinato, revoca durante sessione attiva, outage/timeout e ripristino restano test/gate prima di integrazione. Non collegare un listener onIdTokenChanged senza gestire la transizione che il suo evento innesca.

## Work log — verifica CI e stato d'integrazione (2026-11-26)

- HEAD verificato: `7c6130190025e805bb4671a90ec8605706678df7`; PR #1 aperta, Draft e non unita.
- Browser / Playwright sullo SHA esatto: [run 45767726435](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45767726435), completata con successo. Log: **97 test superati, 0 falliti**; inclusi adapter Firebase sintetico, lifecycle, rinnovo, AUTH-008, IndexedDB, invalidazione BroadcastChannel tra due pagine browser, CSP, cronologia, export CSV e preview locale.
- Firestore Rules Emulator sullo stesso SHA: [run 45767726489](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45767726489), completata con successo: **38 test superati, 0 falliti, 0 saltati**.
- I check-runs sullo SHA corrente risultano entrambi `completed/success`; nessuna esecuzione CI è attiva al momento della verifica.
- Il confronto GitHub tra `81bcb9d0cf0ad2eff584854af6bee1c51591e980` e l'HEAD corrente mostra quattro file cambiati e **nessun file sotto `functions/`**. Questo prova che il codice Functions non è cambiato in quel tratto, ma non equivale a un'esecuzione backend emulator sullo SHA corrente.
- La pipeline backend emulator precedentemente verificata (63 test, 0 falliti sul commit storico riportato nel log di lavoro) non viene promossa a prova CI sullo SHA corrente. Va rieseguita sul codice Functions corrente prima di considerare completato il gate backend.
- Nessun endpoint protetto per i dati DSM è implementato: `health` continua a dichiarare `protectedDataApisImplemented: false` e `authorizationImplemented: false`. Il resolver di membership e le policy pure non sostituiscono le API dati.
- Restano bloccanti le decisioni di schema canonico account/sede/reparto, il collegamento autorevole UID↔dipendente, la semantica own-scope, la matrice di permessi per operazione e la policy di membership multi-account/validità.
- Nessuna modifica a `main`, root `firestore.rules`, configurazione Firebase operativa, entrypoint o composizione UI protetti; nessun accesso a dati reali, import, sincronizzazione o deploy.
- Prossimo passo sicuro: completare le decisioni di dominio e, dopo approvazione, implementare loader e API protette isolate con test Auth/Functions/Firestore Emulator sintetici. Fino ad allora il core resta non operativo e la PR resta Draft.
