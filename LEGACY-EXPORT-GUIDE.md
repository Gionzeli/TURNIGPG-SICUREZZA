# Esportazione sicura dei dati legacy per la riconciliazione

Questa procedura serve a preparare una copia da analizzare. Non importa, modifica o cancella i dati nell'app.

## File da usare

1. Aprire la versione legacy dell'app sul dispositivo che contiene i dati.
2. Aprire la sezione **Backup e ripristino**.
3. Premere **Senza password** (non **Backup cifrato**).
4. Salvare il file JSON generato senza rinominarne il contenuto.

Il file non è cifrato: trattarlo come un documento personale. Contiene parametri, profilo, turni e i dati extra inclusi nell'export (quote, valori mensili, modelli e formazione). Non pubblicarlo su repository, chat di gruppo o servizi cloud condivisi.

## Prima di condividerlo per l'analisi

- Conservare una copia originale in un luogo privato e sicuro.
- Non inviare password, codici di recupero, PIN, hash o salt.
- Non inviare screenshot di credenziali o schermate di accesso.
- Non usare un backup cifrato: questo strumento lo riconosce nell'inventario ma non lo decifra.
- Se il file contiene informazioni che non si desidera condividere, non caricarlo. È possibile prima eseguire l'analisi in un ambiente locale fidato.

## Cosa viene controllato

L'analisi riconosce il formato dell'export dell'app, controlla la validità dei turni e riepiloga la presenza di quote, valori mensili, modelli e formazione. Con due o più export può confrontare turni, parametri e dati extra, segnalando copie identiche, possibili duplicati e conflitti.

**Nessun dato viene importato, unito, sovrascritto o cancellato.** Il report non stabilisce quale copia sia quella corretta: la provenienza e la scelta finale devono essere verificate prima di qualsiasi futura migrazione.

## Limite attuale

Il file prodotto dal pulsante **Senza password** è un export puntuale: non comprende necessariamente lo storico modifiche, tutte le copie per-utente o i backup precedenti conservati nel browser. Per una riconciliazione completa quelle fonti richiedono un inventario separato.

## Analisi locale con lo strumento DSM

È disponibile la pagina `tools/legacy-report.html`, che usa il modulo locale `tools/legacy-report.js` e l'adapter read-only del progetto.

1. Scaricare/clonare una copia del repository sul computer fidato, mantenendo insieme le cartelle `tools` e `src`.
2. Aprire un terminale nella cartella principale del progetto e avviare un server statico locale: `python -m http.server 8000`.
3. Aprire `http://localhost:8000/tools/legacy-report.html`.
4. Selezionare uno o più export JSON non cifrati e avviare l'analisi. Con un solo file viene prodotta un'anteprima; con due o più file viene eseguita anche la riconciliazione.
5. Esaminare il riepilogo per fonte, i conflitti e gli elementi in quarantena. Se serve, salvare il rapporto riepilogativo.

La pagina applica un limite di 100 file e 10 MB per file. I file selezionati vengono letti in memoria dal browser: non sono caricati su GitHub o su altri servizi, non vengono salvati in LocalStorage/IndexedDB e non sono modificati. Il rapporto scaricabile omette contenuti dei turni, identificativi legacy, valori in conflitto e nomi dinamici dei campi legacy; mostra etichette generiche per conflitti, avvisi e quarantene. Contiene comunque nomi dei file selezionati, conteggi e indici, quindi va trattato con riservatezza.

Con una sola fonte il report mostra la validità e i conteggi del singolo export; con più fonti aggiunge il confronto tra profili, dati extra e turni. Nessun risultato abilita o esegue l'importazione: `automaticImportAllowed` rimane sempre `false`.
