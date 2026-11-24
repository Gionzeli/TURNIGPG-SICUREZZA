# Test browser DSM Enterprise

## Esecuzione

I test usano IndexedDB reale e un database dedicato `DSM_ENTERPRISE_TEST_DB`; non aprono il DB operativo DSM né il LocalStorage legacy.

1. Clonare il branch `dsm-enterprise/core-v1`.
2. Avviare un server statico dalla root (es. `python -m http.server 8000`).
3. Aprire `http://localhost:8000/tests/browser/`.
4. Attendere il riepilogo PASS/FAIL.

Non usare `file://`, perché i moduli ES richiedono HTTP.

## Fixture composition root dimostrativa

- Aprire `http://localhost:8000/tests/browser/composition-demo.html` per la dimostrazione isolata.
- La pagina mostra un avviso persistente: account locale non autenticato e dati esclusivamente sintetici.
- Crea un database IndexedDB con nome casuale, monta la cronologia tramite `createDSMComposition` e popola tre eventi sintetici.
- Il pulsante di terminazione esegue il teardown, distrugge la vista, chiude la connessione e cancella il database temporaneo.
- Il parametro tecnico `?fail-mount` simula un errore dopo la scrittura dei soli eventi sintetici: la fixture verifica il teardown e la cancellazione del database anche quando il montaggio fallisce.
- CSP: script e stili same-origin, `connect-src 'none'`, nessuna risorsa remota; non importa Firebase né la pagina operativa.
- La fixture non è una pagina di prodotto, non autentica utenti e non deve essere collegata a `index.html`.

## Copertura

- rifiuto del nome DB vuoto senza fallback al DB operativo;
- apertura DB test isolato e stato DB coerente;
- object store;
- blocco operazioni senza account;
- creazione/lettura profilo;
- update, revisione, delete;
- isolamento account A/B;
- creazione turno e persistenza dopo reopen;
- ID duplicato;
- campi riservati;
- conflitto su revisione obsoleta;
- validazione ID e revisione attesa;
- update di record inesistente;
- due aggiornamenti concorrenti sulla stessa revisione;
- blocco della cancellazione con revisione obsoleta e cancellazione con revisione corrente;
- Service Layer profili: default, validazione percentuali/campi e merge con revisione;
- Service Layer turni: date reali, orari, flag booleani, normalizzazione e conflitti di revisione;
- isolamento account verificato anche attraverso i servizi e cancellazione con revisione attesa;
- anteprima adapter legacy in sola lettura per `tg_online_v1`: snapshot valido, quarantena turni non validi, ID duplicati, campi extra, avvisi di correzioni legacy e JSON corrotto;
- anteprima `tg_extra_v1`: quote, mensili, modelli, formazione, residui ferie/permessi e gestione prudente dei metadati PIN/salt.

## Pulizia e limiti

- Il harness cancella il DB test all'avvio e tenta di cancellarlo nuovamente a fine sessione.
- Se la cancellazione è bloccata da altre schede, il harness mostra un errore di cleanup: chiudere le schede che usano il DB test e ripetere.
- La cancellazione del database di test non tocca `DSM_ENTERPRISE_DB` né i dati legacy.
- Il workflow GitHub Actions `DSM Core browser tests` esegue gli stessi controlli con Chromium/Playwright su push al branch e tramite avvio manuale (`workflow_dispatch`).
- L'esito CI va verificato nella scheda Actions del repository; la sola presenza del workflow non equivale a test superati.
- Non testano Firebase, cifratura, backup, sync, migrazione legacy, service worker o dispositivi multipli.


## Inventario archivio legacy

- `LEGACY-009`: inventario read-only di backup precedenti, chiavi per-utente, storico e formazione; verifica che suffissi identificativi e contenuti dello storico non vengano restituiti.
- `LEGACY-010`: riconoscimento dei contenitori cifrati v3 senza decifrazione.
- Nessun test usa dati reali del browser: i campioni sono sintetici e non attivano importazioni.


## Riconciliazione read-only

- `LEGACY-011`: copie identiche e possibili duplicati con ID differenti.
- `LEGACY-012`: conflitti sullo stesso ID e divergenze dei parametri profilo.
- `LEGACY-013`: conteggio separato dei record in quarantena.
- La funzione `inspectLegacyReconciliation(candidates)` non fonde né modifica i record.


- `LEGACY-014`: riconoscimento dell'export ufficiale senza password con report minimizzato.
- `LEGACY-015`: confronto dei dati extra tra export ufficiali.

- `LEGACY-016`: analisi cronologica read-only; rileva sovrapposizioni tra turni notturni e turni del giorno successivo e distingue i cambi turno consecutivi dai periodi di riposo.

- `LEGACY-017`: esclude dalla cronologia turni con date/orari non validi, segnala gli elementi non validi e ignora le assenze.
- `LEGACY-018`: rileva tutte le sovrapposizioni anche quando un intervallo è interamente contenuto in un altro.
- `LEGACY-019`: segnala duplicati con dati turno uguali all'interno della stessa fonte, mantenendo i riferimenti a fonte/indice e senza fusione automatica.
- `LEGACY-020`: segnala possibili duplicati tra fonti quando mancano gli ID legacy, senza considerarli copie certe.
- `LEGACY-021`: mantiene entrambe le varianti quando lo stesso ID legacy ha dati discordanti tra fonti.
- `LEGACY-022`: riconosce come copie identiche i record con stesso ID e stessi dati tra fonti.
- `LEGACY-023`: rileva campi extra presenti in una sola fonte, conservando anche il riferimento alla fonte priva del campo.
- `LEGACY-024`: rileva parametri profilo assenti in una delle fonti.
- `LEGACY-025`: conserva provenienza, indice e motivo dei turni messi in quarantena.
- `LEGACY-026`: rileva una sezione extra completamente assente in una fonte.
- `LEGACY-027`: verifica il rapporto read-only di migrazione, la quarantena di modelli/formazione e il blocco dell'importazione automatica.

## Strumento locale di rapporto legacy

- `tools/legacy-report.html` permette anteprima singola o riconciliazione di più export JSON direttamente nel browser.
- Il test Playwright verifica file sintetici, quarantena turni/modelli/formazione, assenza di richieste esterne e minimizzazione del rapporto scaricato.
- Lo strumento non usa LocalStorage/IndexedDB, non invia file in rete e non importa né modifica dati.
