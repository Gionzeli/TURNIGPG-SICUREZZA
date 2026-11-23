# DSM Core — confini di sicurezza e requisiti prima dell'uso reale

## Stato attuale

Questo documento descrive i limiti verificati del core DSM nel branch `dsm-enterprise/core-v1`. Non introduce autenticazione, cifratura, sincronizzazione o cancellazione globale.

- IndexedDB `DSM_ENTERPRISE_DB` è locale al profilo browser e non è cifrato dal core.
- `createAccountContext()` è un selettore di contesto in memoria, non un sistema di login.
- Il contesto accetta soltanto `identitySource: "local"`; rifiuta `firebase_verified` perché non verifica token o sessioni.
- L'identificativo account locale è fornito dal chiamante. Chi può eseguire codice nella stessa origine può tentare di attivare un altro identificativo.
- Il filtro `accountId` nei repository riduce gli accessi accidentali tra contesti, ma non è una barriera contro codice ostile, XSS o accesso diretto a IndexedDB.
- La chiusura del database e `accountContext.clear()` non cancellano i dati persistenti.
- Gli eventi history conservano metadati e identificativi interni delle entità, non copie complete dei record.
- Non esiste una procedura completa per cancellare un account e tutti i dati correlati.
- Non esistono ancora adapter di autenticazione, gestione chiavi, cifratura a riposo o sessione remota nel core.

## Modello delle minacce

### Rischi considerati

1. **Dispositivo condiviso o profilo browser accessibile ad altri**: i dati IndexedDB possono essere letti da chi usa lo stesso profilo/browser.
2. **Codice malevolo nella stessa origine**: XSS o script compromessi possono leggere/modificare IndexedDB e invocare le API client.
3. **Selezione account manipolata**: l'accountContext non autentica l'utente e non deve essere usato per autorizzare accessi reali.
4. **Perdita o cancellazione del profilo browser**: i dati locali possono essere eliminati dal browser o dal dispositivo; il core non è un sistema di backup.
5. **Audit alterabile**: la cronologia è utile per consultazione applicativa, ma IndexedDB e i record sono modificabili da codice con accesso alla stessa origine.

### Fuori garanzia

Il core attuale non garantisce confidenzialità contro accesso al dispositivo/browser, integrità contro codice same-origin ostile, autenticazione forte, non ripudio o conservazione immutabile.

## Requisiti per una futura autenticazione Firebase

Prima di accettare identità remote occorre un adapter esplicito che:

- riceva l'identità esclusivamente da un flusso Firebase Auth realmente verificato;
- verifichi lo stato della sessione e l'UID usando l'SDK ufficiale, non un valore passato dall'interfaccia;
- gestisca scadenza, revoca, cambio account e logout;
- impedisca che l'interfaccia possa impostare direttamente un flag `firebase_verified`;
- abbia test per sessione assente, scaduta, revocata, cambio account e tentativi di impersonificazione.

Un valore testuale, un timestamp o un campo `identitySource` non sono prova di autenticazione.

## Requisiti per cifratura locale

Prima di cifrare dati reali occorre decidere:

- quali store e campi cifrare, inclusi eventuali indici che potrebbero rivelare metadati;
- come derivare/proteggere le chiavi senza conservarle in chiaro accanto ai dati;
- come gestire sblocco, timeout, cambio account, logout, recupero e perdita della chiave;
- come migrare lo schema esistente senza perdere dati e come ripristinare in modo verificabile;
- come evitare che log, cronologia, export e messaggi di errore espongano contenuti.

Non è sufficiente aggiungere AES-GCM senza un ciclo di vita delle chiavi e un modello di recupero.

## Requisiti per cancellazione e retention

Prima dell'uso reale occorre definire una procedura esplicita e testata che distingua:

- logout: rimuove il contesto e le chiavi dalla memoria, non cancella automaticamente i dati;
- cancellazione di una singola entità: definisce cosa fare degli eventi storici collegati;
- cancellazione account: elimina in modo coordinato record, cronologia, impostazioni, assenze, lavori e quarantena dell'account;
- conservazione: stabilisce tempi e motivi per mantenere o cancellare i metadati;
- conferma: richiede un'azione esplicita e mostra chiaramente l'ambito della cancellazione.

Nessuna cancellazione globale viene implementata da questo documento.

## Condizioni minime prima del collegamento operativo

- autenticazione e autorizzazione verificate indipendentemente dal client;
- modello di cifratura e gestione chiavi approvato;
- difese XSS/CSP e revisione delle dipendenze;
- logout, cambio account e cancellazione con test di isolamento;
- strategia di backup/ripristino e retention;
- revisione privacy e sicurezza prima di usare dati reali.

Fino a quel momento il core va trattato come prototipo locale per test sintetici. Non inserirvi dati reali sensibili e non collegarlo all'app operativa.

## Stato dei repository di migrazione e quarantena

I repository conservano soltanto metadati sintetici e non eseguono importazioni o trasferimenti di dati.

- Un nuovo job di migrazione nasce in stato `analysis`; sono consentiti soltanto passaggi di revisione, pausa o annullamento/errore compatibili con la modalità read-only.
- Gli stati `approved`, `ready-to-execute` e `completed` non sono raggiungibili dalle API attuali: richiedono un futuro processo esplicito, autorizzato e verificato.
- Un nuovo elemento in quarantena nasce `pending`; può essere marcato `reviewed` o `discarded`, ma non `released`.
- Il rilascio dalla quarantena resta bloccato finché non esisterà una procedura di migrazione esplicita. Nessuna di queste etichette equivale a un'importazione effettiva.
- I cambi di stato usano la revisione corrente come controllo ottimistico per rifiutare aggiornamenti concorrenti.

Questi controlli limitano gli stati fuorvianti nel prototipo; non costituiscono un'autorizzazione utente o una prova di approvazione aziendale.

## Impostazioni: validazione minima del repository

Il repository impostazioni non definisce ancora un catalogo funzionale dei singoli parametri. Per ridurre il rischio di persistenza accidentale di payload complessi, ora accetta soltanto oggetti semplici con un massimo di 30 proprietà, nomi chiave in formato tecnico limitato e valori primitivi: stringhe fino a 256 caratteri, numeri finiti, booleani o `null`. Oggetti annidati, array, valori numerici non finiti e chiavi non conformi vengono rifiutati.

Questa è una protezione strutturale, non una classificazione semantica dei dati: una stringa breve può comunque contenere un dato personale. Non inserire dati personali, retributivi, credenziali o contenuti operativi nelle impostazioni. Prima dell'uso reale occorre definire un catalogo esplicito delle preferenze ammesse, con finalità, retention e classificazione dei dati.
