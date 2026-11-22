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
