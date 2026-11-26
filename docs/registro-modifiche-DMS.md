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
