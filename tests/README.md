# Test browser DSM Enterprise

## Esecuzione

I test usano IndexedDB reale e un database dedicato `DSM_ENTERPRISE_TEST_DB`; non aprono il DB operativo DSM né il LocalStorage legacy.

1. Clonare il branch `dsm-enterprise/core-v1`.
2. Avviare un server statico dalla root (es. `python -m http.server 8000).
3. Aprire `http://localhost:8000/tests/browser/`.
4. Attendere il riepilogo PASS/FAIL.

Non usare `file://`, perché i moduli ES richiedono HTTP.

## Test

- apertura DB test isolato e stato DB coerente;
- object store;
- blocco operazioni senza account;
- creazione/lettura profilo;
- update, revisione, delete;
- isolamento account A/B;
- creazione turno e persistenza dopo reopen;
- ID duplicato;
- campi riservati.

## Pulizia e limiti

- Il harness cancella il DB test all'avvio e tenta di cancellarlo nuovamente a fine sessione.
- Se la cancellazione è bloccata da altre schede, il harness mostra un errore di cleanup: chiudere le schede che usano il DB test e ripetere.
- La cancellazione del database di test non tocca `DSM_ENTERPRISE_DB` né i dati legacy.
- I test sono manuali; non sono CI e non sono stati eseguiti automaticamente.
- Non testano Firebase, cifratura, backup, sync, migrazione legacy, service worker o dispositivi multipli.
