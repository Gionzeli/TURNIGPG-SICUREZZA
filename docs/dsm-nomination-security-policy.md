# Policy di sicurezza per nomination amministrative DSM

**Decisione:** approvata dal responsabile del repository nel commento [DSM-NOMINATION-POLICY-APPROVED-2026-11-25](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/pull/1#issuecomment-7155584340), 25 novembre 2026.

**Ambito:** prototipo isolato di nomination amministrativa. Questa decisione definisce i requisiti del prototipo; non autorizza callable, frontend, deployment, collegamento all'app operativa o uso con dati reali.

## Policy vincolante

1. **Scadenza:** massimo 24 ore. Il server calcola `expiresAt = createdAt + 24h` con il proprio clock fidato. Il client non fornisce né estende la deadline. Rifiutare clock/timestamp non sicuri, overflow, deadline già trascorse e nomination scadute in approvazione.
2. **Autenticazione recente:** per il proponente al momento della proposta e per l'approvatore al momento dell'approvazione, verificare `auth_time` del Firebase ID token dopo `verifyIdToken(token, true)`. Il timestamp deve essere valido, non futuro e non più vecchio di 300 secondi rispetto al clock server. `iat` e `expiresIn` non sostituiscono `auth_time`.
3. **MFA:** obbligatoria per entrambi. Accettare esclusivamente `firebase.sign_in_second_factor === "totp"`. SMS/phone non è un fallback ammesso. Claim assente, sconosciuto o non verificabile comporta rifiuto fail-closed. Applicare lo stesso gate alla cancellazione.
4. **Separazione:** il gate privilegiato di recent-auth/MFA resta specifico alle nomination e non diventa requisito globale per `verifyIdentity` o `resolveAuthorization`.
5. **Nessuna esposizione:** la policy non abilita callable nomination, frontend o deployment. Nessuna modifica a Firebase operativo, root Firestore Rules, entrypoint operativo o `main`.

## Verifica del codice presente sul branch

Riferimento ispezionato: branch `dsm-enterprise/core-v1`, HEAD `d2185599af1f25919c675e6b76ac4ceb2d77ec4d`.

- `functions/src/auth/verify-identity.js` esegue la verifica token con il verifier iniettato dal chiamante e restituisce UID, email verificata, `auth_time` (solo intero sicuro) e `firebase.sign_in_second_factor`.
- `functions/src/membership/nomination-service.js` applica un gate comune a create/approve/cancel: identità corrispondente all'attore, email verificata, `auth_time` non futuro e non più vecchio di 300 secondi, fattore esattamente `totp`, clock server intero sicuro e membership admin attiva.
- La creazione calcola la deadline dal clock del servizio e verifica l'assenza di overflow. L'approvazione verifica che la deadline memorizzata coincida esattamente con `createdAt + 24h` e non sia trascorsa.
- `functions/src/membership/nomination-callable-handlers.js` ricava l'attore dal bearer token e richiede la verifica revocation-aware. Gli handler sono deliberatamente non collegati a `onCall`.
- `functions/src/index.js` non esporta handler nomination: le callable esposte restano `health` e `resolveAuthorization`.

## Evidenza e lacune di verifica

- I test unitari di `nomination-service` verificano recent-auth, timestamp futuri, fattore phone/sconosciuto/assente, scadenza, clock non valido e assenza di scritture nei casi negativi.
- I test di `nomination-callable-handlers` usano verifier e servizi mockati: verificano derivazione dell'attore e controllo revoca, ma non costituiscono un test Auth/Functions end-to-end.
- `membership-emulator.integration.test.js` esercita i servizi direttamente con Firestore Emulator e identità sintetiche; non verifica il claim MFA emesso dall'Auth Emulator.
- La documentazione Firebase Admin descrive `DecodedIdToken.auth_time` e il claim opzionale `firebase.sign_in_second_factor`, il cui factor ID è quello del secondo fattore usato per il login: https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.decodedidtoken
- La documentazione Auth Emulator descrive i flussi MFA SMS: https://firebase.google.com/docs/emulator-suite/connect_auth . Non abbiamo evidenza nel repository che un flusso TOTP reale/emulato produca il claim atteso e lo renda verificabile tramite la versione Admin SDK effettivamente installata.

**Gate ancora aperto:** prima di esporre una callable nomination, dimostrare con un test d'integrazione server-side supportato che un accesso MFA TOTP produce `firebase.sign_in_second_factor === "totp"` nel risultato di `verifyIdToken(..., true)`. Se questo non è dimostrabile nel contesto supportato, mantenere il flusso bloccato; non degradare a SMS e non simulare la prova con un mock.

## Stato operativo

- Nessuna callable nomination esposta.
- Nessun collegamento frontend o app operativa.
- Nessun deploy o accesso a dati reali.
- Nessuna modifica a `main`, root Firestore Rules o configurazione Firebase operativa.
- La PR resta aperta e Draft fino a revisione tecnica e sicurezza.
