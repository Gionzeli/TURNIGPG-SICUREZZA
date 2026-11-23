# DSM — audit cambio account e operazioni pendenti

## Ambito
Revisione del branch `dsm-enterprise/core-v1` su cambio account, riuso repository, connessioni IndexedDB e invalidazione UI. Nessun dato operativo o personale è stato usato.

## Esito

- **Filtro account nei repository:** le operazioni acquisiscono l'accountId all'inizio e filtrano le letture tramite gli indici `accountId` e `accountId_id`. Il test `DB-006` verifica il riuso di un repository passando da A a B e poi tornando ad A.
- **Context clear:** `clear()` rimuove il contesto attivo; `AUTH-002` verifica che nuove chiamate repository vengano rifiutate e che i dati persistenti restino presenti.
- **Database close/open:** la chiusura invalida richieste di apertura pendenti (`DB-001B`); il workflow browser CI è verde al commit esaminato.
- **Cambio account e UI:** il core non ha un coordinatore che invalida viste, cache o riferimenti applicativi. L'isolamento dei repository non basta se una UI conserva dati già letti in memoria.
- **Operazioni IndexedDB già avviate:** non è presente un meccanismo di cancellazione/revoca per operazioni già partite. Il loro accountId viene catturato all'inizio, ma una transizione di contesto non interrompe necessariamente l'operazione. Non considerare `clear()` come barriera completa.
- **Repository collegati a una connessione:** i repository mantengono la connessione DB ricevuta al costruttore. Se la connessione viene chiusa o sostituita, i vecchi repository non vengono automaticamente ricreati; il chiamante deve ricostruirli e ricaricare la vista.

## Decisione

Non aggiungere un coordinatore parziale senza test controllabili: un blocco UI isolato non garantirebbe il rollback delle transazioni IndexedDB già avviate e potrebbe creare una falsa impressione di sicurezza. Per ora non cambiare codice applicativo.

## Prerequisiti per il coordinatore lifecycle

1. API lifecycle con stato transizione esplicito (`switching/clearing/active`) e blocco nuove operazioni.
2. Token/generazione del contesto per rilevare operazioni e risultati stale.
3. Registrazione delle operazioni pendenti e abort best-effort delle transazioni cancellabili; gestione chiara di quelle già completate.
4. Evento di cambio contesto consumato dalle viste per svuotare immediatamente DOM, cache e riferimenti ai record.
5. Rilascio dei vecchi repository/connessioni e ricostruzione solo dopo transizione conclusa.
6. Test browser deterministici: A→B non mostra dati A nella UI; logout cancella viste; risultato asincrono stale non viene renderizzato; transazione in corso durante cambio account; errori/rollback; nuova connessione con repository freschi.
7. Verificare il comportamento in più schede. Un context locale per scheda non è coordinamento cross-tab.

## Limiti e sicurezza

Il contesto client-side e gli indici IndexedDB forniscono separazione logica per prototipo, non autorizzazione contro codice same-origin ostile. IndexedDB resta non cifrato e persistente. Non usare dati personali/operativi finché autenticazione, protezione dei dati, lifecycle e retention non sono progettati e testati.

## Stato di verifica

L'ultimo workflow `DSM Core browser tests` esaminato (run 45250320994, commit `4d3a74aa19beedf4e9fe767a06494e4d2b4b6f6d`) ha conclusione `success`. Questo risultato si riferisce ai test del commit e non certifica i prerequisiti futuri sopra elencati.


## Aggiornamento — coordinatore isolato (branch DSM)

È stato aggiunto `src/core/account/account-lifecycle-coordinator.js`, esportato da `src/core/database/index.js`.

- `beginTransition()` incrementa la generazione, passa a `switching`, azzera il contesto e notifica i listener.
- `capture()` restituisce accountId e generazione solo nello stato attivo; `isCurrent()` rifiuta risultati appartenenti a generazioni precedenti.
- Listener e risorse disposable possono essere registrati. Gli errori di pulizia mantengono il coordinatore non attivo; `retryCleanup()` consente un nuovo tentativo.
- `activateLocal()` richiede il token di transizione e pulizia completata; `clear()` completa il logout.

Test sintetici AUTH-003/AUTH-004 coprono invalidazione A→B, logout, pulizia cache tramite listener e retry dopo errore.

**Non integrato:** BaseRepository, servizi applicativi e viste reali non ricevono ancora il coordinatore. I test di listener usano una cache sintetica, non il DOM dell'applicazione. Le transazioni IndexedDB già avviate non vengono abortite dal coordinatore. Non è una garanzia di isolamento completa né un'autorizzazione di sicurezza. Prima dell'uso applicativo servono wiring esplicito, test d'integrazione end-to-end e verifica multi-scheda.


## Aggiornamento — collegamento BaseRepository (2026-11-23)

La decisione iniziale di non modificare il codice applicativo è superata dall'implementazione incrementale seguente:

- BaseRepository accetta l'opzione facoltativa lifecycleCoordinator; i repository concreti la inoltrano già tramite ...options.
- Ogni operazione acquisisce una coppia accountId/generazione e verifica che sia ancora corrente prima di restituire risultati.
- Le letture completate dopo una transizione vengono rifiutate, non restituite alla UI.
- Le transazioni di scrittura vengono registrate come risorse disposable; beginTransition() tenta di abortire quelle ancora pendenti. Le transazioni già completate non sono reversibili.
- Le verifiche di update/delete controllano anche la generazione nel callback IndexedDB prima di scrivere.
- Il test AUTH-005 usa IndexedDB sintetico: controlla una lettura account A, avvia una scrittura e commuta ad account B, verifica che la scrittura pendente venga rifiutata e che B non legga il record di A.

**Collegamento ancora esplicito, non automatico:** il chiamante deve passare la stessa istanza di lifecycleCoordinator a ogni repository (inclusi Profile, Shift, Absence, Settings, History, MigrationJob e Quarantine). I servizi usano i repository ricevuti e quindi ereditano la protezione. Non è ancora collegato il DOM dell'app operativa né esiste un composition root dell'app che istanzi e distribuisca il coordinatore. Le viste devono sottoscrivere gli eventi e cancellare cache/DOM; questo non va dichiarato completato.

La coordinazione è per singola istanza/scheda. Non risolve conflitti cross-tab, autenticazione, cifratura IndexedDB o protezione contro script same-origin. Non costituisce autorizzazione di sicurezza e non rende il core pronto per produzione.


## Sessione DSM condivisa

È disponibile `createDSMCoreSession({ db, accountId? })` da `src/core/database/index.js`. La factory crea un solo accountContext e un solo lifecycleCoordinator e li inietta in Profile, Shift, Absence, Settings, History, MigrationJob e Quarantine repository. Espone inoltre i servizi Profile, Shift, Absence e History che usano quegli stessi repository.

- Se `accountId` è fornito, l'account locale viene attivato dopo la fase iniziale di cleanup.
- `switchLocalAccount(nextAccountId)` esegue la transizione coordinata e attiva il nuovo account solo dopo cleanup.
- `logout()` esegue la transizione e lascia la sessione in stato `cleared`.
- `lifecycle.subscribe()` resta il punto d'integrazione per le viste: i listener dell'app devono svuotare cache e DOM e annullare richieste UI. La factory non modifica automaticamente l'interfaccia operativa né collega Firebase.

Il test AUTH-006 verifica con dati sintetici che servizio e repository condividano lo stesso coordinatore, che lo switch isoli i record dell'account precedente e che logout azzeri la sessione. La factory non trasforma account locali in identità autenticate e non modifica i limiti di sicurezza descritti sopra.


## Integrazione vista cronologia

`mountHistoryPage(container, { historyService, lifecycleCoordinator })` può ora ricevere il coordinatore della sessione. La vista cattura la generazione attiva prima della lettura e sottoscrive gli eventi lifecycle: su `transition-start` o `context-cleared` rimuove listener e contenuto dal container. Se la lettura asincrona termina dopo la transizione, il risultato viene scartato e non renderizzato. Il chiamante deve montare una nuova vista per l'account appena attivato.

Il test browser della cronologia simula una lettura pendente dell'account A, avvia lo switch a B, completa tardivamente la lettura A e verifica che il container resti vuoto. Questa integrazione riguarda la sola pagina cronologia DSM; non equivale al collegamento di tutte le schermate dell'applicazione operativa.
