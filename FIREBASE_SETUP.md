# Firebase — Turni GPG/sicurezza

Il progetto Firebase Web è già configurato in `firebase-config.js` per il progetto `turnigpg-sicurezza`. La PWA usa Firebase soltanto per autenticazione e gestione delle autorizzazioni dei collaboratori.

## Servizi utilizzati

1. Firebase Authentication con email/password e verifica dell'indirizzo.
2. Firestore per richieste di accesso, autorizzazioni, date di inizio/fine e notifiche amministrative.
3. L'amministratore `zelanogianfranco@gmail.com` approva o sospende i collaboratori e stabilisce il periodo di validità.

## Dati che non devono essere caricati su Firebase

Turni, buste paga, parametri economici, documenti, profilo locale e backup restano sul dispositivo. La PWA non deve chiamare funzioni di sincronizzazione per questi dati e non deve usare la raccolta `privateData`.

Le regole presenti in `firestore.rules` negano ogni accesso a `privateData/{uid}`. Le regole nel repository non vengono pubblicate automaticamente da GitHub Pages: devono corrispondere alle regole attive nella Console Firebase.

## Controllo prima di invitare collaboratori

- In Firebase Authentication, verificare che il metodo Email/Password sia abilitato.
- In Authentication > Settings > Authorized domains, verificare il dominio GitHub Pages.
- In Firestore > Rules, verificare che siano pubblicate le regole del file `firestore.rules`.
- Provare registrazione, email di verifica, login, richiesta, approvazione, sospensione e scadenza.
- Verificare che turni e cedolini non vengano creati o letti in Firestore.

Non attivare procedure di migrazione o sincronizzazione dei dati lavorativi.
