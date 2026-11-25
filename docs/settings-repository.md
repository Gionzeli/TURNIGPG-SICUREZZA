# SettingsRepository — limiti e uso sicuro

Il repository `SettingsRepository` è un archivio tecnico per preferenze semplici del core DSM. Non esiste ancora un `SettingsService` né una allowlist di impostazioni di dominio; il repository non deve quindi essere interpretato come un archivio generico per dati dell'utente.

## Validazione applicata

- Da 1 a 30 chiavi per record.
- Chiavi da 1 a 64 caratteri, con formato `[a-z][a-zA-Z0-9_]*`.
- Valori soltanto primitivi: stringhe fino a 256 caratteri, numeri finiti, booleani o `null`.
- Oggetti annidati, array, stringhe troppo lunghe, numeri non finiti e chiavi non conformi vengono rifiutati.
- La stessa validazione si applica a creazione e aggiornamento; un aggiornamento non valido non modifica il record.
- Le operazioni CRUD sono isolate per account dal repository base e registrano gli eventi audit supportati.

## Limiti di sicurezza

IndexedDB DSM non è cifrato. La validazione strutturale non può riconoscere il significato di un valore: una stringa breve potrebbe comunque contenere un dato personale o un segreto. Non memorizzare qui password, PIN, token, credenziali, dati sanitari, retributivi, fiscali o altri dati personali/sensibili.

Prima di collegare impostazioni alla UI operativa occorre introdurre un `SettingsService` con allowlist esplicita delle sole preferenze necessarie, validazione specifica per ciascun campo e test dedicati. Fino ad allora il repository resta un componente tecnico non integrato e non va usato per archiviare dati reali.

Questi controlli non sostituiscono autenticazione, cifratura o protezioni contro codice malevolo nella stessa origine.
