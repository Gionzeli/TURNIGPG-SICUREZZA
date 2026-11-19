# Prototipo AI locale — fase di fattibilità

**Stato:** isolato sul branch `ai-locale-prototype`. Non è incluso nell'app pubblicata.

## Obiettivo della prima fase
Rilevare, senza caricare modelli e senza leggere documenti, quali capacità il browser espone:
- WebAssembly come base di compatibilità;
- WebGPU e WebNN come possibili acceleratori;
- Prompt API integrata nel browser, se presente;
- memoria e core dichiarati dal browser, quando disponibili.

Il file `local-ai-capabilities.js` espone `window.LocalAIEnvironment.probe()`. La funzione è sincrona e non esegue richieste di rete.

## Limiti importanti
- Una API rilevata non prova che un modello sia installato, scaricabile o compatibile.
- La PWA non può chiamare liberamente le AI native di Android, iOS o Windows.
- WebGPU non è disponibile su tutti i dispositivi; WASM è il percorso di compatibilità, ma non rende possibile eseguire modelli grandi su hardware insufficiente.
- Questa fase non interpreta ancora PDF o immagini e non cambia l'importazione esistente.

## Vincoli prima di ogni integrazione
1. Modello opzionale e caricato solo su richiesta esplicita, mai all'avvio.
2. Documenti e testo estratto restano sul dispositivo; nessun endpoint di inferenza cloud.
3. Download del modello separato e dichiarato: il file del modello può arrivare da una CDN, ma il documento dell'utente non deve essere inviato.
4. Esecuzione fuori dal thread principale, con limiti di memoria/tempo e possibilità di annullare.
5. Se il dispositivo non è adatto o il modello non è disponibile, l'app non deve bloccarsi e non deve perdere dati.
6. Risultati mostrati in anteprima e salvati solo dopo conferma.
7. Profili e correzioni personalizzate conservati localmente, senza sincronizzare documenti o contenuti personali a Firebase.

## Prossimo gate tecnico
Provare runtime e modello quantizzato su Android di fascia bassa/media, iPhone/iPad e desktop Windows/macOS. Misurare dimensione download, memoria, tempi, annullamento e comportamento offline. Solo dopo questi test valutare un adattatore AI reale e una migrazione graduale dei parser, mantenendo l'estrazione PDF/OCR locale come ingresso dei documenti.
