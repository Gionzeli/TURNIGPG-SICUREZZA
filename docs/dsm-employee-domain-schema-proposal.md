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
| EMP-04 | Placement multiplo e storico | Storico append-only o versionato; un solo placement attivo salvo policy multi-site esplicita. |
| EMP-05 | Shift ownership | Ogni turno collegato a Employee; delega manager con permission dedicata. |
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
