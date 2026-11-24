# Piano test negativi Firebase — DSM

**Stato:** specifica e suite parzialmente eseguite; verifiche emulator e browser automatizzate sul branch indicato.
**Ambiente previsto:** Firebase Emulator Suite, progetto demo isolato e dati sintetici.
**Branch:** `dsm-enterprise/core-v1`

Questo piano completa il contratto DSM Firebase senza introdurre un adapter, modificare le regole operative o collegare il DSM a Firebase. Le prove devono essere eseguite esclusivamente contro emulatori locali; vietato usare il progetto Firebase reale o account reali.

## Gate prima di eseguire

- [ ] Identificare una versione Node/npm e una versione Firebase Emulator Suite fissate e riproducibili.
- [ ] Aggiungere dipendenze di test in modo dichiarato (non installazioni transitorie non versionate).
- [ ] Configurare un progetto emulator-only con ID dedicato; bloccare ogni endpoint di produzione.
- [ ] Caricare le regole Firestore del branch in esame nell'emulatore.
- [ ] Creare utenti e documenti sintetici tramite API di setup dell'emulatore, mai tramite UI o credenziali reali.
- [ ] Pulire emulatori e dati al termine; fallire il job se una richiesta tenta di uscire verso Firebase production.
- [ ] Non rendere il workflow un gate di produzione finché la suite non è ripetibile e revisionata.

## Matrice Firestore Security Rules

Ogni caso deve asserire sia l'esito atteso (allow/deny) sia che nessun documento non autorizzato sia stato modificato.

| ID | Identità sintetica | Operazione | Atteso | Rischio coperto |
|---|---|---|---|---|
| FR-01 | non autenticato | read/write `members/{uid}` | deny | accesso anonimo |
| FR-02 | utente A verificato | read `members/A` | allow | lettura del proprio accesso |
| FR-03 | utente A verificato | read `members/B` | deny | lettura membership altrui |
| FR-04 | utente A verificato | create/update/delete `members/A` | deny | self-grant e auto-sospensione/manomissione |
| FR-05 | utente A verificato | create `accessRequests/A` con UID/email/status coerenti e soli campi ammessi | allow | richiesta legittima |
| FR-06 | utente A verificato | create richiesta con UID, email o status discordante | deny | impersonificazione e richiesta non pendente |
| FR-07 | utente A verificato | create richiesta con campo extra | deny | mass assignment |
| FR-08 | utente A verificato | update richiesta cambiando status in approved o altro valore non pending | deny | auto-approvazione |
| FR-09 | utente A verificato | update richiesta modificando solo campi ammessi e lasciando status pending | allow | modifica richiesta legittima |
| FR-10 | utente A verificato | update richiesta tentando di cambiare UID/email | deny | alterazione identità |
| FR-11 | utente A verificato | delete propria richiesta | allow secondo regola attuale | cancellazione richiesta |
| FR-25 | utente A verificato | update `createdAt` della propria richiesta mantenendo `status: pending` | allow secondo regola attuale | integrità temporale della richiesta |
| FR-12a | utente A non verificato | read `accessRequests/A` | deny | `isOwner()` richiede email verificata |
| FR-12b | utente A non verificato ma autenticato, con email token coerente | create `accessRequests/A` con tutti i campi ammessi e status pending | **allow secondo le regole attuali** | `create` controlla solo `request.auth != null`, non `email_verified` |
| FR-13 | utente A verificato | read/write `privateData/A` | deny | area privata disabilitata |
| FR-14 | utente A verificato | update notifica cambiando campi diversi da `read` | deny | modifica contenuto notifica |
| FR-15 | utente A verificato | update notifica con `read: true` booleano | allow | sola marcatura lettura |
| FR-16 | utente A verificato | update notifica con `read: "true"` | deny | tipo non valido |
| FR-17 | utente A verificato | read `updates/{id}` | allow | feed per utenti verificati |
| FR-18 | utente A verificato | write `updates/{id}` | deny | pubblicazione non admin |
| FR-19 | utente admin sintetico verificato | gestione `members`, `accessRequests`, `notifications`, `updates` secondo regole | allow | percorso amministrativo |
| FR-20 | utente non admin verificato | invocare operazioni admin | deny | escalation privilegi |
| FR-21 | qualunque identità | read/write collezione non esplicitamente prevista | deny | regola catch-all |

### Verifiche di policy da non confondere con le regole

- L'attuale `isAdmin()` confronta l'email verificata con un indirizzo hardcoded. I test emulator devono dimostrare che un utente ordinario non ottiene privilegi alterando campi del proprio documento o della richiesta.
- **Gap rilevato:** `accessRequests.create` verifica `request.auth != null` ma non `request.auth.token.email_verified == true`. Un utente autenticato con email non verificata può creare una richiesta se UID, email e campi ammessi coincidono. FR-12b documenta il comportamento attuale; una futura modifica dovrà richiedere `signedIn()` e avere una prova che passa da allow a deny.
- La regola owner su `accessRequests` consente aggiornamenti limitati, inclusa la possibilità di mantenere/impostare `status: "pending"`; non deve essere interpretata come approvazione o membership.
- **Gap d'integrità:** `createdAt` è tra i campi modificabili dal proprietario. FR-25 documenta che un owner può riscrivere il timestamp mantenendo lo stato `pending`; non è una prova temporale attendibile e non va usato per audit o ordinamento autorevole.
- La membership `members/{uid}` è scrivibile solo dall'admin secondo le regole attuali. Un documento `accessRequests` non deve mai essere sufficiente per creare un contesto DSM.
- Il test dell'email amministratore hardcoded non risolve il rischio operativo di gestione dell'identità admin. La migrazione a custom claims o autorità server richiede una decisione separata, bootstrap, revoca e test; non modificarla in questa attività.

## Matrice adapter/sessione DSM — mock isolati

Questi test sono unit/integration test del futuro adapter e non test Firestore. Non devono essere implementati aggirando `identitySource: "local"` o costruendo un contesto remoto fittizio nel codice di produzione.

| ID | Stimolo sintetico | Risultato obbligatorio |
|---|---|---|
| AD-01 | CustomEvent UI con UID/admin/member/request arbitrari | nessun contesto DSM creato |
| AD-02 | SDK auth restituisce null | sessione DSM assente; risorse chiuse |
| AD-03 | utente presente ma email non verificata | fail-closed |
| AD-04 | membership assente o inattiva | fail-closed |
| AD-05 | ruolo insufficiente o intervallo di validità scaduto | fail-closed |
| AD-06 | errore SDK, timeout o rete indisponibile durante auth/membership | nessuna sessione parziale |
| AD-07 | membership revocata mentre la sessione è attiva | invalidazione e dispose |
| AD-08 | cambio identità A→B con operazione A pendente | A invalidato; scrittura tardiva rifiutata |
| AD-09 | logout durante lettura/scrittura | operazione annullata o scartata; cleanup completato |
| AD-10 | callback auth duplicati o fuori ordine | una sola generazione valida; callback obsolete ignorate |
| AD-11 | token/claim/credenziale nei messaggi cross-tab o log | nessun dato sensibile emesso |
| AD-12 | errore durante dispose/cleanup | fail-closed e retry senza riattivare la sessione |

## Criteri di accettazione

1. Tutti i test FR devono essere eseguiti con Firestore Emulator e riportare il numero esatto di casi passati/falliti.
2. Tutti i test AD devono usare stub deterministici e account sintetici; nessun Firebase Auth reale.
3. I test devono verificare anche l'assenza di side effect dopo un deny o una transizione di account.
4. Nessun test deve richiedere o stampare password, token, OTP, PIN, email personali o altri segreti.
5. Il report CI deve identificare commit SHA, versione emulatori e suite eseguita.
6. Un test verde non autorizza l'implementazione dell'adapter, l'importazione dati, la sincronizzazione o la distribuzione.
7. Non modificare `firestore.rules`, `firebase-client.js`, `firebase-ui-v3-13.js`, il guard account DSM o il branch `main` nell'ambito di questo piano.

## Stato effettivo

Aggiornato il 24 novembre 2026:
- audit statico di `firestore.rules` e `firebase-client.js` completato;
- Firebase Emulator Suite configurato in `tests/firebase-emulator/`, con progetto demo `demo-dsm-rules`;
- workflow CI dedicato: `.github/workflows/firebase-rules-emulator-tests.yml`;
- le regole testate sono copiate dalla root del commit nella directory del progetto emulator prima dell'avvio;
- **38 test Firestore superati, 0 falliti, 0 saltati** sul commit `b804cd2d50b9642612191a6bf9cb2492bc484044`, run [45465935709](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465935709); il log riporta `# tests 38`, `# pass 38`, `# fail 0`;
- **test browser IndexedDB superati** sul commit `1563262904f191a73ca60d71796820dae0bc5347`, run [45465628030](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465628030); i successivi commit fino a `b804cd2` hanno modificato solo documentazione, non il codice coperto;
- copertura dinamica attuale: FR-01, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12a, FR-12b, FR-13, FR-14, FR-15, FR-16, FR-19/19a/19b, FR-20a/20b/20c, FR-21, FR-22a–22e, FR-23a–23h, FR-24a–24b e FR-25;
- i casi non presenti nella suite non sono dichiarati superati;
- nessun adapter Firebase DSM implementato; nessun account o dato reale usato.

La suite verifica le regole correnti, non certifica l'intero modello di sicurezza. FR-12b continua a documentare un gap effettivo: la creazione di una richiesta da parte di un utente autenticato ma non verificato è consentita dalle regole correnti. FR-25 dimostra inoltre che il proprietario può riscrivere `createdAt` mantenendo lo stato `pending`; tale campo non è quindi una prova temporale attendibile.


### Ultima verifica congiunta delle pipeline

Sul commit `3d4cc2158064f4e3d588799779b3c08ace8f216b` entrambe le pipeline sono completate con esito positivo:
- Browser IndexedDB / Playwright: [run 45466631470](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45466631470), job `indexeddb-browser-tests` completato.
- Firestore Rules Emulator: [run 45466632153](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45466632153), job `firestore-rules-emulator` completato.

Il log della run Firebase sul commit precedente `b804cd2` documenta esplicitamente 38 test, 38 pass, 0 fail e 0 skipped. Per la run `45466632153` è stato verificato l'esito positivo di tutti gli step del job; non viene attribuito un conteggio numerico non estratto dal relativo log.

Il branch è poi avanzato con commit documentali successivi (`e53ab6e`, `3d4cc21`, `38cb5f9`). Queste esecuzioni non vanno presentate come run sullo SHA HEAD `38cb5f9`; i cambiamenti successivi alle pipeline sono documentali e non modificano il codice testato.


### Verifica CI sul commit `a570bde`

Sul commit `a570bde875a725343cbd02834085537540888520` entrambe le pipeline sono completate con esito positivo:
- Firestore Emulator: [run 45456336449](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45456336449); log esplicito `# tests 37`, `# pass 37`, `# fail 0`.
- Browser IndexedDB / Playwright: [run 45456336316](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45456336316), job completato con successo.


### Verifica CI sul commit `cf093db3d3d27e9ad5ca85e7baebc69b98ed0512`

Entrambe le pipeline sono completate con esito positivo sul medesimo SHA:
- Firestore Emulator: [run 45456600293](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45456600293).
- Browser IndexedDB / Playwright: [run 45456600298](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45456600298).


### Verifica congiunta CI sul commit `642d6b20c44ca050ae0886e6769ed46cce640996`

Il 24 novembre 2026 entrambe le pipeline sono state completate con esito positivo sullo stesso SHA:
- Browser IndexedDB / Playwright: [run 45467136541](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45467136541). Il log riporta **88 superati, 0 falliti**; include AUTH-001 con cinque sorgenti non locali rifiutate e tentativi di dichiarare UID, ruolo admin, email verificata e membership.
- Firestore Rules Emulator: [run 45467136692](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45467136692). Il log riporta **38 test, 38 pass, 0 fail, 0 skipped**.

Il job browser ha inoltre completato le prove Playwright per BroadcastChannel tra due pagine same-origin, fixture CSP, preview e demo composition isolata. Le prove usano esclusivamente dati sintetici. Il job Firebase usa il progetto demo `demo-dsm-rules` e Firestore Emulator; non si collega a Firebase production.

Questa verifica riguarda il commit indicato, non autorizza adapter Firebase, integrazione nell'entrypoint operativo, import/sync di dati, deploy o merge. Le regole operative e il guard account non sono stati modificati.


### Verifica congiunta CI sul commit `dc35072b02619d0bff03bed3bb0f1b7ff87f2b15`

Il 24 novembre 2026 entrambe le pipeline sono terminate con esito positivo sul medesimo SHA:
- Browser IndexedDB / Playwright: [run 45467870415](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45467870415), **89 superati, 0 falliti**. Include AUTH-002: claim remoti aggiuntivi (UID, ruolo admin, flag admin, email verificata, membership e permessi) non vengono propagati dal contesto locale; l'oggetto mantiene soltanto `accountId`, `identitySource` e `verifiedAt`.
- Firestore Rules Emulator: [run 45467870487](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45467870487), **38 test, 38 pass, 0 fail, 0 skipped**.

Le suite usano fixture sintetiche e l'emulatore locale. Questa verifica non attesta un'autenticazione Firebase reale né l'esistenza di un adapter DSM. Non autorizza integrazione operativa, import/sync, deploy o merge; regole Firebase e guard account operativo restano fuori ambito.


### Verifica congiunta CI sul commit `acda5653cf228d52d212886447b67aaf1b3e8242`

Il 24 novembre 2026 entrambe le pipeline sono terminate con esito positivo sul medesimo SHA:
- Browser IndexedDB / Playwright: [run 45468368000](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45468368000), **89 superati, 0 falliti**. AUTH-005 verifica che, dopo l'invalidazione della scrittura pendente durante lo switch A→B, il ritorno all'account sintetico A restituisca il record originale con contenuto invariato e revisione 1.
- Firestore Rules Emulator: [run 45468368016](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45468368016), **38 test, 38 pass, 0 fail, 0 skipped**.

Le suite usano fixture sintetiche e Firestore Emulator locale. Il test aggiuntivo verifica il percorso di abort della transazione nel caso riprodotto; non dimostra che scritture già completate possano essere annullate retroattivamente. Nessuna regola Firebase operativa, UI Firebase o guard account è stata modificata. Questa verifica non autorizza adapter, import/sync, deploy o merge.
