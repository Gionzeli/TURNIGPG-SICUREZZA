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

## Flusso target

`casella collegata → messaggio/allegato → verifica provenienza → PDF isolato → estrazione → confronto → proposta personale → OK collaboratore → nuova revisione calendario`

- L'acquisizione non pubblica direttamente un PDF nel calendario.
- L'importazione crea una proposta con stato `awaiting_employee_approval`; non cambia i turni attivi.
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
- Non esistono ancora connettori email multi-provider, parser PDF aziendale, matching affidabile, proposta diff, approvazione self-service o notifiche.
- Prima di collegare caselle reali va definito e testato il processo autorizzato di associazione casella↔Employee e la gestione dei segreti.
- Sviluppo e test esclusivamente con fixture sintetiche e Firebase Emulator. Nessuna chiamata Firebase reale, nessun accesso a caselle reali, nessun deploy, merge o attivazione produzione.
