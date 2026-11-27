# DSM — progetto del ciclo di vita dell'account

## Scopo e perimetro

Questo documento definisce il comportamento richiesto per accesso locale, cambio account, logout e futura cancellazione. È una specifica progettuale: non introduce login, cifratura, cancellazione o migrazione. Il core rimane separato dall'app operativa.

## Stato implementato oggi

- `createAccountContext()` mantiene un account attivo soltanto in memoria.
- `activate()` accetta esclusivamente `identitySource: "local"`; rifiuta valori remoti, incluso `firebase_verified`.
- `clear()` azzera il contesto in memoria.
- I repository filtrano i record usando `accountId`.
- IndexedDB è persistente e non cifrato.
- Non esiste un servizio account completo né una cancellazione coordinata di tutti gli store.
- Il contesto client non è un meccanismo di autenticazione o autorizzazione contro codice same-origin ostile.

## Stato aggiornato del lifecycle — 2026-11-24

La descrizione iniziale dello stato implementato e la sezione storica sulle operazioni pendenti qui sotto precedono l'introduzione del coordinatore: non descrivono più integralmente il branch corrente. Oggi sono presenti `createAccountLifecycleCoordinator()`, il controllo generazione/operazioni in `BaseRepository`, `createDSMCoreSession()` e il bridge cross-tab opzionale. Le implementazioni e i limiti sono descritti in `lifecycle-coordinator-design.md` e `account-switch-audit.md`.

**Limite di integrazione UI verificato sul tree del branch:** `src/ui/history-page.js` è un modulo DSM autonomo e il suo wiring lifecycle è facoltativo. Il modulo viene esercitato dai fixture `tests/browser/history-page-test.html` e `tests/browser/history-page-test.js`; non risultano chiamanti applicativi nel tree del branch. `index.html` resta la pagina legacy/operativa e non importa `src/ui/history-page.js` né la session factory DSM. Di conseguenza non si deve descrivere la cronologia come già collegata all'app operativa, né estendere automaticamente il coordinatore alla UI Firebase.

La verifica Playwright sul commit `12459677f3a711318a7f2861d4b030e5dcf83894` ha superato i test di transizione della fixture cronologia, compreso il blocco dell'export CSV tramite un riferimento obsoleto al pulsante. È una prova del modulo/fixture DSM, non di integrazione end-to-end nell'applicazione operativa.

## Terminologia obbligatoria

- **Selezione account locale**: scelta di un namespace locale per dati sintetici o di prova. Non equivale a login.
- **Autenticazione**: verifica dell'identità da parte di un provider fidato.
- **Autorizzazione**: decisione, lato fidato, su quali dati e operazioni l'identità può usare.
- **Logout**: rimozione del contesto e dei segreti dalla memoria; non implica cancellazione dei dati persistenti.
- **Cancellazione account**: procedura esplicita che elimina i dati dell'account da tutti gli store previsti e produce un esito verificabile.

Non usare parole come "verificato", "autenticato" o "sicuro" per descrivere una semplice selezione locale.

## Contratto per le transizioni

### 1. Avvio senza account

- Il contesto parte vuoto.
- Le operazioni sui repository che richiedono un account falliscono con `DB_ACCOUNT_REQUIRED`.
- Nessun account deve essere attivato automaticamente leggendo un valore non verificato da storage o URL.

### 2. Selezione locale (solo test/prototipo)

- Può essere usata esclusivamente per dataset sintetici.
- L'interfaccia deve dichiarare chiaramente che si tratta di un contesto locale, non di un'identità autenticata.
- Un account ID fornito dal client non deve essere interpretato come prova di titolarità.
- Il cambio del contesto deve prima invalidare le viste e le operazioni pendenti dell'account precedente.

### 3. Futuro accesso remoto

Non implementare finché non esiste un adapter di autenticazione verificabile. L'adapter dovrà fornire un principal immutabile proveniente dall'SDK ufficiale; l'interfaccia non potrà costruirlo né passare un booleano o una stringa che dichiari l'identità verificata.

Il contratto dovrà includere:
- stato iniziale in attesa di verifica;
- sessione valida, scaduta, revocata e assente;
- UID canonico dal provider;
- gestione cambio account e revoca;
- blocco di tutte le operazioni se la verifica fallisce;
- test che dimostrino che un UID arbitrario passato dal client non abilita l'accesso a dati altrui.

L'autorizzazione ai dati reali non può basarsi soltanto su filtri client-side IndexedDB. Dovrà essere definita una barriera fidata adeguata all'architettura scelta.

### 4. Cambio account

Sequenza richiesta:
1. impedire nuove operazioni;
2. attendere o annullare operazioni pendenti;
3. svuotare viste, cache e riferimenti ai record dell'account precedente;
4. rimuovere contesto e chiavi temporanee dalla memoria;
5. verificare il nuovo principal tramite il flusso fidato;
6. inizializzare il nuovo contesto e ricaricare soltanto i dati autorizzati.

Non riutilizzare oggetti repository o cache che conservino dati del precedente account senza un controllo esplicito.

### 5. Logout

Il logout deve:
- bloccare nuove operazioni prima di modificare lo stato;
- invalidare viste, cache e richieste pendenti;
- azzerare il contesto in memoria;
- rimuovere dalla memoria eventuali chiavi di cifratura e materiale di sessione;
- lasciare esplicito che i dati persistenti restano sul dispositivo, a meno che l'utente scelga separatamente la cancellazione.

Il logout non deve cancellare automaticamente dati o cronologia: confondere logout e cancellazione può causare perdita irreversibile.

## Verifica implementativa aggiuntiva

Il test browser `AUTH-002` verifica il comportamento reale di `clear()`: il contesto in memoria viene azzerato e le successive chiamate ai repository vengono rifiutate con `DB_ACCOUNT_REQUIRED`, mentre i record IndexedDB restano presenti e tornano leggibili solo dopo una nuova selezione locale dello stesso namespace. Questo è logout del contesto, non cancellazione account.

### Nota storica: limite delle operazioni pendenti

Questa sezione descrive lo stato precedente al lifecycle coordinator e resta valida soltanto per `accountContext.clear()` usato isolatamente: `clear()` da solo non garantisce l'annullamento delle operazioni già avviate né lo svuotamento delle viste/cache UI. Nel branch corrente `BaseRepository` può ricevere il coordinatore e applicare controlli di generazione e abort best-effort delle scritture pendenti. Una scrittura già completata non è reversibile; il wiring della UI resta esplicito e non universale. Non presentare `clear()` isolato come logout completo di sicurezza.

## Specifica per futura cancellazione account

La cancellazione è distruttiva e deve essere progettata separatamente prima di scrivere il codice.

### Store da considerare

La procedura dovrà considerare tutti gli store account-scoped presenti nello schema:
- `accounts`
- `profiles`
- `settings`
- `shifts`
- `absences`
- `history`
- `migration_jobs`
- `migration_quarantine`

Dovrà inoltre rilevare eventuali nuovi store introdotti da future versioni. Non affidarsi a un elenco parziale mantenuto in più punti del codice.

### Garanzie richieste

- Un'unica transazione IndexedDB per la cancellazione locale coordinata, quando possibile.
- Nessuna cancellazione di record appartenenti ad altri account.
- Nessuna cancellazione parziale presentata come successo.
- Gestione esplicita di schede/connessioni concorrenti e database bloccato.
- Conferma esplicita dell'utente con indicazione degli store e del numero di record coinvolti.
- Risultato verificato con una nuova lettura di tutti gli store.
- Test di errore a metà transazione, quota/DB non disponibile, account inesistente e dati di un secondo account da preservare.

### Cronologia e audit

La cancellazione fisica dei record e la conservazione degli eventi history sono in tensione: se si cancellano anche gli eventi, non rimane audit locale; se si mantengono, restano metadati riferibili all'account. La policy deve decidere esplicitamente tra:
- eliminazione completa, inclusa la cronologia;
- conservazione limitata di metadati minimizzati, con base e durata definite.

Non scegliere automaticamente una delle due opzioni nel codice.

### Backup e ripristino

Prima della cancellazione deve essere chiaro se esiste un export volontario e come verificare il ripristino. Non creare backup automatici, non inviare dati a servizi esterni e non esportare dati personali senza una decisione esplicita.

## Matrice minima di test futura

| Caso | Risultato atteso |
|---|---|
| Avvio senza contesto | Repository rifiuta l'accesso |
| Selezione locale | Dichiarata come locale/demo, mai autenticata |
| Tentativo di identitySource remoto | Rifiutato |
| Logout | Contesto e cache svuotati, IndexedDB invariato |
| Cambio account A → B | Nessun dato/cache di A visibile in B |
| Sessione remota scaduta | Operazioni bloccate |
| UID client manipolato | Nessuna autorizzazione concessa |
| Cancellazione account A | Tutti gli store previsti senza record A |
| Cancellazione account A | Record B invariati |
| Errore transazione | Rollback completo e nessun falso successo |
| Nuovo store in schema futuro | Cancellazione richiede aggiornamento esplicito e test |

## Decisioni necessarie prima dell'implementazione

1. Il DSM resterà esclusivamente locale oppure sarà collegato a Firebase Auth?
2. Se remoto, quale componente fidato autorizzerà l'accesso ai dati? IndexedDB client-side da solo non basta.
3. La cancellazione account deve eliminare anche tutta la cronologia?
4. Quale policy di retention e backup è richiesta?
5. Quale esperienza di recupero è prevista se la chiave locale viene persa?

Fino a queste decisioni, mantenere il core in modalità prototipo con dati sintetici. Non collegarlo all'app operativa e non usarlo per conservare dati reali sensibili.
