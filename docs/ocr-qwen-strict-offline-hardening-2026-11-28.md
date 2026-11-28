# OCR e Qwen in modalità offline rigorosa — 2026-11-28

## Obiettivo e vincolo
PDF di turni e cedolini, immagini rasterizzate, testo OCR, output del modello e risultati intermedi devono restare sul terminale. Nessun servizio AI remoto, API, CDN o download automatico durante la lettura.

## Modifiche applicate
- `local-qwen.js`: rimosso l'import dinamico di Transformers.js da jsDelivr. Qwen accetta soltanto un `pipelineLoader` fornito dall'app e configura `allowRemoteModels=false`, `allowLocalModels=true`, con percorso locale. Senza runtime locale l'inizializzazione fallisce in modo esplicito.
- `local-reader.js`: Tesseract non inietta più SDK da CDN e usa esclusivamente percorsi locali `./vendor/tesseract/`; PaddleOCR non esegue più import dinamici da CDN e accetta soltanto `window.LocalPaddleOCR.createOffline`, wrapper locale che deve puntare esplicitamente ai pesi PP-OCRv6 e al runtime ONNX/WASM locali. Il percorso Tesseract per turni conserva le coordinate X delle parole OCR.
- `index.html`: PDF.js, SheetJS (Excel), Mammoth (DOCX) e QR generator non vengono più scaricati da CDN; richiedono librerie già installate in `./vendor/`. La Content Security Policy non autorizza più `cdnjs` o `jsdelivr` come sorgenti script.
- Qwen riceve ora soltanto n-grammi che superano la lista locale di parole/etichette generiche approvate; numeri, importi, date, codici fiscali, IBAN, email e testo libero non vengono passati al modello. Il suo ruolo resta limitato a proporre alias generici, mai a leggere o correggere importi.
- Per i fogli turni Qwen è escluso dal percorso: il parser resta deterministico e non riceve suggerimenti semantici del modello. Test browser Qwen: verifica riduzione del contesto e blocco senza runtime locale. Test browser turni: fixture sintetiche verificano che il testo residuo non diventi postazione o flag e che sia accettata soltanto l'etichetta esplicita `POSTAZIONE:`.
- Ulteriore hardening del mapper geometrico: tutte le intestazioni rilevate, comprese quelle non ammesse come `Totale`, `Note` e `Notturno`, restano ancore di colonna. I valori appartenenti a colonne escluse vengono scartati e non possono confluire nella Postazione per vicinanza. La fixture browser turni ora include queste colonne e ne verifica l'esclusione.
- Aggiunta `tests/browser/offline-ai-boundary-smoke.html`: con Tesseract, PaddleOCR e runtime Qwen volutamente assenti, verifica che i tre percorsi falliscano in modo esplicito e che `fetch`/XHR e risorse esterne non vengano richiesti. La fixture è eseguita dalla suite browser CI.
- Test PaddleOCR: avvisa che usa soltanto dipendenze già installate localmente.
- Parser turni: non usa più alias appresi per reinterpretare righe del calendario; non deduce postazione da testo residuo e non ricava flag piantonamento/notturno dal PDF. La postazione viene valorizzata soltanto se il testo contiene un'etichetta esplicita `POSTAZIONE:`. Data e coppie di orari restano i soli altri dati letti.


- Il bootstrap AI verifica tramite `MessageChannel` che la pagina sia controllata dalla versione attesa del service worker prima di caricare i runtime locali; la versione cache PWA e l'URL di registrazione in `index.html` sono allineati (`tg-v3.180`). La suite Playwright verifica l'handshake con un service worker realmente installato.

## Stato reale: fail-closed, non ancora pacchetto offline completo
Nel repository non risultano ancora distribuiti i file vendor necessari: SDK PDF.js, worker PDF.js, SDK SheetJS, SDK Mammoth, QR generator, SDK PaddleOCR, runtime ONNX/WASM e relativi pesi PP-OCRv6, SDK/worker/core/language data Tesseract, runtime Transformers.js e modello Qwen quantizzato. Non è corretto dichiarare che l'OCR o Qwen siano già utilizzabili senza rete finché tali file non sono inclusi e verificati.

In loro assenza, le funzioni PDF/OCR/AI si fermano in sicurezza invece di tentare un accesso Internet. L'applicazione nel suo complesso mantiene Firebase per le funzioni account/membership e collegamenti esterni espliciti di condivisione/aggiornamento; questa modifica non rende offline l'intera app o Firebase. Il salvataggio dei parametri e dei turni importati dal lettore passa dalla funzione locale `save()` (LocalStorage); nessun file PDF o immagine viene caricato da `aiImport`.

## Lavoro residuo prima di riattivare la lettura assistita
1. Acquisire e fissare versioni e licenze delle dipendenze; includere SDK, worker, WASM, tokenizer e pesi nel pacchetto distribuito.
2. Verificare hash/SHA-256 degli artefatti e usare percorsi relativi locali; non consentire fallback remoti.
3. Collegare un loader locale esplicito per PaddleOCR PP-OCRv6 e Qwen2.5-0.5B quantizzato; usare WebGPU quando disponibile e WASM/CPU come fallback locale.
4. Far usare Qwen soltanto per proporre alternative su segmenti OCR incerti, mantenendo bbox/coordinate e testo sorgente. Nessuna correzione automatica di importi, date, orari o colonne.
5. Integrare un mapper a colonne per turni: leggere esclusivamente data contestuale, colonna orari e colonna Postazione esplicita. Le righe prive di mappatura certa restano in revisione.
6. Verificare con fixture sintetiche e DevTools/network monitor che l'import PDF non generi richieste di rete. Testare browser reali, memoria, GPU e fallback CPU.

## Verifiche
Le modifiche sono state salvate sul ramo autorizzato `codex/employee-shift-date-range-query`. In questa sessione non sono stati eseguiti test browser, Node, Emulator o prove di rete offline. Non è stato aperto alcun PDF personale e non è stata usata Firebase reale.
