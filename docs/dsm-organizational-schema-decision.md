# Decisione approvata — schema organizzativo DSM

**Stato:** approvata dall'utente il 2026-11-27 per implementazione isolata.
**Ambiente:** codice sul branch `dsm-enterprise/core-v1`, Firebase Emulator, dati sintetici.
**Esclusioni esplicite:** nessuna migrazione/import di dati reali, accesso a progetti Firebase reali, credenziali, deploy, modifica delle Rules operative, merge o modifica di `main`.

## 1. Gerarchia Firestore canonica (ORG-01)

Si adotta una gerarchia flat per account:

```text
accounts/{accountId}
accounts/{accountId}/sites/{siteId}
accounts/{accountId}/departments/{departmentId}
accounts/{accountId}/members/{uid}
accounts/{accountId}/organizationAudit/{eventId}
```

I percorsi `members` sono già usati dal backend. Account, sites, departments e organizationAudit diventano il contratto canonico per il nuovo adapter isolato. I reparti sono flat sotto account e hanno un solo `siteId` corrente. Il documento reparto non viene spostato quando cambia sede.

Campi obbligatori:
- Account: `accountId` uguale al document ID, `status`, `schemaVersion` intero positivo, `version` intero positivo, `createdAt`, `updatedAt`.
- Site: `accountId`, `siteId` uguale al document ID, `status`, `version`, `createdAt`, `updatedAt`.
- Department: `accountId`, `departmentId` uguale al document ID, `siteId` canonico nella stessa account, `status`, `version`, `createdAt`, `updatedAt`.
- Membership: percorso esistente `accounts/{accountId}/members/{uid}`; UID e account devono coincidere con path e token verificato.

## 2. Lifecycle (ORG-02, ORG-05)

- Account, site e department accettano solo `active` o `archived`. Stati assenti, sconosciuti o non attivi negano ogni normale operazione.
- Un site non può essere archiviato se ha departments attivi o assegnazioni manager attive. Prima vanno completati trasferimenti/revoche autorizzati.
- Un department deve riferirsi a un site attivo dello stesso account.
- Membership usa `status: active | suspended | revoked`, `validFrom` Timestamp obbligatorio e `validUntil` Timestamp o null. L'intervallo è semiaperto `[validFrom, validUntil)`, valutato con clock server. Solo status active e intervallo corrente autorizzano. Campi mancanti, tipo errato o intervallo invalido negano.
- Le membership esistenti senza campi lifecycle non vengono convertite automaticamente: nessuna migrazione è autorizzata. Il codice nuovo nega tali record finché non esiste una migrazione separatamente approvata.

## 3. Account multipli e scope (ORG-03, ORG-04)

- Lo stesso UID può avere membership distinte in più account.
- `accountId` fornito dal client è solo un selettore; il server usa UID dal token revocation-checked e carica la membership esatta per account.
- Non si sceglie mai implicitamente un account e non si riutilizza una membership di un altro account.
- Sono consentiti più scope ID nello stesso scopeType. Gli ID devono essere validi, univoci e riferiti a risorse attive nello stesso account.
- Admin: `account` con scopeIds vuoto. Manager: `site` con almeno un site. Member: `site` oppure `department` con almeno un ID.

## 4. Matrice autorizzativa approvata (ORG-06)

Permessi derivati esclusivamente dal server; campi permissions client/stored non sono autorità.

| Ruolo | Permessi base | Limiti |
|---|---|---|
| member | `dsm:read:own-scope` | Solo dati propri collegati a binding Employee attivo. Nessuna gestione organizzativa, payroll o dati salute. |
| manager | `dsm:read:site`, `dsm:manage:site`, `dsm:manage:departments`, `dsm:transfer:departments` | Solo site assegnati; dipartimenti autorizzati via relazione corrente; nessun account-wide, membership, payroll o contenuto sanitario. |
| admin | `dsm:read:account`, `dsm:manage:account`, `dsm:manage:memberships`, `dsm:manage:admin-nominations`, `dsm:transfer:departments` | Scope account. Non implica payroll, dati sanitari o export. |

Semantica:
- `read`: sola lettura del dominio indicato.
- `manage:site` / `manage:departments`: creazione e aggiornamento ordinario entro lo scope; non sostituisce l'autorizzazione esplicita per archive/transfer.
- `transfer:departments`: trasferimento tra site dello stesso account. Un manager deve avere scope sia sulla sede sorgente sia sulla destinazione; admin deve avere account scope.
- Archiviazione di account/site/department è operazione distinta, con controllo di dipendenze e audit; non è implicata da un generico update.
- Payroll read/write/export restano deny-by-default: nessun ruolo base li riceve.
- Assenze manager ordinarie espongono solo disponibilità e date; categoria sanitaria, motivo, note e documenti sono esclusi.

## 5. Trasferimenti (ORG-07)

Trasferimento department→site in transazione:
1. verifica token revocation-checked, membership corrente e permesso `dsm:transfer:departments`;
2. carica department, source site e destination site canonici;
3. verifica account identico, tutti active, source uguale al parent corrente e destination diversa;
4. verifica version attesa e scope actor su entrambe le sedi;
5. aggiorna solo `siteId`, `version + 1`, `updatedAt`;
6. crea evento audit append-only nella stessa transazione;
7. rifiuta replay, stale version e concorrenza; se audit o update falliscono, rollback integrale.
Ogni accesso successivo rilegge la relazione department→site corrente: nessuna lista client/cache conferisce autorità.

## 6. Identificativi (ORG-08)

Gli ID account/site/department/event sono generati server-side (Firestore auto-ID o processo server equivalente), opachi, immutabili e mai riutilizzati dopo archive. Il client non può scegliere ID arbitrari per creare o riassegnare risorse. Le mutazioni verificano sempre corrispondenza document ID/campo ID.

## 7. Audit e retention (ORG-09)

`organizationAudit` è append-only dal servizio server. Evento minimo: eventId, accountId, actorUid verificato, action, resourceType, resourceId, timestamp server, reasonCode, version precedente/nuova e delta strettamente necessario. Nessun token, segreto, dati sanitari o payload completo.
Lettura limitata a permesso amministrativo dedicato e non esposta in questa fase. Nessuna cancellazione automatica o TTL viene configurata finché non è approvata una retention legale/privacy specifica; accesso e retention restano da revisionare prima dell'uso reale.

## 8. API protette e sequenza (ORG-10)

Ogni API dati dovrà:
- verificare Bearer ID token con controllo revoca;
- derivare UID esclusivamente dal token;
- ricaricare membership e risorse canoniche ad ogni operazione;
- controllare lifecycle, permesso operation-specific, scope e binding Employee quando applicabile;
- applicare query tenant-scoped e DTO allowlist;
- rendere atomiche mutazione e audit;
- negare per default su errori, ambiguità, record mancanti, archived o stale version.

La risoluzione membership non è un'API dati. I servizi di dominio Employee esistenti restano interni; non vengono esportati callable di lettura/scrittura turni, assenze o payroll finché ogni adapter autorizzativo end-to-end non è testato. Payroll resta separato e non implementato.

## 9. Implementazione e limiti approvati

Ordine: schema docs → validatori/lifecycle → Firestore loaders → trasferimento transazionale/audit → test Emulator positivi, negativi e concorrenti → API protette una per una solo dopo i gate.
I percorsi sopra sono approvati per il codice isolato e i test Emulator. Non sono autorizzati deploy, Rules operative, migrazioni, import, accesso a dati reali, uso di credenziali reali, modifiche alla composition root operativa o release.
