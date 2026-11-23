# Anteprima isolata della cronologia DSM

## Scopo

La pagina `tests/browser/history-preview.html` è una dimostrazione autonoma dell'interfaccia di consultazione della cronologia. Usa esclusivamente sei eventi sintetici definiti nel modulo JavaScript della demo.

Non è una schermata operativa e non è collegata al database DSM o all'applicazione esistente. Non apre IndexedDB, LocalStorage o Firebase e non invia richieste di rete.

## Funzioni dimostrative

- Ricerca testuale senza distinzione tra maiuscole e minuscole.
- Filtri per data iniziale/finale, elemento e azione.
- Ordinamento dal più recente al più vecchio o viceversa.
- Paginazione con 3, 5 o 10 eventi per pagina.
- Comando per azzerare ricerca e filtri e ripristinare i valori iniziali.
- Esportazione CSV dell'intero risultato filtrato e ordinato, non soltanto della pagina visibile.
- Pulsante CSV disabilitato quando non ci sono risultati esportabili o l'intervallo di date non è valido.

## Formato e protezioni CSV

Il file dimostrativo si chiama `cronologia-demo.csv` ed è generato localmente nel browser. Contiene le colonne Data e ora, Elemento, Azione, Descrizione e Revisione.

I campi sono racchiusi tra virgolette e le virgolette interne vengono raddoppiate. I valori che iniziano con `=`, `+`, `-`, `@`, tab o ritorno carrello ricevono un apostrofo iniziale per ridurre il rischio di interpretazione come formula nei fogli di calcolo. Il file include il BOM UTF-8 per favorire la corretta lettura dei caratteri italiani.

L'esportazione usa il serializzatore condiviso `src/ui/history-csv-export.js`. I valori che possono essere interpretati come formule sono prefissati da un apostrofo prima dell'escaping CSV; i campi restano correttamente racchiusi tra virgolette anche in presenza di virgolette o virgole interne. Il runner include casi sintetici per i prefissi `=`, `+`, `-`, `@`, tab e ritorno carrello e per le virgolette interne.

L'esportazione non carica il CSV su alcun servizio remoto. Il contenuto è limitato agli eventi sintetici mostrati dalla demo.

## Sicurezza della pagina

La pagina applica una Content Security Policy restrittiva: script e fogli di stile solo dalla stessa origine, nessuna connessione di rete, nessuna immagine remota, nessuna base URI e nessuna destinazione per form. La UI della cronologia usa il renderer dedicato, che inserisce le descrizioni come testo e non come HTML.

## Verifiche automatiche

Il runner Playwright verifica caricamento e contenuto sintetico, filtri combinati, ricerca, ordinamento, paginazione, reset, esportazione CSV, intestazioni e righe esportate, assenza di identificativi interni nell'export e stato disabilitato del pulsante senza risultati. Verifica inoltre l'assenza di errori JavaScript e richieste esterne.

## Limiti

Questa pagina non dimostra l'integrazione con dati reali, non legge la cronologia persistita, non implementa importazione o sincronizzazione e non modifica l'applicazione operativa. L'esportazione CSV è una funzione della sola anteprima e non va considerata un report operativo o un audit immutabile.
