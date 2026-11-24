# DSM — contratto per un futuro entrypoint isolato

## Stato

**Primo orchestratore isolato disponibile; non è un entrypoint di prodotto né un confine di autenticazione.** `src/ui/create-dsm-composition.js` riceve una connessione già aperta, un accountId locale, una funzione di mount e una callback esplicita di chiusura DB. Coordina sessione, cleanup registrati, retry del teardown e chiusura della connessione. Non apre il database, non autentica un'identità e non autorizza dati remoti. `src/core/database/create-dsm-session.js` compone repository e servizi; `src/ui/history-page.js` resta una vista montabile.

Questo documento definisce i vincoli per un futuro entrypoint separato. Non autorizza modifiche a `index.html`, alla UI Firebase, alle regole Firestore o ai guard operativi.

## Confine di fiducia

Un entrypoint non deve mai trasformare un campo URL, localStorage, input o parametro JavaScript in una dichiarazione di identità verificata.

Sono ammessi due futuri profili, chiaramente separati:

1. **Fixture/demo locale:** esclusivamente dati sintetici, avviso persistente “ambiente dimostrativo — account locale non autenticato”, nessuna importazione di dati operativi e nessuna richiesta di rete. Un account ID locale è solo un namespace di test.
2. **Applicazione con identità verificata:** non implementabile finché non esiste un adapter di autenticazione verificabile e un confine di autorizzazione fidato. Il composition root dovrà ricevere un principal immutabile emesso dall'adapter, non un UID o un booleano fornito dalla vista. I filtri IndexedDB lato client non autorizzano dati reali.

Non è consentito un profilo ibrido che presenti la selezione locale come login o che abiliti dati reali usando soltanto l'accountId del client.

## Responsabilità del composition root

Quando i prerequisiti saranno soddisfatti, un unico modulo DSM separato dovrà:

1. verificare il profilo di esecuzione e il relativo confine di fiducia prima di costruire viste;
2. ricevere o aprire una connessione database secondo una policy esplicita, gestendo errori e chiusura;
3. costruire una sola sessione tramite `createDSMCoreSession({ db, ... })`;
4. montare le viste passando sempre `session.lifecycle` e i servizi della medesima sessione;
5. possedere le funzioni di teardown delle viste e invocarle prima di cambiare contesto o terminare la sessione;
6. impedire nuove azioni durante `switching` e rifiutare ogni callback/risultato appartenente a una generazione obsoleta;
7. dismettere il bridge cross-tab, se attivato, solo dopo aver risolto eventuali invalidazioni pendenti;
8. esporre errori generici e minimizzati, senza registrare record, credenziali, token o identificativi personali.

Il composition root non deve ricreare un secondo account context o un coordinatore parallelo: sessione, repository, servizi e viste devono condividere lo stesso lifecycle.

## Ordine di teardown

Per cambio contesto o logout:

1. iniziare la transizione attraverso la sessione;
2. svuotare immediatamente le viste e disregistrarne listener, timer e riferimenti a record;
3. lasciare al coordinatore il completamento della pulizia registrata; in caso di errore restare non attivi e richiedere il retry previsto;
4. non riattivare il contesto successivo finché la pulizia non è completata;
5. dopo l'attivazione, rimontare le viste con i servizi della sessione e caricare nuovamente i dati;
6. al teardown definitivo, distruggere le viste, dismettere il bridge quando possibile e chiudere la connessione database con l'API dedicata.

Nota: `createDSMCoreSession().dispose()` attualmente dismette soltanto il bridge cross-tab. Non equivale a logout, chiusura IndexedDB o distruzione automatica delle viste. Il chiamante resta responsabile di tali operazioni.

## Requisiti del fixture locale

Un eventuale fixture separato dovrà essere collocato sotto `tests/` e non presentato come pagina di prodotto. Dovrà:

- usare solo fixture sintetiche create nel test;
- applicare CSP restrittiva e nessun endpoint remoto;
- non importare Firebase né la pagina legacy;
- non leggere dati da storage preesistente;
- non offrire import/export di dati reali;
- mostrare chiaramente che account e contenuti sono dimostrativi;
- fallire in modo chiuso se il database o il lifecycle non possono essere inizializzati.

La fixture browser attuale della cronologia resta un test della vista; non deve essere descritta come composition root o app DSM.



## Primo orchestratore isolato — stato implementativo

`createDSMComposition()` è un modulo di orchestrazione riutilizzabile, non una pagina o un'applicazione avviata automaticamente. Il chiamante deve aprire la connessione e trasferire esplicitamente la responsabilità di chiuderla tramite `closeDatabase`. La callback `mount` riceve la sessione e `registerCleanup`: ogni vista deve registrare il proprio cleanup appena crea risorse, così anche un mount interrotto a metà può essere dismesso.

`start()` esegue il mount; se questo fallisce, tenta il teardown. Se un cleanup fallisce, la connessione resta aperta e la sessione resta bloccata in transizione: il chiamante può ripetere `teardown()`, che riprende la pulizia pendente prima di chiudere il DB. La chiusura viene tentata soltanto dopo il completamento della pulizia lifecycle. L'API non implementa login, principal remoto, cambio account o UI di prodotto; l'accountId resta esclusivamente locale/demo.

La fixture browser verifica un mount parziale con cleanup fallito al primo tentativo: nessuna chiusura DB anticipata, retry riuscito, una sola chiusura finale. Questa copertura dimostra l'orchestrazione di teardown nel modulo, non un'integrazione con `index.html`.

## Copertura già presente e lacune residue

L'audit dei test browser esistenti evita di duplicare scenari già verificati:

- `tests/browser/database-core.test.js`, AUTH-006: verifica che la session factory condivida lo stesso coordinatore tra repository e servizi, che il cambio A → B non esponga i record precedenti e che il logout porti il lifecycle allo stato `cleared`.
- `tests/browser/database-core.test.js`, AUTH-007: verifica il blocco durante cleanup fallito e il retry sia per lo switch sia per il logout.
- `tests/browser/history-page-test.js`: verifica che la vista venga svuotata e distrutta all'avvio della transizione, che un riferimento obsoleto al pulsante CSV non produca un export e che una lettura asincrona tardiva non rimonti dati della generazione precedente.
- `tests/browser/run-playwright.mjs`: esegue anche la prova cross-tab su due pagine browser reali e verifica il rapporto legacy in sola lettura.

Questi test coprono i componenti e alcuni collegamenti, ma **non** dimostrano l'esistenza di un composition root: i test costruiscono sessione e vista separatamente. Restano senza copertura integrata l'ordine orchestrato di mount/teardown, la chiusura della connessione DB da parte del proprietario e il comportamento del root quando il mount di una vista fallisce a metà. Non si deve colmare il gap collegando la vista a `index.html`; prima va realizzata una fixture dedicata sotto `tests/`, non una pagina di prodotto.

## Test di accettazione prima di creare l'entrypoint

| Scenario | Esito richiesto |
|---|---|
| Avvio senza principal verificato | Nessuna vista dati reali montata |
| Account ID arbitrario nel browser | Non produce autenticazione né autorizzazione |
| Fixture locale | Banner demo visibile; dataset soltanto sintetico |
| Cambio A → B | DOM/cache A svuotati prima dell'attivazione B |
| Risposta asincrona tardiva | Risultato scartato se la generazione non è più corrente |
| Listener/disposable fallisce | Sessione resta non attiva; retry esplicito |
| Logout | Contesto e viste svuotati; IndexedDB non dichiarato cancellato |
| Teardown | Listener e bridge rimossi; connessione chiusa dal proprietario |
| Isolamento operativo | Nessuna modifica/import da `index.html`, Firebase o Firestore Rules |

## Fuori ambito

Questo contratto non introduce autenticazione, autorizzazione, cifratura, cancellazione account, sincronizzazione remota, migrazione o deployment. Non modifica il comportamento dell'applicazione operativa. Qualsiasi integrazione con dati reali richiede una revisione separata del modello di identità, delle regole di accesso e della protezione dei dati.
