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

## Test

La fixture `tests/browser/local-learning.html` verifica con dati sintetici:
- rifiuto di alias contenenti numeri e indicatori di dati identificativi;
- persistenza delle sole regole generiche in IndexedDB;
- applicazione dell'alias senza cambiare l'importo OCR;
- normalizzazione deterministica di data, orario, importo e testo;
- disattivazione e cancellazione delle regole;
- integrazione sintetica con i parser cedolino e turni e presenza della UI di apprendimento;
- verifica che Transformers.js riceva la revisione Hugging Face fissata.
