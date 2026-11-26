# Confronto tecnico degli storage candidati per il dominio Employee

**Stato:** Firestore selezionato dall'utente il 2026-11-26 per il backend canonico Employee; modello fisico documentato in `docs/dsm-employee-firestore-decision.md`.
**Decisione di riferimento:** EMP-10 approvata il 2026-11-26 (confine storage-agnostic).
**Branch:** `dsm-enterprise/core-v1`; valutazione basata sul codice e sui documenti presenti all'HEAD di audit.
**Dati:** nessun dato reale; nessuna prova di carico o benchmark economico eseguito.

## 1. Scopo e confini

Questa specifica valuta i candidati per un futuro archivio backend canonico Employee e per le relazioni collegate (binding UID, placement, turni, assenze, termini/payroll e audit). Non sceglie collection, path, tabelle, colonne, indici o servizi cloud.

Le policy di dominio EMP-01…EMP-09 sono requisiti approvati. EMP-10 stabilisce che la tecnologia e i percorsi fisici richiedono una decisione separata del responsabile dello schema. L'utente ha successivamente autorizzato esplicitamente la scelta e l'implementazione dello storage (2026-11-26); la decisione è registrata nel documento dedicato.

## 2. Evidenze verificate nel repository

- Il backend usa Firestore Admin SDK per la membership al percorso già esistente `accounts/{accountId}/members/{uid}`; nomination e membership audit hanno altri percorsi esistenti.
- `functions/src/index.js` inizializza Firebase Admin e legge la membership. Il callable di risoluzione identità/membership non è una API Employee.
- `functions/src/membership/employee-binding.js` valida un binding ricevuto da loader iniettato; non contiene adapter Firestore né definisce percorsi. `loadActiveProfile` è anch'esso iniettato.
- `resource-resolver.js` riceve loader account/site/department iniettati e documenta esplicitamente l'assenza di percorsi canonici approvati.
- Le proposte organizzative descrivono concetti e alcuni esempi; dichiarano che i percorsi account/site/department sono proposte e non schema fisico approvato.
- I servizi profilo, turni e assenze correnti sono locali/IndexedDB; non costituiscono archivio backend Employee. Turni e assenze non hanno ownership Employee server-authoritative.
- Le Firestore Rules sotto `functions/emulator-only.rules` negano tutto e sono emulator-only. Le Rules operative root sono un modello legacy separato e non possono essere considerate prova di protezione per un futuro schema Employee.
- Le API dati protette non sono implementate; `health` dichiara `protectedDataApisImplemented: false` e `authorizationImplemented: false`.

Queste evidenze descrivono lo stato del repository, non una decisione di architettura.

## 3. Requisiti non negoziabili da dimostrare

1. **Tenancy:** ogni record e relazione Employee deve essere confinato a un account; nessuna risoluzione deve dipendere da un accountId non verificato lato server.
2. **Binding 1:1 attivo:** unicità in entrambe le direzioni UID↔Employee entro account, compresi tentativi concorrenti e retry. Conflitti e duplicati devono fallire senza selezione automatica.
3. **Atomicità e revisioni:** binding, stato Employee, eventuale placement e audit richiesto devono rispettare invarianti transazionali; revisioni stale devono essere respinte.
4. **Placement storico:** un solo placement attivo; intervalli non sovrapposti; trasferimento senza riscrittura del contesto dei turni storici.
5. **Lifecycle e revoca:** stato canonico e membership/binding rivalutati server-side per ogni operazione protetta; nessuna autorizzazione basata su principal browser memorizzato.
6. **Separazione dati:** Employee identitario separato da compensation/payroll; assenza manager minimizzata senza categoria sanitaria o dettagli medici in query, aggregati, filtri ed export ordinari.
7. **Audit:** attore, azione, target, reason code, effective date, timestamp server e revisioni; nessun token, segreto, importo payroll o dettaglio sanitario non necessario. Le mutazioni critiche e l'evento audit devono essere atomici dove richiesto.
8. **Query e accesso:** query vincolate sul server prima della restituzione, paginazione limitata, DTO allowlist, permessi distinti per azione e dominio.
9. **Operabilità e test:** test sintetici per concorrenza, cross-account, cross-employee, revoca, trasferimenti, record archiviati, stale revisions, payroll leakage, assenza sensibile e fallimento audit.

## 4. Candidati

### A. Firestore come archivio backend canonico

**Punti favorevoli**
- È già presente nell'ambiente Functions/Firebase e il repository usa Admin SDK per la membership.
- Le transazioni possono raggruppare letture e scritture su documenti coinvolti; gli aggiornamenti condizionati e le revisioni possono essere modellati server-side.
- I documenti permettono DTO separati per identità Employee, binding, placement e domini sensibili.
- Emulator e test backend esistenti offrono un punto di partenza per test sintetici.

**Rischi e prove mancanti**
- Firestore non fornisce vincoli relazionali generali o vincoli UNIQUE multi-documento equivalenti a un database SQL. L'unicità bidirezionale richiederebbe chiavi di prenotazione/indice canoniche e transazioni che leggano e aggiornino tutte le chiavi coinvolte; la forma fisica è da progettare e provare.
- Gli intervalli temporali non sovrapposti non sono un vincolo nativo semplice: occorre una strategia transazionale che serializzi le modifiche per Employee e testi concorrenza e retrodatazioni.
- Le query e gli indici compositi dipendono dalle query reali; non vanno dedotti dalla proposta.
- Le transazioni hanno limiti di durata, dimensione e contesa da verificare sulla documentazione e sui carichi previsti prima del dimensionamento.
- Admin SDK bypassa Firestore Security Rules: ogni API server deve ripetere autenticazione, membership, permission, ownership e lifecycle. Rules non sostituiscono l'autorizzazione Functions.
- Un audit nello stesso database può essere atomico con la mutazione, ma non è automaticamente immutabile contro un principal server troppo privilegiato. Servono separazione dei privilegi, retention e controlli di integrità.
- La presenza di Firestore per membership non dimostra che sia il datastore più adatto per il dominio Employee.

**Valutazione preliminare:** candidato plausibile per continuità infrastrutturale, subordinato a una prova di unicità bidirezionale, intervalli non sovrapposti, contesa, query e audit atomico. Non selezionato.

### B. Database relazionale transazionale (es. PostgreSQL gestito)

**Punti favorevoli**
- Vincoli UNIQUE, FOREIGN KEY, NOT NULL e CHECK possono esprimere direttamente molte invarianti di tenancy e identità.
- Le transazioni, i lock e i livelli di isolamento permettono di serializzare binding e trasferimenti concorrenti. La strategia esatta va progettata e testata; nessun livello di isolamento da presumere sufficiente senza analisi.
- Le relazioni Employee–placement–turni–assenze–payroll sono naturalmente relazionali e consentono query con join e vincoli referenziali.
- Vincoli temporali più forti possono essere valutati (ad esempio range/exclusion constraints in PostgreSQL) per impedire sovrapposizioni, previa verifica di compatibilità e scelta dello schema.
- Audit e mutazione possono condividere la stessa transazione se risiedono nello stesso database.

**Rischi e prove mancanti**
- Il repository non mostra attualmente un database SQL, driver, migrazioni, backup, osservabilità, pool connessioni o gestione operativa Cloud SQL/PostgreSQL.
- Occorrono decisioni e competenze operative per provisioning, patching, backup/restore, alta disponibilità, rete, segreti, connessioni, migrazioni e disaster recovery.
- Row-level security, se usata, richiede una configurazione robusta dei ruoli e della sessione DB; non deve essere considerata una sostituzione dei controlli applicativi. Un ruolo owner/superuser può bypassarla.
- La separazione payroll/sanitario resta un problema di DTO, autorizzazione, query e privilegi, non viene risolta dal solo modello relazionale.
- L'integrazione con Firebase Auth richiede un mapping server-side UID↔Employee; non si deve duplicare l'identità come fonte indipendente.

**Valutazione preliminare:** candidato forte quando l'integrità relazionale e temporale è prioritaria e l'organizzazione può sostenere il relativo servizio operativo. Nessuna infrastruttura SQL è attestata nel repository; non selezionato.

### C. IndexedDB come archivio canonico

**Punti favorevoli**
- È già implementato per dati locali e consente funzionamento locale/offline.
- È utile come cache o proiezione client, con revisione e sincronizzazione progettate separatamente.

**Limiti bloccanti**
- È controllato dal browser e dal dispositivo dell'utente; non è una fonte attendibile per binding, ownership, ruoli, lifecycle o payroll.
- Non coordina in modo affidabile più amministratori/dispositivi per unicità globale e mutazioni concorrenti.
- Non può imporre revoca server-side o autorizzare una lettura protetta prima che i dati arrivino al client.
- Cancellazione, partizionamento account, backup e audit locale non costituiscono garanzie canoniche o immutabili.

**Valutazione:** escluso come archivio canonico Employee e fonte di autorizzazione. Ammissibile solo come cache/proiezione locale minimizzata, non autorevole, dopo una futura progettazione di sincronizzazione e invalidazione.

### D. Architettura ibrida multi-store

Un datastore canonico server-side più IndexedDB come cache può essere valutato per UX/offline. Non si raccomanda invece di distribuire binding, Employee, placement, payroll e audit tra più datastore autorevoli nella prima versione: dual-write, consistenza eventuale, revoche e rollback aumentano il numero di stati parziali. Se una futura esigenza richiede più archivi, serviranno un'autorità unica per ciascun dato, outbox/idempotenza, riconciliazione e test di failure; non è una scelta implicita di questa specifica.

## 5. Matrice comparativa sintetica

| Criterio | Firestore | PostgreSQL | IndexedDB |
|---|---|---|---|
| Isolamento account | Da imporre in ogni query/transazione server | Vincoli e query tenant-scoped; RLS eventuale | Solo partizionamento locale, non trusted |
| Unicità UID↔Employee | Chiavi canoniche + transazioni da provare | Vincoli UNIQUE/relazionali adatti | Non globale |
| Atomicità binding + audit | Possibile entro transazione, con limiti da provare | Possibile nella stessa transazione | Solo locale al dispositivo |
| Placement non sovrapposti | Logica transazionale applicativa | Vincoli temporali/lock valutabili | Non autorevole |
| Query relazionali/storico | Denormalizzazione e indici | Join e vincoli relazionali | Query limitate al dataset locale |
| Revoca server-side | Endpoint deve rileggere membership/binding | Endpoint deve rileggere membership/binding | Non garantibile |
| Rules/accesso | Admin SDK bypassa Rules; autorizzazione server obbligatoria | Autorizzazione server; RLS opzionale e non sufficiente | Nessun boundary server |
| Audit non alterabile | Non automatico | Non automatico | No |
| Coerenza con stack attuale | Alta | Bassa, nuova infrastruttura | Alta per cache, nulla come authority |
| Stato | Candidato non selezionato | Candidato non selezionato | Escluso come canonico |

## 6. Raccomandazione tecnica non vincolante

Mantenere il modello di dominio indipendente dallo storage e ridurre i candidati finali a una valutazione decisionale tra Firestore e PostgreSQL. IndexedDB va escluso come archivio canonico, ma può restare una cache locale non autorevole.

Non raccomandiamo una decisione basata soltanto sulla continuità con Firebase. Il responsabile dello schema dovrebbe scegliere Firestore solo se una prova sintetica dimostra in modo ripetibile:
- unicità bidirezionale sotto concorrenza e retry;
- trasferimenti/placement senza sovrapposizioni;
- mutazione e audit atomici;
- query account-scoped senza letture ampie o filtri client;
- revoca e lifecycle controllati a ogni operazione;
- assenza di leakage payroll/sanitario in DTO, aggregati ed export.

Se tali invarianti richiedono molte contorsioni applicative o non sono dimostrabili, PostgreSQL merita preferenza per i vincoli relazionali, a condizione che l'organizzazione approvi e sostenga esplicitamente l'infrastruttura operativa. Questa è una raccomandazione di valutazione, non una scelta dello storage.

## 7. Gate per una decisione successiva del responsabile dello schema

Prima di selezionare tecnologia e schema fisico occorre produrre:
1. elenco delle operazioni e dei volumi attesi, inclusi picchi e concorrenza;
2. threat model e matrice account × dominio × azione × campo;
3. modello transazionale per binding, revoca, placement, trasferimento e audit;
4. query catalogue con paginazione e indici derivati;
5. piano di backup/restore, retention, audit e incident response;
6. stima costi/operatività basata su volumi e SLO reali, non su ipotesi;
7. test sintetici concorrenti e test di sicurezza negativi per il candidato scelto;
8. approvazione esplicita del responsabile dello schema su tecnologia, modello fisico e responsabilità operative.

## 8. Non autorizzazione esplicita

Questa specifica è un confronto architetturale documentale. Non approva Firestore, PostgreSQL, percorsi, collection, tabelle, documenti, indici, Rules, driver, migrazioni, provisioning, loader, endpoint/callable, wiring, accesso a dati reali, credenziali o deploy. Non introduce benchmark o garanzie non testate. EMP-10 resta in vigore: la scelta fisica richiede una decisione separata del responsabile dello schema.


## 9. Esito della decisione — 2026-11-26

Firestore è selezionato come archivio canonico Employee per la prima implementazione, subordinatamente ai gate tecnici descritti nel documento `docs/dsm-employee-firestore-decision.md`. La scelta si basa sulla continuità con Firebase Admin SDK, Functions e Firestore Emulator già presenti. PostgreSQL resta un'alternativa futura se i test di contesa, query o vincoli non soddisfano i requisiti. IndexedDB resta escluso come authority.

La selezione non implica deploy, uso di un progetto Firebase reale, importazione dati o collegamento all'UI operativa. Ogni API che usa Admin SDK deve applicare esplicitamente autenticazione, revoca, membership, binding, lifecycle, permessi e scope perché Admin SDK bypassa Firestore Rules.
