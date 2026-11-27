# API

API JSON sotto `/api`. L'interfaccia è in italiano. I codici errore sono stabili e in inglese, così il client può riconoscerli; i messaggi sono in italiano.

## Convenzioni

- Autenticazione: cookie `volontari_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` quando la richiesta è HTTPS.
- Le richieste che modificano dati, se usano il cookie, devono avere `Content-Type: application/json`, l'intestazione `X-Volontari-Request: 1` e un `Origin` uguale all'origine della richiesta.
- Gli identificativi sono UUID. Un id malformato è `400`, non una query.
- Date filtro: istanti ISO-8601, convertiti in millisecondi UTC. Il client mostra `Europe/Rome`.
- Paginazione: `page` da 1, `pageSize` predefinito 20, massimo 50. Risposta: `{ items, page, pageSize, total }`.
- Ordinamento: `sort` da un elenco chiuso e `direction` `asc` oppure `desc`.
- Una risorsa fuori dal perimetro autorizzato risponde `404` con lo stesso corpo di una risorsa assente. `403` si usa quando la persona vede la risorsa ma il ruolo non consente quell'azione.
- Validazione Zod su ogni corpo e su ogni query. I campi non previsti sono rifiutati.

## Errori

```json
{
  "error": {
    "code": "validation_error",
    "message": "Controlla i campi evidenziati.",
    "fields": { "title": "Il titolo è obbligatorio." }
  }
}
```

| HTTP | `code`             | Quando                                                     |
| ---- | ------------------ | ---------------------------------------------------------- |
| 400  | `validation_error` | Payload o query non validi                                 |
| 401  | `unauthenticated`  | Cookie assente, sessione revocata o scaduta                |
| 403  | `forbidden`        | Azione non consentita dentro il proprio perimetro          |
| 403  | `csrf_rejected`    | Origin o intestazione di scrittura assenti                 |
| 404  | `not_found`        | Assente oppure fuori perimetro                             |
| 409  | `conflict`         | Transizione di stato non valida o vincolo unico di dominio |
| 429  | `rate_limited`     | Troppi tentativi. Include `Retry-After`                    |
| 503  | `unavailable`      | Database non raggiungibile o quota D1 esaurita             |

`500` ha un messaggio generico. Il dettaglio resta nel log, con un `requestId`, senza dati personali superflui.

## Setup e sessione

| Metodo e percorso                       | Chi                            | Effetto                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/setup`                        | Pubblico                       | `{ "initialized": true }` oppure `{ "initialized": false }`. Non rivela altro.                                                                                                                                   |
| `POST /api/setup`                       | Pubblico, solo con zero utenti | Crea l'amministratore e apre la sessione. Corpo: `bootstrapToken`, `fullName`, `email`, `password`. Se esiste già un utente risponde `404`. Il sedicesimo utente, da qui o da `POST /api/users`, risponde `409`. |
| `POST /api/auth/login`                  | Pubblico                       | Corpo: `email`, `password`. Esito positivo: cookie e profilo. Esito negativo: `401` con «Credenziali non valide.», anche se l'email non esiste o l'utente è disattivato.                                         |
| `POST /api/auth/logout`                 | Sessione                       | Revoca la sessione corrente e cancella il cookie.                                                                                                                                                                |
| `GET /api/auth/me`                      | Sessione                       | Profilo: `id`, `fullName`, `email`, `role`, `status`, gruppi, `associationName`.                                                                                                                                 |
| `PATCH /api/me`                         | Sessione                       | Solo `fullName`. Ruolo, stato ed email non sono in questo schema.                                                                                                                                                |
| `POST /api/me/password`                 | Sessione attiva                | `currentPassword`, `newPassword`. Revoca le sessioni precedenti e imposta un cookie nuovo.                                                                                                                       |
| `POST /api/auth/invitations/accept`     | Pubblico, con token            | `token`, `password`. Attiva l'utente invitato e apre la sessione.                                                                                                                                                |
| `POST /api/auth/password-reset/confirm` | Pubblico, con token            | `token`, `password`. Cambia la password, revoca tutte le sessioni e non apre un nuovo accesso.                                                                                                                   |

Il token di invito o reset arriva dal frammento dell'URL e viene inviato nel corpo JSON. Non si accetta il token come query string dell'API.

Password: minimo 16 caratteri, massimo 128, rifiuto di un elenco interno di password comuni. Nessuna regola di composizione obbligatoria oltre alla lunghezza. Il testo mostrato all'utente chiede una frase di almeno 16 caratteri.

## Utenti e gruppi

| Metodo e percorso                    | Chi                             | Effetto                                                                                                                                     |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users`                     | Admin                           | Elenco con ruolo, stato e gruppi.                                                                                                           |
| `POST /api/users`                    | Admin                           | Crea `invited`. Corpo: `fullName`, `email`, `role`, `groupIds`. Risposta, una sola volta: profilo e `inviteUrl` con il token nel frammento. |
| `GET /api/users/:id`                 | Admin                           | Dettaglio.                                                                                                                                  |
| `PATCH /api/users/:id`               | Admin                           | `fullName`, `email`, `role`. Non si auto-declassa l'unico amministratore attivo.                                                            |
| `POST /api/users/:id/invite`         | Admin                           | Nuovo invito se lo stato è `invited`. Invalida i token di invito precedenti.                                                                |
| `POST /api/users/:id/password-reset` | Admin                           | Emette un link di reset per un utente `active`.                                                                                             |
| `POST /api/users/:id/disable`        | Admin                           | Stato `disabled`, revoca sessioni. Non può disattivare se stesso se è l'unico amministratore.                                               |
| `POST /api/users/:id/enable`         | Admin                           | Torna `active` solo se una password esiste già. Altrimenti `409`: serve un nuovo invito.                                                    |
| `GET /api/groups`                    | Sessione                        | Admin: tutti. Gli altri: solo i gruppi di appartenenza.                                                                                     |
| `POST /api/groups`                   | Admin                           | `name`, `description`.                                                                                                                      |
| `PATCH /api/groups/:id`              | Admin                           | Nome, descrizione, `active` o `archived`.                                                                                                   |
| `GET /api/groups/:id/members`        | Admin, oppure membro del gruppo | Elenco membri.                                                                                                                              |
| `PUT /api/groups/:id/members`        | Admin                           | Sostituisce l'elenco `userIds`. Rifiuta utenti inesistenti.                                                                                 |

Il coordinatore non ha endpoint per cambiare ruoli o appartenenze.

## Attività

| Metodo e percorso              | Chi                                                          | Effetto                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/tasks`               | Sessione, nel perimetro                                      | Filtri: `status`, `groupId`, `assigneeId`, `priority`, `dueFrom`, `dueTo`, `q`. Ordinamenti: `dueAt`, `priority`, `createdAt`, `title`, `status`.   |
| `POST /api/tasks`              | Admin o coordinatore del gruppo                              | `title`, `description`, `groupId`, `assigneeIds`, `priority`, `dueAt`, `checklistTemplateIds` (fino a 5 modelli attivi dello stesso gruppo).        |
| `GET /api/tasks/:id`           | Chi può vedere il gruppo                                     | Dettaglio con assegnatari, checklist collegate e, se presente, regola di ricorrenza.                                                                |
| `PATCH /api/tasks/:id`         | Admin o coordinatore del gruppo                              | Campi descrittivi, priorità, scadenza, assegnatari e, se inviato, `checklistTemplateIds`. Una task nata da una regola diventa `recurrenceDetached`. |
| `POST /api/tasks/:id/claim`    | Membro autorizzato                                           | Da `todo` a `in_progress`. Consentito se la persona è assegnataria, oppure se non ci sono assegnatari ed è nel gruppo.                              |
| `POST /api/tasks/:id/release`  | Chi l'ha presa in carico, coordinatore o admin               | Da `in_progress` a `todo`.                                                                                                                          |
| `POST /api/tasks/:id/complete` | Assegnatario, chi l'ha presa in carico, coordinatore o admin | Da `todo` o `in_progress` a `completed`. 409 se manca un'esecuzione `completed` di una checklist collegata.                                         |
| `POST /api/tasks/:id/reopen`   | Coordinatore o admin                                         | Da `completed` a `in_progress`.                                                                                                                     |
| `POST /api/tasks/:id/cancel`   | Coordinatore o admin                                         | Da `todo` o `in_progress` a `cancelled`. `cancelled` è terminale nell'MVP.                                                                          |
| `GET /api/tasks/:id/history`   | Chi può vedere la task                                       | Righe di audit di quella task, in ordine cronologico.                                                                                               |

Le transizioni sono un `UPDATE` condizionato allo stato atteso. Se non aggiorna alcuna riga, la risposta è `409`.

`GET /api/dashboard` restituisce solo numeri calcolati.

Per un volontario: assegnate a lui, da prendere in carico nel gruppo, urgenti aperte, scadute, in scadenza entro `due_soon_hours`, checklist proprie ancora aperte, ultime notifiche.

Per un coordinatore, in più, sui propri gruppi: aperte, scadute, completate negli ultimi 30 giorni, checklist in corso, conteggio assegnazioni per persona.

Per un amministratore: gli stessi riquadri del coordinatore su tutti i gruppi.

Nessun numero è una costante scritta nell'interfaccia.

## Ricorrenze e calendario

| Metodo e percorso                   | Chi                             | Effetto                                                                                                                                    |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/recurrences`              | Admin o coordinatore            | Regole dei gruppi autorizzati.                                                                                                             |
| `POST /api/recurrences`             | Admin o coordinatore del gruppo | Definizione descritta in `DATABASE.md`, più `assigneeIds`.                                                                                 |
| `GET /api/recurrences/:id`          | Stesso perimetro                | Dettaglio.                                                                                                                                 |
| `PATCH /api/recurrences/:id`        | Admin o coordinatore            | Aggiorna la regola. Non riscrive le task già create.                                                                                       |
| `POST /api/recurrences/:id/suspend` | Admin o coordinatore            | Corpo opzionale: `cancelFutureOpen`.                                                                                                       |
| `POST /api/recurrences/:id/resume`  | Admin o coordinatore            | Azzera `suspended_at`.                                                                                                                     |
| `GET /api/calendar`                 | Sessione                        | Query `from`, `to`, `groupId` opzionale. Restituisce le task con `dueAt` nell'intervallo, nel perimetro. L'intervallo massimo è 62 giorni. |

`POST /api/admin/jobs/tick` è riservato all'amministratore e al test locale. Esegue lo stesso codice del cron: genera le ricorrenze, crea le notifiche in scadenza e scadute, invia al massimo cinque push e poi pulisce sessioni, tentativi, token, notifiche e consegne. In produzione il cron non passa da questo endpoint. L'endpoint esiste per i test e per uno sblocco manuale; ogni esecuzione finisce nell'audit.

## Checklist

| Metodo e percorso                             | Chi                                    | Effetto                                                                                                            |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/checklist-templates`                | Membro dei gruppi                      | Modelli attivi. Coordinatore e admin vedono anche gli inattivi.                                                    |
| `POST /api/checklist-templates`               | Admin o coordinatore                   | Titolo, descrizione, gruppo, voci ordinate.                                                                        |
| `GET /api/checklist-templates/:id`            | Membro del gruppo                      | Modello con voci.                                                                                                  |
| `PATCH /api/checklist-templates/:id`          | Admin o coordinatore                   | Sostituisce i campi e l'elenco voci. Non tocca le esecuzioni.                                                      |
| `POST /api/checklist-templates/:id/runs`      | Membro del gruppo, modello attivo      | Crea l'esecuzione e le copie delle voci. Corpo opzionale: `taskId` dello stesso gruppo.                            |
| `GET /api/checklist-runs`                     | Sessione                               | Volontario: le proprie e quelle collegate a una task a lui assegnata. Coordinatore e admin: il gruppo autorizzato. |
| `GET /api/checklist-runs/:id`                 | Come sopra                             | Esecuzione e voci.                                                                                                 |
| `PATCH /api/checklist-runs/:id/items/:itemId` | Chi l'ha avviata, coordinatore o admin | `result` e `note`, solo se l'esecuzione è `in_progress`.                                                           |
| `POST /api/checklist-runs/:id/complete`       | Chi l'ha avviata, coordinatore o admin | Applica le regole di chiusura e calcola l'esito.                                                                   |
| `POST /api/checklist-runs/:id/cancel`         | Chi l'ha avviata, coordinatore o admin | Solo da `in_progress`.                                                                                             |

Regole di chiusura, ripetute perché sono un contratto dell'API:

- ogni voce obbligatoria deve essere `compliant` o `non_compliant`;
- `not_applicable` è ammesso solo sulle facoltative;
- una facoltativa può restare `pending`;
- se compare almeno un `non_compliant`, l'esito è `non_compliant`, e la chiusura è comunque valida.

Un'attività può collegare fino a cinque modelli dello stesso gruppo. Il dettaglio dell'attività elenca quelle checklist e l'esecuzione aperta, oppure l'ultima conclusa. `POST /api/tasks/:id/complete` risponde 409 con il messaggio `Prima di concludere l'attività completa la checklist collegata: …` finché ogni modello collegato non ha un'esecuzione `completed` di quella attività. Un'esecuzione annullata o ancora in corso non basta. Vale sia l'esito conforme sia quello non conforme.

## Notifiche e push

| Metodo e percorso                    | Chi          | Effetto                                                                                         |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------- |
| `GET /api/notifications`             | Sessione     | Solo le proprie, non lette per prime.                                                           |
| `POST /api/notifications/:id/read`   | Destinatario | Imposta `readAt`.                                                                               |
| `POST /api/notifications/read-all`   | Sessione     | Segna tutte le proprie.                                                                         |
| `GET /api/push/vapid-public-key`     | Sessione     | Chiave pubblica. Non rivela la privata.                                                         |
| `POST /api/push/subscriptions`       | Sessione     | Registra endpoint, `p256dh` e `auth`. Lo stesso endpoint viene riassociato all'utente corrente. |
| `DELETE /api/push/subscriptions/:id` | Proprietario | Rimuove la sottoscrizione del proprio dispositivo.                                              |

Il server crea le notifiche per questi eventi:

1. Task assegnata, verso ogni assegnatario diverso dall'attore.
2. Task in scadenza, entro `due_soon_hours`, verso gli assegnatari, o verso i membri del gruppo se non ce ne sono.
3. Task scaduta e ancora aperta, verso gli stessi destinatari.
4. Task completata, verso i coordinatori del gruppo diversi da chi l'ha completata.
5. Checklist completata, verso i coordinatori del gruppo diversi da chi l'ha chiusa.

La riga interna nasce nella stessa operazione dell'evento. La consegna push è una riga di coda, scaricata dal cron a piccoli lotti.

## Amministrazione

| Metodo e percorso            | Chi                  | Effetto                                                                                                                                                       |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/audit-logs`        | Admin                | Filtri `action`, `entityType`, `entityId`, `from`, `to`.                                                                                                      |
| `GET /api/exports/tasks.csv` | Admin o coordinatore | CSV UTF-8 con BOM delle task nel perimetro. Il coordinatore è limitato ai propri gruppi. Le celle che iniziano con `=`, `+`, `-` o `@` ricevono un apostrofo. |
| `GET /api/exports/backup`    | Admin                | JSON di backup descritto in `DATABASE.md`.                                                                                                                    |
| `GET /api/settings`          | Admin                | Impostazioni modificabili.                                                                                                                                    |
| `PATCH /api/settings`        | Admin                | `associationName`, `dueSoonHours`. Gli altri valori di sessione e sicurezza non si cambiano da qui nell'MVP.                                                  |
| `GET /api/health`            | Pubblico             | `{ "status": "ok", "service": "volontari", "database": "ok", "time": "<iso>" }`. Nessun segreto. Database assente: `503`.                                     |

## Matrice sintetica

| Capacità                                                 | Admin           | Coordinatore          | Volontario                                        |
| -------------------------------------------------------- | --------------- | --------------------- | ------------------------------------------------- |
| Utenti, ruoli, gruppi, impostazioni, audit, backup       | Sì              | No                    | No                                                |
| Task e modelli dei propri gruppi                         | Tutti i gruppi  | Sì                    | Lettura e azioni operative                        |
| Prendere in carico e completare                          | Sì              | Sì                    | Sì, se assegnato o se la task è libera nel gruppo |
| Annullare una task, riaprirla, sospendere una ricorrenza | Sì              | Sì, nei propri gruppi | No                                                |
| Checklist di gruppo                                      | Sì              | Sì                    | Avvio e proprie esecuzioni                        |
| Notifiche e push                                         | Solo le proprie | Solo le proprie       | Solo le proprie                                   |
| Export CSV                                               | Tutti i gruppi  | Propri gruppi         | No                                                |

Il dettaglio operativo per ogni transizione è nel servizio, non nell'interfaccia. L'interfaccia nasconde le azioni vietate, ma il server le rifiuta comunque.
