# DSM Core — revisione tecnica preliminare di sicurezza

Data: 2026-11-24
Riferimento: branch `dsm-enterprise/core-v1`; revisione documentale aggiornata il 24 novembre 2026.

## Esito

Il core è adatto a prove locali con dati sintetici e a ulteriore sviluppo isolato. **Non è pronto per gestire dati personali o turni reali, né per essere collegato all'app operativa.** I test automatizzati superati verificano i flussi implementati, ma non trasformano i controlli client-side in autenticazione o autorizzazione.

Questa è una revisione statica preliminare dei moduli elencati, non un penetration test, una verifica indipendente o una certificazione.

## Rilievi

### SEC-01 — Mancano autenticazione e autorizzazione fidate
**Gravità: bloccante prima di qualsiasi dato reale.**

`createDSMCoreSession({ db, accountId })` attiva un contesto locale usando l'ID fornito dal chiamante. `createAccountContext.activate()` accetta intenzionalmente soltanto `identitySource: "local"`; non verifica sessioni, token o principal. Di conseguenza un accountId non dimostra l'identità dell'utente e l'indice `accountId` protegge soltanto l'organizzazione dei record nell'applicazione client.

**Stato aggiornato:** esiste ora un adapter Firebase isolato che chiede al backend un principal e controlla la coerenza con UID, account selezionato e revisione della selezione. Il callable `resolveAuthorization` verifica il bearer token (inclusa la revoca) e legge la membership canonica. Tuttavia l'adapter non è collegato alla sessione/composition root DSM e il backend dichiara esplicitamente che le API dati protette e l'autorizzazione delle operazioni non sono implementate. La restituzione di un principal non autorizza quindi alcuna lettura/scrittura reale del core.

**Azione richiesta:** prima dell'integrazione, progettare API dati server-side che ri-verifichino identità, membership e scope per ogni operazione, con test negativi per UID/accountId arbitrari. Il principal dovrà provenire da un componente fidato; non accettare UID, flag o timestamp forniti da UI, URL o storage locale.

### SEC-02 — IndexedDB non è un confine di sicurezza
**Gravità: alta per dati reali.**

I repository applicano filtri per account, ma codice eseguito nella stessa origine può accedere direttamente a IndexedDB e alterare record, indici e cronologia. Il test browser `HIST-005` scrive direttamente nello store `history` e verifica che la modifica sia visibile attraverso il repository. La CSP della fixture demo riduce le superfici della pagina di test, ma non protegge un'applicazione diversa o una sessione compromessa.

**Azione richiesta:** non conservare qui segreti o dati reali finché non sono definiti threat model, mitigazioni XSS, gestione sessione e strategia di protezione dei dati. La cifratura lato client, da sola, non sostituisce l'autorizzazione e richiede un ciclo di vita delle chiavi separato.

### SEC-03 — La cronologia è append-only a livello API, non immutabile
**Gravità: alta se usata come audit probatorio.**

`HistoryRepository` rifiuta update/delete attraverso la propria API e le mutazioni supportate aggiungono eventi nella stessa transazione IndexedDB. Tuttavia chi controlla il contesto browser può scrivere direttamente nello store o alterare/cancellare dati. Gli eventi non sono firmati né ancorati a un servizio fidato.

**Azione richiesta:** descrivere la cronologia come registro applicativo locale, non come audit immutabile. Per audit probatorio serve un sistema remoto fidato, autenticato, con integrità e retention definite.

### SEC-04 — Il bridge cross-tab è solo invalidazione best-effort
**Gravità: media, mitigazione già documentata.**

I messaggi BroadcastChannel contengono senderId e sequence e scartano replay semplici, ma tali campi sono falsificabili da codice nella stessa origine. Un test browser sintetico dimostra che un senderId inventato può provocare l'invalidazione della sessione ricevente. Il bridge non è autenticazione né confine di sicurezza.

**Azione richiesta:** mantenerlo come meccanismo di coordinamento UX; non usarlo per autorizzare operazioni o dimostrare logout globale. Il backend dovrà imporre autonomamente i permessi.

### SEC-05 — Lifecycle e cleanup riducono le operazioni obsolete, ma non revocano codice ostile
**Gravità: media.**

Generazioni, abort delle transazioni e disposable registrati mitigano callback tardive e cambi account concorrenti. Un test aggiuntivo ha riprodotto la registrazione di un disposable durante un cleanup asincrono; il coordinatore ora drena anche le risorse registrate durante il teardown. Non protegge da XSS, manipolazione diretta dello storage o codice che conserva riferimenti e ignora il lifecycle.

**Azione richiesta:** ogni vista deve registrare cleanup appena crea risorse; i servizi futuri dovranno verificare l'autorizzazione al momento dell'operazione, non affidarsi solo al controllo della vista.

## Controlli positivi osservati

- Il contesto account rifiuta identità remote non verificabili.
- I repository usano query account-scoped e revisioni ottimistiche.
- Le mutazioni di entità supportate e i relativi eventi sono scritti nella stessa transazione IndexedDB.
- I campi strutturali riservati non possono essere sovrascritti attraverso `BaseRepository`.
- La cronologia espone una API senza update/delete.
- Il fixture demo usa dati sintetici, database temporaneo e nessuna richiesta esterna.
- Le regole Firestore e il runtime Firebase operativo non sono parte di questa integrazione.

## Verifiche CI e corrispondenza dei commit

Gli aggiornamenti documentali successivi non modificano il codice eseguito da queste suite. Le ultime esecuzioni verificate sono:

- **Firebase Rules Emulator** sul commit `b804cd2d50b9642612191a6bf9cb2492bc484044`: [workflow 45465935709](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465935709) — success. Il job `firestore-rules-emulator` ha completato tutti gli step, inclusa l'esecuzione dei test nell'emulatore locale.
- **Browser IndexedDB sull'ultimo commit con modifiche al codice** `1563262904f191a73ca60d71796820dae0bc5347`: [workflow 45465628030](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45465628030) — success. Il successivo commit `b804cd2` modifica soltanto documentazione; non attribuiamo quindi questa esecuzione browser al suo SHA.

Questi workflow verificano le rispettive suite automatizzate nei commit specificati; non sono un penetration test, non certificano l'autenticazione/autorizzazione reale e non attestano l'integrazione nell'app operativa.

## Gate obbligatori prima dell'uso reale

1. Threat model e classificazione dei dati, inclusi XSS, accesso fisico al dispositivo, backup e profili browser condivisi.
2. Adapter di autenticazione verificabile e autorizzazione server-side; test negativi per UID/accountId arbitrari.
3. Decisione architetturale sulla persistenza: quali dati possono stare in IndexedDB, cifratura e ciclo di vita delle chiavi, cancellazione e recovery.
4. Audit remoto con integrità, retention e controllo accessi, se richiesto dal requisito normativo/operativo.
5. Revisione indipendente del codice e test di sicurezza mirati, inclusi manipolazione diretta IndexedDB, messaggi cross-tab falsificati, XSS e race durante teardown.
6. Piano esplicito di migrazione/backup e test di ripristino; nessuna importazione automatica delle fonti legacy concorrenti.
7. Approvazione esplicita prima di qualsiasi modifica a entrypoint, UI Firebase, Firestore Rules o dati reali.

## Decisione

**Mantenere la PR in bozza e il core in ambiente sintetico.** Nessun merge, deploy, collegamento a `index.html`, importazione o sincronizzazione di dati reali è autorizzato da questa revisione.


## Aggiornamento evidenze CI — 24 novembre 2026

La PR #1 è stata ricontrollata sul commit `9e635e2b0718ee3bdad050de88083d440f768ff8`. Le due esecuzioni seguenti hanno checkout esplicito dello stesso SHA:

- **Browser IndexedDB / Playwright:** [workflow 45485825286](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45485825286) — **89 superati, 0 falliti**. Il log include AUTH-005 per l'invalidazione delle letture e l'abort delle scritture pendenti; la verifica aggiornata osserva anche l'abort delle transazioni readonly.
- **Firestore Rules Emulator:** [workflow 45485825297](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45485825297) — **38 superati, 0 falliti, 0 saltati**.

Questi risultati attestano soltanto le suite automatizzate eseguite con fixture e ambiente emulatoriale. Non attestano un adapter Firebase DSM, l'autenticazione o autorizzazione di utenti reali, l'integrazione operativa, né una certificazione di sicurezza.

La PR #1 risulta aperta, in draft e non unita al momento dell'aggiornamento. Il suo HEAD verificato è `9e635e2b0718ee3bdad050de88083d440f768ff8`. Il core resta isolato: nessun collegamento a `index.html`, nessuna modifica al runtime Firebase o alle Firestore Rules, nessuna importazione/sincronizzazione di dati reali. I rilievi SEC-01–SEC-05 e tutti i gate obbligatori sopra restano invariati; il superamento CI non li chiude.


## Aggiornamento revisione e CI — 26 novembre 2026

La verifica è stata ripetuta sul branch `dsm-enterprise/core-v1`, HEAD `81bcb9d0cf0ad2eff584854af6bee1c51591e980`; la PR #1 è aperta, Draft e non unita.

- **Browser IndexedDB / Playwright:** [workflow 45764015583](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45764015583) — success; 97 test superati, 0 falliti, incluso AUTH-008.
- **Firestore Rules Emulator:** [workflow 45764015688](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45764015688) — success; 38 test superati, 0 falliti.
- **Backend Auth/Functions/Firestore Emulator:** [workflow 45712537972](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45712537972) — success; 63 test superati, 0 falliti e 0 saltati sul commit `f1974e7214ef2205bbf2804ce891c7dbd310637e`. Il confronto Git tra quel commit e l'HEAD corrente mostra che nessun file `functions/**` è cambiato nell'intervallo; il risultato è quindi applicabile al codice backend attuale, ma il workflow non ha eseguito un checkout dell'HEAD corrente.

La suite backend include il test emulatoriale del callable `resolveAuthorization`: verifica bearer mancante/malformato, email non verificata, selettore malformato, membership assente/inattiva, utente disabilitato e token revocato. La membership viene letta dal percorso server-owned `accounts/{accountId}/members/{uid}`; il callable usa Firebase Admin e non dipende dalle regole Firestore client per tale lettura.

Questi risultati sono test automatizzati su emulatori e dati sintetici, non un test di penetrazione né una verifica di integrazione end-to-end con l'app operativa. Restano bloccanti l'assenza di API dati DSM protette, l'integrazione dell'adapter nella sessione DSM, la protezione dei dati IndexedDB, il ciclo di vita delle chiavi e un audit remoto con integrità, ove richiesto. Mantenere la PR in bozza; non usare dati reali e non collegare il core all'entrypoint operativo.
