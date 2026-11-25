# DSM Lifecycle Coordinator — specifica e stato implementativo

## Goal
Make account changes/logout a UI and operation lifecycle boundary. Il coordinatore e alcuni punti d'integrazione sono implementati nel branch DSM; restano limiti espliciti e non costituiscono un controllo di autenticazione/autorizzazione.

## Stato implementato nel branch

- `createAccountLifecycleCoordinator()` gestisce stati `switching/active/cleared`, generazione, token opaco di transizione, listener e cleanup retry.
- `BaseRepository` può ricevere il coordinatore: cattura account/generazione, invalida risultati stale e registra le transazioni di scrittura per abort best-effort.
- `createDSMCoreSession()` costruisce un unico contesto/coordinatore condiviso da repository e servizi; espone switch, logout e retry.
- `createAccountLifecycleCrossTabBridge()` è opzionale e trasmette solo invalidazioni minimali. Richiede canale e `tabId` espliciti.
- `mountHistoryPage()` accetta facoltativamente il coordinatore, cattura la generazione, si sottoscrive e distrugge listener/DOM su `transition-start` o `context-cleared`.
- I test browser coprono invalidazione repository, session factory, retry cleanup, bridge sintetico e `BroadcastChannel` reale tra due pagine Playwright.

## Limiti attuali

- La protezione UI è collegata alla pagina cronologia solo quando il chiamante passa `lifecycleCoordinator`; non esiste un composition root che garantisca il wiring per ogni vista.
- Le transazioni IndexedDB sono abortite best-effort; una scrittura già completata prima della transizione non può essere annullata retroattivamente.
- Il bridge cross-tab non è persistente: schede sospese/offline o aperte dopo il messaggio possono non ricevere l'invalidazione.
- `tabId` deve essere univoco per scheda; il canale e la riattivazione restano responsabilità del chiamante.
- Il coordinatore è per correttezza del lifecycle, non autenticazione o autorizzazione; non protegge da codice malevolo same-origin.
- IndexedDB resta non cifrato e i dati persistenti non vengono cancellati dal logout.

## Required invariants
1. Every activation/clear/switch increments a monotonically increasing context generation.
2. Transition start publishes a non-active state and synchronously asks subscribers to clear rendered data and caches.
3. Repository operations may capture `{accountId, generation}`; results are renderable only if the generation is still current and the context is active.
4. New operations are denied while a transition is in progress.
5. Old connections/repositories are retired after views have cleared; fresh instances are constructed after the new context is active.
6. Cross-tab coordination is a separate requirement and cannot be implied by a per-tab coordinator.

## API implementata (sintesi del contratto effettivo)
- `beginTransition(reason)`: passa a `switching`, incrementa la generazione, svuota il contesto e notifica i listener; restituisce un token opaco.
- `activateLocal(token, accountId)`: accetta solo il token corrente e una pulizia completata; attiva esclusivamente un contesto locale/demo.
- `clear(token)`: completa il logout del contesto soltanto dopo la pulizia.
- `capture()` / `isCurrent(capture)`: acquisiscono e verificano account e generazione per scartare risultati obsoleti.
- `subscribe(listener)`: restituisce una funzione unsubscribe; i listener UI devono rimuovere dati visibili su `transition-start`.
- `registerDisposable(dispose)`: registra callback di pulizia; gli errori impediscono la riattivazione finché `retryCleanup(token)` non completa.
- La session factory espone `switchLocalAccount()`, `logout()`, `resumePendingTransition()` e `dispose()`. `dispose()` è terminale: invalida il contesto, impedisce nuove attivazioni, dismette listener/bridge e consente soltanto retry della pulizia se incompleta.

## Ordering for account switch
1. Start transition and increment generation (old async results become stale immediately).
2. Notify UI listeners synchronously; clear visible records, selections, search results, and cached DTOs.
3. Best-effort abort registered cancellable transactions; do not promise IndexedDB rollback after completion.
4. Close old DB connection and dispose registered resources.
5. Activate new local context, create fresh repositories, load data.
6. Render async results only after checking `isCurrent(capture)`.

## Error and failure policy
- If cleanup fails, remain non-active and require explicit recovery; do not activate another account while old resources are uncertain.
- A stale result is silently discarded by presentation layer (optional generic diagnostics only).
- Listener failures must not prevent other listeners from clearing. Collect generic failure indicators without logging record content or account IDs.
- Clear/logout must never be represented as secure deletion of IndexedDB.

## Test matrix (synthetic fixtures only)
- Generation invalidates stale read: capture A, switch to B, `isCurrent(A)` false.
- Logout invalidates: capture, clear, stale result blocked.
- UI listener immediately clears cached view model on transition.
- Subscriber throws: remaining subscribers still receive transition notification; coordinator remains blocked until recovery.
- Dispose callbacks run and are idempotent; failure blocks activation.
- Old repository connection is not reused after lifecycle transition.
- Read begun under A resolves after B activation: result must be discarded before render.
- Cross-tab note: confirm no security claim without explicit coordination and tests.

## Stato della sequenza di implementazione

- **Completato:** coordinatore isolato e test; hook di generazione nei repository; session factory DSM; test browser per risultati tardivi, cambio account e cleanup retry.
- **Parziale:** wiring UI della cronologia soltanto se il chiamante passa esplicitamente `lifecycleCoordinator`.
- **Completato con limiti:** bridge cross-tab opzionale e test BroadcastChannel reale; non è una garanzia persistente per schede sospese/offline o aperte dopo la notifica.
- **Ancora aperto:** composition root DSM e wiring obbligatorio delle future viste. Non esiste integrazione con `index.html` né con la UI Firebase operativa; tale integrazione resta fuori perimetro.

## Security note
This coordinator only protects application lifecycle correctness. Client-side account contexts are not authentication, and generation tokens do not protect against same-origin malicious scripts. IndexedDB is currently unencrypted; do not use operational or sensitive data.

## Nota di verifica — transazioni readonly dei repository

Revisione del 24 novembre 2026 sul branch `dsm-enterprise/core-v1`:

- `BaseRepository.create()`, `update()` e `delete()` registrano le rispettive transazioni tramite `_trackTransaction()`; il cleanup tenta `abortTransaction()` e la Promise dell'operazione si risolve con errore se la transazione viene abortita.
- `BaseRepository.getById()` e `getAll()` creano transazioni `readonly` ma non chiamano `_trackTransaction()`. Attendono la conclusione IndexedDB e poi chiamano `_assertLifecycleCurrent()`; se la generazione è cambiata, il risultato viene rifiutato al chiamante.
- Di conseguenza, il contratto attualmente verificato per le letture è **invalidazione/scarto del risultato obsoleto**, non abort della transazione readonly durante il cleanup.
- AUTH-005 avvia letture pendenti e verifica che vengano rifiutate dopo la transizione. Non osserva direttamente l'evento `abort` delle transazioni readonly e non va descritto come prova di tale abort.

Un eventuale miglioramento futuro può registrare anche le transazioni readonly come disposable. Prima di adottarlo, i test sintetici dovranno verificare separatamente: abort effettivo quando la lettura è ancora attiva; gestione senza errore quando la transazione è già completata; rifiuto del risultato se la generazione cambia; nessun risultato o dato dell'account A consegnato dopo l'attivazione di B. Questa revisione è documentale: non modifica il runtime né amplia l'autorizzazione a intervenire su Firebase, UI operativa o entrypoint.


## Contratto di dismissione definitiva della sessione (2026-11-25)

- `session.dispose()` è asincrono, idempotente e terminale. Porta il lifecycle allo stato `disposed`; non è un semplice unsubscribe né un alias del logout reversibile.
- Il contesto viene invalidato e marcato come dismesso prima di attendere il cleanup. Anche i riferimenti già ottenuti a `accountContext`, `lifecycle`, repository e servizi non possono riattivare o usare la sessione.
- La sottoscrizione Firebase viene rimossa e il bridge cross-tab viene chiuso dopo l'avvio dell'invalidazione locale.
- Se un disposable fallisce, `dispose()` rifiuta la Promise e il lifecycle resta non attivo in `switching`. Non sono consentite nuove attivazioni; `dispose()` ripetuto o `resumePendingTransition()` riprovano esclusivamente il cleanup e finalizzano lo stato `disposed`.
- La dismissione non cancella IndexedDB e non equivale a cancellazione sicura dei dati persistenti. La garanzia riguarda il lifecycle della sessione e le risorse registrate.