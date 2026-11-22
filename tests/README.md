# Test browser DSM Enterprise

## Esecuzione

Questi test usano l'IndexedDB nativo del browser, non un mock e non il LocalStorage della PWA legacy.

1. Clonare il branch `dsm-enterprise/core-v1`.
2. Avviare un server HTTP statico dalla root del repository (ad esempio `python -m http.server 8000`).
3. Aprire `http://localhost:8000/tests/browser/` in un browser moderno.
4. Attendere il riepilogo: ogni controllo mostra PASS o FAIL.

Non aprire il file HTML direttamente con `file://`: i moduli ES richiedono un'origine HTTP.

## Copertura

- apertura database e presenza degli object store;
- rifiuto operazioni senza account attivo;
- creazione e lettura profilo;
- aggiornamento, revisione e cancellazione;
- isolamento lettura tra due account;
- creazione turno e persistenza dopo chiusura/riapertura;
- gestione ID duplicato e integrità del record originale;
- rifiuto dei campi riservati.

## Limiti

- I test usano un database dedicato `DSM_ENTERPRISE_DB` e inseriscono record di prova con account ID `browser-test-account-A/B`. Non usano né cancellano dati legacy.
- I record di test rimangono nel database locale del browser; per una sessione pulita usare un profilo browser dedicato o cancellare manualmente il database di test dagli strumenti di sviluppo.
- Non verificano autenticazione Firebase, cifratura, backup, sincronizzazione, migrazione legacy, service worker o compatibilità multi-dispositivo.
- Questa pagina è un harness manuale: non equivale a una suite CI automatizzata.
