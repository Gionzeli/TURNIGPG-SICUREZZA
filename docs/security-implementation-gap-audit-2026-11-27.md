# Audit di avanzamento sicurezza — 2026-11-27

**Stato:** verifica documentale e statica del repository; nessuna modifica al runtime.
**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`
**Branch esaminato:** `codex/employee-shift-date-range-query`
**HEAD esaminato:** `2bb540eae0310f60ba93295256b8d2ba98cba328`
**Ambito:** confronto tra decisioni approvate, codice presente, test dichiarati e gate ancora aperti.
**Dati:** solo codice, documentazione e fixture sintetiche. Nessun dato personale o ambiente Firebase reale.

## 1. Sintesi esecutiva

Il repository contiene un core DSM locale, un backend Firebase isolato e diversi servizi/policy Employee e organizzativi con test Emulator. Non è però un sistema pronto per l'uso operativo con dati reali.

Le 127 decisioni L-01…L-127 nel decision record sono approvazioni/requisiti di policy. Non dimostrano che le relative protezioni siano state implementate. La stessa intestazione del decision record dichiara che l'implementazione resta subordinata a ruoli, scope, schema, workflow, lifecycle e test.

**Esito complessivo: NON PRONTO per dati reali, collegamento all'app operativa, merge o produzione.** È appropriato continuare lo sviluppo isolato e le verifiche sintetiche.

## 2. Cosa risulta presente nel repository

- Core browser con IndexedDB, repository e servizi per profili, turni, assenze e cronologia.
- Coordinamento lifecycle account e adapter Firebase isolato.
- Backend Functions con callable per risoluzione membership, operazioni organizzative e alcune operazioni di provisioning/binding/turni.
- Servizi Employee e organizzativi transazionali, loader e primitive di autorizzazione.
- Test browser, unitari e Firestore/Auth/Functions Emulator.
- Regole Firestore operative nel repository con default deny per percorsi non esplicitamente consentiti; il backend Admin SDK richiede comunque autorizzazione applicativa server-side perché bypassa le Rules.

Questa inventariazione non equivale a una revisione completa riga per riga né a una prova che tutti i percorsi siano collegati o invocabili.

## 3. Blocchi verificati

### BLOCCO-01 — API protette per i dati Employee non complete

Il file `functions/src/index.js` dichiara esplicitamente:
- `protectedEmployeeDataApisImplemented: false`;
- `protectedEmployeeShiftApisImplemented: true`;
- `employeeDelegatedShiftAuthorizationImplemented: false`.

Il backend espone alcune callable di turni self-service, ma la delega manageriale non risulta implementata come percorso completo. La documentazione del progetto distingue inoltre i servizi interni/testati dalle callable effettivamente esposte.

**Conseguenza:** non dichiarare disponibile l'intero dominio Employee; non concedere accesso manageriale ai turni e non presumere disponibili profili, payroll o dettagli di assenza protetti.

### BLOCCO-02 — Il modello canonico e le autorizzazioni di dominio richiedono completamento

Le proposte e i decision record contengono approvazioni limitate, ma restano requisiti da tradurre in schema fisico, loader, query e DTO. La matrice dei domini distingue correttamente identità, scope organizzativo e permesso sul singolo dominio: nessuna dimensione sostituisce le altre.

**Conseguenza:** prima di ogni endpoint occorre verificare il mapping dei campi, ownership Employee, placement efficace alla data dell'operazione, lifecycle, permesso specifico e query server-side. Nessun campo non mappato o permesso generico va interpretato in senso permissivo.

### BLOCCO-03 — Integrazione con l'app operativa non autorizzata né verificata

Il core e l'adapter sono descritti come isolati. La PR #1 resta aperta e Draft e punta a un branch diverso; non è prova di integrazione nel runtime legacy. La documentazione segnala che `index.html` e il percorso Firebase legacy non sono collegati alla composizione DSM.

**Conseguenza:** nessun collegamento all'app operativa, nessuna sostituzione del runtime e nessun merge automatico.

### BLOCCO-04 — Protezione dei dati locali e audit non equivalgono a garanzia server

IndexedDB è modificabile da codice eseguito nella stessa origine. Il bridge cross-tab è best-effort. La cronologia locale append-only a livello API non è un audit immutabile o probatorio. Le decisioni su cifratura, chiavi, retention e audit remoto richiedono implementazione ed evidenze separate.

**Conseguenza:** non conservare né trattare dati reali come protetti sulla sola base della partizione IndexedDB, della cronologia locale o della cifratura non ancora verificata.

### BLOCCO-05 — Assicurazione MFA/TOTP reale ancora da dimostrare

La documentazione backend dichiara che i test sintetici/verifier mockati non provano che il tenant Firebase reale emetta e verifichi il claim TOTP atteso. L'Auth Emulator standard non fornisce questa prova.

**Conseguenza:** mantenere i flussi che dipendono da tale garanzia non esposti/non distribuiti finché non esiste una verifica supportata in un ambiente non produttivo approvato.

### BLOCCO-06 — Evidenza CI non completa sul HEAD esaminato

Sul commit `2bb540eae0310f60ba93295256b8d2ba98cba328` GitHub mostra un check completato con successo: `indexeddb-browser-tests`. Non risultano check-run backend Functions/Auth/Firestore né un check Firestore Rules sullo stesso SHA nell'elenco dei check-runs consultato. Il commit è documentale, quindi la pipeline backend non è stata attivata da questo cambiamento.

**Conseguenza:** il successo browser non va esteso al backend, alle Rules, alle API protette o alla sicurezza complessiva. Le esecuzioni storiche restano riferite ai rispettivi SHA.

## 4. Ordine di lavoro raccomandato

1. **Chiudere il contratto canonico Employee e organizzativo:** schema, ownership, cardinalità, placement, lifecycle e mapping campi.
2. **Completare l'autorizzazione per operazione:** self e delega distinti, permessi per dominio/azione/campo, query server-side e DTO allowlist.
3. **Completare i percorsi protetti mancanti:** prima letture minime Employee e turni self; poi delega manageriale solo con autorizzazione canonica testata. Payroll resta separato e negato finché non completato.
4. **Testare sullo stesso commit:** Auth + Functions + Firestore Emulator, Rules Emulator e suite browser; includere test negativi cross-tenant, cross-employee, revoca, lifecycle, stale revision, DTO leakage e concorrenza.
5. **Completare protezione dati e audit:** threat model, XSS, IndexedDB, cifratura/chiavi, retention, audit remoto e restore.
6. **Revisione indipendente e decisione separata:** solo dopo evidenze riproducibili valutare integrazione, PR, eventuale merge e qualsiasi uso reale.

Ogni fase deve produrre un elenco di file modificati, test eseguiti sullo SHA esatto, esiti e rischi residui. Un test superato non chiude un requisito che non esercita.

## 5. Confini mantenuti durante questo audit

- Nessuna modifica a `main`.
- Nessuna modifica alla PR #1.
- Nessuna modifica a `index.html`, UI legacy, configurazione Firebase operativa o regole operative.
- Nessun accesso a Firebase reale, deploy, migrazione, importazione o sincronizzazione.
- Nessun uso di dati personali reali.
- Nessuna nuova decisione L-128: la priorità passa dall'espansione del registro alla chiusura dei gap implementativi.

## 6. Riferimenti interni esaminati

- `docs/dsm-employee-domain-permission-decision-record.md`
- `docs/security-review-preliminary.md`
- `docs/dsm-integration-readiness.md`
- `docs/backend-protected-data-api-design.md`
- `docs/dsm-data-domain-authorization-matrix.md`
- `docs/dsm-employee-firestore-decision.md`
- `docs/firebase-server-authorization-contract.md`
- `functions/README.md`
- `functions/src/index.js`
- `firestore.rules`
- `DSM-CORE-IMPLEMENTATION.md`

**Nota:** questo audit è una fotografia statica del branch e dello SHA indicati, non un penetration test, una certificazione, una verifica indipendente o una dichiarazione di conformità normativa.
