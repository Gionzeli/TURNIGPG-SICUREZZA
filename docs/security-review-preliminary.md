# DSM Core — revisione tecnica preliminare di sicurezza

Data: 2026-11-24
Riferimento: branch `dsm-enterprise/core-v1`, HEAD verificato `a01cb00f14b87e045be4ee036b1abdd8663625f2`.

## Esito

Il core è adatto a prove locali con dati sintetici e a ulteriore sviluppo isolato. **Non è pronto per gestire dati personali o turni reali, né per essere collegato all'app operativa.** I test automatizzati superati verificano i flussi implementati, ma non trasformano i controlli client-side in autenticazione o autorizzazione.

Questa è una revisione statica preliminare dei moduli elencati, non un penetration test, una verifica indipendente o una certificazione.

## Rilievi

### SEC-01 — Mancano autenticazione e autorizzazione fidate
**Gravità: bloccante prima di qualsiasi dato reale.**

`createDSMCoreSession({ db, accountId })` attiva un contesto locale usando l'ID fornito dal chiamante. `createAccountContext.activate()` accetta intenzionalmente soltanto `identitySource: "local"`; non verifica sessioni, token o principal. Di conseguenza un accountId non dimostra l'identità dell'utente e l'indice `accountId` protegge soltanto l'organizzazione dei record nell'applicazione client.

**Azione richiesta:** progettare un adapter di autenticazione verificato e un modello di autorizzazione prima dell'integrazione. Il principal dovrà provenire da un componente fidato; non accettare UID, flag o timestamp forniti da UI, URL o storage locale.

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

Il HEAD attuale `a01cb00f14b87e045be4ee036b1abdd8663625f2` aggiorna soltanto questa documentazione. Le ultime esecuzioni verificate sono:

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
