# Lettura documenti locale e apprendimento controllato

## Architettura

- PaddleOCR italiano (PP-OCRv6) è il primo riconoscitore per le immagini dei cedolini.
- Tesseract italiano/inglese resta il fallback locale e il percorso OCR per turni e immagini.
- L'estrazione PDF testuale e i parser deterministici restano prioritari quando il testo è già disponibile.
- Qwen 2.5 0.5B Instruct è un assistente opzionale: può proporre etichette generiche mancanti, ma non scrive importi, date o dati personali e non modifica il risultato OCR.
- Il repository del modello è fissato alla revisione Hugging Face `cc5cc01a65cc3ff17bdb73a7de33d879f62599b0`, non al ramo mobile `main`, per rendere ripetibile il contenuto scaricato. La variante Q4 richiesta dal runtime ha un file di pesi di circa 786 MB: il primo avvio richiede quindi un download consistente e spazio cache sul dispositivo.
- Ogni alias proposto da Qwen deve essere presente nel testo OCR, essere associato a un campo consentito e venire approvato esplicitamente dall'utente prima di essere salvato.
- Le regole approvate vengono applicate ai successivi documenti per normalizzare etichette. I parser esistenti continuano a validare importi, date, orari e struttura; la conferma dell'utente resta obbligatoria.
- La scrittura dei dati riconosciuti resta deterministica: date ISO, orari HH:mm, importi in formato italiano e testo ripulito. Qwen non genera né completa valori mancanti.

## Dati persistenti e privacy

L'archivio `turni-gpg-ocr-learning` in IndexedDB contiene esclusivamente:
- categoria del documento;
- chiave di un campo predefinito;
- etichetta generica approvata dall'utente;
- data e versione della regola.

Non contiene PDF, immagini, testo OCR, nomi, codici, importi, date del documento, risultati di estrazione, prompt o risposte Qwen. Le regole non vengono inviate a Firebase, Gemini, API AI o altri servizi. L'apprendimento è locale al profilo browser e può essere disattivato o cancellato dalla schermata dedicata.

Qwen viene scaricato da Hugging Face tramite Transformers.js e viene eseguito nel browser usando WebGPU o WASM. Il download remoto riguarda il codice della libreria e i pesi del modello; non è un servizio di inferenza remoto e il testo del documento non viene trasmesso al repository del modello. Il modello non è necessario per usare OCR e parser. I pesi del modello possono restare nella cache gestita dal browser; non sono documenti personali.

## Limiti di sicurezza

Questa architettura evita l'upload applicativo dei documenti e l'inferenza remota, ma non rende invulnerabile un dispositivo compromesso o un browser con estensioni malevole. Chi controlla il dispositivo o una sessione browser già sbloccata può potenzialmente leggere ciò che è visualizzato o presente in memoria. Usare un profilo browser personale, blocco dispositivo e cifratura del disco. I dati applicativi già presenti in localStorage non vengono cifrati da questa funzionalità.

**Limite della catena di fornitura:** il lettore carica librerie OCR e il motore Transformers.js da CDN; il codice JavaScript scaricato viene eseguito nel contesto della pagina e, come ogni codice con quei privilegi, potrebbe tecnicamente accedere al testo OCR in memoria o alla pagina. Il flusso applicativo non invia intenzionalmente i documenti a un servizio remoto, ma questa scelta non equivale a una garanzia crittografica che il codice di terze parti non possa farlo. Per documenti ad alta riservatezza, non abilitare Qwen e usare una distribuzione con dipendenze verificate e servite da infrastruttura controllata, insieme a una Content Security Policy restrittiva. Anche il caricamento iniziale delle librerie OCR esterne va incluso nella valutazione.

## Prova manuale dell'inferenza reale

La pagina `tests/browser/qwen-smoke.html` esegue un controllo separato dalla CI ordinaria e usa esclusivamente una fixture sintetica. Per provarla, avviare un server statico dalla radice del repository (ad esempio `python3 -m http.server 8000`) e aprire `http://localhost:8000/tests/browser/qwen-smoke.html` in un browser aggiornato. Premere **Avvia prova reale** e attendere il download iniziale del modello Q4 (circa 786 MB).

La pagina mostra:
- se il modello si carica e quale backend viene scelto (WebGPU o WASM);
- se l'inferenza termina senza errore;
- il tempo totale e, quando disponibile, l'heap JavaScript esposto dal browser;
- soltanto suggerimenti che superano il filtro locale per campo e contenuto.

Un risultato vuoto può essere valido: il modello non è obbligato a proporre alias. Un errore di memoria, WebGPU o rete va registrato come prova fallita su quel dispositivo; non va aggirato usando documenti reali o disabilitando i filtri. La pagina non fa parte dell'app operativa e non viene eseguita automaticamente dalla CI perché il download del modello è molto grande e dipende dall'hardware.

## Test automatici

La fixture `tests/browser/local-learning.html` verifica con dati sintetici:
- rifiuto di alias contenenti numeri e indicatori di dati identificativi;
- persistenza delle sole regole generiche in IndexedDB;
- applicazione dell'alias senza cambiare l'importo OCR;
- normalizzazione deterministica di data, orario, importo e testo;
- disattivazione e cancellazione delle regole;
- integrazione sintetica con i parser cedolino e turni e presenza della UI di apprendimento;
- verifica che Transformers.js riceva la revisione Hugging Face fissata.


## Prova manuale OCR Paddle sui cedolini

La pagina `tests/browser/ocr-smoke.html` genera una fixture grafica sintetica nel canvas e la passa al percorso reale `LocalDocAI.ocrPayslipImages` (PaddleOCR PP-OCRv6), quindi a `parsePayslip`. Non richiede upload o selezione di file e confronta dieci campi con valori noti. Avviare il server statico dalla radice del repository e aprire `http://localhost:8000/tests/browser/ocr-smoke.html`.

Il risultato è specifico del browser, della rete e dell'hardware usati. La pagina mostra il testo OCR, i valori estratti, il confronto campo per campo e il tempo totale. Un esito parziale va trattato come errore di accuratezza, non corretto automaticamente con Qwen. La pagina carica SDK e modello PaddleOCR da CDN: usare esclusivamente la fixture sintetica e considerare il rischio di supply chain descritto sopra. Questa prova manuale non sostituisce un corpus di validazione rappresentativo né costituisce una garanzia di precisione su cedolini reali.
