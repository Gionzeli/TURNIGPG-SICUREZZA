# Turni GPG/sicurezza

App per registrare i turni e stimare la busta paga, per guardie giurate (GPG), sicurezza e portierato.
Si installa sul telefono come una vera app (PWA) e funziona anche senza connessione.
I tuoi dati restano sul tuo dispositivo.

## Pubblicarla su GitHub Pages (gratis)

Serve un account su https://github.com (gratuito). Si può fare anche dal telefono.

1. **Crea il repository**
   - Su GitHub tocca **+** › **New repository**.
   - Nome, per esempio: `turni-gpg`.
   - Scegli **Public** (con l'account gratuito GitHub Pages funziona solo con repository pubblici).
   - Tocca **Create repository**.

2. **Carica i file**
   - Nella pagina del repository tocca **uploading an existing file** (oppure **Add file › Upload files**).
   - Decomprimi lo zip e seleziona **tutti i file** che trovi dentro (sono 19, nessuna sottocartella): `index.html`, `manifest.webmanifest`, `sw.js`, `updates.json`, `favicon.ico`, `README.md` e le icone `.png` e `.svg`.
   - Su computer puoi trascinarli tutti nella pagina; su telefono usa il selettore dei file e scegli tutti i file.
   - Attendi che siano tutti caricati, poi tocca **Commit changes**.
   - **Importante:** `index.html` deve stare nella pagina principale del repository, non dentro una cartella.

3. **Attiva GitHub Pages**
   - Vai in **Settings › Pages**.
   - In **Source** scegli **Deploy from a branch**.
   - In **Branch** scegli `main` e la cartella `/ (root)`, poi tocca **Save**.
   - Dopo 1-2 minuti in alto compare l'indirizzo dell'app:
     `https://IL-TUO-NOME-UTENTE.github.io/turni-gpg/`

4. **Installa l'app sul telefono**
   - **Android (Chrome):** apri l'indirizzo › menu ⋮ › **Installa app**.
   - **iPhone (Safari):** apri l'indirizzo › Condividi › **Aggiungi a Home**.
   - **Computer (Chrome/Edge):** icona di installazione nella barra dell'indirizzo.

5. **Condividila**
   Nell'app apri **Condividi** (menu in alto): c'è il messaggio già pronto con il link, più WhatsApp,
   Telegram, SMS, email, QR code e il menu del telefono. Se hai l'app con accessi su Claude, scrivi lo stesso
   indirizzo nel campo «Indirizzo dell'app autonoma» della pagina Collaboratori.

## Aggiornarla
Quando ti viene preparata una nuova versione:
1. Nel repository tocca **Add file › Upload files** e carica i file nuovi con gli stessi nomi (sostituiscono i vecchi).
2. **Commit changes**. Dopo 1-2 minuti l'aggiornamento è online.
3. Gli utenti lo ricevono da soli alla prima apertura con internet: compare «Nuova versione pronta».
4. Le novità mostrate nella pagina Aggiornamenti si scrivono in `updates.json` (titolo `t`, testo `b`, data `d`).

## Cosa cambia rispetto alla versione dentro Claude
- **Nessun limite di utilizzo** per turni, calcoli, calendario, backup cifrato, PIN e guida.
- **Nessuna registrazione né approvazione dei collaboratori**: ognuno usa l'app sul suo telefono con i suoi dati.
- **Lettura automatica di busta paga e turni**: usa Gemini gratuito di Google. Ognuno crea la sua chiave gratis (senza carta) su
  https://aistudio.google.com/apikey e la incolla in *Busta paga › Lettura automatica*.
  Con il piano gratuito Google può usare i contenuti inviati per migliorare i suoi servizi: se non ti sta bene, inserisci i dati a mano.

## Privacy
Turni, busta paga e impostazioni restano nel browser del telefono. L'app non ha pubblicità né strumenti di tracciamento.
Solo se usi la lettura automatica, il file viene inviato a Google Gemini con la tua chiave.
