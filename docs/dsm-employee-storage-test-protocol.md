# Protocollo di prova comparativa per lo storage Employee

**Stato:** piano di test documentale; non eseguito.
**Riferimento:** EMP-01…EMP-10 e `docs/dsm-employee-storage-comparison.md`.
**Ambiente:** solo fixture sintetiche isolate; nessun progetto/ambiente operativo, dato personale o credenziale.
**Gate:** nessun test di integrazione con un datastore concreto prima dell'approvazione separata del responsabile dello schema.

## 1. Scopo

Definire le prove che un candidato backend dovrà superare prima di essere selezionato come archivio canonico Employee. Le prove sono indipendenti dalla tecnologia dove possibile; i dettagli di implementazione (schema, path, tabelle, indici, query fisiche, harness) saranno definiti solo dopo la selezione e approvazione del candidato.

Non si devono creare collezioni/tabelle provvisorie nel progetto esistente, abilitare servizi cloud, introdurre driver o scrivere codice runtime in questa fase.

## 2. Dataset sintetico

Usare identificatori fittizi e namespace isolati:
- Account A e Account B.
- Employee EA-1, EA-2 in A; Employee EB-1 in B.
- UID U-1, U-2, U-3, senza corrispondenza a utenti Firebase reali.
- Sedi/reparti S-A1/D-A1, S-A2/D-A2 e S-B1/D-B1.
- Placement con intervalli espliciti, ad esempio [2026-01-01, 2026-06-01) e [2026-06-01, +∞); istanti e fusi trattati in modo uniforme.
- Turni sintetici prima/dopo il trasferimento, assenze sintetiche senza motivazioni mediche e record payroll con importi fittizi marcati come sensibili.

Il dataset deve essere riproducibile tramite seed deterministico e completamente eliminabile. Non usare email, codici fiscali, nomi o identificativi derivati da persone.

## 3. Casi di prova obbligatori

Ogni caso va eseguito su ogni candidato backend concreto, con risultato, log tecnico minimizzato e prova di persistenza/reload. I casi concorrenti devono usare barriere sincronizzate e ripetizioni multiple; un singolo esito fortuito non è sufficiente.

| ID | Scenario | Stimolo | Risultato richiesto |
|---|---|---|---|
| T01 | Un UID → due Employee | Due richieste concorrenti associano U-1 a EA-1 e EA-2 | Al massimo una associazione attiva; l'altra confligge e fallisce |
| T02 | Due UID → un Employee | Due richieste associano U-1 e U-2 a EA-1 | Al massimo un UID attivo per Employee |
| T03 | Retry idempotente | Ripetizione della stessa richiesta con medesima chiave idempotenza | Nessuna duplicazione; risposta coerente con esito originale |
| T04 | Retry conflittuale | Stessa chiave idempotenza con payload diverso | Rifiuto esplicito; nessuna mutazione |
| T05 | Account boundary | U-1/A tenta di risolvere o modificare EB-1/B | Deny; nessun dato del tenant B restituito |
| T06 | Stale revision | Due operatori leggono rev N; il secondo scrive dopo il primo | La scrittura stale è respinta e richiede rilettura |
| T07 | Trasferimento concorrente | Due trasferimenti simultanei dello stesso Employee verso placement incompatibili | Un solo stato coerente; mai due placement attivi |
| T08 | Intervalli sovrapposti | Inserimento retrodatato che interseca un placement esistente | Rifiuto fail-closed o correzione esplicita autorizzata; nessuna sovrapposizione |
| T09 | Contesto turno storico | Trasferire Employee dopo un turno precedente | Il turno conserva il placement valido alla data del turno |
| T10 | Revoca durante richiesta | Revocare binding/membership tra autorizzazione e mutazione | La mutazione non si completa usando una decisione ormai stale; policy di serializzazione documentata |
| T11 | Employee non attivo | Nuova operazione ordinaria su Employee sospeso/terminato | Deny; record storico resta conservato |
| T12 | Audit atomico | Forzare errore di scrittura audit nella mutazione critica | Nessuna mutazione senza audit richiesto; stato precedente integro |
| T13 | Audit attribution | Operatore A tenta di attribuire l'azione a operatore B | Actor derivato da contesto server verificato; payload actor contraffatto ignorato/rifiutato |
| T14 | Payroll isolation | Member/manager senza permission richiede payroll | Deny; nessun importo o metadato sensibile nel DTO/log |
| T15 | Absence minimization | Manager usa liste, conteggi, filtri, report ed export | Solo indisponibilità/intervallo; categoria sanitaria e inferenze non esposte |
| T16 | Query scoping | Richiesta con account/site/department non autorizzati o filtri manipolati | Scope applicato server-side prima della restituzione |
| T17 | Partial failure | Timeout/crash tra passaggi logici e retry | Nessuno stato parziale che violi invarianti; recupero/idempotenza documentati |
| T18 | Concorrenza ripetuta | Ripetere T01/T02/T07 con contention e ordine casuale | Invarianti sempre rispettati; conflitti espliciti, nessuna doppia associazione |
| T19 | Revoca e storico | Revocare accesso e interrogare storico | Nessun nuovo accesso ordinario; accesso storico solo con grant distinto |
| T20 | Data leakage | Ispezionare DTO, errori, query logs, export e metriche | Nessun segreto, token, payroll o dettaglio sanitario non autorizzato |

## 4. Oracoli e criteri di superamento

Un candidato supera la prova solo se:
1. ogni invariante EMP è rispettata dopo ogni interleaving concorrente;
2. nessuna risposta positiva si basa su dati client non attendibili;
3. ogni mutazione critica ha un esito atomico e revisionato, con audit richiesto coerente;
4. dopo riavvio/rilettura lo stato persistito resta coerente;
5. i test negativi dimostrano assenza di side channel nei DTO, aggregati, export ed errori;
6. i conflitti sono distinguibili da errori transitori e i retry non duplicano operazioni;
7. query, limiti e indici sono misurati su volumi sintetici concordati, senza inventare soglie prima della definizione degli SLO.

Non basta che il test restituisca un errore: bisogna verificare che nessuna scrittura parziale sia rimasta e che non siano stati divulgati dati.

## 5. Misure specifiche per candidato

### Firestore
- Verificare che il meccanismo di prenotazione delle due direzioni UID↔Employee sia serializzato e transazionale.
- Ripetere T01/T02/T07/T18 con contention e retry; raccogliere conflitti, latenza, retry e stato finale.
- Verificare i limiti effettivi delle transazioni e le letture/scritture coinvolte.
- Verificare query e indici per i casi d'uso approvati; nessun filtro di sicurezza affidato al client.
- Testare esplicitamente che l'uso Admin SDK non salti l'autorizzazione applicativa e che ogni endpoint rilegga membership, binding, permission e lifecycle.
- Verificare atomicità audit solo se mutazione e audit condividono una transazione supportata; separare poi il tema dell'immutabilità/privilegi.

### PostgreSQL
- Verificare vincoli UNIQUE e FOREIGN KEY per unicità e tenancy, incluse le associazioni concorrenti.
- Valutare vincoli temporali (ad esempio exclusion constraints su intervalli) e testare trasferimenti concorrenti e retrodatati.
- Testare livelli di isolamento, lock, deadlock, retry e serializzazione; non assumere che un livello scelto sia corretto senza prove.
- Verificare tenant scoping e, se adottata, Row-Level Security con ruoli applicativi non-owner e test di bypass.
- Verificare audit nella stessa transazione e privilegi separati per impedire alterazioni non autorizzate.

## 6. Metriche e report

Per ogni test registrare:
- candidato/versione e configurazione non segreta;
- seed e numero di ripetizioni;
- esito atteso/ottenuto e stato persistito dopo reload;
- numero di conflitti, retry, deadlock/abort e latenze p50/p95/p99;
- numero di letture/scritture o query e dimensione dei payload;
- costo stimato solo con listini e volumi approvati;
- log sanitizzati, senza UID reali, token, importi payroll o dati sanitari.

Non stabilire SLO, volumi o soglie economiche senza requisiti del responsabile del servizio. Un risultato funzionale non costituisce automaticamente un'approvazione di costo o produzione.

## 7. Gate e decisione

1. Il responsabile dello schema approva un candidato e un ambiente di test isolato, oppure autorizza esplicitamente un harness puramente in-memory che non pretende di provare le garanzie del datastore.
2. Si definiscono modello fisico minimo, query catalogue, SLO, volumi e responsabilità operative per il candidato scelto.
3. Si implementa solo il test harness autorizzato, senza endpoint di prodotto né accesso ai dati reali.
4. Si eseguono T01–T20 e si pubblica un rapporto con evidenze e limiti.
5. Il responsabile dello schema decide se selezionare il candidato, richiedere modifiche o respingerlo.

## 8. Limiti di questa fase

Questo documento è un protocollo, non un risultato di test. Nessun test Firestore/PostgreSQL è stato eseguito; nessun benchmark o garanzia è dichiarato. Nessun path, collection, tabella, indice, driver, progetto cloud o servizio è stato creato o selezionato. Nessuna implementazione, Rules, migrazione, provisioning, loader, endpoint/callable, wiring, credenziale, dato reale o deploy è autorizzato. EMP-10 resta invariata.


## 9. Harness di riferimento autorizzato

È stato aggiunto `tests/storage-harness/` con modelli in-memory semplificati e test per il sottoinsieme iniziale di invarianti: binding UID↔Employee 1:1, retry idempotente/conflittuale, isolamento namespace account e rollback mutazione/audit. Il comando previsto è `node --test tests/storage-harness/*.test.mjs` dalla root repository. Il codice non usa SDK, driver, emulator, rete, credenziali, schema fisico o servizi cloud.

**Limite essenziale:** i due modelli simulano forme transazionali semplificate; non sono adapter Firestore/PostgreSQL e non dimostrano le garanzie reali dei database. Il harness non è stato eseguito in questo ambiente. Nessun test superato viene dichiarato. Non copre ancora placement, revoca, lifecycle, payroll, assenze, query, crash recovery o durabilità/reload. Per tali proprietà e per test datastore reali servirà una distinta autorizzazione/approvazione dell'ambiente isolato.


## 10. Estensione del modello sintetico (non datastore)

È stato aggiunto `tests/storage-harness/domain-model.mjs` con prove pure in memoria per: intervalli di placement half-open e non sovrapposti, trasferimento con conservazione del contesto turno storico, rifiuto su placement mancante/ambiguo, revoca binding, lifecycle Employee/risorse organizzative, payroll deny-by-default e minimizzazione del DTO manager delle assenze. Sono esempi di policy deterministiche, non prove di persistenza, concorrenza datastore, query, recupero crash o sicurezza effettiva. Le permission payroll write/export, deleghe manager, report/aggregati e crash recovery restano fuori copertura.


## 11. Controlli aggiuntivi del modello di dominio in-memory

L'estensione corrente del modello verifica anche che il trasferimento sia atomico rispetto alla validazione: se il placement di destinazione non è valido, il placement precedente resta invariato. Verifica inoltre che un'operazione sia autorizzata solo se sede e reparto coincidono con il placement dell'Employee alla data dell'operazione, inclusi i confini temporali del trasferimento. Sono test del modello sintetico, non prove del comportamento di un datastore o dell'enforcement server-side nell'applicazione.
