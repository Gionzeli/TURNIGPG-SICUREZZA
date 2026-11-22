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
- `src/core/repositories/base-repository.js`: operazioni CRUD con scope account e controllo concorrenza ottimistico su update/delete.
- `src/core/repositories/profile-repository.js`: repository profili.
- `src/core/repositories/shift-repository.js`: repository turni.
- `src/core/services/service-validation.js`: validazione condivisa di oggetti, date e revisioni.
- `src/core/services/profile-service.js`: normalizzazione e validazione di parametri retributivi e dati profilo.
- `src/core/services/shift-service.js`: validazione di date, tipi turno, orari, flag e ore.
- `src/core/legacy/legacy-read-adapter.js`: analisi read-only degli snapshot `tg_online_v1`/`tg_extra_v1` e inventario delle copie di backup, chiavi per-utente, storico, formazione e contenitori cifrati.

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
  ShiftRepository,
  ProfileService,
  ShiftService
} from "./src/core/database/index.js";

const db = await openDSMDatabase();
const accountContext = createAccountContext();

// Chiamare activate() solo da un servizio di autenticazione/onboarding
// che abbia già verificato l'identità e il contesto.
accountContext.activate({
  accountId: "local-demo-account",
  identitySource: "local"
});

const profileRepository = new ProfileRepository({ db, accountContext });
const shiftRepository = new ShiftRepository({ db, accountContext });
const profiles = new ProfileService({ repository: profileRepository });
const shifts = new ShiftService({ repository: shiftRepository });

const profile = await profiles.create({
  params: { paga_base: 1250, ore_turno: 7.25 },
  profile: { ccnl: "Servizi", section: "Operativo", level: "Da definire", role: "Operatore" }
});
const shift = await shifts.create({
  date: "2026-11-22",
  start_time: "06:00",
  end_time: "14:00",
  type: "turno",
  hours: 8
});

// Update e delete richiedono la revisione letta dal record.
await shifts.update(shift.id, { hours: 7.5 }, { expectedRevision: shift.revision });
```

## Anteprima dati legacy (sola lettura)

Gli adapter `inspectLegacySnapshot(rawJson)` e `inspectLegacyExtras(rawJson)` analizzano stringhe JSON esportate manualmente dalle chiavi `tg_online_v1` e `tg_extra_v1`. Non legge direttamente LocalStorage, non apre il database operativo, non crea record e non modifica dati. Restituisce:
- validità delle sezioni `params` e `profile`;
- turni compatibili e turni da verificare in quarantena, con motivo e contenuto originale;
- avvisi sulle correzioni automatiche presenti nel runtime legacy (ad esempio `ore_turno` 7,15/12), senza applicarle;
- un indicatore `importable` che resta falso se esistono errori o turni in quarantena.

L'anteprima extra riconosce quote ferie/permessi, valori mensili, modelli turno, formazione e residui da busta paga. Rileva l'eventuale presenza di PIN hash e salt ma non restituisce i relativi valori e non li importa: serve una transizione autenticazione separata.

L’inventario `inspectLegacyArchive(entries)` accetta un oggetto costruito da un export manuale chiave/valore e riconosce `tg_online_v1_pre_local_backup`, `tg_extra_v1_pre_local_backup`, le famiglie `tg_online_v1_user_*` e `tg_extra_v1_user_*`, `tg_change_history_v1` e `tg_training_local_v1`. Riporta conteggi e anteprime sanificate; non restituisce i suffissi identificativi delle chiavi per-utente né i contenuti `before`/`after` dello storico. Le voci formazione prive di titolo valido sono isolate in quarantena. Il vecchio runtime copia alcune voci di `tg_training_local_v1` in `tg_extra_v1.skills` senza cancellare la chiave sorgente: in fase di riconciliazione occorre evitare duplicati.

L’inventario riconosce anche file backup JSON in chiavi alias `backup...`: i backup in chiaro vengono analizzati come snapshot più sezione extra; i contenitori cifrati v2/v3 AES-256-GCM sono solo classificati per versione/algoritmo, senza decifratura. Password, codici di recupero, PIN hash e salt non sono richiesti né restituiti. Le chiavi sconosciute vengono segnalate per analisi separata.

Questa fase resta solo inventario/anteprima: nessuna scrittura, nessuna selezione automatica tra copie concorrenti, nessuna importazione o cancellazione. Prima di una futura migrazione occorre confrontare le copie e definire esplicitamente provenienza, priorità, duplicati e gestione credenziali.

## Limiti noti e sicurezza

- Il contesto account è un controllo di isolamento applicativo, non un confine di sicurezza contro XSS o codice malevolo nella stessa origine.
- `identitySource: "firebase_verified"` deve essere impostato soltanto da un servizio che abbia verificato realmente la sessione Firebase. Il modulo account non autentica l'utente.
- `identitySource: "local"` è per account locali creati dal flusso onboarding, non per attribuire dati legacy di provenienza incerta.
- Il database non è cifrato da questo pacchetto.
- Non è presente sincronizzazione remota.
- Il pacchetto non importa né cancella dati LocalStorage.
- La UI legacy non è ancora collegata a questi moduli.
- È presente un harness browser in `tests/browser/`, eseguito automaticamente con Chromium/Playwright tramite GitHub Actions.
- L'ultima esecuzione CI verificata (run `45016682049`) ha superato 33 test funzionali e la pulizia del database test: 33 superati, 0 falliti. Sono inclusi Service Layer, adapter legacy, inventario backup/storico/per-utente/formazione e riconoscimento dei backup cifrati. Gli adapter non leggono LocalStorage, non scrivono IndexedDB e non avviano importazioni. Il workflow si attiva su push al branch `dsm-enterprise/core-v1` e può essere avviato manualmente.

## Stato della verifica

I moduli e l'harness sono stati inseriti nel branch dedicato. È stata completata una prova automatizzata in Chromium su IndexedDB reale. Prima di collegare il codice alla PWA occorre verificare l’autenticazione del contesto account, definire il flusso di backup/import e completare la riconciliazione delle copie legacy. Il risultato CI non certifica l'integrazione con la UI, Firebase, cifratura, migrazione o dispositivi mobili.
