# Decisione storage canonico Employee — Firestore

**Stato:** approvata dall'utente il 2026-11-26 per la prima implementazione isolata.
**Ambito:** archivio backend canonico Employee e domini correlati.
**Ambiente autorizzato:** codice sul branch `dsm-enterprise/core-v1`, test con Firebase Emulator e dati sintetici esclusivamente.
**Esclusioni:** progetto Firebase reale, credenziali, dati personali/operativi, deploy, merge, main e wiring dell'app operativa.

## 1. Decisione

Firestore è scelto come datastore canonico per la prima versione Employee. Motivazioni:
- il backend Functions usa già Firebase Admin SDK e Firestore;
- è disponibile un workflow Functions con Firestore Emulator;
- evita di introdurre subito un nuovo database relazionale, driver, pool, rete, backup e ciclo operativo;
- le invarianti richieste possono essere implementate con documenti di prenotazione deterministici e transazioni, purché siano provate con test concorrenti.

PostgreSQL resta il piano alternativo se le prove Firestore non dimostrano affidabilmente unicità, contesa, placement, query e audit. IndexedDB non è fonte canonica.

## 2. Modello fisico iniziale

Tutti i documenti Employee sono tenant-scoped sotto `accounts/{accountId}`. I nomi seguenti sono i percorsi scelti per il prototipo backend isolato; non vanno creati in un progetto reale senza una revisione separata.

| Percorso | Contenuto consentito | Regola |
|---|---|---|
| `accounts/{accountId}/employees/{employeeId}` | employeeId, accountId, status, revision, createdAt, updatedAt | Identità minima; niente payroll, dati sanitari o token |
| `accounts/{accountId}/employeeBindingsByUid/{uid}` | uid, accountId, employeeId, status, revision, timestamps | Prenotazione univoca per UID |
| `accounts/{accountId}/employeeBindingsByEmployee/{employeeId}` | employeeId, accountId, uid, status, revision, timestamps | Prenotazione inversa univoca per Employee |
| `accounts/{accountId}/employees/{employeeId}/placements/{placementId}` | accountId, employeeId, siteId, departmentId, validFrom, validUntil, revision | Storico placement; intervalli [from, until) |
| `accounts/{accountId}/employeeControl/{employeeId}` | accountId, employeeId, placementRevision, bindingRevision | Documento di serializzazione per mutazioni concorrenti |
| `accounts/{accountId}/employeeShifts/{shiftId}` | accountId, employeeId, placementId, siteId, departmentId, date e soli campi turno necessari | Ownership assegnata dal server; contesto storico immutabile |
| `accounts/{accountId}/employeeAbsences/{absenceId}` | accountId, employeeId, intervallo e campi riservati | DTO manager ordinario consente solo indisponibilità e date |
| `accounts/{accountId}/employeePayroll/{employeeId}/records/{recordId}` | record retributivi minimizzati | Dominio separato; deny-by-default |
| `accounts/{accountId}/employeeAudit/{eventId}` | actorUid, action, target, reasonCode, occurredAt, revisions | Append-only per servizio; mai segreti, importi o dettagli sanitari |

Gli ID sono opachi, generati/assegnati dal backend, immutabili e non riutilizzati. `profileId` nel contratto binding esistente viene mappato esplicitamente a `employeeId`; il nome del campo non viene rinominato in questa fase.

## 3. Invarianti transazionali

### Binding 1:1 attivo (EMP-03)

Una transazione legge la prenotazione UID, la prenotazione Employee, il documento Employee e il controllo/revision. Crea o aggiorna entrambe le prenotazioni soltanto se entrambe sono assenti oppure sono una precedente associazione esplicitamente revocata. Le due copie devono concordare esattamente su account, UID, Employee, stato e revisione. Nessun auto-selezione e nessun overwrite. La revoca aggiorna entrambe le prenotazioni e audit nella stessa transazione. Una nuova associazione richiede revoca precedente e approvazione manuale a due persone (EMP-09).

### Placement e trasferimenti (EMP-04)

Le mutazioni leggono e aggiornano `employeeControl/{employeeId}` nella stessa transazione, serializzando tutte le modifiche dello stesso Employee. Gli intervalli sono semiaperti `[validFrom, validUntil)`, validFrom obbligatorio e validUntil esclusivo/null per il placement corrente. Si rifiutano overlap, placement mancanti/ambigui, revisioni stale e risorse non attive. Un trasferimento chiude il placement precedente e crea quello nuovo atomically; shift storici conservano placementId/siteId/departmentId originali.

### Dati sensibili e audit (EMP-06/07/08)

Assenze e payroll sono raccolti separati. Le API manager non leggono né restituiscono categoria sanitaria, motivo, note o documenti. Payroll richiede permessi distinti read/write/export e audit per ciascuna azione. Lifecycle account/site/department/Employee è ricontrollato dal server a ogni operazione. Mutazioni e audit richiesti condividono una transazione.

## 4. Confine di autorizzazione

Firestore Admin SDK bypassa Security Rules. Pertanto:
- le Rules client non sono un sostituto dell'autorizzazione server;
- ogni callable/API deve derivare UID da ID token verificato con controllo revoca;
- il server rilegge membership canonica, binding, Employee e lifecycle ad ogni operazione;
- scope manager e permessi sono verificati per azione e per data del turno;
- il client non può fornire employeeId come prova di ownership;
- query tenant-scoped e DTO allowlist sono obbligatori.

Le Rules per i nuovi percorsi restano deny-by-default per client direct access finché non esiste un contratto specifico e testato.

## 5. Gate tecnici prima di dichiarare il backend utilizzabile

1. Test emulator su creazione, revoca, retry, duplicati e concorrenza UID↔Employee.
2. Test su trasferimenti concorrenti, retrodatazioni, overlap, stale revision e preservazione storico.
3. Test account/site/department/Employee lifecycle e cross-tenant.
4. Test DTO/queries che provino assenza leakage payroll e sanitario.
5. Test atomicità mutazione/audit e rollback su failure.
6. Test paginazione, query catalogue e limiti Firestore.
7. Revisione security delle callable e rate limiting/abuse controls.
8. Backup/restore, retention, key management e disaster recovery da approvare prima di qualunque uso reale.

Fino al superamento dei gate il codice è un prototipo backend isolato su emulator, non un sistema operativo o certificato.
