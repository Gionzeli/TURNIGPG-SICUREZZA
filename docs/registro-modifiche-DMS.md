# Registro modifiche DSM — modello A e audit autorizzativo

## Stato

- Repository: `Gionzeli/TURNIGPG-SICUREZZA`
- Branch di lavoro: `dsm-enterprise/core-v1`
- PR: #1, aperta e Draft verso `main`
- Perimetro: solo codice backend isolato, documentazione e test sintetici
- Esclusioni: dati reali, credenziali, Firebase Rules operative, migrazioni, deploy e modifiche a `main`

## 2026-11-26 — Approvazione e implementazione isolata del modello A

**Decisione approvata:** binding backend-owned separato UID Firebase → profilo dipendente, logicamente collocato sotto `accounts/{accountId}/employeeBindings/{uid}`.

**Moduli aggiunti**

- `functions/src/membership/employee-binding.js`: validazione binding, risoluzione dell'unico profilo associato al membro autenticato attraverso loader fidati; fail-closed su mismatch, stati non attivi, profilo non canonico, ruolo non ammesso o errori di lettura.
- `functions/test/employee-binding.test.js`: test sintetici positivi e negativi per binding, identità, account, stato/revisione, profilo e fallimenti dei loader.
- `docs/dsm-employee-identity-linkage-decision.md`: decisione A registrata e limiti della prima implementazione esplicitati.

**Sicurezza e limiti**

- Il modulo non legge direttamente Firestore e non è collegato a un callable endpoint.
- Il client non può fornire un `profileId` per scegliere un altro dipendente.
- La verifica del profilo richiede un loader backend fidato che confermi account, ID e stato attivo.
- Non esiste ancora una fonte profilo canonica server-side: i profili attuali restano in IndexedDB. Perciò nessun loader concreto, endpoint protetto, provisioning, migrazione o modifica delle Rules è incluso.
- La policy è limitata a `member` con `dsm:read:own-scope`; manager/admin restano su flussi distinti.

**Test**

- Test sintetici aggiunti al runner Node `node --test`.
- Workflow `membership-service-tests` sul commit `19a3ab41...`: **success** (inclusi test Node del backend e test emulator Auth/Functions/Firestore).
- Workflow `firestore-rules-emulator` sullo stesso commit: **success**.
- Workflow `indexeddb-browser-tests`: **success**.

**Commit / verifica**

- Commit precedente: `b7f6c8ecc7999f2b19566154a84b789eef7b5a80`.
- Commit della correzione isolata: `19a3ab41ba9aa4551c33655577307934fe1e49b3` (verificato su branch e PR).
- Stato CI finale sul commit del codice `19a3ab41...`: tutti e 3 i check conclusi con `success` (`membership-service-tests`, `firestore-rules-emulator`, `indexeddb-browser-tests`).
- Deploy: non eseguito.

## Registro audit aperto

1. Definire e approvare la fonte canonica backend dei profili prima di creare loader reali.
2. Specificare provisioning, prova di corrispondenza persona/profilo, revoca, riassegnazione e audit append-only.
3. Decidere cardinalità e comportamento multi-account/recupero identità.
4. Associare shifts e absences al profilo canonico e applicare controllo individuale a ogni endpoint.
5. Separare DTO e permessi per dati retributivi e categoria sanitaria delle assenze.
6. Allineare membership e Firestore Rules solo dopo revisione dedicata e test emulator.
7. Eseguire e archiviare l'esito CI del commit preciso.

## 2026-11-26 — Audit della fonte canonica dipendente e dei riferimenti ai dati

**HEAD esaminato:** `842714a8d3bd3ca4f0ead462c3fb0c6d9b0b3f0c`.

**Esito:** blocco architetturale confermato; nessuna modifica runtime autorizzata o necessaria in questa fase.

### Evidenze verificate

- `docs/dsm-canonical-organizational-schema-proposal.md` definisce una proposta per account, sedi, reparti e membership. Non definisce un'entità dipendente/profilo canonica né il percorso di persistenza del profilo. Il documento dichiara espressamente che i percorsi proposti non sono approvati né implementati.
- `src/core/services/profile-service.js` ammette soltanto le sezioni `params` e `profile`; la sezione `profile` contiene `ccnl`, `section`, `level`, `role`, `effective_date`. Non esiste un campo owner UID, employee ID, site ID o department ID.
- `src/core/services/shift-service.js` normalizza data, tipo, sede/nota, orari, flag e ore; non contiene un identificatore dipendente/profilo.
- `src/core/services/absence-service.js` normalizza categoria e intervallo date; non contiene un identificatore dipendente/profilo.
- I repository locali sono partizionati per account in IndexedDB, ma tale partizione client-side non è una fonte di autorità per l'autorizzazione server-side.
- `functions/src/membership/employee-binding.js` richiede un loader fidato `loadActiveProfile(accountId, profileId)`, ma nessun loader canonico concreto è presente.
- `functions/src/membership/resource-resolver.js` resta storage-agnostic e richiede loader iniettati per account/sede/reparto; inoltre il suo contratto corrente non verifica `status: active` su tali risorse. La proposta organizzativa richiede questo controllo, ma non lo implementa.
- L'API dati DSM protetta non è esportata: lo stato dichiarato resta `protectedDataApisImplemented: false` e `authorizationImplemented: false`.

### Conseguenza di sicurezza

Non collegare il binding a un record IndexedDB, a un nome/email, a un campo scelto dal browser o a un percorso Firestore ipotizzato. Non aggiungere `employeeId`/ `profileId` ai payload client come prova di proprietà. Senza record canonico e lifecycle server-side, il resolver non può dimostrare né ownership individuale né validità del profilo al momento dell'operazione.

### Decisioni necessarie prima di un loader concreto

1. Approvare se il profilo contrattuale attuale diventa una risorsa backend canonica oppure se si introduce un'entità dipendente separata e indipendente dai dati retributivi.
2. Definire il percorso canonico, l'ID immutabile, il campo account, lo stato/lifecycle e le regole di archiviazione.
3. Definire come turni e assenze fanno riferimento al dipendente e come si gestiscono record storici, trasferimenti e cessazioni.
4. Definire separazione dei dati: accesso al profilo anagrafico/organizzativo, ai parametri retributivi e alla categoria sanitaria dell'assenza non deve derivare automaticamente dal solo binding.
5. Approvare provisioning, verifica fuori banda della corrispondenza persona-profilo, unicità, recupero identità, revoca, riassegnazione e audit transazionale.
6. Estendere i resolver canonici con stati attivi per account/sede/reparto e test negativi prima di usarli in endpoint protetti.

**Prossima attività sicura:** preparare una decisione di schema limitata all'entità dipendente e ai riferimenti di turni/assenze, mantenendola come proposta non operativa. Nessuna scelta di percorso Firestore, cardinalità o provisioning è stata inferita.

**Verifica PR:** PR #1 è ancora aperta e Draft, branch `dsm-enterprise/core-v1`, HEAD `842714a8d3bd3ca4f0ead462c3fb0c6d9b0b3f0c`; nessun merge, deploy o dato reale.


## 2026-11-26 — Proposta del dominio dipendente e riferimenti a turni/assenze

**Documento:** `docs/dsm-employee-domain-schema-proposal.md`.
**Stato:** proposta documentale non operativa; nessun path Firestore o campo runtime approvato.

### Direzione raccomandata per la revisione

- Introdurre una entità Employee minimale, con ID opaco, immutabile e account-scoped, distinta dai dati payroll.
- Il binding A deve puntare all'identità dipendente canonica; prima del loader occorre decidere se il suo `profileId` esistente diventa l'ID Employee o se si aggiorna il contratto.
- Separare placement organizzativo (sede/reparto e validità) e termini/payroll.
- Collegare ogni turno e assenza a Employee con riferimento server-authoritative; la proprietà non è dimostrata da ID forniti dal client.
- Applicare permessi diversi per self-service, delega manager, payroll e categoria sensibile delle assenze.
- Conservare la proprietà storica dei record dopo trasferimenti/cessazioni; la policy di visibilità storica resta da approvare.

### Decisioni aperte

EMP-01…EMP-10 coprono separazione Employee/payroll, compatibilità `profileId`, cardinalità UID↔Employee, placement, ownership turni, privacy assenze, payroll permissions, lifecycle, provisioning e tecnologia/percorso backend. I default nel documento sono raccomandazioni prudenziali, non decisioni approvate.

### Verifiche CI e PR

- Sul precedente HEAD `ae72c20ba12a5417ff6ecb8ca7e623d490dd96c8`, i workflow `indexeddb-browser-tests` e `firestore-rules-emulator` risultano `success`.
- Questo commit contiene solo documentazione: non attiva necessariamente il workflow backend Functions; non attribuire a questo SHA test del backend non eseguiti.
- Nessuna modifica runtime, Firestore Rules, `main`, deploy, migrazione o dato reale.


## 2026-11-26 — Approvazione limitata EMP-01 / EMP-02

**Decisione esplicita dell'utente:** approvata la separazione proposta e la compatibilità in cui l'attuale `profileId` del binding A identifica l'entità Employee.

- **EMP-01 — APPROVATO:** Employee è un'entità identitaria minimale, distinta dai dati contrattuali/retributivi (terms/payroll), che restano in un dominio separato con permessi dedicati.
- **EMP-02 — APPROVATO:** il valore logico `profileId` già previsto dal contratto isolato del binding A identifica l'ID stabile dell'Employee canonico. Nel dominio Employee tale identificatore è denominato `employeeId`; il mapping è esplicito nel loader, senza rinominare ora il contratto del modulo di policy.
- La decisione non implica che esista già un archivio Employee canonico né autorizza a usare IndexedDB come fonte attendibile.
- Restano **non approvati** EMP-03…EMP-10: cardinalità UID↔Employee, placement e storia, ownership/delega turni, privacy/DTO assenze, permessi payroll, lifecycle, provisioning/prova identità e percorsi/tecnologia backend.
- Non sono autorizzati loader concreti, endpoint, Rules, migrazioni, accesso a dati reali o deploy. Nessuna modifica runtime effettuata.

**HEAD di partenza:** `82ac016947c19abf68378cb3cd92d04adc0a51be`. PR #1 verificata aperta, Draft, non merged, base `main`. CI sul nuovo commit documentale da verificare separatamente.


## 2026-11-26 — Audit tecnico EMP-03…EMP-10 (solo raccomandazioni)

**HEAD esaminato:** `20881c3aca2f8d64fffb8336f3fc526860cf9af7`.

Verificati i contratti di `ProfileService`, `ShiftService`, `AbsenceService`, `employee-binding.js` e `resource-resolver.js`. Evidenze:
- il profilo locale mescola parametri retributivi e campi contrattuali, senza employeeId/owner canonico;
- turni e assenze non hanno riferimenti Employee;
- le assenze includono `malattia`, quindi i futuri DTO manager richiedono minimizzazione esplicita;
- il binding richiede loader iniettati ma non ha loader Firestore né endpoint;
- il resolver organizzativo non impone ancora `status: active` su account/sede/reparto.

Raccomandazioni proposte, **non approvate**:
- EMP-03: cardinalità attiva 1:1 UID↔Employee per account, deny su duplicati/conflitti;
- EMP-04: un placement corrente, storico versionato/append-only;
- EMP-05: ownership shift canonica lato server e permission manager dedicata;
- EMP-06: DTO manager senza categoria `malattia` o dettagli sanitari per default;
- EMP-07: payroll negato per default e permessi separati per read/write/export;
- EMP-08: lifecycle da allineare a ORG; stato mancante/sconosciuto/non attivo = deny;
- EMP-09: provisioning manuale verificato fuori banda, approvato e auditato;
- EMP-10: nessun path/tecnologia scelti prima dell'approvazione schema.

Nessuna implementazione runtime o migrazione effettuata. Nessuna delle raccomandazioni EMP-03…EMP-10 è considerata approvata.

**CI sul commit `20881c3aca2f8d64fffb8336f3fc526860cf9af7`:** `firestore-rules-emulator` = success; `indexeddb-browser-tests` = in_progress al momento del controllo. Non sono presenti risultati Functions su questo commit documentale.


## 2026-11-26 — Chiarimento non operativo del contratto di binding

**HEAD esaminato:** `89da6e06cdea77d4324a554eb425e4ac8f6beff2`.

Il commento in `functions/src/membership/employee-binding.js` citava un percorso Firestore esemplificativo per `loadBinding`. È stato reso esplicitamente storage-agnostic: il loader deve leggere un record backend-owned, ma il percorso concreto dipende dalla decisione EMP-10/schema, ancora non approvata.

La modifica riguarda solo il commento. Nessun path Firestore è stato scelto; nessuna logica runtime, test, Rules, endpoint, migrazione o provisioning è stata modificata. EMP-03…EMP-10 restano non approvate.


## 2026-11-26 — Approvazione esplicita EMP-03 (cardinalità UID↔Employee)

**Decisione esplicita dell'utente:** approvata la cardinalità attiva 1:1 per account tra UID Firebase verificato ed Employee canonico.

- Un UID verificato può avere al massimo un Employee attivo nell'account.
- Un Employee può avere al massimo un UID attivo nell'account.
- Duplicati, conflitti e associazioni concorrenti in entrambe le direzioni devono essere rifiutati fail-closed; nessuna selezione automatica.
- La decisione approva solo l'invariante logica di cardinalità. Non definisce path/storage, provisioning, verifica della persona, revoca/riassegnazione, lifecycle o audit.
- EMP-04…EMP-10 restano non approvate. Nessun loader, endpoint, Rules, migrazione, wiring applicativo o modifica runtime è autorizzato da questa decisione. Nessun dato reale o deploy.

**HEAD di partenza:** `08824fe981ad493c800b759af1d3b1198f1aef5b`. PR #1 verificata aperta, Draft, non merged, base `main`. I tre check CI su questo SHA risultano `success`; i risultati non si trasferiscono automaticamente al nuovo commit documentale.


## 2026-11-26 — Approvazione esplicita EMP-04 (placement organizzativo)

**Decisione esplicita dell'utente:** approvata la regola di un solo placement organizzativo attivo per Employee, con trasferimenti storicizzati.

- Ogni Employee può avere un solo placement corrente alla volta.
- Il trasferimento chiude il placement precedente e crea un nuovo placement; lo storico non viene sovrascritto né cancellato.
- Gli intervalli temporali dello stesso Employee non possono sovrapporsi.
- I turni storici devono conservare il contesto organizzativo valido alla data in cui si sono svolti; il trasferimento non deve riscrivere retroattivamente tale contesto.
- Ambiguità, conflitti e intervalli incoerenti comportano rifiuto fail-closed, senza selezione automatica.
- La regola esclude assegnazioni simultanee a più sedi/reparti per lo stesso Employee. Un eventuale scenario multisede simultaneo richiede una decisione e una policy dedicate.

L'approvazione definisce l'invariante logica, non la persistenza fisica. Non approva path Firestore, lifecycle completo, provisioning, loader, endpoint, Rules, migrazioni, wiring applicativo, dati reali o deploy. I servizi Shift attuali non implementano ancora il contesto storico server-authoritative. Nessuna modifica runtime è stata effettuata.

**HEAD di partenza:** `61a6efbc6789b49c2e64b04271ccd20f0c34601f`. PR #1 verificata aperta, Draft, non merged, base `main`. I check CI sul nuovo commit documentale devono essere verificati separatamente.


## 2026-11-26 — Approvazione esplicita EMP-05 (ownership e accesso ai turni)

**Decisione esplicita dell'utente:** approvata la policy di ownership individuale dei turni e delega manager controllata.

- Ogni turno deve essere associato a un `employeeId` canonico assegnato/verificato dal backend; un ID inviato dal client non dimostra proprietà.
- Il dipendente può leggere e gestire soltanto i propri turni tramite il binding personale verificato.
- Manager/delegati richiedono una permission esplicita, specifica per l'operazione, e uno scope organizzativo autorizzato.
- Lo scope deve essere verificato rispetto alla collocazione Employee valida alla data del turno.
- Il turno conserva il contesto organizzativo storico; trasferimenti successivi non lo riscrivono.
- Identità, Employee, turno, collocazione, intervallo o permesso mancanti/ambigui/incoerenti/revocati/fuori scope comportano deny fail-closed.
- Read/create/update/delete sono operazioni distinte; il ruolo manager da solo non concede privilegi.

L'approvazione riguarda la policy, non l'implementazione. Non approva schema fisico/path, lifecycle completo, provisioning, loader, endpoint, Rules, migrazioni, wiring, dati reali o deploy. Gli attuali servizi Shift non hanno un riferimento Employee canonico e non applicano questa policy. Nessuna modifica runtime è stata effettuata.

**HEAD di partenza:** `023fe62f55f4363e74807b24a5a6457c9dfb9ee9`. PR #1 verificata aperta, Draft, non merged, base `main`. I check CI sul nuovo commit documentale devono essere verificati separatamente.


## 2026-11-26 — Approvazione esplicita EMP-06 (privacy delle assenze)

**Decisione esplicita dell'utente:** approvata la policy di minimizzazione delle assenze e protezione della categoria sanitaria.

- La vista ordinaria del responsabile mostra soltanto indisponibilità e intervallo temporale necessario alla pianificazione.
- `malattia`, diagnosi, motivazioni, note e documenti sanitari non sono esposti nei DTO ordinari.
- Riepiloghi, conteggi, filtri, ricerche, report ed export non devono rivelare direttamente o indirettamente la categoria sanitaria.
- L'accesso eccezionale ai dettagli sanitari richiede permission separata, finalità autorizzata e audit.
- Il dipendente consulta i propri dati secondo regole personali da definire.

L'approvazione riguarda la policy, non l'implementazione. L'attuale `AbsenceService` locale conserva e restituisce `kind` (incluso `malattia`) e `summarizeRange()` aggrega per categoria; non esiste un DTO manager backend protetto. Non sono approvati schema/path, lifecycle, loader, endpoint, Rules, migrazioni, wiring, dati reali o deploy. Nessuna modifica runtime effettuata.

**HEAD di partenza:** `600b9b8ac6a1a331448677d39e5ad2468a046452`. PR #1 verificata aperta, Draft, non merged, base `main`.


## 2026-11-26 — Approvazione esplicita EMP-07 (protezione payroll)

**Decisione esplicita dell'utente:** approvata la policy di accesso ai dati contrattuali/retributivi.

- Accesso payroll negato per default; il ruolo manager/admin non concede privilegi impliciti.
- Il dipendente può consultare soltanto i propri dati tramite identità Employee verificata, secondo le regole personali da definire.
- Lettura delegata: `payroll:read` esplicita e scope autorizzato.
- Modifica: `payroll:write` separata.
- Esportazione: `payroll:export` separata. Le tre permission non si implicano reciprocamente.
- Ogni accesso, modifica ed esportazione deve essere attribuibile all'attore e registrato in audit.
- Identità, permesso, scope o dato mancanti/ambigui/incoerenti comportano rifiuto fail-closed.

L'approvazione riguarda la policy, non l'implementazione. L'audit di `ProfileService` ha rilevato che i parametri retributivi sono attualmente conservati nel profilo locale IndexedDB e che il servizio non applica autorizzazioni payroll proprie; non esistono ancora archivio payroll canonico e API backend protette. Nessuna protezione runtime è quindi da considerarsi attiva.

Non sono approvati schema/path, storage, loader, endpoint, Rules, migrazioni, wiring, accesso a dati reali o deploy. Nessuna modifica runtime effettuata.

**HEAD di partenza:** `9685df21ece56722b4711897bcf8b6a8b3d0abbb`. PR #1 verificata aperta, Draft, non merged, base `main`.


## 2026-11-26 — Approvazione esplicita EMP-08 (lifecycle Employee e risorse organizzative)

**Decisione esplicita dell'utente:** approvata integralmente la policy EMP-08.

- Employee e risorse organizzative richiedono uno stato canonico esplicito; stati mancanti, sconosciuti, incoerenti o non autorizzati comportano deny fail-closed.
- Account, sede e reparto devono essere attivi per nuove operazioni protette; risorse archiviate non concedono accesso.
- Solo Employee attivi sono utilizzabili per nuove operazioni ordinarie. Sospensione, cessazione e archiviazione bloccano le nuove operazioni secondo la policy di stato.
- Sospensione/revoca di membership e binding deve bloccare nuove operazioni protette lato server, non soltanto invalidare la sessione client.
- Turni, assenze e audit storici non vengono cancellati o riassegnati automaticamente per cessazione, revoca o archiviazione.
- L'accesso storico dopo cessazione/revoca richiede autorizzazione distinta e non discende automaticamente dall'ownership storica.
- Ogni transizione è tracciata lato server con attore, motivazione e decorrenza; mutazioni critiche atomiche e protette da conflitti concorrenti.

L'approvazione riguarda le invarianti, non il calendario completo delle transizioni o lo schema fisico. Non autorizza path Firestore, loader, endpoint, Rules, migrazioni, provisioning, wiring, dati reali o deploy. L'audit ha confermato che il resolver organizzativo non controlla ancora gli stati active di account/sede/reparto e che il lifecycle Employee canonico non è integrato. Nessuna modifica runtime effettuata.

**HEAD di partenza:** `322f42cb47fbb1f20ca86b4d054799c812018d8b`. PR #1 verificata aperta, Draft, non merged, base `main`.


## Approvazione EMP-09 — 2026-11-26

L'utente ha approvato integralmente la policy di provisioning manuale e verifica identità fuori banda: nessun matching automatico; proposta e approvazione da attori distinti; precondizioni e cardinalità EMP-03 verificate; unicità e revisioni protette atomicamente; revoca esplicita prima di eventuale nuovo binding; audit minimizzato e fail-closed. La procedura non deve copiare documenti d'identità o dati personali superflui. Approvata la policy, non schema fisico/path, ambiente Identity Platform, callable, endpoint, Rules, migrazione, wiring o deploy. Il provisioning Employee non è implementato.


## Approvazione EMP-10 — confine storage-agnostic — 2026-11-26

L'utente ha approvato il mantenimento del dominio Employee storage-agnostic fino a una decisione separata del responsabile dello schema. I percorsi Firestore di membership, nomination e audit non vengono riutilizzati né assunti come schema Employee per analogia.

Prima di scegliere storage fisico e percorsi è richiesta una specifica comparativa che dimostri isolamento account, unicità bidirezionale, atomicità/concorrenza, revisioni, lifecycle/revoche, placement e storico, audit attribuibile, protezione payroll e dati sanitari, query/indici, confini di accesso e testabilità. Tecnologia, collection/path, documenti, indici e persistenza richiederanno una decisione esplicita successiva del responsabile dello schema.

L'approvazione non autorizza loader, endpoint/callable, Rules, migrazioni, provisioning operativo, wiring, dati reali o deploy. Nessuna modifica runtime è stata effettuata.

**HEAD di partenza:** `0993ef82bbb046d10ea8e996716678643ea6af36`. PR #1 verificata aperta, Draft, non merged, base `main` prima della scrittura.


## Specifica comparativa storage Employee — 2026-11-26

A seguito dell'approvazione EMP-10 è stata preparata `docs/dsm-employee-storage-comparison.md`. Il confronto documentale valuta Firestore e PostgreSQL come candidati non selezionati e IndexedDB come soluzione esclusa quale archivio canonico (ammissibile solo come cache non autorevole). Sono esplicitati i requisiti di tenancy, unicità bidirezionale, atomicità/concorrenza, placement e storico, lifecycle/revoche, audit, separazione payroll/assenze, query/indici e testabilità.

La raccomandazione è mantenere il dominio storage-agnostic e sottoporre Firestore e PostgreSQL a una decisione del responsabile dello schema dopo prove sintetiche e valutazione operativa. Non sono stati scelti path, collection, tabelle, indici o servizi. Questa è una specifica comparativa, non un'approvazione tecnologica e non autorizza implementazione, loader, endpoint, Rules, migrazioni, provisioning, wiring, dati reali o deploy. Nessuna modifica runtime.


## Protocollo di prova comparativa storage Employee — 2026-11-26

Aggiunto `docs/dsm-employee-storage-test-protocol.md` con 20 scenari sintetici T01–T20, oracoli di correttezza, misure e gate distinti per Firestore e PostgreSQL. Il documento non costituisce esecuzione: nessun test datastore o benchmark è stato eseguito. Ogni harness concreto richiederà approvazione dello storage candidato, ambiente isolato e autorizzazione specifica. Nessuna modifica runtime o scelta di schema fisico; EMP-10 resta invariata.


## Harness sintetico autorizzato — 2026-11-26

Su autorizzazione esplicita è stato aggiunto `tests/storage-harness/` con due modelli in-memory semplificati (Firestore optimistic-transaction model e PostgreSQL serialized-transaction model), test Node `node:test` e README. Il perimetro copre binding UID↔Employee 1:1 entro account, retry idempotente/conflittuale e rollback in caso di errore audit. Non sono adapter reali e non provano garanzie effettive Firestore/PostgreSQL. Nessun SDK/driver, emulator, cloud project, network, credenziale, schema fisico, collection, tabella, indice, Rules o codice applicativo è coinvolto. Harness aggiunto ma non eseguito in questo ambiente; nessun risultato di test dichiarato. Estensioni per placement, revoca, lifecycle, payroll, assenze e crash recovery restano da fare e richiedono successiva verifica. Nessun deploy.


## Estensione harness sintetico — 2026-11-26

Aggiunti `tests/storage-harness/domain-model.mjs` e `domain-model.test.mjs`. Copertura aggiuntiva puramente in-memory: intervalli placement non sovrapposti, trasferimento e contesto storico turno, placement ambiguo, revoca binding, lifecycle Employee/risorse, payroll deny-by-default e minimizzazione vista manager assenze. Le funzioni sono isolate dai modelli transazionali e non costituiscono test Firestore/PostgreSQL né prove di persistenza, concorrenza datastore, query, crash recovery o security enforcement. Restano esclusi payroll write/export, deleghe manager, aggregati/report ed esecuzione effettiva del test runner. Nessun runtime, schema, endpoint, Rules, migration o deploy modificato.


## Correzione del modello sintetico: atomicità trasferimento e scope temporale — 2026-11-26

Rafforzato `tests/storage-harness/domain-model.mjs`: il trasferimento valida il placement di destinazione prima di modificare quello corrente; le operazioni protette richiedono che sede/reparto coincidano con il placement valido alla data specificata. Aggiunti test per rollback logico del trasferimento fallito e accesso negato fuori dal placement temporale. Corretto il fixture test lifecycle per fornire esplicitamente la data di autorizzazione. Queste prove restano in-memory e non dimostrano atomicità o enforcement nei datastore/runtime reali. Test runner non eseguito; nessun esito di CI dichiarato. Nessuna modifica runtime, schema, Rules, endpoint, migrazione o deploy.


## Workflow CI dedicato al harness Employee sintetico — 2026-11-26

Aggiunto `.github/workflows/employee-storage-harness.yml`, limitato a `tests/storage-harness/**` e al proprio file workflow. Esegue `node --test tests/storage-harness/*.test.mjs` su Node 20, senza installare pacchetti, usare emulatori, servizi cloud, credenziali o dati reali. Si attiva su pull request verso `main`, push sul branch `dsm-enterprise/core-v1` e dispatch manuale; permesso GitHub limitato a `contents: read`. Un eventuale esito positivo dimostrerà soltanto il comportamento dei modelli in-memory documentati, non le garanzie Firestore/PostgreSQL o la sicurezza runtime. L'esecuzione sul nuovo SHA deve essere verificata separatamente.


## Estensione harness: deleghe manager, payroll write/export e report assenze — 2026-11-26

Aggiunti esempi e test puramente in-memory per: delega manager legata a Employee, sede/reparto e data del placement, con permessi distinti per read/create/update/delete; separazione di `payroll:write` e `payroll:export` senza implicazioni da `payroll:read`, con eventi audit sintetici; proiezione report assenze priva di categoria, motivazione, note, raggruppamenti e conteggi per categoria. I casi sono modelli didattici e non autorizzazioni runtime: non verificano identità manager reale, persistenza, atomicità datastore, attribuzione audit trusted o assenza di ogni possibile inferenza da dati temporali. Nessun adapter DB, schema, endpoint, Rules, migrazione, wiring, dato reale o deploy modificato. Il runner CI sul nuovo SHA deve essere verificato prima di dichiarare i test superati.


## Estensione harness: isolamento account/Employee e scope payroll — 2026-11-26

Aggiunti test negativi sintetici per deleghe manager cross-account e cross-Employee, e per payroll con permission esatta ma Employee fuori dallo scope esplicito. Le funzioni payroll richiedono ora anche una lista `authorizedEmployeeIds` e preparano le nuove strutture dati/audit prima di pubblicare la mutazione in-memory. Aggiunto test che un errore nella preparazione dell'audit non lascia la scrittura payroll applicata. Questi esempi non dimostrano che lo scope o l'attore siano derivati da fonti trusted, né atomicità/durabilità datastore; non sono enforcement runtime. Nessuna modifica a schema, storage, endpoint, Rules, migrazioni, provisioning, wiring, dati reali o deploy. CI sul nuovo SHA da verificare.


## Estensione harness: lifecycle e revoca payroll — 2026-11-26

Payroll read/write/export nel modello sintetico richiede ora Employee con status esattamente active. Aggiunti test negativi per sospensione, cessazione, archiviazione e stato sconosciuto, più casi di revoca permission tramite rimozione dei grant. Il test verifica che write deny non aggiunga record. Non dimostra revoca immediata server-side, stato trusted, atomicità datastore, o protezione runtime. Nessuna modifica runtime, schema, endpoint, Rules, migrazione, provisioning, wiring, dati reali o deploy. CI sul nuovo commit da verificare.

## 2026-11-26 — Harness: audit atomico su payroll read/export

**Modello sintetico:** payrollView e exportPayroll preparano il record audit (attore sintetico, permission specifica, account, Employee e numero record) prima di restituire i dati. Se la preparazione dell’audit fallisce, l’operazione solleva errore e non restituisce dati payroll. Anche il record payroll-write ora include la permission specifica.


**Test aggiunti:** audit read/export fail-closed quando l’append non è disponibile; read/export registrano actor e permission corretti. Test in-memory, non audit persistente o autorizzazione server reale. Nessun codice runtime, schema, endpoint, Rules, provisioning o deploy modificato.


## 2026-11-26 — Harness: scadenza e revoca deleghe manager

**Modello sintetico:** le deleghe manager per le operazioni sui turni richiedono una scadenza esplicita; una delega scaduta non autorizza. La revoca seleziona una sola delega attiva e prepara prima l'audit; se l'audit non può essere predisposto, la delega resta attiva. Sono inclusi attore e motivo sintetico nel record di revoca.

**Test aggiunti:** prima dell'istante di scadenza, al momento esatto e dopo; revoca immediata; audit fail-closed della revoca. Modello in-memory, non endpoint o persistence reali.


## 2026-11-26 — Harness: lifecycle dello scope organizzativo manager

Il modello sintetico di autorizzazione turni manager richiede ora esattamente un record organizzativo corrispondente e attivo per account, sede e reparto. Test negativi coprono scope sospeso, archiviato, sconosciuto, mancante o duplicato. Corretti anche i test cross-account/cross-Employee affinché forniscano un timestamp valido e raggiungano davvero i controlli di isolamento, anziché fallire prima per parametro mancante. Solo harness in-memory; nessuna modifica runtime, Rules, schema, storage, endpoint, provisioning o deploy.


## 2026-11-26 — Harness: lifecycle indipendente di account, sede e reparto

Esteso il modello in-memory per richiedere esattamente un account attivo e un record organizzativo univoco con stato esplicito `active` per organizzazione, sede e reparto. Aggiunti casi negativi per stati sospeso, archiviato, sconosciuto e mancante, oltre a duplicazione account. I test verificano il deny su creazione placement, operazioni Employee e accesso manager ai turni. È copertura sintetica del solo harness: non implementa enforcement runtime, non modifica schema/storage/Rules/API e non prova stati trusted o persistenza reale. Nessun dato reale, credenziale, deploy o merge.


## 2026-11-26 — Harness: lifecycle account per payroll e revoca binding audit-first

Esteso il modello sintetico affinché payroll read/write/export richiedano un account univoco con stato esplicito `active`, oltre a Employee attivo e permission specifica. Aggiunti casi negativi per account sospeso, archiviato, sconosciuto o senza stato, verificando assenza di mutazioni payroll/audit. La revoca binding ora prepara l'evento audit prima di mutare lo stato; un errore di staging lascia il binding attivo. Copertura esclusivamente in-memory: non prova enforcement server, audit durevole o atomicità datastore. Nessuna modifica runtime, schema, storage, Rules, endpoint, provisioning, wiring, dati reali o deploy.


## 2026-11-26 — Harness: revoca delega manager e confine trasferimento

Aggiunti test puramente in-memory per la revoca effettiva di una delega manager sulle operazioni successive, per il fail-closed se l'audit di revoca non può essere predisposto, e per il confine temporale di un trasferimento: la delega sul vecchio sito vale solo per turni collocati nel vecchio placement, non per date dal trasferimento in avanti. Aggiunto anche il controllo che un Employee sospeso blocchi l'operazione manager nel modello. Non viene introdotta revoca automatica o lifecycle runtime delle deleghe. Nessuna modifica a schema, storage, endpoint, Rules, provisioning, wiring, dati reali o deploy.


## 2026-11-26 — Harness: deleghe manager duplicate e ambigue

Rafforzato il modello in-memory: l'autorizzazione manager non seleziona più la prima delega corrispondente quando esistono più concessioni attive, valide e identiche per account, manager, Employee, sito, reparto e operazione; in tale situazione nega l'accesso. Aggiunto test dedicato e aggiornata la documentazione del solo harness. Nessuna modifica al runtime, schema, storage, endpoint, Rules, provisioning o deploy.


## 2026-11-26 — Harness: ambiguità limitata alle deleghe effettivamente valide

Aggiunto un test negativo/positivo di confine: una delega scaduta e una delega valida per un'altra operazione non rendono ambigua l'unica concessione corrente per l'operazione richiesta. La regola di deny resta applicata quando più concessioni attive, non scadute e corrispondenti alla stessa operazione competono. Solo modello sintetico in-memory; nessuna modifica runtime, schema, storage, Rules, endpoint, provisioning, wiring o deploy.


## 2026-11-26 — Harness: binding Employee duplicate fail-closed

Rafforzato il solo modello sintetico delle operazioni Employee: richiede esattamente una binding attiva per la tupla account/UID/Employee; più binding attive corrispondenti negano l'accesso senza selezione implicita. Le copie storiche revocate non vengono conteggiate come concessioni attive. Aggiunto test per entrambi i casi. Nessuna modifica runtime, schema, storage, endpoint, Rules, provisioning, wiring o deploy; non è prova di unicità canonica persistente.


## 2026-11-26 — Harness: unicità bidirezionale binding Employee

Rafforzato il solo modello sintetico: per ogni account è richiesta esattamente una binding attiva per UID e una per Employee, e le due devono essere la stessa associazione. Aggiunti test per UID associato a due Employee, Employee associato a due UID e isolamento tra account. Non dimostra unicità persistente, transazioni concorrenti o enforcement server-side. Nessuna modifica runtime, schema, storage, endpoint, Rules, provisioning, wiring, dati reali o deploy.


## 2026-11-26 — Harness: Employee canonico duplicato fail-closed

Aggiunto un controllo sintetico che richiede esattamente un record Employee attivo per account e identificativo Employee. Placement, operazioni personali, accesso manager ai turni e payroll negano in caso di record canonici duplicati. Test in-memory; non dimostra unicità persistente o protezione da concorrenza. Nessuna modifica runtime, schema, storage, endpoint, Rules, provisioning, wiring, dati reali o deploy.


## 2026-11-26 — Decisione storage canonico Employee: Firestore

L'utente ha autorizzato la scelta e l'implementazione dello storage. Selezionato Firestore per continuità con Functions/Admin SDK e disponibilità dell'Emulator; PostgreSQL resta alternativa se le prove di contesa/query/atomicità non soddisfano i requisiti. Definiti percorsi tenant-scoped per Employee, binding bidirezionale, placement, controllo revisioni, turni, assenze, payroll e audit in `docs/dsm-employee-firestore-decision.md`. `profileId` viene mappato esplicitamente a `employeeId`. Prossimo incremento: adapter server-side e test Emulator. Nessun progetto Firebase reale, credenziali, dati reali, deploy, merge, main o wiring UI.


## 2026-11-26 — Adapter Firestore Employee: risoluzione binding canonico

Aggiunto il primo adapter server-only Firestore per risolvere il binding tramite le due prenotazioni UID/Employee e verificare che concordino su account, UID, Employee, stato e revisione. Il loader Employee controlla il lifecycle attivo e mappa `profileId` → `employeeId`. Aggiunto test Firestore Emulator per risoluzione valida, mirror incoerente, Employee sospeso e binding revocato. Nessun endpoint callable, provisioning, UI wiring, accesso a progetto reale o deploy.


## 2026-11-26 — Employee loader: lifecycle account fail-closed

Il loader Firestore ora verifica nella stessa transazione che il documento account esista e abbia `status: active`, oltre al lifecycle Employee. Estesi i test Emulator per account sospeso e mirror inverso mancante. I dati non vengono restituiti se account o associazione sono mancanti/incoerenti. Nessuna API o modifica alle Rules operative.


## 2026-11-26 — Provisioning Employee manuale a doppia approvazione

Aggiunto servizio Firestore transazionale per proposta e approvazione Employee. Richiede account attivo, amministratori canonici attivi con identità TOTP recente verificata dal backend, proponente e approvatore distinti, membro target già attivo e ticket opaco di verifica manuale. L'approvazione crea Employee, due prenotazioni binding UID/Employee, transizione proposta e audit nella stessa transazione; duplicati e rebinding vengono rifiutati. Aggiunto test Emulator sintetico per happy path, self-approval negata e collisione UID. Il servizio è interno, non esposto come callable; il test usa identity fixture sintetiche e non prova il flusso TOTP Firebase reale.


## 2026-11-26 — Callable Employee provisioning protette

Collegati al composition root Functions gli endpoint callable di proposta e approvazione Employee. L'identità amministrativa è ricavata esclusivamente da ID token Firebase verificato con controllo revoca; UID, email verificata, auth time e secondo fattore non sono accettati dal payload client. Errori di policy sono tradotti in HttpsError senza esporre errori interni. Aggiunti test unitari della boundary callable con verifier sintetico. Questo non dimostra ancora l'emissione/validazione reale del claim TOTP in Firebase Auth e non autorizza deploy.


## 2026-11-26 — Revoca Employee binding atomica e auditata

Aggiunta revoca esplicita del binding Employee: amministratore canonico attivo con token verificato/revocation-checked e claim TOTP recente; verifica di account, Employee, mirror UID/Employee e documento controllo revisioni; revoca simultanea dei due mirror, incremento revisione e audit nella stessa transazione. Il provisioning crea anche employeeControl. Collegata callable revokeEmployeeBinding e aggiunti test unitari della boundary. La riassociazione resta un nuovo processo a due persone; i documenti revocati non vengono sovrascritti. Il claim TOTP reale non è ancora validato in un tenant Firebase approvato.

## 2026-11-26 — Test Emulator revoca binding Employee

Aggiunto test Firestore Emulator end-to-end sintetico che crea il binding tramite proposta e approvazione distinte, poi revoca entrambe le prenotazioni UID/Employee, incrementa il controllo revisione e verifica l'evento audit. Il test verifica anche il rifiuto della seconda revoca. Nessun test TOTP reale, progetto reale o deploy.


## 2026-11-26 — Placement Employee e trasferimento atomico

Aggiunto servizio interno Firestore per creazione del placement iniziale e trasferimento con intervalli semiaperti [validFrom, validUntil), controllo revisioni su employeeControl, rilevamento overlap e ambiguità, lifecycle account/Employee/sede/reparto e audit nella stessa transazione. I loader di autorizzazione attore e organizzazione sono iniettati e devono leggere fonti canoniche nella stessa transazione; non viene esposto alcun endpoint perché il contratto fisico dei documenti organizzativi e i permessi per modificare placement non sono ancora stabiliti. Test Emulator sintetico verifica creazione, trasferimento, confine storico e overlap negato.


## 2026-11-27 — Servizio transazionale turni Employee

Aggiunto servizio interno Firestore per create/update/delete dei turni canonici Employee. L'Employee ID e il contesto placement/sede/reparto sono ottenuti esclusivamente da callback server-side; payload client con campi extra respinto. Create/update/delete hanno autorizzazione distinta, revisione ottimistica e audit atomico; delete è soft-delete per preservare lo storico. La data turno è immutabile per non riscrivere il contesto storico. I callback di autorizzazione e risoluzione placement devono leggere membership, binding/deleghe, lifecycle e placement storico nella stessa transazione; non esposto callable finché il contratto canonico deleghe/permessi non è implementato. Test Emulator sintetico copre persistenza, contesto server-side, revisione obsoleta, audit e delete negato.


## 2026-11-27 — Vista manager assenze minimizzata

Aggiunto servizio interno per disponibilità assenze: il DTO restituisce esclusivamente indisponibilità e date, senza categoria, motivazione, note o documenti. Il filtro usa placement IDs restituiti da un authorizer server-side che deve verificare permission esplicita absence:read:availability e scope delegato per l'intero intervallo. Audit minimizzato senza categorie sanitarie. Test Firestore Emulator sintetico verifica clipping date, esclusione placement fuori scope e assenza di campi sensibili nella risposta/audit. Non esposto callable finché l'adapter canonico membership/deleghe non è implementato.


## 2026-11-27 — Coerenza owner e placement nei turni

Rafforzata la boundary update/delete: l'Employee restituito dall'authorizer deve coincidere con l'owner storico del turno e il placement risolto alla data originale deve coincidere con placement/sede/reparto registrati. Aggiunto test che nega il tentativo di agire su un Employee differente senza mutare revisione o record.


## 2026-11-27 — Normalizzazione update turno

Corretto l'update dei turni per validare esclusivamente i campi di dominio modificabili, senza passare i metadati server (account, owner, placement, revisioni e audit timestamps) nel validatore del payload. Il test Emulator esercita ora aggiornamento riuscito e attacco con authorizer che restituisce un Employee diverso dall'owner storico.


## 2026-11-27 — Correzione test idempotenza audit assenze

La CI ha evidenziato un'asserzione errata nel test: una seconda lettura con un nuovo eventId è legittima e deve essere auditata. Il test ora ripete lo stesso eventId e verifica il rifiuto del duplicato, coerentemente con l'idempotenza dell'audit. Nessuna modifica alla policy o al servizio.


## 2026-11-27 — Hardening placement e binding Employee

Il servizio placement ora richiede entrambe le riserve UID↔Employee attive e coerenti con employeeControl.bindingRevision nella stessa transazione. Ogni record placement storico viene validato (account/employee/doc ID, site/department, date e revisioni) prima di valutare intervalli; dati malformati bloccano la mutazione. La creazione iniziale è consentita solo con storico vuoto. Test Emulator aggiunti per binding mirror mancante/incoerente, storico malformato e seconda creazione iniziale. I loader organizzativi e autorizzativi restano iniettati e non equivalgono a un adapter manager/member di produzione.


## 2026-11-27 — Test fail-closed per vista assenze manager

Esteso il test Emulator della disponibilità assenze con casi di authorizer che nega la permission/scope e che restituisce un Employee diverso dal target. Entrambi devono fallire senza creare audit né restituire intervalli. I test di successo continuano a verificare DTO privo di categorie e dettagli sanitari.


## 2026-11-27 — Primitive fail-closed per autorizzazione Employee per dominio

Aggiunto `employee-domain-authorization.js`: modalità self richiede binding UID↔Employee attivo e revisione valida; modalità delegated richiede permission esatta per dominio/operazione e placement canonico coerente con account/Employee, poi applica il controllo scope esistente. I permessi proposti non sono aggiunti alla allowlist dei ruoli e non vengono esposti endpoint. Test unitari coprono spoof Employee, binding revocato/mismatch, permission generica insufficiente, payroll deny-default e scope manager cross-site.

 
## 2026-11-27 — Validazione rigorosa principal e intervalli placement

Rafforzata la primitive Employee domain authorization: il principal deve avere ruolo, scope, array di scope ID univoci e permission strutturalmente validi anche nel percorso self; i placement delegati richiedono date ISO calendariali reali e intervalli non vuoti/non invertiti. Aggiunti test negativi per ruoli sconosciuti, scope duplicati, permission malformate, date impossibili e intervalli invertiti. La verifica resta una policy pura: non sostituisce loader canonici, controllo lifecycle o autorizzazione temporale rispetto alla data della singola operazione.

 
## 2026-11-27 — Correzione effettiva validazione principal e date Employee

Risolta una discrepanza individuata nella verifica del commit precedente: la validazione strutturale del principal non era collegata al guard effettivo e il pattern data conteneva un escape errato. Ora il guard invoca validPrincipal in entrambi i percorsi e i placement delegati verificano date calendario reali e intervalli validi. I test negativi aggiunti coprono questi casi. La verifica rimane una primitive pura e non sostituisce loader canonici/lifecycle.

 
## 2026-11-27 — Coerenza ruolo/scope nel principal Employee

La primitive Employee verifica ora anche le combinazioni ruolo/scope già previste dalla policy membership esistente: admin account senza scope ID, manager site-scoped con almeno un ID, member site/department-scoped con almeno un ID. Aggiunti casi negativi per combinazioni incoerenti. Nessun nuovo privilegio o endpoint è stato introdotto.

 
## 2026-11-27 — Hardening shape di permessi e binding personale

La primitive Employee ora rifiuta permessi vuoti, composti da soli spazi o duplicati. Nel percorso personale il binding deve essere un oggetto e il suo profileId deve rispettare il formato ID canonico oltre a coincidere con Employee richiesto. Aggiunti test negativi. Nessun endpoint esposto.


## 2026-11-27 — Approvazione ORG-01–ORG-10

L'utente ha approvato esplicitamente tutte le decisioni organizzative e i default prudenziali. Registrata la decisione vincolante in `docs/dsm-organizational-schema-decision.md`: gerarchia Firestore flat account/sites/departments; lifecycle active/archived; membership effective-dated e revocabile; multi-account con selector non autorevole; scope multipli; matrice per operazione; trasferimento reparto atomico; ID server-side immutabili; audit append-only senza TTL automatico fino a policy di retention; API dati con autenticazione, revoca e autorizzazione server-side a ogni chiamata.

**Ambito:** implementazione isolata e Firebase Emulator con dati sintetici. Restano esclusi dati reali, credenziali, Rules operative, migrazioni, deploy, merge e main. Il bootstrap del primo admin resta processo separato e non attivato.


## 2026-11-27 — Primo adapter organizzativo Firestore e trasferimento

Aggiunti loader server-only sui percorsi approvati `accounts/{accountId}`, `sites/{siteId}`, `departments/{departmentId}`, con controllo ID documento/campi, parent account, parent site e lifecycle active. Il resolver puro ora nega account/site/department non active. Aggiunto servizio interno di trasferimento department→site con version precondition, scope authorization iniettata e audit generato server-side nella stessa transazione. Test Emulator sintetico copre catena canonica, trasferimento, audit, replay stale e archived. Nessuna callable esposta.


## 2026-11-27 — Lifecycle effettivo membership e permesso trasferimento

Il validatore membership ora richiede validFrom Timestamp/Date, validUntil Timestamp/Date o null, status active e intervallo corrente secondo clock server. Suspended, revoked, date mancanti/malformate/future/expired negano. Il permesso `dsm:transfer:departments` è derivato per manager scoped alle sedi; payroll e salute restano fuori dalla matrice base. La nomina crea membership effective-dated; revoca usa lo stesso timestamp server per la decisione. Aggiornate fixture sintetiche Emulator.

- Hardening aggiuntivo: il loader richiede `schemaVersion` positiva sull'account; test Emulator verifica due trasferimenti concorrenti con la stessa versione (un solo vincitore), audit e rifiuto della destinazione archiviata.


## 2026-11-27 — Allineamento fixture membership al lifecycle approvato

La prima esecuzione backend dopo l'introduzione dei campi effective-dated ha evidenziato fixture storiche prive di `validFrom`/`validUntil`. Il validatore ha correttamente negato tali membership. Aggiornate le fixture sintetiche dei test unitari ed Emulator con timestamp espliciti; nessun rilassamento della policy runtime.

- Correzione fixture unit nomination: anche gli helper compatti ora forniscono `validFrom` e `validUntil`; la policy effettiva non è stata allentata.

- Il servizio di trasferimento ora include un authorizer transazionale predefinito: ricarica la membership effective-dated e verifica permesso, ruolo e scope su entrambe le sedi. Il test Emulator usa la policy canonica e verifica il diniego a manager non assegnato alla destinazione.

- Corretto il test di replay stale per usare il nuovo authorizer canonico (nessun callback sintetico residuo); aggiunto caso di account privo di schemaVersion che deve negare la risoluzione.

- Corretto l'allineamento della matrice: anche l'admin account-scoped riceve il permesso esplicito `dsm:transfer:departments`; il manager continua a richiedere scope su entrambe le sedi. Aggiornato il test unitario.
- Resa più resiliente l'installazione Playwright CI: installa Chromium senza invocare apt/system-deps esterni, il cui repository Microsoft ha restituito HTTP 403 nell'ultima run. Le librerie native saranno verificate dal test browser.


## 2026-11-27 — Creazione e archiviazione organizzativa controllata

Aggiunto servizio interno per creare site e department con ID Firestore auto-generati server-side, parent validation e audit atomico. Aggiunti archiviazione site/department riservata ad admin con permessi dedicati: blocca dipartimenti attivi, placement Employee correnti e membership/scope ancora attivi. Nessun endpoint callable esposto; il chiamante deve derivare actorUid da token revocation-checked.

- Aggiunto test Emulator per ID server-generated, creazione site/department, blocco archiviazione con dipartimenti/placement/member/manager attivi e audit delle quattro operazioni.
