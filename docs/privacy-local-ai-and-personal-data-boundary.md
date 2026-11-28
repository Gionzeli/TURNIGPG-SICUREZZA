# Privacy: AI locale e confine dei dati personali

## Impegno tecnico per OCR e Qwen

- PDF, fotografie, pagine rasterizzate, testo OCR, coordinate, frammenti inviati a Qwen e risultati intermedi devono essere elaborati esclusivamente nel browser/dispositivo.
- Il codice OCR/AI non deve caricare SDK, worker, dizionari, runtime o pesi da CDN, Hugging Face o altri host.
- I modelli devono essere inclusi nel pacchetto di distribuzione e installati nella cache PWA durante l'installazione/aggiornamento dell'app. L'avvio ordinario non deve scaricare modelli.
- Il service worker verifica per ogni asset origine same-origin, percorso sotto `vendor/` o `models/`, dimensione e SHA-256 prima di metterlo in cache. Se il pacchetto AI è incompleto, l'installazione della nuova versione fallisce; non viene usato un fallback remoto.
- Il manifest `local-ai-assets.json` è attualmente `enabled: false` e senza asset. Questa protezione è predisposta, ma non significa che i motori offline siano già distribuiti.
- Non inviare dati personali, PDF, testo o immagini a Qwen, PaddleOCR, servizi AI, analytics o telemetria.

## Limite importante: Firebase e servizi connessi

L'applicazione contiene già funzioni Firebase per autenticazione, membership e sincronizzazione/lettura di dati. Quando queste funzioni sono abilitate, i dati necessari a tali operazioni vengono trattati dall'infrastruttura Firebase/Google e non rimangono esclusivamente sul dispositivo. I collegamenti mailbox e le eventuali funzioni di condivisione sono ulteriori confini esterni.

Questa modifica **non** disattiva Firebase e non può quindi garantire che tutti i dati personali dei collaboratori restino sempre e soltanto sul loro dispositivo. Garantisce il perimetro locale previsto per l'elaborazione OCR/AI, una volta inclusi e verificati gli asset. Non equivale a una certificazione legale o a una garanzia assoluta di non divulgazione da parte di tutti i servizi configurati.

Per un requisito assoluto di sola conservazione locale occorre una modalità local-only separata: Firebase, mailbox, condivisione, sincronizzazione e funzioni remote devono essere disattivati per quei profili. Questo comporta la rinuncia a membership e sincronizzazione multi-dispositivo finché non viene adottata un'infrastruttura controllata e approvata. Non attivare tale modalità implicitamente senza migrazione e verifica delle conseguenze sui flussi collaborativi.

## Regola di rilascio

Non dichiarare il sistema "privacy offline pronto" finché:
1. gli asset PaddleOCR, Tesseract, PDF.js, ONNX Runtime, Transformers.js e Qwen non sono inclusi con licenza, versione, origine, dimensione e hash verificati;
2. `node tools/verify-local-ai-assets.mjs --require-ready` termina con esito positivo;
3. il service worker installa tutti gli asset e la PWA si avvia in modalità aereo dopo l'installazione;
4. test browser verificano zero richieste esterne durante apertura, OCR, correzione Qwen e salvataggio locale;
5. è documentato separatamente quali dati continuano a essere trattati da Firebase o altri servizi connessi.
