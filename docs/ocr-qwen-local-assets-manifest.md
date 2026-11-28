# Inventario obbligatorio degli asset OCR/AI locali

Stato: **specifica di confezionamento, non prova di installazione** (2026-11-28).

## Vincolo non negoziabile

Durante l'apertura e la lettura di un documento non sono consentiti CDN, fetch verso Hugging Face, risoluzione di modelli remoti, telemetry o fallback verso servizi terzi. PDF, immagini, testo OCR, bbox, prompt, output Qwen e risultati intermedi restano sul dispositivo.

L'assenza di un componente deve produrre un errore chiaro e interrompere quella funzione. Non aggiungere fallback Internet per "farla funzionare".

## Stato del repository

Al commit di questa specifica, nell'albero del ramo non risultano directory `vendor/` o `models/` con gli artefatti necessari. I loader sono quindi intenzionalmente fail-closed: la rimozione dei CDN non equivale a un'installazione offline funzionante.

## Inventario richiesto

| Componente | Percorso locale atteso | Interfaccia richiesta | Stato |
|---|---|---|---|
| PDF.js browser | `vendor/pdfjs/pdf.min.js` | espone `window.pdfjsLib` | non incluso |
| PDF.js worker | `vendor/pdfjs/pdf.worker.min.js` | worker locale same-origin | non incluso |
| Tesseract.js 5.1.1 | `vendor/tesseract/` | espone `window.Tesseract.createWorker` | non incluso |
| Tesseract worker/core | `vendor/tesseract/worker.min.js`, core WASM nella stessa directory | `workerPath` e `corePath` locali | non inclusi |
| Lingue Tesseract | `vendor/tesseract/lang/ita.traineddata.gz`, `eng.traineddata.gz` (o formato esatto supportato dalla build scelta) | `langPath` locale | non incluse |
| Wrapper PaddleOCR | bundle locale applicativo | espone `window.LocalPaddleOCR.createOffline` | non incluso |
| PaddleOCR PP-OCRv6 italiano | `models/paddleocr/pp-ocrv6/` | modello/dizionari/config richiesti dalla versione fissata | non inclusi |
| ONNX Runtime Web | `vendor/onnxruntime/` | WASM locale, nessun download automatico | non incluso |
| Transformers.js | bundle locale applicativo | loader iniettato come `pipelineLoader`, restituisce `pipeline` ed `env` | non incluso |
| Qwen2.5-0.5B-Instruct | `models/qwen2.5-0.5b-instruct/` | pesi quantizzati compatibili, config e tokenizer locali | non incluso |

I nomi dei file specifici di ONNX, Tesseract e dei pesi Qwen/Paddle dipendono dalla build e dalla quantizzazione selezionate: prima di fissarli occorre scegliere una release compatibile, registrarne licenza e SHA-256 e adattare i loader a quegli artefatti reali. Non creare file segnaposto che facciano apparire disponibile un motore non installato.

## Contratti di caricamento

### Tesseract

- Deve essere già presente `window.Tesseract.createWorker`.
- Worker, core WASM e dati `ita`/`eng` devono risolversi esclusivamente nei percorsi locali.
- In caso di file mancanti o errore di inizializzazione, interrompere l'OCR senza riprovare su CDN.

### PaddleOCR

- Il wrapper locale deve esporre `window.LocalPaddleOCR.createOffline({ lang: "it", ocrVersion: "PP-OCRv6", modelPath, ortWasmPath, backend: "wasm" })`.
- Deve verificare che modello, dizionario, runtime e WASM siano disponibili localmente prima di inizializzare.
- Non deve usare resolver remoti o telemetria; errori e progressi non devono contenere testo del documento.

### Qwen

- `createLocalQwen` deve ricevere un `pipelineLoader` che importa il bundle locale e restituisce `pipeline`/ `env`.
- `allowRemoteModels=false` deve essere applicato prima della creazione della pipeline; modello e tokenizer devono essere risolti da `./models/qwen2.5-0.5b-instruct/`.
- WebGPU può essere tentato per primo; il fallback CPU/WASM deve restare locale.
- Il ruolo attuale di Qwen è limitato a suggerire alias di etichette generiche sanificate. Non corregge ancora segmenti OCR incerti e non deve essere presentato come un correttore OCR già integrato.
- Una futura assistenza agli errori OCR dovrà ricevere solo ritagli/testo strettamente necessari e sanificati, mantenere il testo originale e le bbox, restituire alternative con confidenza e motivazione, e lasciare la decisione a controlli deterministici e revisione umana. Vietato applicare direttamente correzioni a importi, date, orari o colonne.

## Gate prima di dichiarare "offline pronto"

1. Registrare per ogni artefatto versione upstream, licenza, origine, dimensione e SHA-256; nessun artefatto senza provenienza verificabile.
2. Includere SDK, worker, WASM, tokenizer, dizionari e pesi nel pacchetto pubblicato e nella cache PWA. Non scaricarli al primo avvio.
3. Verificare che ogni percorso richiesto esista e che l'hash corrisponda prima di abilitare la funzione.
4. Eseguire i test in browser con rete disabilitata e intercettazione di `fetch`, XHR, WebSocket e richieste worker; nessuna richiesta verso origini esterne deve essere generata dalla lettura.
5. Verificare separatamente PDF.js, Tesseract, PaddleOCR, Qwen WebGPU e Qwen CPU/WASM con sole fixture sintetiche.
6. Verificare memoria, tempi, cancellazione dei buffer temporanei e comportamento quando un asset è mancante/corrotto.
7. Non abilitare la lettura automatica agli utenti finché tutti i gate pertinenti non sono passati.

## Limiti funzionali per i PDF turni

Il percorso di importazione deve usare esclusivamente la data contestuale, la colonna degli orari e la colonna esplicitamente identificata come Postazione. Il tipo standard è `turno`; la durata si calcola dagli orari. Totali, flag, note, mansioni e testo residuo non devono alimentare i campi del calendario. Informazioni aggiuntive, se supportate, devono restare metadati separati e non modificare data/orari/postazione. Le righe con colonne ambigue vanno messe in revisione, non indovinate.

## Limiti per i cedolini

Non confondere lordo, netto, contributi, trattenute, aliquote e importi di pagamento. Nessun campo retributivo ambiguo deve essere dedotto da valori predefiniti o da una correzione probabilistica del modello. Il perimetro di accesso ai dati paga resta quello già approvato; questa specifica non autorizza nuovi campi o nuove letture lato account.
