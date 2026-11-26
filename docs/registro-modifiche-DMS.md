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
