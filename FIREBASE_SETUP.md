# Integrazione Firebase — Turni GPG

Questa è la base tecnica dell'integrazione; **non è ancora attiva nell'interfaccia della PWA**. La versione pubblicata continua a funzionare come prima finché non viene configurato Firebase e completato il collegamento UI.

## Funzioni previste
- Firebase Authentication: email e password, verifica email e recupero password.
- Accesso subordinato ad approvazione: richiesta in `accessRequests/{uid}`, autorizzazione amministrativa in `members/{uid}`.
- Dati personali isolati in `privateData/{uid}`.
- Notifiche interne in `notifications/{uid}/items/{notificationId}`; nessun Firebase Cloud Messaging e nessuna push.
- Amministratore: `zelanogianfranco@gmail.com`, con email verificata.

## Configurazione una tantum
1. Creare un progetto Firebase e registrare un'app Web.
2. Abilitare Authentication > Email/Password e il controllo di verifica email.
3. Creare Firestore Database.
4. Copiare `firebase-config.example.js` in `firebase-config.js` e sostituire i tre valori con quelli dell'app Web. Il file di configurazione Web contiene identificatori pubblici, non password o chiavi private.
5. Pubblicare `firestore.rules` in Firestore > Rules.
6. Aggiungere il dominio GitHub Pages in Authentication > Settings > Authorized domains.

## Modello dati
- `accessRequests/{uid}`: richiesta e stato della registrazione.
- `members/{uid}`: stato approvato, date di inizio/fine e nome.
- `privateData/{uid}`: parametri e turni del singolo utente.
- `notifications/{uid}/items/{id}`: avvisi interni destinati a un singolo utente.

## Attenzione prima di attivare
- Non inserire chiavi Admin SDK, service account o password nel repository.
- La regola amministrativa usa l'indirizzo email verificato; proteggere quindi l'accesso a quella casella con autenticazione a due fattori.
- La PWA attuale usa localStorage per i dati. Il passaggio a `privateData/{uid}` richiede una migrazione esplicita e verificata per non sovrascrivere i dati locali. Non cancellare il vecchio archivio.
- L'interfaccia di registrazione/login, la verifica dello stato membro, il salvataggio cloud e il ripristino locale/cloud devono essere collegati e testati prima di distribuire l'accesso obbligatorio.
- Le notifiche sono in-app e si leggono quando l'app è aperta; non vengono inviate notifiche push al telefono.
