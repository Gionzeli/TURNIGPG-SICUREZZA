# Turnazioni da email aziendali — requisiti e architettura

**Data:** 2026-11-27  
**Branch:** `codex/employee-shift-date-range-query`  
**Stato:** requisiti di prodotto confermati; architettura proposta; nessun collegamento a caselle reali e nessuna attivazione produzione.

## Requisiti confermati dall'utente

1. I turni sono predisposti dall'azienda e arrivano come PDF via email. L'amministratore dell'app non prepara i turni.
2. Ogni collaboratore ha una turnazione individuale, con orari e postazioni/mansioni proprie.
3. Le caselle email possono usare provider diversi: non è accettabile imporre Gmail o Outlook.
4. Il sistema deve acquisire automaticamente i nuovi messaggi e gli allegati PDF, estrarre la turnazione e preparare l'aggiornamento.
5. Una modifica successiva deve essere confrontata con la versione precedente e applicata solo alle date/righe interessate; lo storico deve restare consultabile.
6. Il collaboratore, e soltanto il collaboratore interessato, verifica e approva la propria turnazione. L'amministratore non approva i turni.
7. È prevista anche l'inserimento manuale di una modifica aziendale da parte del collaboratore; anche questa modifica segue la conferma personale.
8. Buste paga e documenti individuali restano separati e accessibili solo al collaboratore autorizzato. Payroll rimane deny-by-default finché non esiste una decisione e un'implementazione specifica.

## Modalità di collegamento caselle confermate

Sono supportate entrambe le modalità, con isolamento server-side:

1. **Casella personale del collaboratore** (mode: personal): il collaboratore autorizza la propria casella. La configurazione server-side conserva il riferimento al binding canonico verificato (ownerEmployeeId + ownerUid); il worker risolve nuovamente il binding a ogni ingestione. Il PDF può non riportare un identificativo del collaboratore: l'identità deriva esclusivamente dalla casella personale già associata e verificata. Se il parser restituisce più documenti/persona, l'allegato viene fermato per revisione e non crea proposte.
2. **Casella aziendale condivisa** (mode: shared): la casella viene autorizzata da un soggetto aziendale con potere di collegamento, senza attribuirgli poteri di approvazione dei turni. Non ha un Employee proprietario. Ogni sezione del PDF deve contenere una chiave di corrispondenza verificabile; il server la risolve tramite mapping canonico, quindi crea proposte separate. Se una persona non è riconosciuta o la corrispondenza è ambigua, quella sezione viene bloccata.

Entrambe le modalità richiedono mittenti autorizzati e autenticazione del messaggio; entrambe usano lo stesso parser, confronto revisionato e approvazione individuale. La casella condivisa non concede all'amministratore accesso alle turnazioni individuali né la possibilità di approvarle. La modalità personale non può essere usata per importare turni di un altro Employee.

**Stato implementativo:** il core server-side ora valida esplicitamente personal/shared, richiede il proprietario canonico per la modalità personale e vincola il risultato del resolver allo stesso Employee/UID. La modalità personale rifiuta allegati suddivisi in più documenti; la modalità condivisa richiede una chiave di matching per ciascuna persona. Sono presenti test sintetici di isolamento per entrambe. I flussi OAuth/IMAP di consenso e revoca, l'interfaccia di collegamento, il worker, la persistenza delle connessioni e il parser PDF/OCR reale restano da implementare.

## Flusso target

`casella collegata → messaggio/allegato → verifica provenienza → PDF isolato → estrazione → confronto → proposta personale → OK collaboratore → nuova revisione calendario`

- L'acquisizione non pubblica direttamente un PDF nel calendario.
- L'importazione crea una proposta con stato `pending`; non cambia i turni attivi.
- La schermata personale mostra valori precedenti e nuovi, date coinvolte, origine del documento e differenze.
- Solo una callable autenticata, con binding UID↔Employee canonico verificato server-side, può approvare la proposta per quell'Employee.
- L'approvazione applica la proposta in transazione, controlla le revisioni attese, crea audit e conserva la versione precedente.
- Rifiuto/annullamento è registrato senza modificare il calendario.
- L'inserimento manuale crea la stessa tipologia di proposta, con provenienza `employee_manual`; non deve essere confuso con un PDF aziendale verificato.

## Connettori email multi-provider

Definire un'interfaccia provider-neutral, con adapter separati:
- IMAP/IMAP IDLE quando il provider lo supporta;
- polling IMAP schedulato come fallback;
- OAuth quando supportato dal provider;
- adapter specifici per API/webhook proprietari quando IMAP non è disponibile o non è abilitato.

Non promettere compatibilità universale: alcuni provider disabilitano IMAP, richiedono OAuth/app-password o non espongono API compatibili. La configurazione deve verificare il provider e mostrare chiaramente il metodo supportato.

I connettori devono essere eseguiti in un worker/server trusted, mai nel browser. Segreti e refresh token non vanno salvati in chiaro in Firestore o LocalStorage; usare un secret manager/KMS, cifratura, rotazione e revoca. Il sistema deve supportare disconnessione immediata della casella.

## Sicurezza e integrità

- Associare ogni casella a un account DSM e a uno o più Employee attraverso un processo di collegamento verificato e autorizzato; mai fidarsi del solo indirizzo email o di un Employee ID inviato dal client.
- Allowlist dei mittenti/domini configurata e verificata; la sola presenza di un PDF non prova che il documento provenga dall'azienda.
- Idempotenza su provider + mailbox + message-id + hash allegato; deduplicare inoltri e retry.
- Antivirus/sandbox e limiti dimensione/formato prima del parsing; PDF cifrati, corrotti o non leggibili vanno in quarantena.
- Il parser produce dati candidati tipizzati e un livello di confidenza; non inventa valori. Ambiguità su collaboratore, data, turno o sovrapposizione blocca la proposta e richiede correzione nel contesto personale.
- Se un PDF contiene più collaboratori, separare i dati per Employee senza esporre gli altri turni al destinatario; non associare in base al solo nome.
- Confronto deterministico per Employee + data + identificatore/chiave turno; modificare solo le righe identificate con certezza. Conflitti di revisione non sovrascrivono dati.
- Registrare hash del PDF, metadati minimi del messaggio, parser version, autore della modifica, decisione del collaboratore, timestamp e revisione. Conservare il documento originale solo secondo retention e access policy approvate.
- I dati non pertinenti (buste paga, IBAN, salute, note personali) non entrano nel DTO turnazione.

## Modello dati proposto (da implementare con validazione)

- `mailboxConnections/{connectionId}`: account, tipo provider, protocollo, stato, riferimenti secret manager, cursor/checkpoint; mai password/token in chiaro.
- `mailboxEmployeeScopes/{scopeId}`: legame autorizzato casella↔Employee/account e regole mittente.
- `scheduleIngestionJobs/{jobId}`: stato elaborazione, idempotency key, hash documento, esito parser, error code non sensibile.
- `employeeShiftProposals/{proposalId}`: Employee canonico, origine, date coinvolte, diff allowlist, expected revisions, stato e scadenza.
- `employeeShiftProposalDecisions/{decisionId}`: UID verificato, Employee vincolato dal server, approvazione/rifiuto, timestamp e revisione.
- `employeeShifts`: calendario pubblicato solo dopo approvazione personale; revisioni e audit immutabili.

I nomi e i campi sono una proposta, non una migrazione già autorizzata. Le scritture devono passare da servizi trusted e callable server-authorized; Firestore Admin SDK non applica le Rules.

## Stato implementativo e prossimi incrementi

- Esiste già la lettura self-service dei turni con intervallo date e DTO allowlist.
- L'UI del calendario resta in sola lettura finché non è pronto il flusso di proposta e approvazione. È stata rimossa la precedente azione di modifica diretta perché avrebbe pubblicato modifiche senza il nuovo consenso personale.
- Esistono servizi shift self-service con revisione e audit, ma non equivalgono a un workflow di proposta/approvazione e non devono essere usati come scorciatoia per importare PDF.
- Le callable pubbliche `createOwnEmployeeShift`, `updateOwnEmployeeShift` e `deleteOwnEmployeeShift` restano esportate per compatibilità ma ora falliscono con `failed-precondition`; le relative autorizzazioni di membership sono state rimosse. Il calendario e le API sono quindi in sola lettura finché non sarà disponibile il flusso di proposta/approvazione. I vecchi metodi interni del service non sono esposti da queste callable.
- Sono implementate le callable `proposeOwnEmployeeShiftChanges`, `listOwnEmployeeShiftProposals`, `approveOwnEmployeeShiftProposal` e `rejectOwnEmployeeShiftProposal`. Il server ricava l’Employee dal binding canonico verificato e accetta decisioni soltanto dal collaboratore con ruolo member. Le proposte sono limitate a 30 variazioni e usano DTO allowlist.
- L’approvazione verifica nuovamente appartenenza, ambito organizzativo e revisioni attese. Tutte le modifiche, gli audit, la decisione immutabile in `employeeShiftProposalDecisions` e gli snapshot allowlist in `employeeShiftRevisions` vengono scritti in un’unica transazione. Un conflitto impedisce l’intera applicazione; una proposta già decisa non può essere riapplicata.
- La UI personale mostra le proposte e offre approvazione/rifiuto; non espone modifiche dirette al calendario.
- La UI personale consente di proporre manualmente la creazione, modifica o eliminazione di un turno selezionato dal proprio calendario e di rivedere/approvare/rifiutare le proposte. Restano da completare i connettori email multi-provider, il parser PDF/OCR reale, il worker schedulato, la persistenza Firestore del processo di ingestione e le notifiche. Nessuna casella reale è ancora collegata.
- È stato aggiunto un core di ingestione provider-neutral (`employee-schedule-email-ingestion.js`): applica allowlist esatta del mittente e richiede autenticazione email verificata (DMARC pass e DKIM o SPF pass), controlla firma PDF e limite dimensione, richiede scansione antivirus pulita, usa idempotenza provider/casella/message-id/hash e valida i dati estratti. Risolve l’Employee esclusivamente tramite callback trusted di mapping canonico verificato, separa i collaboratori presenti nello stesso PDF e calcola differenze conservative. Non deduce cancellazioni dall’assenza di righe nel PDF, blocca matching ambiguo o confidenza inferiore al 98% e non interpreta campi/flag assenti come valori falsi o cancellazioni. Crea proposte `employer_email` separate, approvabili soltanto dal collaboratore vincolato al binding UID↔Employee e con provenienza/hash verificati.
- Il core è un modulo server-side con dipendenze iniettate e test sintetici: non è ancora collegato a IMAP/OAuth/API, a un worker schedulato, a Secret Manager o a un parser PDF/OCR reale. Le caselle reali restano disabilitate; i callback di persistenza/idempotenza dovranno essere implementati con transazioni Firestore e adapter trusted prima dell’attivazione.\n- Prima di collegare caselle reali va definito e testato il processo autorizzato di associazione casella↔Employee e la gestione dei segreti.
- Sviluppo e test esclusivamente con fixture sintetiche e Firebase Emulator. Nessuna chiamata Firebase reale, nessun accesso a caselle reali, nessun deploy, merge o attivazione produzione.

## Incremento integrazione — orchestrazione worker provider-neutral

È stato aggiunto `functions/src/membership/mailbox-schedule-ingestion-worker.js` con test sintetici dedicati. Il worker:
- elenca connessioni dovute per account e rifiuta righe duplicate o fuori ambito;
- acquisisce un lease per singola casella prima di contattare l'adapter;
- rilegge la connessione canonica e processa soltanto connessioni attive;
- invoca adapter provider-neutral che restituiscono messaggi normalizzati, poi delega ogni messaggio al core di ingestione già esistente;
- avanza il cursore soltanto dopo l'elaborazione completa del batch e una seconda verifica che la casella sia ancora attiva;
- in caso di errore non avanza il cursore, così il provider può riproporre i messaggi e l'idempotenza degli allegati evita duplicazioni;
- rilascia il lease anche in caso di errore, lasciando la scadenza del lease come recupero se il rilascio fallisce.

Questo è il primo collegamento di orchestrazione tra polling provider e pipeline di proposte; non abilita ancora provider reali. Restano da implementare e collegare adapter IMAP/Gmail/Graph, lease e checkpoint Firestore transazionali, scheduler/worker Firebase, scansione antivirus e parser PDF reali. Il worker non è esportato come callable e non viene eseguito automaticamente. Test esclusivamente sintetici; nessun account reale o deploy.

## Collegamento Firestore del polling

È stato aggiunto `mailbox-schedule-ingestion-firestore-adapters.js`:
- interroga `accounts/{accountId}/mailboxPolling` per `nextPollAt <= now`, con batch limitato;
- inizializza idempotentemente lo stato di polling solo per una connessione canonica attiva;
- legge la connessione canonica e delega acquire/release al servizio lease già esistente;
- salva il cursore in transazione solo se il cursore precedente coincide e il lease owner/fencing token sono ancora quelli del worker, non scaduti e non revocati;
- pianifica il prossimo polling dopo il completamento del batch.

È stato aggiunto l'indice Firestore per `mailboxPolling.nextPollAt`. L'inizializzazione dello stato è ora invocata dal servizio di creazione connessione tramite una dipendenza obbligatoria; il composition root deve ancora iniettare l'adapter Firestore e il worker schedulato Firebase non è ancora cablato. Il test harness unitario è sintetico; è stato aggiunto anche un test d'integrazione condizionato alla presenza del Firebase Emulator, non ancora eseguito.

## Collegamento alla creazione della casella

Il servizio server-side `mailbox-connection-service.js` ora richiede `initializePollingState` e lo invoca subito dopo il salvataggio della connessione attiva, prima dell'audit di creazione. Se l'inizializzazione fallisce, il flusso esistente entra nel percorso fail-closed: marca la connessione `revocation_pending`, disabilita il refresh e avvia la pulizia delle credenziali. Il test sintetico copre anche questo rollback.

L'adapter Firestore fornisce `initializePollingState`, quindi il punto di aggancio è definito; manca ancora il composition root che costruisca e inietti concretamente il servizio connessioni e gli adapter nella funzione schedulata. Nessuna funzione schedulata è stata abilitata.
