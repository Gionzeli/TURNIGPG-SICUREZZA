# Contratto di autorizzazione server-side Firebase per DSM

**Stato:** proposta architetturale e piano di test; endpoint non implementato.
**Ambito:** progettazione documentale, solo fixture e identità sintetiche.
**Riferimento codice:** branch `dsm-enterprise/core-v1`, commit di partenza `f93c4ab93f6e14e3baea17744721145bba45581b`.
**Decisione:** nessuna connessione all'app Firebase operativa, nessun deploy, nessun dato reale.

## 1. Scopo e confine di fiducia

Il servizio proposto risolve l'autorizzazione DSM per una sessione Firebase autenticata. Le responsabilità sono separate:

1. **Firebase Authentication** fornisce l'identità e il token ID.
2. **Backend DSM** verifica il token, controlla revoca e stato dell'identità, legge la membership da una fonte server-side e decide account, ruolo e permessi.
3. **Adapter browser DSM** inoltra il token al backend e convalida la forma/validità temporale della risposta. Non decide autonomamente membership o privilegi.
4. **Core DSM nel browser** usa il principal solo per il lifecycle locale. Non costituisce un confine di sicurezza contro XSS, DevTools, codice same-origin o manipolazione IndexedDB.

La stringa `verifiedBy: "server"` prevista dal protocollo è un indicatore di formato, **non** una firma e non prova da sola la provenienza della risposta. La fiducia deriva dall'esecuzione del controllo nel backend, dal trasporto HTTPS e dall'integrità del client distribuito. Un browser compromesso resta fuori dal modello di protezione del core locale.

Ogni API backend che legge o modifica dati protetti deve ripetere l'autenticazione e l'autorizzazione lato server. Non deve fidarsi del principal, di `accountId`, di `role` o di `permissions` inviati dal browser.

## 2. Endpoint proposto

Nome logico: `POST /v1/dsm/authorization/resolve`.

Il path è una proposta, non una route esistente. Ambiente, dominio, hosting, CORS e deployment restano da decidere e autorizzare separatamente.

### Richiesta

- Trasporto obbligatorio: HTTPS.
- Header: `Authorization: Bearer <Firebase ID token>`.
- Content-Type: `application/json`; body vuoto (nessun campo di autorizzazione inviato dal client).
- Non usare cookie di sessione come alternativa implicita.
- Non inviare UID, email, accountId, ruolo, permessi, flag admin, membership, scadenze o stato di approvazione come input autorevole.

L'adapter esistente chiama attualmente il resolver con `{ uid, idToken, email }`. Nel futuro binding HTTP, solo `idToken` deve essere usato per autenticare la richiesta; UID ed email del client sono dati non attendibili e vanno ignorati, oppure rimossi dall'interfaccia del resolver in un cambiamento di codice separatamente autorizzato. Il backend ricava UID ed email dai claim del token verificato.

### Verifiche obbligatorie lato server

1. Verificare firma, issuer, audience/project ID, scadenza e integrità del Firebase ID token tramite Firebase Admin SDK o libreria ufficiale equivalente.
2. Eseguire la verifica con controllo di revoca abilitato (ad esempio `verifyIdToken(token, true)` con Admin SDK). Gestire anche utente disabilitato e token non più valido.
3. Richiedere UID valido e, se la policy DSM lo impone, `email_verified === true` nel token verificato. L'email verificata è un requisito d'identità, non un'autorizzazione.
4. Risolvere la membership usando esclusivamente UID ricavato dal token e una fonte server-side definita. Non usare il documento o il payload proposto dal client come fonte di privilegi.
5. Verificare che la membership sia attiva alla data/ora server corrente, che appartenga all'account richiesto secondo la policy e che non sia scaduta, sospesa o revocata.
6. Derivare accountId, ruolo e permessi da dati gestiti dal backend. Applicare una allowlist di ruoli e permessi; negare per default ruoli sconosciuti o combinazioni incoerenti.
7. Per amministratori, usare claim personalizzate gestite esclusivamente da backend/Admin SDK oppure una membership amministrativa server-side protetta. Non fidarsi di `isAdmin`, email, campi UI o custom claims non verificate.
8. Applicare limiti di frequenza, timeout, dimensione risposta e osservabilità senza registrare token o dati personali non necessari.
9. Rispondere con cache disabilitata (`Cache-Control: no-store`) e nessun token Firebase, refresh token o segreto nella risposta.
10. In caso di errore, timeout, membership non disponibile o fonte dati irraggiungibile, negare l'accesso (fail-closed).

**Punto di policy da decidere prima dell'implementazione:** il repository attuale contiene riferimenti a `members/{uid}` e a regole storiche; questa proposta non assume che lo schema o le regole correnti siano sufficienti. Va approvato un modello canonico di membership, inclusi campi obbligatori, stati ammessi, intervalli temporali, account multipli e revoca. Il backend deve usare un accesso server-side ristretto e non interpretare la possibilità di leggere un documento come prova automatica di autorizzazione.

## 3. Risposta positiva proposta

HTTP 200, JSON:

```json
{
  "verifiedBy": "server",
  "uid": "synthetic-firebase-uid",
  "status": "active",
  "accountId": "synthetic-account",
  "role": "member",
  "permissions": ["shifts:read", "profiles:read"],
  "expiresAt": 1795550400000
}
```

Vincoli:

- `uid`: UID ricavato dal token verificato, mai copiato dalla richiesta.
- `status`: valore server-side esatto `active`; ogni altro stato nega l'accesso.
- `accountId`: identificativo canonico derivato dalla membership, conforme al pattern core `^[A-Za-z0-9._:@-]{1,160}$`.
- `role`: valore allowlisted dal backend, conforme al pattern core `^[A-Za-z0-9._:-]{1,64}$`.
- `permissions`: array minimo di stringhe non vuote, ciascuna non oltre 128 caratteri; il backend deve applicare una allowlist semantica, non soltanto il controllo sintattico del client.
- `expiresAt`: Unix epoch in **millisecondi**, numero finito e futuro secondo il clock server. Deve rappresentare una lease breve e limitata, non la scadenza del token Firebase né una garanzia di validità fino a quel momento.
- `verifiedBy`: marker di protocollo richiesto dall'adapter attuale; non è attestazione crittografica.

Il TTL massimo della lease deve essere definito con il threat model e il requisito di revoca. TTL breve riduce la finestra di stale authorization ma non sostituisce la verifica server-side su ogni API protetta. L'orologio client può essere alterato: il backend non deve usare `expiresAt` fornito dal client per autorizzare richieste.

Non includere email se non è indispensabile; il client già conosce l'email dal Firebase SDK. Non includere profili, turni, documenti membership completi o altri dati personali.

## 4. Risposte di errore

Formato esterno uniforme e privo di dettagli sensibili, ad esempio:

```json
{ "error": "authorization_denied" }
```

Comportamento suggerito:

| HTTP | Significato | Comportamento client |
|---|---|---|
| 400 | Richiesta malformata | Negare; nessun principal |
| 401 | Token assente, invalido, scaduto o revocato | Invalidare sessione DSM |
| 403 | Identità valida ma membership/ruolo non autorizzato | Negare; nessun principal |
| 429 | Rate limit | Negare temporaneamente; nessun principal |
| 5xx / timeout / rete | Servizio non disponibile | Fail-closed; nessun principal |

Non distinguere pubblicamente dettagli che facilitino enumerazione di UID o membership. Eventuali codici diagnostici interni devono essere minimizzati e non contenere token, UID completi, email o documenti membership. Non effettuare fallback a dati in cache o a una precedente autorizzazione dopo un errore.

## 5. Regole per sessione, revoca e operazioni

- Ogni evento Auth (sign-out, utente diverso, token/session change) invalida il principal e le operazioni pendenti associate alla generazione precedente.
- Un risultato asincrono tardivo non deve attivare un account dopo un cambio Auth.
- La ripresa di una transizione interrotta deve risolvere nuovamente l'autorizzazione con lo stato Auth corrente; mai riutilizzare il principal memorizzato nella transizione.
- Scadenza della lease: impedire nuove operazioni client e richiedere nuova risoluzione. Lato server ogni endpoint protetto deve comunque ricontrollare il token e la membership corrente.
- Revoca: la verifica token con controllo revoca e il lookup membership devono essere eseguiti sul backend. La sola scadenza della lease non rende immediata una revoca; definire un obiettivo massimo di propagazione.
- Cambio account: il server determina accountId dalla membership; il browser non può sceglierlo aggiungendolo alla richiesta.
- Logout: cancellare contesto, listener, operazioni e cache locali; non considerare BroadcastChannel prova di logout globale.
- Indisponibilità del servizio: nessuna modalità permissiva/offline per dati o API protette.
- Le API di scrittura devono applicare autorizzazione e ownership sul server al momento della scrittura, non fidarsi dei permessi presenti nel browser.

## 6. Requisiti trasporto e hardening

- Solo HTTPS e domini/origini esplicitamente allowlisted.
- CORS limitato alle origini DSM autorizzate; CORS non sostituisce autenticazione/autorizzazione.
- Bearer token in header, mai in URL, query string, localStorage, IndexedDB, log, error tracking o BroadcastChannel.
- `Cache-Control: no-store`; evitare cache CDN/proxy per risposte di autorizzazione.
- Timeout e limiti di dimensione; rate limiting per UID verificato e segnali anti-abuso senza creare lockout facile.
- Nessun segreto Admin SDK nel bundle browser, repository client o log.
- Nessuna membership o autorizzazione basata su dati forniti dalla UI.
- Audit server-side minimizzato: esito, timestamp, identificativo evento pseudonimo e codice motivo; accesso/retention definiti. Mai token o payload completo.
- Dipendenze, configurazione Firebase project/audience e ambiente devono essere espliciti e separati tra test e produzione.

## 7. Piano di test sintetico

Tutti i test devono usare emulatori, fake Admin SDK, token fittizi non validi per servizi reali e account `.invalid`. Nessuna credenziale reale, nessun progetto operativo e nessuna importazione.

### A. Autenticazione token

- [ ] Header Authorization assente o schema diverso da Bearer → 401.
- [ ] Token casuale, malformato o firma invalida → 401.
- [ ] Token emesso da project/issuer diverso → 401.
- [ ] Audience errata → 401.
- [ ] Token scaduto → 401.
- [ ] Token revocato → 401.
- [ ] Utente Firebase disabilitato → 401.
- [ ] Claim UID mancante o malformato → 401.
- [ ] Email non verificata, quando richiesta dalla policy → 403.
- [ ] UID/email nel body o header secondari discordanti non sovrascrivono i claim verificati.

### B. Membership e autorizzazione

- [ ] Membership assente → 403.
- [ ] Membership pending, inactive, suspended o revoked → 403.
- [ ] Membership scaduta o non ancora valida → 403.
- [ ] AccountId assente, malformato o non canonico → 403.
- [ ] Ruolo sconosciuto o non consentito → 403.
- [ ] Permesso sconosciuto/non allowlisted → rifiuto o rimozione secondo policy esplicita; mai elevazione.
- [ ] L'utente non può auto-approvare membership o auto-attribuirsi ruolo/permessi.
- [ ] Documento membership appartenente a UID diverso → 403.
- [ ] Admin: privilegio concesso soltanto da fonte server-side amministrata; claim/email/UI contraffatta non concede admin.
- [ ] Multi-account: il backend restituisce solo l'account selezionato secondo una procedura autorizzata; il client non forza accountId.
- [ ] Aggiornamento membership e revoca diventano effettivi secondo l'obiettivo di propagazione definito.

### C. Robustezza endpoint

- [ ] Timeout del lookup membership → fail-closed.
- [ ] Firestore/backend indisponibile → fail-closed.
- [ ] Risposta malformata, incompleta o con tipi errati → nessun principal.
- [ ] Risposta cacheata non viene riutilizzata.
- [ ] Rate limit → 429 e nessuna sessione parziale.
- [ ] CORS da origine non consentita non concede accesso.
- [ ] Nessun token, refresh token, email o membership completa nei log.
- [ ] Nessun redirect che inoltri Authorization verso host non autorizzati.
- [ ] Content-Type, dimensione body e metodi non previsti sono rifiutati.

### D. Adapter e lifecycle DSM

- [ ] La risposta positiva valida produce principal congelato e permissions congelate.
- [ ] UID della risposta diverso da UID Auth corrente → nessun principal.
- [ ] `verifiedBy` assente/diverso, status diverso da active o expiresAt non numerico/non futuro → nessun principal.
- [ ] Evento Auth durante getIdToken o resolver rende inutilizzabile la risposta tardiva.
- [ ] A→B durante transizione: A non viene mai riattivato; solo una nuova risoluzione di B può attivare B.
- [ ] Sign-out durante cleanup: nessuna attivazione successiva.
- [ ] Revoca tra risoluzione e chiamata API protetta: backend nega l'operazione.
- [ ] Scadenza lease: capture/isCurrent e UI negano l'uso stale; backend resta autorità finale.
- [ ] Errori ripetuti di cleanup non lasciano una sessione attiva o un principal recuperabile senza nuova verifica.
- [ ] Dispose rimuove observer e impedisce completamenti tardivi.
- [ ] Test di regressione per sessioni locali: nessuna identità Firebase viene accettata dal percorso local.

### E. API protette (gate distinto)

Prima di qualunque dato reale, testare ogni endpoint dati con:
- [ ] Nessun token / token revocato.
- [ ] Token valido ma senza membership.
- [ ] Ruolo valido ma permesso mancante.
- [ ] AccountId nel payload diverso dall'account derivato dal server.
- [ ] Accesso a record di altro account.
- [ ] Membership revocata tra lettura e scrittura.
- [ ] Tentativi di mass assignment di role, owner, accountId e campi audit.
- [ ] Replay/idempotenza e concorrenza, secondo il modello delle operazioni.

## 8. Criteri di accettazione

Il contratto può essere considerato pronto per una revisione di implementazione solo quando:

1. schema canonico membership e fonte autoritativa sono approvati;
2. policy di ruolo/permessi e semantica di account multipli sono formalizzate;
3. TTL lease e obiettivo di propagazione revoca sono definiti;
4. threat model, origini CORS, hosting e gestione segreti sono approvati;
5. tutti i test negativi/positivi pertinenti sono automatizzati in ambiente isolato;
6. il backend verifica autonomamente ogni richiesta dati protetta;
7. una revisione di sicurezza indipendente ha esaminato backend, rules e client;
8. l'implementazione e l'integrazione hanno un'autorizzazione separata e circoscritta.

Il superamento dei test dell'adapter browser non sostituisce questi criteri. Non usare il solo endpoint di risoluzione per proteggere operazioni dati che non eseguono un controllo server-side autonomo.

## 9. Ambito organizzativo: assegnazione a una sede

**Decisione approvata per questa specifica:** un manager assegnato a una sede ottiene accesso a tutti i reparti appartenenti a quella sede, senza dover assegnare ogni reparto singolarmente.

Regole normative:

1. L'assegnazione esplicita a una sede include tutti i reparti che, al momento della verifica, risultano appartenere a quella sede.
2. I reparti creati successivamente nella stessa sede sono inclusi automaticamente, senza aggiornare manualmente la membership del manager.
3. Un reparto trasferito a un'altra sede segue la sua appartenenza organizzativa corrente: il manager della sede precedente perde l'accesso ereditato e il manager della nuova sede lo acquisisce, se la sua assegnazione è attiva.
4. L'assegnazione a una sede non concede accesso ad altre sedi dello stesso account.
5. La revoca o scadenza dell'assegnazione alla sede revoca anche l'accesso derivato a tutti i reparti della sede.
6. Il backend deve risolvere l'ambito usando la gerarchia organizzativa canonica e aggiornata. Non deve fidarsi di elenchi di reparti o scopeIds inviati dal browser.
7. Le query e le scritture devono applicare il vincolo di sede/account lato server. Un controllo UI o una lista di ID precalcolata nel client non sono sufficienti.
8. Le modifiche alla relazione reparto-sede devono essere autorizzate e registrate nell'audit server-side. La transizione deve evitare finestre in cui il reparto risulti accessibile tramite la vecchia sede dopo il trasferimento.
9. Se la relazione organizzativa è mancante, ambigua o incoerente, l'accesso del manager a quella risorsa è negato (fail-closed).

Rappresentazione dati raccomandata: distinguere esplicitamente il tipo di assegnazione, ad esempio `scopeType: "site"` e `scopeId: "<site-id>"`, anziché espandere permanentemente la sede in una lista statica di reparti. L'autorizzazione deve derivare dalla relazione corrente reparto→sede. Eventuali assegnazioni dirette a singoli reparti richiedono una policy separata e non sono implicate da questa decisione.

Questa decisione definisce il comportamento richiesto, ma non approva ancora la gerarchia definitiva, il modello di membership, i ruoli complessivi o l'implementazione.

## 10. Policy di nomina e gestione degli amministratori

**Decisione di progetto:** per la nomina ordinaria degli amministratori è richiesta la doppia approvazione; la creazione del primo amministratore avviene tramite un bootstrap iniziale separato. Questa decisione definisce il requisito documentale e non attesta l'esistenza di un flusso implementato.

### 10.1 Nomina ordinaria: doppia approvazione

1. Un amministratore attivo e autorizzato apre una proposta di nomina per un'identità destinataria.
2. Un secondo amministratore attivo, distinto dal proponente, esamina e approva esplicitamente la proposta.
3. Proponente e approvatore devono essere due identità distinte e le rispettive autorizzazioni devono essere verificate dal backend al momento dell'operazione.
4. Il proponente non può approvare la propria proposta, neppure tramite una seconda sessione o un diverso dispositivo.
5. La proposta deve avere un identificativo univoco, una scadenza, uno stato esplicito e un legame non modificabile con destinatario, account e ambito amministrativo richiesti.
6. L'approvazione deve riferirsi esattamente alla proposta esaminata. Modifiche a destinatario, account, ruolo o ambito annullano le approvazioni precedenti e richiedono una nuova procedura.
7. Il backend ricontrolla identità, stato e privilegi di entrambi gli amministratori, validità della proposta e requisiti del destinatario immediatamente prima di attivare la membership.
8. Solo dopo la seconda approvazione valida e il completamento delle verifiche richieste il backend può attivare la membership amministrativa. Una proposta aperta o una sola approvazione non conferiscono alcun privilegio.
9. Proposte scadute, revocate, già consumate o approvate da soggetti non più autorizzati devono essere rifiutate. L'attivazione deve essere atomica e resistente a replay e richieste concorrenti.

### 10.2 Bootstrap iniziale del primo amministratore

Il primo amministratore è nominato mediante una procedura straordinaria di bootstrap, distinta dal flusso ordinario a doppia approvazione. Il bootstrap deve essere utilizzabile una sola volta per l'inizializzazione dell'ambiente/account interessato e non deve diventare una scorciatoia permanente.

Prima dell'implementazione devono essere definiti e approvati:
- il soggetto o processo indipendente autorizzato ad avviare il bootstrap;
- le prove e i controlli per verificare l'identità del destinatario;
- il metodo di autorizzazione iniziale, custodito fuori dal client e non basato su credenziali condivise o account predefiniti;
- la registrazione verificabile di autorizzante, destinatario, account, data/ora, motivazione ed esito;
- la protezione contro ripetizione, replay o riapertura non autorizzata del bootstrap;
- la procedura di recupero in caso di errore o perdita dell'accesso amministrativo.

Il completamento del bootstrap deve chiudere il percorso iniziale e abilitare il normale processo a doppia approvazione. Non sono ammesse auto-nomine né promozioni basate esclusivamente su email, UID dichiarati dal client o campi UI. La modalità concreta di bootstrap resta una decisione operativa aperta e richiede revisione separata prima di qualsiasi attivazione.

### 10.3 Requisiti di sicurezza per gli amministratori

- MFA obbligatoria per ogni identità amministrativa.
- Nuova autenticazione per nomine, approvazioni, revoche e altre operazioni amministrative sensibili.
- Sessioni e autorizzazioni con scadenza e revoca controllate lato server.
- Verifica server-side di token, revoca, membership, ruolo e ambito a ogni operazione protetta.
- Principio del minimo privilegio e rifiuto predefinito per stati o ruoli sconosciuti.
- Nessun privilegio amministrativo derivato da dati forniti dal browser, da una verifica email isolata o dal solo fatto di essere autenticati con Firebase.

### 10.4 Sospensione, revoca e continuità amministrativa

Sospensione e revoca sono decisioni applicate dal backend. Devono impedire nuove operazioni privilegiate, invalidare le autorizzazioni e le sessioni interessate secondo il meccanismo server-side definito e produrre un evento di audit. La persona revocata non può riattivarsi autonomamente.

Il sistema deve impedire la disattivazione dell'ultimo amministratore attivo quando ciò lascerebbe l'organizzazione senza un amministratore autorizzato. La successione deve essere completata e verificata prima della disattivazione dell'amministratore uscente. Eventuali procedure di emergenza o recupero devono essere separate dal flusso ordinario, sottoposte a verifica indipendente e registrate integralmente.

### 10.5 Audit e tracciabilità

Registrare lato server almeno: creazione della proposta, proponente, approvatore, destinatario, account/ambito, versione o identificativo della proposta, esiti e motivazioni di rifiuto, attivazione, sospensione, revoca, scadenza e ogni operazione di bootstrap. I registri devono avere timestamp server-side, accesso ristretto e protezioni contro modifiche non autorizzate. Non registrare token, segreti o payload di autenticazione.

### 10.6 Casi di rifiuto obbligatorio

Negare l'operazione se proponente e approvatore coincidono; se uno dei due non è attivo o non è autorizzato al momento della decisione; se la proposta è scaduta, alterata, revocata o già utilizzata; se il destinatario non supera i controlli; se manca una delle due approvazioni; se il bootstrap non soddisfa i requisiti approvati; se la revoca lascerebbe l'organizzazione senza amministratori; oppure se membership, account o ambito sono mancanti o incoerenti. In caso di indisponibilità dei servizi di verifica, applicare fail-closed.

### 10.7 Test di accettazione da aggiungere al piano

- [ ] Il proponente non può approvare la propria proposta, anche con sessioni o dispositivi distinti.
- [ ] Una sola approvazione non attiva la membership e non concede privilegi.
- [ ] Due amministratori distinti e ancora autorizzati possono completare una proposta valida.
- [ ] Revoca, sospensione o scadenza di uno degli approvatori prima dell'attivazione comporta il rifiuto.
- [ ] Modifica della proposta invalida le approvazioni precedenti.
- [ ] Proposta scaduta, duplicata, revocata o già consumata non può essere riutilizzata.
- [ ] Richieste concorrenti o replay non producono più di un'attivazione.
- [ ] Il bootstrap può essere completato solo dal processo autorizzato e non può essere ripetuto dopo l'inizializzazione.
- [ ] Nessuna auto-nomina, promozione via email o escalation tramite payload client.
- [ ] MFA e nuova autenticazione sono richieste secondo la policy per gli attori amministrativi.
- [ ] Il sistema impedisce di rimuovere l'ultimo amministratore attivo senza successione valida.
- [ ] Sospensione e revoca bloccano le successive operazioni protette lato server.
- [ ] Tutti gli eventi amministrativi producono audit server-side senza segreti o token.

Questa policy non definisce ancora il modello canonico completo delle membership, la procedura operativa dettagliata di bootstrap, il servizio di MFA o gli endpoint amministrativi. Tali elementi richiedono progettazione, test e autorizzazioni separate. Non autorizza modifiche a Firebase operativo, Firestore Rules, app DSM, dati reali, né implementazione o deploy.

## 11. Questioni aperte da decidere (non assunte)

- Quale progetto Firebase e quale ambiente di test saranno dedicati all'emulazione?
- Qual è lo schema canonico membership e chi può modificarlo?
- L'autorità per ruolo/permessi è una custom claim, un documento server-managed o una combinazione?
- Quali ruoli e permessi esistono realmente nel dominio DSM?
- È consentito a un UID appartenere a più account? Come si seleziona l'account in modo verificabile?
- Quale policy di verifica email si applica ad account amministrativi e membri?
- Quale TTL massimo e quale latenza massima di revoca sono accettabili?
- Quali origini web sono ammesse e quale servizio ospiterà l'endpoint?
- Quali API dati server-side saranno necessarie? Il core IndexedDB attuale non fornisce protezione server-side dei dati locali.
- Quali dati personali sono indispensabili e quali retention/cancellazione si applicano?

## 12. Stato e limitazioni attuali

- Esiste un adapter browser isolato che richiede a `resolveAuthorization` un oggetto con `verifiedBy`, `uid`, `status`, `accountId`, `role`, `permissions` ed `expiresAt`; la risposta viene validata sintatticamente e convertita in principal congelato.
- I test browser correnti usano resolver sintetici. Non dimostrano che un server reale verifichi token, revoca o membership.
- Non esiste in questo lavoro un endpoint server, un backend di autorizzazione, una membership canonica approvata o API dati protette.
- L'adapter non deve essere configurato con un resolver client-side basato su Firestore/UI o con un mock fuori dai test.
- L'applicazione Firebase operativa, `firebase-client.js`, `firebase-ui-v3-13.js`, `firestore.rules`, `index.html` e la production composition root restano fuori ambito.
- PR #1 deve restare aperta e draft; nessun merge, deploy, migrazione, import o sincronizzazione di dati reali è autorizzato da questo documento.

**Conclusione:** questo file è una specifica da sottoporre a revisione, non un'autorizzazione a implementare o attivare il servizio.
