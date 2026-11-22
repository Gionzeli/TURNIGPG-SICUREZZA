# DSM Core — primo pacchetto di implementazione

Branch: `dsm-enterprise/core-v1`

## Scopo

Questo pacchetto introduce un primo nucleo IndexedDB isolato dal runtime legacy. Non modifica `index.html`, Firebase, il Service Worker o le chiavi LocalStorage esistenti.

## File inclusi

- `src/core/database/database-schema.js`: schema IndexedDB versione 1.
- `src/core/database/database-errors.js`: errori applicativi normalizzati.
- `src/core/database/database-transactions.js`: helper per richieste e transazioni.
- `src/core/database/database.js`: apertura, chiusura e gestione versionchange.
- `src/core/database/index.js`: export pubblici.
- `src/core/account/account-context.js`: contesto account locale in memoria.
- `src/core/account/account-guard.js`: controlli preliminari di contesto e ownership.
- `src/core/repositories/base-repository.js`: operazioni CRUD con scope account.
- `src/core/repositories/profile-repository.js`: repository profili.
- `src/core/repositories/shift-repository.js`: repository turni.

## Schema v1

Object store: `accounts`, `profiles`, `settings`, `shifts`, `history`, `migration_jobs`, `migration_quarantine`, `schema_metadata`.

Gli store applicativi hanno chiavi account e indice composto `accountId_id`. I record applicativi hanno forma:

```js
{
  id,
  accountId,
  createdAt,
  updatedAt,
  revision,
  schemaVersion,
  data
}
```

## Uso preliminare

```js
import {
  openDSMDatabase,
  createAccountContext,
  ProfileRepository,
  ShiftRepository
} from "./src/core/database/index.js";

const db = await openDSMDatabase();
const accountContext = createAccountContext();

// Chiamare activate() solo da un servizio di autenticazione/onboarding
// che abbia già verificato l'identità e il contesto.
accountContext.activate({
  accountId: "local-demo-account",
  identitySource: "local"
});

const profiles = new ProfileRepository({ db, accountContext });
const shifts = new ShiftRepository({ db, accountContext });

await profiles.create({ displayName: "Profilo locale" });
await shifts.create({
  date: "2026-11-22",
  startTime: "06:00",
  endTime: "14:00",
  type: "DAY"
});
```

## Limiti noti e sicurezza

- Il contesto account è un controllo di isolamento applicativo, non un confine di sicurezza contro XSS o codice malevolo nella stessa origine.
- `identitySource: "firebase_verified"` deve essere impostato soltanto da un servizio che abbia verificato realmente la sessione Firebase. Il modulo account non autentica l'utente.
- `identitySource: "local"` è per account locali creati dal flusso onboarding, non per attribuire dati legacy di provenienza incerta.
- Il database non è cifrato da questo pacchetto.
- Non è presente sincronizzazione remota.
- Il pacchetto non importa né cancella dati LocalStorage.
- La UI legacy non è ancora collegata a questi moduli.
- È presente un harness manuale di test browser in `tests/browser/`, con nove controlli automatici eseguiti nel browser su IndexedDB nativo.
- Non è ancora configurata una pipeline CI e i test non sono stati eseguiti in questa fase.

## Stato della verifica

I moduli e l'harness sono stati inseriti nel branch dedicato. È stata eseguita una revisione statica del codice, ma non una prova in browser reale. Prima di collegare il codice alla PWA occorre eseguire l'harness su browser target, ampliare i test sulle transazioni e verificare l'autenticazione del contesto account.
