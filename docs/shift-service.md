# ShiftService

Il servizio `ShiftService` normalizza e valida i dati dei turni prima di delegare le operazioni a `ShiftRepository`.

## Campi accettati

- `date`: data valida nel formato previsto dal validatore comune.
- `type`: uno tra `turno`, `turno_riposo`, `riposo`, `riposo_compensativo`, `ferie`, `permesso`, `malattia`.
- `post`: stringa facoltativa, massimo 80 caratteri.
- `start_time` e `end_time`: orari `HH:MM`; devono essere entrambi presenti oppure entrambi vuoti. Se presenti non possono coincidere.
- `hours`: numero finito compreso tra 0 e 48.
- `is_night`, `is_sunday`, `is_piantonato`, `is_rest_not_enjoyed`, `has_meal_voucher`: valori booleani.

I campi non riconosciuti sono rifiutati. I valori facoltativi omessi ricevono i valori predefiniti definiti dal servizio.

## Intervalli notturni

Gli orari che attraversano la mezzanotte, ad esempio 22:00–06:00, sono ammessi. Il servizio non deduce automaticamente la durata retribuita dall'intervallo: pause, regole contrattuali e tipologie speciali possono produrre ore diverse. Il campo `hours` resta un valore esplicito validato nell'intervallo 0–48.

## Aggiornamenti e concorrenza

Gli aggiornamenti e le cancellazioni richiedono `expectedRevision`. Un aggiornamento rilegge il record corrente, applica la patch e convalida l'oggetto completo prima della scrittura. Le revisioni obsolete sono rifiutate dal repository.

## Limiti

Queste verifiche garantiscono la forma e i limiti tecnici dei dati, non la correttezza rispetto a un contratto collettivo, a un regolamento aziendale o a un calcolo paghe. Non sono implementate qui regole automatiche su pause, straordinari, riposi minimi o maggiorazioni.
