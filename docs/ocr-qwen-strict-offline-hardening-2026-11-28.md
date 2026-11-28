# OCR e Qwen in modalità offline rigorosa — 2026-11-28

## Obiettivo e vincolo
PDF di turni e cedolini, immagini rasterizzate, testo OCR, output del modello e risultati intermedi devono restare sul terminale. Nessun servizio AI remoto, API, CDN o download automatico durante la lettura.

## Modifiche applicate
- `local-qwen.js`: rimosso l'import dinamico di Transformers.js da jsDelivr. Qwen accetta soltanto un `pipelineLoader` fornito dall'app e configura `allowRemoteModels=false`, `allowLocalModels=true`, con percorso locale. Senza runtime locale l'inizializzazione fallisce in modo esplicito.
- `local-reader.js`: Tesseract non inietta più SDK da CDN e usa esclusivamente percorsi locali `./vendor/tesseract/`; PaddleOCR non esegue più import dinamici da CDN e accetta soltanto `window.PaddleOCR` fornito dal pacchetto locale.
- `index.html`: PDF.js non viene più scaricato da CDN; richiede una libreria già installata e punta il worker a `./vendor/pdfjs/pdf.worker.min.js`.
- Test browser Qwen: verifica il blocco quando manca il runtime locale, senza scaricare il modello.
- Test PaddleOCR: avvisa che usa soltanto dipendenze già installate localmente.
- Parser turni: non usa più alias appresi per reinterpretare righe del calendario; non deduce postazione da testo residuo e non ricava flag piantonamento/notturno dal PDF. La postazione viene valorizzata soltanto se il testo contiene un'etichetta esplicita `POSTAZIONE:`. Data e coppie di orari restano i soli altri dati letti.

## Stato reale: fail-closed, non ancora pacchetto offline completo
Nel repository non risultano ancora distribuiti i file vendor necessari: SDK PDF.js, worker PDF.js, SDK PaddleOCR, runtime ONNX/WASM e relativi pesi PP-OCRv6, SDK/worker/core/language data Tesseract, runtime Transformers.js e modello Qwen quantizzato. Non è corretto dichiarare che l'OCR o Qwen siano già utilizzabili senza rete finché tali file non sono inclusi e verificati.

In loro assenza, le funzioni PDF/OCR/AI si fermano in sicurezza invece di tentare un accesso Internet. L'applicazione nel suo complesso mantiene altri servizi e collegamenti Internet non relativi al percorso OCR; questa modifica non equivale a mettere offline l'intera app o Firebase.

## Lavoro residuo prima di riattivare la lettura assistita
1. Acquisire e fissare versioni e licenze delle dipendenze; includere SDK, worker, WASM, tokenizer e pesi nel pacchetto distribuito.
2. Verificare hash/SHA-256 degli artefatti e usare percorsi relativi locali; non consentire fallback remoti.
3. Collegare un loader locale esplicito per PaddleOCR PP-OCRv6 e Qwen2.5-0.5B quantizzato; usare WebGPU quando disponibile e WASM/CPU come fallback locale.
4. Far usare Qwen soltanto per proporre alternative su segmenti OCR incerti, mantenendo bbox/coordinate e testo sorgente. Nessuna correzione automatica di importi, date, orari o colonne.
5. Integrare un mapper a colonne per turni: leggere esclusivamente data contestuale, colonna orari e colonna Postazione esplicita. Le righe prive di mappatura certa restano in revisione.
6. Verificare con fixture sintetiche e DevTools/network monitor che l'import PDF non generi richieste di rete. Testare browser reali, memoria, GPU e fallback CPU.

## Verifiche
Le modifiche sono state salvate sul ramo autorizzato `codex/employee-shift-date-range-query`. In questa sessione non sono stati eseguiti test browser, Node, Emulator o prove di rete offline. Non è stato aperto alcun PDF personale e non è stata usata Firebase reale.
