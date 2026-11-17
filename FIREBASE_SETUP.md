# Attivazione Firebase — Turni GPG/sicurezza

L'interfaccia Firebase è collegata alla PWA, ma resta disattivata finché non configuri il progetto. La modalità locale continua a funzionare nel frattempo.

1. Crea un progetto nella Console Firebase e registra un'app Web.
2. Attiva Authentication > Email/Password e crea Firestore.
3. Inserisci apiKey, authDomain, projectId e appId in `firebase-config.js`; imposta `enabled: true` solo dopo aver pubblicato le regole.
4. Pubblica `firestore.rules` in Firestore > Rules.
5. Aggiungi il dominio GitHub Pages in Authentication > Settings > Authorized domains.
6. Verifica registrazione, verifica email, login, approvazione, notifiche, recupero password e migrazione prima di invitare collaboratori.

Amministratore: `zelanogianfranco@gmail.com` (email verificata). Non inserire password o chiavi private nel repository.

## Migrazione e isolamento

Dopo l'approvazione, turni e parametri vengono salvati in un documento privato associato all'UID Firebase. Al primo accesso viene chiesto esplicitamente se importare l'archivio locale precedente; il vecchio archivio non viene cancellato. Se esistono dati locali personali e dati cloud, viene chiesto quale versione usare. I dati del profilo/PIN vengono separati per account sul dispositivo; il vecchio archivio resta intatto.

## Ancora necessario

Il progetto Firebase non è stato creato nel tuo account Google. Devi completare i passaggi della Console e inserire la configurazione dell'app Web. Finché `enabled: false`, la PWA resta in modalità locale e non avvia l'autenticazione cloud.
