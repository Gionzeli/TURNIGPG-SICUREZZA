# DSM — contratto per un futuro entrypoint isolato

## Stato

**Specificazione, non entrypoint eseguibile.** Nel branch non esiste ancora un composition root DSM applicativo. `src/core/database/create-dsm-session.js` compone repository e servizi a partire da una connessione IndexedDB già aperta; non apre il database, non autentica un'identità e non autorizza l'accesso a dati remoti. `src/ui/history-page.js` è una vista montabile, non un'applicazione completa.

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
