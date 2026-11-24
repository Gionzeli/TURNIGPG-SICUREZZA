# DSM — audit cambio account e operazioni pendenti

> **Stato corrente — aggiornato dopo la verifica del commit 1245967**
>
> Le sezioni di audit iniziali e gli aggiornamenti intermedi qui sotto sono una traccia cronologica: alcune decisioni e limitazioni descritte sono state successivamente superate. Per lo stato attuale fanno fede questa nota, la sezione **Integrazione vista cronologia** e la specifica [lifecycle-coordinator-design.md](./lifecycle-coordinator-design.md).
>
> - Il lifecycle coordinator è integrato in BaseRepository e nella session factory; la protezione delle viste non è universale.
> - `mountHistoryPage()` è l'unica vista DSM verificata collegata al coordinatore in questo branch; il collegamento è opzionale e dipende dal chiamante.
> - La vista distrugge listener e DOM su `transition-start`/`context-cleared`, e scarta letture asincrone stale.
> - Il runner Playwright verifica anche che un pulsante CSV conservato da una vista distrutta non possa generare un'esportazione dopo l'inizio della transizione.
> - Il bridge cross-tab è opzionale e best-effort; non rende persistenti le notifiche e non autentica né autorizza account.
> - Non esiste un composition root universale per tutte le schermate; Firebase e la UI operativa restano fuori dall'integrazione.
>
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

**Nota storica — superata dagli aggiornamenti successivi:** al momento di questa prima implementazione BaseRepository, servizi e viste non ricevevano ancora il coordinatore. Il wiring BaseRepository/sessione, l'integrazione opzionale della pagina cronologia e i test browser reali sono documentati nelle sezioni successive. Restano validi i limiti di sicurezza e di abort best-effort descritti qui.


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


## Retry delle transizioni nella session factory

La session factory conserva internamente il token opaco e la destinazione di una transizione se il cleanup fallisce. In questo caso `switchLocalAccount()` o `logout()` non attivano il nuovo contesto: la sessione resta `switching`. Il chiamante può invocare `resumePendingTransition()` per ripetere il cleanup; solo dopo il completamento vengono attivati il nuovo account o lo stato `cleared`. Se il retry fallisce, la sessione resta bloccata e la stessa API può essere richiamata nuovamente. AUTH-007 copre il caso sintetico di una risorsa vista che fallisce al primo cleanup e viene rilasciata al secondo tentativo.

## Limite tra schede

Il coordinatore e `accountContext` sono confinati all'istanza JavaScript della singola scheda. Un cambio account in una scheda non invalida automaticamente cache, viste o operazioni pendenti in un'altra scheda che usa lo stesso IndexedDB. Non considerare questo meccanismo un isolamento multi-tab o una barriera di sicurezza: prima dell'uso operativo servono un protocollo cross-tab verificato (ad esempio BroadcastChannel con gestione dei messaggi e fallback), un modello di autenticazione server-side e test di race tra schede.


## Bridge opzionale di invalidazione cross-tab

È stato aggiunto `createAccountLifecycleCrossTabBridge({ lifecycleCoordinator, channel, tabId })`, esportato dal database core. Il bridge usa un canale di messaggistica iniettato (ad esempio un'istanza `BroadcastChannel`) e pubblica soltanto notifiche minimali di transizione: tipo, versione, identificativo scheda e sequenza. Non invia accountId, credenziali, record, turni o contenuti delle viste.

- Quando una scheda avvia una transizione locale, le altre schede ricevono una notifica e, se hanno una sessione attiva, la portano a `cleared` dopo la propria pulizia locale. Non ricevono automaticamente il nuovo account: ogni scheda deve autenticarsi/attivarsi nuovamente attraverso il composition root autorizzato.
- I messaggi provenienti dalla stessa scheda, malformati o con sequenze duplicate/obsolete vengono ignorati.
- Se una pulizia remota fallisce, il bridge conserva il token e `retryPendingInvalidation()` permette di riprovare.
- Se una notifica arriva mentre la scheda è già in transizione, l'invalidazione viene rinviata fino al successivo evento di attivazione; se la scheda termina in logout, è già nello stato sicuro `cleared`.
- `createDSMCoreSession({ db, accountId, crossTabChannel, tabId })` collega il bridge solo quando il chiamante fornisce esplicitamente sia il canale sia un identificativo univoco per quella scheda. `session.dispose()` rimuove il listener.

AUTH-008 usa due canali sintetici nello stesso test browser e verifica l'invalidazione A→B, l'assenza di riattivazione da messaggio duplicato e il dispose.

**Limiti importanti:** il bridge è best-effort e non è una barriera di sicurezza. Richiede un canale funzionante, un `tabId` univoco per ogni scheda e un composition root che lo istanzi e gestisca le riattivazioni. Non offre persistenza delle notifiche: una scheda sospesa, offline o aperta dopo la notifica può non riceverla. Non sostituisce controlli di autorizzazione server-side, autenticazione, cifratura IndexedDB, né la gestione delle race con codice ostile same-origin. Non è stato collegato automaticamente all'app operativa o a Firebase.


Il bridge limita a 128 il numero di mittenti per cui conserva il contatore anti-replay, per evitare una crescita illimitata della memoria in presenza di messaggi non attendibili. `dispose()` rifiuta la dismissione se un'invalidazione remota è ancora pendente: prima va completata o ripetuta con `retryPendingInvalidation()`. AUTH-008 verifica anche il fallimento sintetico del primo cleanup remoto e il completamento al retry.


## Verifica browser reale cross-tab (2026-11-23)

Oltre al test con canali sintetici, il runner Playwright apre ora due pagine distinte nello stesso BrowserContext e usa il vero `BroadcastChannel` del browser. Il test avvia una transizione nella scheda A e attende che la scheda B raggiunga lo stato `cleared`, verificando che non resti un'invalidazione pendente; poi rilascia i canali e chiude il contesto browser.

Il workflow GitHub Actions `DSM Core browser tests` del commit `9926587ea3330ffb789c232f1061d171f189e4fb` (run `45256232821`) è terminato con esito `success`: installazione Playwright e step `Run IndexedDB browser tests` completati. Questa verifica conferma il comportamento del bridge nel caso testato tra due pagine Chromium; non elimina i limiti best-effort descritti sopra (schede sospese/offline, notifiche non persistenti, riattivazione account demandata al composition root).

## Verifica UI su cambio account — 2026-11-24

Il test `tests/browser/history-page-test.js` monta una seconda pagina cronologia con il coordinatore attivo e dati esclusivamente sintetici. Conserva un riferimento al pulsante CSV, avvia `beginTransition("switch")` e verifica che il container sia svuotato e il controller risulti distrutto. Clicca poi il vecchio riferimento al pulsante e intercetta `URL.createObjectURL`: nessun URL/CSV deve essere creato dopo la transizione. Il test prosegue attivando l'account sintetico B e mantiene separato il caso già presente della lettura asincrona stale.

Il commit `12459677f3a711318a7f2861d4b030e5dcf83894` ha superato entrambi i workflow sullo SHA esatto:
- Browser IndexedDB / Playwright, run [45457990347](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45457990347): `success`.
- Firestore Emulator, run [45457990326](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45457990326): `success`.

Il test dimostra la barriera UI della sola pagina cronologia DSM nel percorso provato; non dimostra che altre viste siano collegate né che una scrittura già completata sia reversibile. Non sono state modificate le regole Firebase operative o la UI Firebase.

