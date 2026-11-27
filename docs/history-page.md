# Pagina cronologia DSM

## Componente

`src/ui/history-page.js` esporta `mountHistoryPage(container, { historyService, pageSize })`.
Il chiamante fornisce un'istanza di `HistoryService` già associata al contesto account autorizzato. Il componente non crea account, non sceglie identità, non apre database e non legge LocalStorage o Firebase.

La pagina:
- carica al massimo 200 eventi tramite `HistoryService.getRecentEvents`;
- mostra esclusivamente DTO sanificati (categoria, azione, descrizione generica, data e revisione);
- supporta ricerca testuale, intervallo date (rifiuta quelli invertiti), filtri categoria/azione, ordinamento, dimensione pagina, paginazione e reset;
- consente l'esportazione CSV dei risultati filtrati, non solo della pagina visibile;
- applica escaping CSV e protezione contro formula injection e include BOM UTF-8;
- espone `destroy()` per rimuovere listener e contenuto.

## Sicurezza e limiti

Il componente non esegue import, migrazioni, sincronizzazioni, chiamate di rete o modifiche ai record. L'esportazione è locale e non contiene ID interni, accountId o payload originali.

L'isolamento dei repository si basa sul contesto account client-side; non equivale ad autenticazione forte. IndexedDB DSM non è cifrato. Prima di collegare la pagina a un'applicazione reale occorre che il livello applicativo verifichi l'identità e costruisca il repository con il contesto corretto. Non passare un accountId scelto da un input UI e non considerare il solo contesto client-side una barriera di sicurezza.

## Verifica

`tests/browser/history-page-test.html` usa esclusivamente eventi sintetici in memoria. Playwright controlla rendering, ricerca, filtri categoria/azione/data, intervalli invertiti, ordinamento, dimensione pagina, navigazione, reset, esportazione CSV, BOM UTF-8 effettivo, assenza di richieste esterne e ciclo di vita del componente: `destroy()` svuota il contenitore, rimuove i listener e tollera chiamate ripetute. La fixture non apre `DSM_ENTERPRISE_DB` e non usa dati operativi.
