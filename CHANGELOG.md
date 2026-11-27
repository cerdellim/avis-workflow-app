# Changelog

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [Non rilasciato]

### Aggiunto

- Ricorrenze giornaliere, settimanali, mensili e annuali, con generazione idempotente e calendario.
- Checklist con modelli, voci, esecuzioni e copie che restano invariate se il modello cambia.
- Collegamento di una o più checklist a un'attività: chi la prende in carico vede i controlli e non può chiuderla prima.
- Attività con creazione, assegnazione, presa in carico, completamento, riapertura e annullamento.
- `GET /api/dashboard` con conteggi calcolati dal database per volontario, coordinatore e amministratore.
- Pagine Attività e dettaglio, con la dashboard sulla home.
- Accesso con sessione, inviti, reset password, ruoli e gruppi.
- `GET /api/setup` per sapere se il primo amministratore è già stato creato.
- Password con frase di almeno 16 caratteri, PBKDF2-SHA-256 a 10.000 iterazioni e limite di 15 persone.
- Ambiente locale con React, Vite, Tailwind, Hono, D1 e migrazione `0001_init.sql`.
- `GET /api/health`, errori API in italiano e layout responsive con navigazione.
- Nome dell'app «Avis Berceto» e colore primario `#005EB8`.
- Documentazione di deploy, controlli locali della build e procedura di emergenza per l'amministratore.
- Registro delle azioni, impostazioni dell'associazione, export CSV e copia JSON.
- Ripristino locale della copia JSON con Wrangler, senza endpoint HTTP.
- Centro notifiche, campanella con il numero delle non lette e consegne push a piccoli lotti.
- Manifest e service worker che mostra la notifica, apre il percorso al click e non mette in cache le API.
- Progettazione della Fase 0: architettura, schema, API, permessi, rischi e piano di test.
- `.env.example` con i nomi delle variabili, senza segreti.

### Modificato

- Password semplificate per al massimo 15 utenti e dati non sensibili: minimo 16 caratteri, PBKDF2-SHA-256 a 10.000 iterazioni, senza pepper.
