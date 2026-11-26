# DSM employee-domain schema — proposta per revisione

**Stato:** direzione di dominio approvata limitatamente alla separazione Employee/payroll e alla compatibilità dell'identificatore; proposta non operativa per tutto il resto.
**Riferimento:** branch `dsm-enterprise/core-v1`, modello A UID Firebase → dipendente approvato solo come policy isolata.
**Ambito:** entità dipendente canonica, dati contrattuali/retributivi separati, riferimenti di turni e assenze.
**Vincoli:** esempi esclusivamente sintetici; nessuna scelta definitiva di percorso Firestore, Rules, indice, migrazione, provisioning o deploy.

## 1. Obiettivo e principio di separazione

Introdurre un'identità di lavoro stabile per ogni rapporto dipendente nell'account, indipendente:
- dall'identità di accesso Firebase;
- dai dati contrattuali e retributivi;
- dall'organizzazione corrente (sede/reparto);
- dai singoli turni e dalle singole assenze.

La proposta raccomanda un'entità dipendente canonica separata dai dati payroll. Il binding del modello A dovrebbe risolvere l'UID verificato verso questa identità canonica, non usare email, nome, codice fiscale, UID scelto dal client o un record IndexedDB come prova di proprietà.

**Decisione approvata il 2026-11-26:** il campo logico `profileId` del binding A identifica l'entità canonica `Employee` e ne rappresenta l'ID stabile (`employeeId` nel dominio). Il nome `profileId` resta invariato nel contratto del modulo di policy isolato per compatibilità; il loader dovrà mapparlo esplicitamente all'ID Employee. Questa scelta non rende il binding operativo e non approva percorsi Firestore, cardinalità, provisioning, lifecycle o migrazione.

## 2. Entità logiche proposte

I nomi sotto sono concetti di dominio, non percorsi o collection Firestore approvati.

### 2.1 Employee (identità lavorativa)

Campi minimi candidati:
- `employeeId`: identificatore opaco, immutabile e generato/assegnato da backend.
- `accountId`: account proprietario; deve corrispondere al contenitore canonico.
- `status`: vocabolario da approvare; proposta iniziale `active`, `suspended`, `terminated`, `archived`.
- `createdAt`, `updatedAt`: timestamp server-side.
- `revision`: intero monotono per concorrenza, se adottato.

Non inserire nel record identificativo dati retributivi, categorie di assenza, credenziali o token. Nome e dati di contatto, se necessari, richiedono una decisione separata su minimizzazione, accesso e retention. Il record non deve contenere un UID Firebase come proprietario modificabile dal dipendente.

### 2.2 Employee placement (assegnazione organizzativa)

Rappresenta l'assegnazione corrente e, se richiesto, la storia delle assegnazioni:
- `employeeId`, `accountId`;
- `siteId`, `departmentId`;
- `validFrom`, `validUntil` o intervallo equivalente;
- `status`, `revision`, timestamp server-side.

L'assegnazione deve riferirsi a sede e reparto canonici dello stesso account e rispettare il lifecycle ORG-02. Un trasferimento non deve riscrivere retroattivamente il contesto storico dei turni già svolti. La policy per intervalli sovrapposti, trasferimenti retrodatati e dipendente senza assegnazione corrente resta da approvare.

### 2.3 Employment terms / compensation (dominio separato)

I campi oggi conservati in `ProfileService.params` e `ProfileService.profile` non devono essere inclusi automaticamente nell'Employee DTO. Proposta:
- mantenere i termini contrattuali/retributivi in un dominio separato;
- riferirli a `employeeId` e, se necessario, a intervalli di validità;
- applicare permessi specifici per lettura/scrittura ed esportazione;
- non concedere visibilità payroll per il solo ruolo admin/manager/member o per il solo binding UID;
- evitare che i normali endpoint profilo restituiscano l'intero documento payroll.

La struttura dei campi, le versioni dei termini e le regole di calcolo non sono oggetto di questa proposta.

### 2.4 Shift

Ogni turno futuro gestito da API protetta dovrebbe contenere un riferimento backend-authoritative `employeeId`, oltre ai campi già presenti (data, tipo, post, orari, flag e ore). Il server:
- imposta/valida l'account e l'employeeId usando l'identità e la policy dell'operazione;
- verifica che dipendente e risorsa siano attivi;
- verifica l'assegnazione organizzativa valida alla data del turno secondo regole da approvare;
- rifiuta cambi client di account, owner o riferimenti organizzativi non autorizzati.

Per il member, il target employee deve corrispondere al binding personale. Per manager/delegati, serve un permesso esplicito di gestione turni e verifica della sede/reparto corrente o storica secondo la data. Non basta il generico `dsm:read:own-scope`.

### 2.5 Absence

Ogni assenza dovrebbe essere riferita a `employeeId` e account; l'accesso ai dati resta distinto:
- il dipendente può leggere le proprie assenze secondo la policy approvata;
- una vista team/manager dovrebbe esporre solo il minimo dato necessario alla pianificazione;
- la categoria `malattia` non deve essere inclusa in elenchi generici o DTO manager per impostazione predefinita;
- accesso alla categoria, eventuale documentazione e gestione amministrativa richiedono permessi separati e revisione privacy;
- gli intervalli storici devono restare riferiti al dipendente anche dopo trasferimento o cessazione.

Non introdurre note sanitarie, diagnosi o documenti medici nel modello proposto.

## 3. Relazioni logiche

```text
Firebase verified UID
        |
        | backend-owned binding (model A)
        v
Employee (stable employeeId)
        |--------------------|
        v                    v
Employee placement      Employment terms /
(site, department,       compensation (restricted)
 validity history)
        |
        +------ Shift(employeeId, date, ...)
        |
        +------ Absence(employeeId, date range, restricted kind)
```

Il diagramma descrive relazioni di dominio, non una struttura Firestore. Non definisce se binding e employee siano documenti nello stesso contenitore, collection separate o altro archivio.

## 4. Regole invarianti candidate

1. Ogni Employee appartiene a un solo account; gli ID non sono riutilizzati.
2. Un record Employee non viene identificato dal nome, email, numero telefonico o UID Firebase.
3. Il binding viene risolto solo dal UID verificato lato server; nessun endpoint accetta un employeeId client come prova di ownership.
4. Ogni shift/absence appartiene a un employeeId canonico dello stesso account.
5. Ogni operazione protetta ricarica membership, binding, Employee, lifecycle e relazioni organizzative necessarie al momento dell'operazione.
6. Member self-service: il target deve coincidere con l'Employee risolto dal binding.
7. Manager: accesso delegato distinto, con permission esplicita, scope organizzativo corrente e DTO minimizzato.
8. La visibilità payroll è indipendente dall'accesso al profilo e dai ruoli generici.
9. La categoria di assenza sensibile è esclusa dai DTO generici; ogni eccezione richiede permission esplicita e giustificazione approvata.
10. Trasferimenti/cessazioni non alterano l'owner storico dei record; la regola di accesso storico deve essere definita separatamente.
11. Missing, archived, malformed, cross-account, stale revision o relazioni incoerenti comportano deny.
12. Le mutazioni critiche usano transazioni/versioni e audit server-side; audit non contiene valori payroll, dettagli sanitari, token o payload non necessari.

## 5. Cardinalità da decidere

Il modello A è stato approvato, ma queste cardinalità non sono ancora approvate:
- un UID Firebase attivo → un solo Employee per account oppure più rapporti/ruoli;
- un Employee → uno o più UID (recupero account, cambio provider, identità duplicate);
- un Employee → un solo placement attivo oppure più sedi/reparti contemporanei;
- un Employee → più rapporti contrattuali nel tempo;
- turni/assenze possono essere creati prima dell'assegnazione organizzativa o solo dopo.

**Default prudenziale proposto:** non permettere associazioni multiple attive o sovrapposte finché il prodotto non ne definisce esplicitamente il caso d'uso. Il backend deve comunque rilevare duplicati/conflitti e negare, non scegliere arbitrariamente il primo record.

## 6. Lifecycle e audit da definire

Eventi da considerare: creazione dipendente, attivazione, sospensione, riattivazione, trasferimento, cessazione, archiviazione, binding, revoca, riassegnazione, modifica dei termini e correzione retroattiva.

Per ogni evento definire:
- attore autorizzato e secondo approvatore, se necessario;
- prova fuori banda della corrispondenza tra persona e rapporto;
- motivazione/codice causale;
- effective date e timestamp effettivo server-side;
- revisioni e gestione dei conflitti;
- retention e accesso all'audit;
- comportamento per sessioni/identità revocate e accessi storici.

Non implementare provisioning automatico basato su email, display name, codice fiscale caricato dal client o importazione legacy.

## 7. Migrazione futura — non autorizzata

Se il modello verrà approvato, la migrazione dovrà essere progettata separatamente:
1. inventario e classificazione delle fonti;
2. generazione di ID sintetici/stabili senza collisioni;
3. mapping revisionabile e approvato persona→Employee;
4. dry-run e report di conflitti senza scritture;
5. doppia verifica delle associazioni;
6. import transazionale e audit solo dopo autorizzazione esplicita;
7. rollback e riconciliazione.

Questo documento non autorizza alcuna lettura, importazione o migrazione di dati reali.

## 8. Decisioni richieste

| ID | Decisione | Default prudenziale proposto, non approvato |
|---|---|---|
| EMP-01 | Employee separato dal profilo/payroll? | **APPROVATO:** sì, entità identitaria minimale e dominio terms/payroll separato. |
| EMP-02 | Semantica di `profileId` nel binding A | **APPROVATO:** `profileId` identifica l'Employee canonico; mapping esplicito a `employeeId`, senza rinominare il contratto isolato. |
| EMP-03 | Cardinalità UID↔Employee | Una sola associazione attiva per account in entrambe le direzioni fino a diversa approvazione. |
| EMP-04 | Placement multiplo e storico | **APPROVATO:** un solo placement organizzativo attivo per Employee; trasferimenti storicizzati, intervalli non sovrapposti e contesto storico dei turni preservato. |
| EMP-05 | Shift ownership | **APPROVATO:** ownership Employee canonica assegnata/verificata dal backend; self-service limitato ai propri turni; delega manager con permission esplicita e scope verificato alla data del turno. |
| EMP-06 | Absence privacy | DTO manager minimizzato; categoria malattia non visibile per default. |
| EMP-07 | Payroll permissions | Dominio e permission separati; nessun grant implicito da ruolo. |
| EMP-08 | Lifecycle | Stati, transizioni, cessazione e accesso storico da approvare. |
| EMP-09 | Provisioning e identity proof | Procedura amministrativa verificata fuori banda, auditata e revocabile. |
| EMP-10 | Percorsi e tecnologia | Nessun path Firestore scelto finché schema owner non approva. |

## 9. Sequenza di implementazione dopo approvazione

1. EMP-01 ed EMP-02 sono approvati; decidere separatamente EMP-03…EMP-10 e allineare le decisioni LINK pertinenti.
2. Stabilire il contratto ID Employee e la compatibilità con `profileId` del binding isolato.
3. Approvare il modello lifecycle e placement insieme a ORG-01/02.
4. Definire DTO/permissions separati per employee, payroll, shifts e absences.
5. Definire percorsi backend e query; solo allora scrivere loader canonici.
6. Implementare i loader su emulator con dati sintetici e fail-closed.
7. Implementare endpoint per dominio, uno alla volta, con ownership individuale e scope organizzativo separati.
8. Testare accesso same-site cross-employee, manager cross-site, revoca/trasferimento, payroll leakage e assenza sensibile.
9. Revisione sicurezza/privacy indipendente prima di qualunque integrazione operativa.

## 10. Non autorizzazione esplicita

Questa decisione approva soltanto la separazione concettuale Employee/payroll (EMP-01) e la semantica compatibile di `profileId` (EMP-02). Non approva percorsi Firestore, schema fisico definitivo, cardinalità, placement, lifecycle, provisioning, migrazioni, Rules, endpoint, UI, accesso a dati reali, credenziali o deploy. Non modifica il runtime e non rende attivo il binding A. PR #1 deve restare Draft fino alle decisioni e verifiche separate.


## 11. Audit tecnico dei servizi esistenti — 2026-11-26

Verifica documentale dei file sul commit `20881c3aca2f8d64fffb8336f3fc526860cf9af7`:

| Area | Evidenza nel codice attuale | Implicazione |
|---|---|---|
| Profilo | `ProfileService` persiste `params` retributivi e `profile` con CCNL/sezione/livello/ruolo/decorrenza; nessun Employee ID o owner autorevole. | La separazione concettuale Employee/payroll è necessaria; il profilo locale attuale non può fungere da fonte canonica. |
| Turni | `ShiftService` accetta data, tipo, post/nota, orari, flag e ore; non accetta un employeeId. | Ownership individuale e collegamento storico non sono implementati. Non aggiungere ID client come prova di proprietà. |
| Assenze | `AbsenceService` accetta `kind` (incluso `malattia`) e intervallo date; nessun employeeId o DTO manager distinto. | La categoria sensibile è presente nel dominio locale; qualsiasi futura API manager deve applicare minimizzazione e permessi espliciti. |
| Binding | `resolveOwnEmployeeBinding` usa loader iniettati e verifica il profilo attivo; nessun adapter Firestore o endpoint. | Il modulo è una policy isolata, non un flusso operativo. |
| Risorse organizzative | `resource-resolver.js` verifica identità/account/relazioni parentali ma il contratto loader non richiede `status: active`. | ORG lifecycle resta un prerequisito prima di API protette. |

### Stato raccomandazioni EMP-03…EMP-10 (aggiornato)

- **EMP-03 / LINK-01/02:** partire con cardinalità 1:1 attiva per account; rifiutare duplicati e conflitti, senza scegliere automaticamente un binding. Riesaminare solo con un caso d'uso concreto per account recovery o identità multiple.
- **EMP-04:** consentire un solo placement corrente per Employee; conservare gli intervalli precedenti in modo versionato/append-only. Nessuna sovrapposizione implicita.
- **EMP-05 — APPROVATO:** ogni shift deve avere ownership canonica Employee assegnata/verificata dal backend; self-service solo sui propri turni, senza accettare employeeId client come prova di proprietà. Manager/delegati richiedono permission esplicita per operazione e scope organizzativo verificato rispetto alla collocazione valida alla data del turno. Il contesto storico del turno non viene riscritto dopo trasferimenti.
- **EMP-06:** DTO manager senza categoria `malattia` e senza note/documenti sanitari; distinguere “assenza pianificabile” dai dettagli sensibili. Accesso eccezionale con permission separata e audit.
- **EMP-07:** payroll separato e negato per default; permission esplicite per lettura, modifica ed export, senza grant implicito dal ruolo admin/manager.
- **EMP-08:** nessuna tassonomia definitiva proposta in assenza di decisione ORG lifecycle; qualunque stato mancante, sconosciuto o non attivo deve negare accesso. Cessazione/revoca non cancella l'ownership storica.
- **EMP-09:** provisioning manuale amministrativo con verifica della persona fuori banda, approvazione tracciata, reason code, revisione/concorrenza e revoca; mai auto-match per email/nome o import client.
- **EMP-10:** mantenere il dominio storage-agnostic finché il responsabile schema non approva tecnologia e percorsi; non inferire path Firestore da esempi o percorsi membership esistenti.

Questi punti sono raccomandazioni per decisione, non approvazioni dell'utente e non autorizzano implementazione. In particolare, nessun loader, endpoint, Rules, migrazione o modifica runtime è stato creato.


## 12. Approvazione esplicita EMP-03 — 2026-11-26

**Decisione approvata dall'utente:** cardinalità attiva 1:1 tra UID Firebase verificato ed Employee canonico, entro lo stesso account.

Invarianti approvate:
- ogni UID Firebase verificato può avere al massimo un binding attivo verso un Employee nell'account;
- ogni Employee può avere al massimo un UID Firebase attivo nell'account;
- duplicati, associazioni concorrenti e conflitti in entrambe le direzioni devono essere rifiutati (fail-closed);
- il sistema non deve scegliere automaticamente un binding in presenza di più candidati o conflitti.

L'approvazione definisce la cardinalità logica, non il modello fisico di persistenza. Restano da decidere separatamente provisioning, verifica della persona, revoca/riassegnazione, lifecycle, audit e storage/path (EMP-08…EMP-10 e decisioni correlate). Non autorizza loader concreti, endpoint, Rules, migrazioni, wiring applicativo, accesso a dati reali o deploy. Il binding A resta una policy isolata e non attiva nell'applicazione.


## 13. Approvazione esplicita EMP-04 — 2026-11-26

**Decisione esplicita dell'utente:** approvata la regola di un solo placement organizzativo attivo per Employee, con trasferimenti storicizzati.

Invarianti approvate:
- ogni Employee può avere **un solo placement organizzativo corrente** alla volta;
- un trasferimento chiude il placement precedente e crea un nuovo placement, senza sovrascrivere o cancellare la storia;
- gli intervalli temporali dei placement dello stesso Employee non possono sovrapporsi;
- i turni storici devono conservare il contesto organizzativo valido alla data del turno; il trasferimento non deve riscrivere retroattivamente quel contesto;
- record ambigui, conflittuali o con intervalli incoerenti devono essere rifiutati fail-closed, senza selezione automatica.

La regola non consente assegnazioni organizzative simultanee a più sedi/reparti per lo stesso Employee. Un eventuale caso multisede simultaneo richiederà una nuova decisione esplicita e una policy dedicata; non è incluso in questa approvazione.

L'approvazione definisce l'invariante di dominio, non lo schema fisico o il meccanismo di persistenza. Non approva path Firestore, lifecycle completo ORG/Employee, provisioning, loader, endpoint, Rules, migrazioni, wiring applicativo, accesso a dati reali o deploy. In particolare, i campi e i servizi attuali di Shift non implementano ancora la conservazione server-authoritative del contesto storico. Nessuna modifica runtime è autorizzata da questa decisione.


## 14. Approvazione esplicita EMP-05 — 2026-11-26

**Decisione esplicita dell'utente:** approvata la policy di ownership e accesso ai turni descritta nella proposta.

Invarianti approvate:
- ogni turno deve essere associato a un `employeeId` canonico; il collegamento è assegnato e verificato dal backend, non provato da un identificatore inviato dal client;
- il dipendente può leggere e gestire esclusivamente i propri turni tramite il binding personale verificato;
- manager/delegati possono operare sui turni altrui soltanto con una permission esplicita e specifica per l'operazione, oltre a uno scope organizzativo autorizzato;
- lo scope del manager/delegato deve essere verificato rispetto alla collocazione Employee valida alla data del turno, non soltanto rispetto alla collocazione attuale o al ruolo;
- il turno conserva il contesto organizzativo valido quando è stato svolto; trasferimenti successivi non riscrivono la storia;
- identità, Employee, turno, collocazione, intervallo temporale o permesso mancanti, ambigui, incoerenti, revocati o fuori scope comportano rifiuto fail-closed;
- leggere, creare, modificare e cancellare turni sono operazioni autorizzative distinte; nessun privilegio deriva implicitamente dal solo ruolo manager.

L'approvazione definisce la policy di dominio e autorizzazione, non la sua implementazione. Non approva uno schema fisico o path Firestore, il lifecycle completo, provisioning, loader concreti, endpoint, Rules, migrazioni, wiring applicativo, accesso a dati reali o deploy. I servizi Shift attuali non contengono un riferimento Employee canonico e non applicano questa policy. Nessuna modifica runtime è stata autorizzata o effettuata.
