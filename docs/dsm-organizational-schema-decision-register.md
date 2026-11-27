# Registro decisioni per lo schema organizzativo DSM

**Stato:** ORG-01–ORG-10 approvate dall'utente il 2026-11-27; vedere `dsm-organizational-schema-decision.md`.
**Ambito:** confronto tra codice attuale, contratti documentali e decisioni ancora necessarie.
**Riferimento:** branch `dsm-enterprise/core-v1`; nessuna modifica a Firebase operativo, Rules, migrazioni o deploy.

Questo registro evita di confondere i comportamenti già codificati con le scelte di prodotto ancora da approvare. I percorsi e i default del documento `dsm-organizational-schema-decision.md` sono approvati per implementazione isolata ed Emulator; non per produzione.

## 1. Fatti verificati nel codice attuale

| Tema | Evidenza attuale | Cosa NON dimostra |
|---|---|---|
| Membership | `accounts/{accountId}/members/{uid}` è letto da `resolveAuthorization`. | Non prova che account/sedi/reparti abbiano già percorsi canonici definitivi. |
| Stato membership | `membership-policy.js` accetta solo `status: "active"`. | Non definisce sospensione, scadenza, validità futura o retention. |
| Ruoli | Allowlist: `member`, `manager`, `admin`. | Non costituisce approvazione della matrice completa per tutte le operazioni DSM. |
| Scope | Un solo `scopeType` per membership; `scopeIds` è un array di ID univoci. | Non definisce se assegnazioni multiple siano desiderate dal prodotto. |
| Manager | Codice attuale: scope `site`, almeno un ID; permessi fissi di lettura/gestione sede e reparti. | Non definisce chi può assegnare/rimuovere manager o trasferirli. |
| Member | Codice attuale: scope `site` o `department`, almeno un ID; permesso `dsm:read:own-scope`. | Non definisce il modello dati per l'accesso ai singoli record DSM. |
| Admin | Codice attuale: scope `account`, array vuoto; permessi fissi account/membership/nomine. | Non definisce i limiti di bootstrap, nomina, approvazione e revoca. |
| Risorse | Resolver puro con loader iniettati controlla ID e relazioni account/sede/reparto. | Non esistono loader Firestore canonici e non vengono controllati stati di archiviazione. |
| API dati | L'entry point Functions dichiara `protectedDataApisImplemented: false`. | Il resolver di membership non è una API dati protetta. |
| Trasferimenti | Non è presente un flusso di trasferimento sede/reparto nell'entry point verificato. | Atomicità, audit e autorizzazioni di trasferimento non sono implementati. |

## 2. Contratto corrente: forma della membership

Il codice attuale valida una membership con questa forma logica (esempio illustrativo, non fixture da caricare):

```json
{
  "uid": "<uid>",
  "accountId": "<accountId>",
  "status": "active",
  "role": "manager",
  "scopeType": "site",
  "scopeIds": ["<siteId>"]
}
```

Le proprietà `permissions` inviate o memorizzate nella membership non sono fonte di autorità: i permessi sono derivati dalla allowlist nel codice.

Attenzione: `scopeIds` consente attualmente più ID per manager e member. Questo è un comportamento del validatore, non una decisione esplicita sul prodotto. L'eventuale disabilitazione delle assegnazioni multiple richiede modifica di policy e test dedicati.

## 3. Incongruenza documentale da risolvere

Il callable corrente `resolveAuthorization` richiede `accountId` come selettore nella richiesta e poi legge la membership canonica per la coppia account/UID verificato. Il contratto documentale `firebase-server-authorization-contract.md` descrive invece una richiesta senza `accountId`, con account determinato dal backend.

Entrambi i modelli possono essere resi sicuri solo con un contratto coerente:
- **Selettore account non autorevole:** il client può indicare l'account da tentare; il server verifica comunque una membership attiva per UID verificato in quell'account e non accetta ruolo o permessi dal client.
- **Account scelto dal server:** il backend risolve tutte le membership dell'UID e applica una regola esplicita per selezione o ambiguità.

Il repository non documenta ancora la UX e la policy per l'utente con membership in più account. Non cambiare il callable finché questa scelta non è approvata. In entrambi i modelli ogni API dati deve rifare i controlli server-side.

## 4. Decisioni da approvare

| ID | Decisione | Evidenza/limite | Default prudenziale proposto, non approvato |
|---|---|---|---|
| ORG-01 | Percorsi e campi canonici account/sedi/reparti | I loader non esistono; la proposta indica percorsi possibili. | Approvare una sola gerarchia e campi obbligatori prima dei loader. |
| ORG-02 | Stati risorsa e archiviazione | Il resolver attuale non verifica `status`. | `active` obbligatorio per ogni antenato; valori mancanti/sconosciuti negano. Definire `archived` e retention. |
| ORG-03 | Membership multi-account | Il callable attuale accetta un account selector; non c'è discovery UX documentata. | Nessun account implicito; risolvere ogni selezione contro membership canonica attiva. |
| ORG-04 | Assegnazioni multiple | Gli array attuali ammettono più sedi/reparti dello stesso scope type. | Conservare il comportamento solo dopo conferma esplicita del product owner. |
| ORG-05 | Scadenza/sospensione membership | Validatore controlla solo `status: active`. | Definire `validFrom`, `validUntil`, sospensione e revoca usando il clock server; negare in caso di ambiguità. |
| ORG-06 | Matrice permessi | Esistono permessi fissi per tre ruoli. | Approvare ogni operazione (read/create/update/archive/transfer/export) prima di esporla. |
| ORG-07 | Trasferimento reparto | La proposta richiede che il reparto segua la sede corrente. | Aggiornamento atomico del legame canonico e audit append-only nella stessa transazione, dopo approvazione del modello. |
| ORG-08 | Identificativi | Il resolver applica un pattern sintattico, ma non una policy di allocazione. | Generazione server-side; ID immutabili e non riutilizzati, se confermato. |
| ORG-09 | Audit e retention | Non esiste un contratto completo per audit organizzativo. | Definire eventi, attori, motivazione, retention e accesso prima delle mutazioni. |
| ORG-10 | API DSM protette | Nessuna API dati DSM è esportata attualmente. | Inventariare operazioni, query e invarianti; autenticare/autorizzare ogni chiamata. |

## 5. Sequenza minima prima di implementare

1. Il responsabile dello schema approva ORG-01 e ORG-02.
2. Il responsabile prodotto approva ORG-03–ORG-09, oppure registra esplicitamente le decisioni rinviate.
3. Si aggiorna il contratto di autorizzazione per eliminare l'incongruenza ORG-03.
4. Si implementano loader isolati solo su Firestore Emulator, con fixture sintetiche.
5. Si aggiungono test fail-closed per record assenti, stati non attivi, relazioni incoerenti, revoche e trasferimenti concorrenti.
6. Si inventariano e implementano le API dati una per una, con controlli server-side per ogni operazione.
7. Si eseguono i test backend Functions/Auth/Firestore Emulator sul commit esatto e si revisionano i risultati prima di qualunque decisione di rilascio.

## 6. Stato dopo approvazione

ORG-01–ORG-10 sono approvate per codice isolato e test Emulator. La decisione vincolante e i dettagli sono in `dsm-organizational-schema-decision.md`. I vecchi default sono stati risolti: gerarchia flat, lifecycle attivo/archiviato, membership effective-dated, multi-account con account selector non autorevole, scope multipli, matrice per operazione, trasferimento transazionale, ID server-side, audit append-only senza TTL automatico e API protette con verifica server-side per ogni chiamata.

## 7. Non autorizzazione

L'approvazione non autorizza percorsi o modifiche al progetto Firebase operativo, Rules operative, migrazioni, accesso a dati reali, credenziali, deploy o modifiche all'app di produzione. I loader approvati possono essere implementati solo nel backend isolato e testati su Emulator. La PR deve restare aperta e draft finché le decisioni non sono revisionate.
