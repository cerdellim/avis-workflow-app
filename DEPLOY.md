# Preparazione al deploy

Questa fase lascia il progetto pronto per Cloudflare e non pubblica nulla. I comandi remoti sono scritti qui per la Fase 9: non vanno eseguiti prima di un'autorizzazione esplicita.

Il piano è quello gratuito: un Worker, un database D1 e un Cron Trigger. Non si usano KV, R2, code, email o piani a pagamento. Il nome del Worker è `volontari`. L'indirizzo futuro sarà `https://volontari.<sottodominio>.workers.dev`, salvo una decisione diversa prima della pubblicazione.

## Controlli locali

```bash
npm run release:check
```

Il comando esegue il controllo dei tipi, ESLint, i test, la build di produzione e `node scripts/phase8-checks.ts`. L'ultimo passaggio:

- legge `wrangler.jsonc` e rifiuta binding a pagamento, variabili in chiaro e un cron diverso da ogni 15 minuti;
- verifica che `.dev.vars` e `dist/` siano ignorati e che `.env.example` non contenga segreti;
- controlla che la build contenga la pagina, il manifest, le icone e il service worker;
- cerca nel risultato marcatori di chiavi private;
- avvia la build in locale, senza `--remote`, e prova il routing.

Il `database_id` resta il segnaposto `00000000-0000-0000-0000-000000000000`. Si sostituisce solo quando, in Fase 9, si crea il database remoto.

## Cosa viene pubblicato

| Pezzo                                   | Dove                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| API e cron                              | `src/worker`, compilato in `dist/worker/index.js`                       |
| Pagine, manifest, icone, service worker | `dist/client`                                                           |
| Schema                                  | `migrations/`                                                           |
| Segreti                                 | non nel repository e non nel bundle: si impostano con `wrangler secret` |

`npm run build` può copiare `.dev.vars` accanto al Worker per la prova locale. Quel file è ignorato da Git e da `.assetsignore`, quindi non entra negli asset pubblicati. I segreti di produzione non si copiano da `.dev.vars`: si impostano sull'account.

Il service worker non usa la Cache API. Le richieste a `/api/*` arrivano al Worker prima degli asset. Ogni altro percorso sconosciuto riceve `index.html`, così un aggiornamento su `/attivita/...` riapre l'applicazione. Il service worker si registra solo nella build di produzione.

Su HTTPS il cookie di sessione ha il flag `Secure`. `workers.dev` è HTTPS.

## Comandi remoti, solo dopo autorizzazione

Non eseguirli in questa fase.

```bash
npx wrangler login
npx wrangler d1 create volontari
```

Sostituire il `database_id` in `wrangler.jsonc` con l'identificativo stampato dal comando. Poi:

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler d1 migrations apply volontari --remote
npx wrangler deploy
```

`VAPID_SUBJECT` è un `mailto:` dell'associazione. Le chiavi VAPID sono quelle già generate in locale; la privata non si incolla in un file versionato. Il cron è già in `wrangler.jsonc` e parte con il deploy: non serve un secondo comando.

## Primo amministratore

1. Aprire `https://<indirizzo>/avvio`.
2. Inserire il `BOOTSTRAP_TOKEN` e creare la prima persona.
3. Da quel momento `/api/setup` risponde 404 anche se il token resta tra i secret.
4. Creare il gruppo e le altre persone dall'applicazione. I link di invito si consegnano di persona.

## Backup

Prima di ogni modifica rischiosa, un amministratore scarica la copia JSON da Impostazioni. Il file contiene hash delle password e endpoint push: si conserva fuori dal repository.

In locale, senza toccare il database in uso:

```bash
node scripts/restore-local.ts copia.json .restore
```

Su Cloudflare il Time Travel di D1 conserva circa 7 giorni sul piano gratuito. Serve per un errore recente, dal pannello del database o con:

```bash
npx wrangler d1 time-travel info volontari --remote
npx wrangler d1 time-travel restore volontari --remote --timestamp <istante>
```

Anche questi due comandi sono remoti e restano per la Fase 9 o per un'emergenza. Non sostituiscono la copia JSON: oltre la finestra di Time Travel la copia scaricata è il recupero.

## Rollback dell'applicazione

Dopo la prima pubblicazione, la versione precedente del Worker si ripristina con:

```bash
npx wrangler rollback
```

Il comando non riporta indietro il database. Uno schema nuovo va valutato insieme al Time Travel o alla copia JSON. Non esiste un ripristino dall'interfaccia.

## Amministratore senza accesso

Se esiste un altro amministratore, è lui a creare un link di reset dalla pagina Utenti.

Se non ne resta nessuno, interviene chi controlla l'account Cloudflare. Sul proprio computer, senza inviare nulla:

```bash
node scripts/print-password-hash.ts "frase di almeno 16 caratteri" amministratore@example.org
```

Lo script stampa due `UPDATE`: uno imposta l'hash e riattiva solo la riga con quel ruolo, l'altro revoca le sessioni. La frase non viene scritta nel database. L'applicazione sul remoto, di nuovo solo in emergenza, è:

```bash
npx wrangler d1 execute volontari --remote --command "<SQL stampato>"
```

Poi la persona entra da `/accedi` con la frase scelta.

## Prova dopo la pubblicazione

Da eseguire in Fase 9, sull'URL HTTPS:

1. `GET /api/health` risponde `database: "ok"`.
2. Il primo amministratore completa `/avvio`.
3. Un coordinatore e un volontario attivano l'invito.
4. Si crea un'attività, la si collega a una checklist e il volontario la completa.
5. Una ricorrenza compare nel calendario.
6. La notifica interna arriva nel centro notifiche.
7. Su telefono, la PWA si aggiunge alla schermata Home e un percorso diretto si apre dopo un aggiornamento.

Le push sul dispositivo restano una prova manuale separata: Android con Chrome e la PWA installata, iPhone solo se l'app è stata aggiunta alla Home e aperta dall'icona. Finché quei dispositivi non sono stati usati, le push non si dichiarano verificate.
