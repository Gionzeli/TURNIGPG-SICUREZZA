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
- **33 test Firestore superati, 0 falliti** sul commit `1574c51bdd46df896e70159c1f4c1f8b2a40876c`, run [45455543014](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45455543014);
- **test browser IndexedDB superati** sullo stesso SHA, run [45455543372](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45455543372);
- copertura dinamica attuale: FR-01, FR-04, FR-05, FR-08, FR-09, FR-12a, FR-12b, FR-13, FR-14, FR-15, FR-16, FR-19/19a/19b, FR-20a/20b/20c, FR-21, FR-22a–22e e FR-23a–23h e FR-24a–24b;
- i casi non presenti nella suite non sono dichiarati superati;
- nessun adapter Firebase DSM implementato; nessun account o dato reale usato.

La suite verifica le regole correnti, non certifica l'intero modello di sicurezza. FR-12b continua a documentare un gap effettivo: la creazione di una richiesta da parte di un utente autenticato ma non verificato è consentita dalle regole correnti.


### Verifica CI sul commit documentale corrente

Sul commit `1f87a34eb3c8bfafd2895423c51f0eb2ac10880d` entrambe le pipeline sono state completate con esito positivo:
- Firestore Emulator: [run 45455804054](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45455804054), job completato con successo.
- Browser IndexedDB / Playwright: [run 45455804147](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45455804147), job completato con successo.
- Il test file emulator contiene 33 casi; il conteggio esplicito 33/33 è stato riportato nella run precedente sul commit `1574c51`. La run sul commit `1f87a34` conferma il successo del job, senza attribuire un nuovo conteggio non letto dai log.
