# Registro modifiche DSM — modello A e audit autorizzativo

## Stato

- Repository: `Gionzeli/TURNIGPG-SICUREZZA`
- Branch di lavoro: `dsm-enterprise/core-v1`
- PR: #1, aperta e Draft verso `main`
- Perimetro: solo codice backend isolato, documentazione e test sintetici
- Esclusioni: dati reali, credenziali, Firebase Rules operative, migrazioni, deploy e modifiche a `main`

## 2026-11-26 — Approvazione e implementazione isolata del modello A

**Decisione approvata:** binding backend-owned separato UID Firebase → profilo dipendente, logicamente collocato sotto `accounts/{accountId}/employeeBindings/{uid}`.

**Moduli aggiunti**

- `functions/src/membership/employee-binding.js`: validazione binding, risoluzione dell'unico profilo associato al membro autenticato attraverso loader fidati; fail-closed su mismatch, stati non attivi, profilo non canonico, ruolo non ammesso o errori di lettura.
- `functions/test/employee-binding.test.js`: test sintetici positivi e negativi per binding, identità, account, stato/revisione, profilo e fallimenti dei loader.
- `docs/dsm-employee-identity-linkage-decision.md`: decisione A registrata e limiti della prima implementazione esplicitati.

**Sicurezza e limiti**

- Il modulo non legge direttamente Firestore e non è collegato a un callable endpoint.
- Il client non può fornire un `profileId` per scegliere un altro dipendente.
- La verifica del profilo richiede un loader backend fidato che confermi account, ID e stato attivo.
- Non esiste ancora una fonte profilo canonica server-side: i profili attuali restano in IndexedDB. Perciò nessun loader concreto, endpoint protetto, provisioning, migrazione o modifica delle Rules è incluso.
- La policy è limitata a `member` con `dsm:read:own-scope`; manager/admin restano su flussi distinti.

**Test**

- Test sintetici aggiunti al runner Node `node --test`.
- Esecuzione effettiva: da verificare tramite workflow CI sul commit aggiornato; non dichiarare i test superati prima del risultato.

**Commit / verifica**

- Commit precedente: `b7f6c8ecc7999f2b19566154a84b789eef7b5a80`.
- Commit della correzione: da registrare dopo la creazione e verifica GitHub.
- Deploy: non eseguito.

## Registro audit aperto

1. Definire e approvare la fonte canonica backend dei profili prima di creare loader reali.
2. Specificare provisioning, prova di corrispondenza persona/profilo, revoca, riassegnazione e audit append-only.
3. Decidere cardinalità e comportamento multi-account/recupero identità.
4. Associare shifts e absences al profilo canonico e applicare controllo individuale a ogni endpoint.
5. Separare DTO e permessi per dati retributivi e categoria sanitaria delle assenze.
6. Allineare membership e Firestore Rules solo dopo revisione dedicata e test emulator.
7. Eseguire e archiviare l'esito CI del commit preciso.
