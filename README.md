# Avis Berceto

Piattaforma gestionale per Avis Berceto, fino a 15 persone.
È una Progressive Web App in italiano, pensata per telefono, tablet e computer, senza costi di esercizio previsti.

Lo stato attuale è la **Fase 8 — preparazione al deploy**. I comandi di pubblicazione sono in [DEPLOY.md](DEPLOY.md) e non vanno eseguiti prima dell'autorizzazione. Le chiavi VAPID restano in `.dev.vars` e non vanno versionate.

## Avvio

Serve Node.js 22.12 o successivo.

```bash
npm install
cp .env.example .dev.vars
```

Apri `.dev.vars` e imposta `BOOTSTRAP_TOKEN` con una frase lunga, diversa da qualsiasi password. Poi:

```bash
npm run db:migrate
npm run dev
```

L'applicazione risponde su `http://localhost:5173/`.
Il primo avvio è `http://localhost:5173/avvio`: usa il codice appena scritto, poi entra dalla home.
Lo stato del servizio è `http://localhost:5173/api/health`.

`db:migrate` applica le migrazioni solo al database D1 locale, nella cartella `.wrangler`. Non usa risorse Cloudflare remote. Il `database_id` in `wrangler.jsonc` è un segnaposto: il database remoto si crea nella Fase 9. `.dev.vars` resta sul computer e non va versionato.

## Comandi

| Comando                 | Effetto                                                |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Interfaccia, Worker e D1 locale                        |
| `npm run db:migrate`    | Applica le migrazioni al D1 locale                     |
| `npm run test`          | Test, controllo segreti e prova di ripristino locale   |
| `npm run e2e`           | Flussi Playwright su task e checklist                  |
| `npm run typecheck`     | Controllo TypeScript                                   |
| `npm run lint`          | ESLint                                                 |
| `npm run format`        | Prettier                                               |
| `npm run build`         | Build di produzione dell'interfaccia e del Worker      |
| `npm run release:check` | Tipi, lint, test, build e controlli di rilascio locali |
| `npm run types`         | Rigenera i tipi dei binding Worker                     |

## Documenti

| Documento                                            | Contenuto                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                   | Decisioni, componenti, permessi, sicurezza, limiti del piano gratuito |
| [DATABASE.md](DATABASE.md)                           | Schema, integrità, cancellazioni, ricorrenze e fuso orario            |
| [API.md](API.md)                                     | Endpoint REST, errori e autorizzazioni                                |
| [TESTING.md](TESTING.md)                             | Piano di test per le fasi successive                                  |
| [DEPLOY.md](DEPLOY.md)                               | Comandi, backup, rollback e prova dopo la pubblicazione               |
| [CHANGELOG.md](CHANGELOG.md)                         | Evoluzione del progetto                                               |
| [.env.example](.env.example)                         | Nomi delle variabili, senza segreti                                   |
| [migrations/0001_init.sql](migrations/0001_init.sql) | Schema SQL iniziale                                                   |

## Copia e ripristino locale

Da amministratore, scarica la copia JSON. Il file contiene gli hash delle password e gli endpoint push: va tenuto fuori dal repository.

Per provarla su un database vuoto, senza usare Cloudflare remoto e senza cancellare i dati in uso:

```bash
node scripts/restore-local.ts copia.json .restore
```

Lo script applica le migrazioni nella directory indicata e reinserisce le righe. Poi stampa i conteggi. `npm test` esegue la stessa prova su una copia sintetica.

## Vincoli

- Costo previsto: 0 €/mese, sul piano gratuito di Cloudflare Workers e D1.
- Nessun server da amministrare, nessun invio email, nessun WhatsApp, nessuno store di app.
- Fuso orario applicativo: `Europe/Rome`. Gli istanti sono salvati in UTC.
- Accesso solo su invito di un amministratore. Il primo amministratore si crea da `/avvio`, finché non esiste alcuna persona.
