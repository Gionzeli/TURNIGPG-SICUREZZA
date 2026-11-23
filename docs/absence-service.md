# Gestione delle assenze DSM

## Separazione dei dati

Le assenze sono archiviate nell'object store IndexedDB `absences`, distinto da `shifts`. L'aggiornamento dello schema DSM alla versione 2 aggiunge lo store durante l'upgrade IndexedDB; gli store esistenti vengono mantenuti.

## Modello attuale

Ogni assenza contiene esclusivamente:
- `kind`: `ferie`, `permesso` oppure `malattia`
- `startDate`: data ISO `YYYY-MM-DD`
- `endDate`: data ISO `YYYY-MM-DD`

Le date sono inclusive come intervallo descrittivo, senza calcolo automatico di giorni lavorativi, ore, quote o residui. La data finale non può precedere quella iniziale. Non sono previsti note, dettagli sanitari, stato di approvazione o motivazioni.

## Repository e audit

`AbsenceRepository` applica l'account scoping e le revisioni ottimistiche del `BaseRepository`. Creazione, modifica e cancellazione producono eventi sanitizzati `absence` nello store `history`, nella stessa transazione IndexedDB dell'operazione.

`AbsenceService` valida i campi consentiti, il tipo e le date. Gli aggiornamenti e le cancellazioni richiedono `expectedRevision`.

## Limiti e sicurezza

- Nessuna integrazione con l'interfaccia operativa o con Firebase.
- Nessuna importazione o sincronizzazione di dati legacy.
- IndexedDB resta locale al browser e non è cifrato.
- `accountContext` è un controllo applicativo client-side, non autenticazione forte.
- Il modello non definisce regole contrattuali, approvazioni, sovrapposizioni, ferie a ore o calcoli paga.
