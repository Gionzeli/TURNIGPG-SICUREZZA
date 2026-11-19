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


## Scelta preliminare del runtime (documentazione consultata il 19 novembre 2026)
Per la compatibilità più ampia, il candidato iniziale è **ONNX Runtime Web**, eventualmente usato tramite **Transformers.js** per i modelli NLP: la documentazione ONNX indica il backend WASM/CPU anche su Chrome/Edge Android, Safari iOS e desktop; WebGPU è un'accelerazione facoltativa e non va considerata requisito. Transformers.js usa ONNX Runtime e documenta modelli quantizzati, ma dimensioni e qualità dipendono dal modello scelto. Riferimenti: https://onnxruntime.ai/docs/get-started/with-javascript/web.html e https://huggingface.co/docs/transformers.js/index.

**LiteRT.js** resta un candidato da confrontare per dispositivi compatibili e modelli .tflite; la guida web richiede un browser moderno con WebGPU per il percorso raccomandato, mentre WebNN è ancora sperimentale. Non lo scegliamo come unica base universale. Riferimenti: https://developers.google.com/edge/litert/web/get_started e https://developers.google.com/edge/litert/overview.

## Adattatore isolato
`local-ai-adapter.js` definisce il contratto per una futura integrazione: caricamento solo quando viene chiamato `analyze()`, limite di testo, timeout, supporto all'annullamento, verifica dell'output strutturato e rilascio del modello dalla memoria. Non contiene un runtime né un modello e non viene caricato da `index.html`; quindi non interpreta ancora documenti e non genera traffico di rete. Il test `local-ai-adapter.test.cjs` verifica il caricamento su richiesta, la forma del risultato e il rilascio.

## Gate prima di usare dati reali
L'adattatore non è ancora collegato a PDF, OCR, cedolini, turni o parametri. Prima servono un modello concreto con licenza verificata, benchmark di memoria/tempo su device reali, test con documenti sintetici di aziende/formati differenti e controllo che nessun testo/documento venga trasmesso in rete. L'estrazione PDF e OCR locale restano necessarie per convertire scansioni in testo; l'AI dovrà interpretare quel testo localmente, non sostituire il meccanismo di acquisizione.


## Modello candidato da valutare (non ancora integrato)
La prima prova concreta sarà con **Qwen3-0.6B-Instruct in formato ONNX** tramite Transformers.js. La scheda della variante ONNX dichiara licenza Apache 2.0 e uso con Transformers.js; il pacchetto quantizzato Q4F16 pubblicato è circa 648 MB. La famiglia Qwen3 dichiara copertura di oltre 100 lingue, inclusa l'italiana. Riferimenti: https://huggingface.co/onnx-community/Qwen3-0.6B-Instruct-ONNX e https://huggingface.co/Qwen/Qwen3-0.6B.

**Limite importante:** 648 MB sono troppi per scaricare automaticamente o imporre il modello su ogni telefono. Quindi il modello resta soltanto candidato per una prova facoltativa, con download esplicito e indicazione della dimensione; non sarà caricato all'avvio e non sarà requisito per aprire l'app. Prima di adottarlo vanno misurati memoria, tempi e accuratezza su esempi sintetici in italiano. Se non supera le prove, non verrà integrato. Nessuna inferenza cloud e nessun costo API.

## Verifiche automatiche aggiunte
Il workflow GitHub Actions `.github/workflows/local-ai-prototype-tests.yml` esegue il test Node dell'adattatore quando cambiano adattatore o test sul branch prototipo. I test coprono caricamento su richiesta, rilascio, timeout, annullamento e fallimento del caricatore. La presenza del workflow non equivale a un test completato: il risultato va controllato nei run GitHub Actions.
