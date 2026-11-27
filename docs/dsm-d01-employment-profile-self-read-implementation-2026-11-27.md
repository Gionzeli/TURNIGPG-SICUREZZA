# D-01 — implementazione lettura del profilo lavorativo self-service

**Data:** 2026-11-27  
**Branch:** `codex/employee-shift-date-range-query`  
**Decisione:** collocazione Firestore approvata dall'utente in chat; nessuna attivazione produzione.

## Collocazione canonica approvata

`accounts/{accountId}/employees/{employeeId}/employmentProfiles/current`

Il documento è distinto dal documento identitario Employee. Campi di controllo:
- `accountId`, `employeeId`, `status: "active"`;
- `schemaVersion: 1`;
- `revision` intero positivo.

Campi dati proiettati dal mapper D-01:
- `ccnl`, `section`, `level`, `role`, `effectiveDate`.

Il documento Employee continua a contenere solo identità tecnica e lifecycle. Il profilo non è usato per autorizzare ruoli, permessi o accessi DSM.

## Implementazione

- Permission self dedicata: `dsm:employee:employment-profile:read:self`, assegnata solo al ruolo canonical `member`.
- Callable: `readOwnEmployeeEmploymentProfile`; accetta esclusivamente `accountId`.
- UID ricavato dal token Firebase verificato e revocation-checked.
- Binding UID↔Employee verificato in entrambe le direzioni, con status e revisione coerenti.
- Account e Employee devono essere attivi; membership valida e permission esplicita obbligatoria.
- Il loader legge il solo documento `current` e restituisce un DTO chiuso con `employeeId` opaco e i cinque campi D-01.
- Proprietà estranee (payroll, IBAN, salute, note, audit) non vengono restituite.
- Nessun endpoint di scrittura, nessuna migrazione LocalStorage, nessuna sincronizzazione o cache offline.

## Limiti ancora aperti

1. La provenienza dei cinque valori e il processo manuale di verifica non sono ancora definiti. La callable legge esclusivamente il documento canonico predisposto da un processo trusted; non certifica la veridicità dei valori.
2. `effectiveDate` è restituita come data dichiarata nel profilo corrente. Non viene creato uno storico, né interpretata come timeline dei termini contrattuali.
3. Non è stato approvato un nome/display label; l'identità UI usa soltanto l'ID Employee opaco.
4. Nessun caricamento automatico dal profilo locale e nessuna scrittura client diretta.
5. La permission è per sola lettura self. Manager/admin non ricevono questo grant.

## Verifica

Il test Emulator sintetico copre binding reciproco, proiezione allowlist, esclusione di campi sensibili, rifiuto di selettore Employee client e binding revocato. Il risultato CI del commit finale va verificato separatamente. Nessun Firebase reale, deploy o attivazione produzione.
