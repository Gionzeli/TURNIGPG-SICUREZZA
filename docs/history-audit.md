# Cronologia DSM: consultazione e limiti

## Stato

Il nucleo DSM registra automaticamente gli eventi di creazione, modifica e cancellazione per:
- turni (`shifts`);
- profili (`profiles`);
- impostazioni (`settings`).

La registrazione avviene nella stessa transazione IndexedDB della modifica: se la modifica viene annullata, anche l'evento storico viene annullato.

## Consultazione dal codice

Il livello repository consente:
- `getEvents()`: eventi dell'account attivo in ordine cronologico;
- `getEventsForEntity(entityType, entityId)`: eventi di una singola entità;
- `getRecentEvents(limit)`: ultimi eventi, con limite compreso tra 1 e 200.

Il livello servizio `HistoryService` espone:
- `getEventsForEntity(entityType, entityId)`;
- `getRecentEvents(limit)`.

Il servizio trasforma gli eventi in descrizioni leggibili (ad esempio “Profilo creato” e “Turno modificato”) e non restituisce l'identificativo interno dell'entità né il suo contenuto. I risultati sono congelati per evitare modifiche accidentali nell'interfaccia chiamante.

Esempio d'uso:

```js
const historyRepository = new HistoryRepository({ db, accountContext });
const historyService = new HistoryService({ repository: historyRepository });

const recentEvents = await historyService.getRecentEvents(30);
```

L'account deve essere già attivo nel contesto passato al repository. Il repository applica il filtro account per ogni lettura.

## Campi esposti dal servizio

Ogni elemento restituito dal servizio contiene esclusivamente:
- `id`: identificativo dell'evento storico;
- `occurredAt`: data/ora ISO dell'evento;
- `entityLabel`: categoria leggibile;
- `actionLabel`: operazione leggibile;
- `description`: descrizione sintetica;
- `revision`, `previousRevision`, `newRevision`: metadati di revisione.

Non vengono restituiti nomi, importi, orari dei turni, contenuti dei profili, impostazioni o payload grezzi.

## Limiti e garanzie

- Lo storico contiene metadati, non copie dei record precedenti.
- Non è quindi possibile annullare o ripristinare una modifica usando soltanto questi eventi.
- Non è ancora presente una schermata utente collegata a questo servizio.
- Il blocco di update/delete del repository è una protezione applicativa, non una garanzia crittografica contro modifiche dirette a IndexedDB.
- L'isolamento tramite accountContext è un controllo lato client, non autenticazione forte né cifratura.
- IndexedDB DSM non è cifrato da questo componente.
- Non usare lo storico come unico sistema di audit immutabile o come backup.

## Regole per sviluppi successivi

Prima di introdurre ripristino o versioni complete dei record occorre progettare cifratura, gestione delle chiavi, autorizzazioni, conservazione e cancellazione dei dati. Non aggiungere payload originali o dati personali agli eventi storici come scorciatoia.

La documentazione descrive il nucleo DSM separato: non abilita importazione, sincronizzazione, merge o distribuzione e non modifica l'applicazione esistente.
