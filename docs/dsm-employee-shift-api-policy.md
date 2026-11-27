# API turni Employee — policy self-service e confini

**Stato:** implementazione isolata autorizzata il 2026-11-27.
**Ambiente:** Functions + Firestore Emulator, fixture sintetiche.
**Non autorizzato:** deploy, Rules operative, migrazioni, dati reali, merge o modifica di `main`.

## Policy operativa

Sono esposte quattro callable protette: `listOwnEmployeeShifts`, `createOwnEmployeeShift`, `updateOwnEmployeeShift`, `deleteOwnEmployeeShift`.

La policy concede esclusivamente self-service a un membro con:
- ID token Firebase verificato con controllo revoca;
- membership canonica active/effective-dated nell'account selezionato;
- binding UID↔Employee attivo e bidirezionale, con revisioni concordi;
- Employee e account attivi;
- controllo Employee coerente con la revisione binding;
- un solo placement storico valido alla data del turno, con sede e reparto canonici attivi.

Le quattro operazioni sono distinte nel codice con permission identifiers separati (`dsm:employee:shift:{read|create|update|delete}:self`). Questi identificatori sono policy server-owned: non sono accettati dal client e non sono letti da campi `permissions` forniti dal client. Il loro grant corrente è limitato al ruolo `member` dopo la prova del binding personale. Nessun privilegio è derivato da un ruolo manager/admin.

## Confini

- Il client può selezionare l'account, fornire i campi di turno consentiti e, per update/delete, indicare shiftId e expectedRevision.
- UID è derivato solo dal token verificato. employeeId, owner, placement, site, department, scope e permission non sono parametri client.
- Gli ID dei nuovi turni e degli eventi audit sono generati server-side.
- Update/delete ricaricano la risorsa e il placement storico nella transazione; la data del turno è immutabile.
- La lettura restituisce DTO allowlist, solo turni propri, con verifica del placement storico. Limite risposta 200.
- Mutazioni e audit sono atomici. Le revisioni impediscono aggiornamenti obsoleti.
- Manager e admin non ricevono accesso delegato ai turni. Le operazioni manager restano negate finché una policy approvata non definisce grant separati read/create/update/delete e scope storico.
- Payroll e assenze non sono esposti da queste callable. La categoria sanitaria resta fuori da questa API.

## Limiti prima dell'uso reale

L'implementazione è un prototipo backend isolato. Richiede revisione indipendente, verifica delle query/indici nell'Emulator, test end-to-end Auth/Functions/Firestore, policy di retention e valutazione privacy/sicurezza. Non costituisce certificazione o autorizzazione alla produzione.
