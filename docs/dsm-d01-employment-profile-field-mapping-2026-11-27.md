# D-01 — verifica di mapping dei campi del profilo lavorativo

**Data:** 2026-11-27  
**Tipo:** verifica tecnica e proposta di mapping; non è una nuova approvazione di schema o storage.  
**Branch autorizzato:** `codex/employee-shift-date-range-query`  
**Ambito:** esclusivamente i campi semantici già approvati in D-01 per la lettura del proprio profilo.  
**Esclusioni:** nessuna callable/API, migrazione, sincronizzazione, scrittura su Firebase reale, cache offline o integrazione con l'app operativa.

## 1. Esito

La verifica del codice legacy consente di identificare i nomi e alcuni vocabolari dei cinque campi contrattuali, ma **non** consente di trattare il profilo locale come fonte canonica né di trasferire automaticamente i suoi valori nel backend.

Il backend attuale crea `accounts/{accountId}/employees/{employeeId}` con i soli campi identificativi minimi:
`accountId`, `employeeId`, `status`, `revision`, timestamp e riferimenti di audit.
Non contiene nome, CCNL, sezione, livello, mansione o decorrenza.

Il binding UID↔Employee risolve l'identità e non restituisce i campi del documento Employee. Il test Emulator aggiunto sul commit `c2b8a6742742c47729c89dc8e605855c7f77eb06` verifica esplicitamente che il resolver non esponga campi di profilo, retribuzione, IBAN o assenza.

**Conclusione:** il mapping semantico è sufficientemente chiaro per una proposta di DTO, ma non è ancora sufficiente per implementare un endpoint sicuro. Restano da approvare la collocazione fisica del documento del profilo lavorativo, la provenienza dei valori e il campo minimo d'identità.

## 2. Mapping semantico proposto

| Campo D-01 | Campo legacy | Tipo/candidato | Vincoli osservabili o proposti | Esito |
|---|---|---|---|---|
| CCNL | `profile.ccnl` | stringa codice | Il client attuale propone `HV17`; valori sconosciuti o vuoti non devono essere interpretati come un CCNL valido | Mappabile, vocabolario canonico da confermare |
| Sezione | `profile.section` | enum stringa | `vigilanza_armata`, `servizi_sicurezza`, `servizi_fiduciari`; la UI la considera valida solo con CCNL HV17 | Mappabile, relazione enum da confermare |
| Livello | `profile.level` | stringa | Testo libero; nessun enum canonico o normalizzazione affidabile rilevata | Non normalizzare né inferire |
| Mansione/ruolo operativo | `profile.role` | stringa | Testo libero; non equivale automaticamente a ruolo di autorizzazione DSM | Non usare mai per autorizzare |
| Decorrenza | `profile.effective_date` | data ISO `YYYY-MM-DD` o null | Facoltativa nella UI; non deve essere inventata se assente | Mappabile come data facoltativa, semantica temporale da confermare |

La UI legacy salva questi valori localmente nel browser. La sua validazione e i suoi valori predefiniti sono dettagli d'interfaccia, non validazione server-side né prova di veridicità contrattuale.

## 3. Campi che restano esclusi

Non devono essere copiati nel DTO D-01:
- parametri retributivi, paga base, scatti, straordinari, indennità e maggiorazioni;
- trattenute, INPS, IRPEF, cessione del quinto e altre voci payroll;
- alias personalizzati delle voci di cedolino;
- IBAN, coordinate o strumenti di pagamento;
- dati di assenza, motivi, categorie sanitarie, note o documenti;
- skill, attestati e documenti, finché non esiste un mapping e una policy separati.

I campi `level` e `role` sono oggi testo libero. Prima di esporli devono essere limitati in lunghezza, rifiutare contenuti non conformi e non essere interpretati come permessi, ruoli IAM o qualifiche verificate.

## 4. Identità minima: gap esplicito

D-01 include semanticamente i campi minimi necessari a identificare il record Employee collegato. Il documento Employee attuale non ha un nome o display label. Non è sicuro:
- dedurre il nome dal nome visualizzato Firebase;
- copiare il nome da una richiesta d'invito o registrazione;
- usare email, telefono o UID come etichetta del profilo lavorativo;
- restituire altri dati personali solo per riempire la sezione identità.

Quindi l'ID Employee opaco può identificare tecnicamente il record, ma non è ancora definito un campo nominativo da mostrare. Il nome/display label richiede una fonte canonica e una decisione su accesso, accuratezza e retention.

## 5. Contratto DTO candidato

Dopo approvazione dello schema fisico e della provenienza dei dati, la risposta self-service dovrebbe avere forma esplicita e chiusa, senza passthrough Firestore:

```js
{
  employeeId: "opaque-canonical-id",
  employmentProfile: {
    ccnl: "HV17",
    section: "vigilanza_armata",
    level: "4",
    role: "Guardia particolare giurata",
    effectiveDate: "2026-09-01"
  }
}
```

L'esempio è interamente sintetico e illustra solo la forma del DTO. I valori non sono dati reali né un default da applicare. I campi non disponibili devono essere `null` o omessi secondo un contratto unico da definire; non vanno ricostruiti dal browser o da documenti payroll.

## 6. Gate necessari prima del codice runtime

1. Approvare un percorso Firestore distinto dal documento identitario Employee, con proprietario e schema versionato.
2. Definire la provenienza autorizzata dei cinque campi e la procedura manuale di inserimento/verifica; nessuna importazione automatica da LocalStorage.
3. Definire se `effectiveDate` vale per l'intero profilo o per ciascun termine contrattuale, e come rappresentare variazioni nel tempo. D-01 non approva storico o accesso storico.
4. Definire se il DTO include solo `employeeId` o anche un display label canonico. Non inventare un nome.
5. Introdurre una permission self dedicata, distinta da `dsm:read:own-scope`, e concederla solo al member secondo la policy approvata.
6. Implementare loader server-side che ricavino UID dal token verificato, risolvano binding attivo, ricontrollino account/Employee lifecycle e leggano solo i campi allowlist.
7. Test Emulator negativi per UID non associato, binding revocato/incoerente, Employee/account inattivi, campi extra, payload malformati e tentativi di leggere un altro Employee.
8. Verificare che la callable non restituisca mai documenti grezzi e che non vi siano scritture client dirette.

## 7. Stato implementativo

- D-01 policy semantica: approvata.
- Campi legacy identificati: sì, ma solo come riferimenti di mapping, non come fonte canonica.
- Schema fisico del profilo lavorativo: non approvato.
- Provenienza e verifica dei valori: non approvate.
- Permission dedicata e callable self profile: non implementate.
- Migrazione/sincronizzazione legacy: non autorizzata.
- Produzione e Firebase reale: non coinvolti.

Questo documento restringe il lavoro successivo: il prossimo cambiamento runtime potrà iniziare solo dopo la decisione sui gate 1–4. Non è una certificazione di sicurezza né un'autorizzazione al deploy.
