# Lettura documenti locale e apprendimento controllato

## Architettura

- PaddleOCR italiano (PP-OCRv6) è il primo riconoscitore per le immagini dei cedolini.
- Tesseract italiano/inglese resta il fallback locale e il percorso OCR per turni e immagini.
- L'estrazione PDF testuale e i parser deterministici restano prioritari quando il testo è già disponibile.
- Qwen 2.5 0.5B Instruct è un assistente opzionale: può proporre etichette generiche mancanti, ma non scrive importi, date o dati personali e non modifica il risultato OCR.
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

## Test

La fixture `tests/browser/local-learning.html` verifica con dati sintetici:
- rifiuto di alias contenenti numeri e indicatori di dati identificativi;
- persistenza delle sole regole generiche in IndexedDB;
- applicazione dell'alias senza cambiare l'importo OCR;
- normalizzazione deterministica di data, orario, importo e testo;
- disattivazione e cancellazione delle regole;
- integrazione sintetica con i parser cedolino e turni e presenza della UI di apprendimento.
