import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { passwordResetSql } from './print-password-hash.ts';

const root = path.resolve(import.meta.dirname, '..');
const port = 8791;
const persist = path.join(root, '.routing-preview');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJson(relative: string): Record<string, unknown> {
  const text = readFileSync(path.join(root, relative), 'utf8').replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(text) as Record<string, unknown>;
}

function assertConfig(): void {
  const config = readJson('wrangler.jsonc');
  if (config.name !== 'volontari') {
    fail('Il Worker deve chiamarsi volontari.');
  }
  if (config.compatibility_date !== '2026-11-18') {
    fail('Data di compatibilità inattesa.');
  }
  const flags = config.compatibility_flags;
  if (!Array.isArray(flags) || !flags.includes('temporal')) {
    fail('Manca il flag temporal.');
  }
  const databases = config.d1_databases;
  const database = Array.isArray(databases) ? databases[0] : undefined;
  if (
    !database ||
    database.binding !== 'DB' ||
    database.database_name !== 'volontari' ||
    database.database_id !== '00000000-0000-0000-0000-000000000000' ||
    database.migrations_dir !== 'migrations'
  ) {
    fail('Il binding D1 non è quello previsto per la Fase 8.');
  }
  const triggers = config.triggers as { crons?: string[] } | undefined;
  if (!triggers?.crons || triggers.crons.join(',') !== '*/15 * * * *') {
    fail('Il cron deve restare ogni 15 minuti.');
  }
  const assets = config.assets as
    { not_found_handling?: string; run_worker_first?: string[] } | undefined;
  if (
    assets?.not_found_handling !== 'single-page-application' ||
    assets.run_worker_first?.join(',') !== '/api/*'
  ) {
    fail('Il routing degli asset non manda le API al Worker e il resto alla PWA.');
  }
  if (config.vars || config.kv_namespaces || config.r2_buckets || config.queues) {
    fail('La configurazione non deve dichiarare variabili, KV, R2 o code.');
  }

  const example = readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const name of ['BOOTSTRAP_TOKEN=', 'VAPID_PUBLIC_KEY=', 'VAPID_PRIVATE_KEY=']) {
    if (!example.includes(`\n${name}\n`) && !example.startsWith(name)) {
      fail(`${name} deve restare vuoto in .env.example.`);
    }
  }
  const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['.dev.vars', 'dist/', '.routing-preview/']) {
    if (!ignore.split('\n').some((line) => line.trim() === entry)) {
      fail(`${entry} non è ignorato.`);
    }
  }
  const session = readFileSync(path.join(root, 'src', 'worker', 'session.ts'), 'utf8');
  if (!session.includes("secure: new URL(c.req.url).protocol === 'https:'")) {
    fail('Il cookie di sessione deve essere Secure solo su HTTPS.');
  }
}

function assertBundle(): void {
  const required = [
    'dist/client/index.html',
    'dist/client/manifest.webmanifest',
    'dist/client/sw.js',
    'dist/client/icon-192.png',
    'dist/client/icon-512.png',
    'dist/client/favicon.svg',
    'dist/client/.assetsignore',
    'dist/worker/index.js',
    'dist/worker/wrangler.json',
  ];
  for (const relative of required) {
    if (!existsSync(path.join(root, relative))) {
      fail(`Manca ${relative}. Esegui npm run build.`);
    }
  }
  const html = readFileSync(path.join(root, 'dist/client/index.html'), 'utf8');
  if (!html.includes('Avis Berceto') || !html.includes('/assets/')) {
    fail('La pagina di produzione non contiene il nome o lo script.');
  }
  const manifest = readJson('dist/client/manifest.webmanifest');
  if (
    manifest.name !== 'Avis Berceto' ||
    manifest.start_url !== '/' ||
    manifest.display !== 'standalone' ||
    manifest.theme_color !== '#005EB8'
  ) {
    fail('Il manifest di produzione non è quello di Avis Berceto.');
  }
  const serviceWorker = readFileSync(path.join(root, 'dist/client/sw.js'), 'utf8');
  if (serviceWorker.includes('caches') || !serviceWorker.includes('notificationclick')) {
    fail('Il service worker di produzione non è quello previsto.');
  }
  const ignoreAssets = readFileSync(path.join(root, 'dist/client/.assetsignore'), 'utf8');
  if (!ignoreAssets.includes('.dev.vars')) {
    fail('Gli asset di produzione non escludono .dev.vars.');
  }
  const built = readJson('dist/worker/wrangler.json');
  const assets = built.assets as { not_found_handling?: string; run_worker_first?: string[] };
  if (
    assets.not_found_handling !== 'single-page-application' ||
    assets.run_worker_first?.join(',') !== '/api/*' ||
    JSON.stringify(built.vars) !== '{}'
  ) {
    fail('Il Wrangler generato non è pronto per il rilascio.');
  }
  const markers = /BEGIN [A-Z ]*PRIVATE KEY|BOOTSTRAP_TOKEN=|VAPID_PRIVATE_KEY=/;
  for (const file of walk(path.join(root, 'dist'))) {
    if (!/\.(js|html|css|json|webmanifest|svg)$/i.test(file)) {
      continue;
    }
    if (markers.test(readFileSync(file, 'utf8'))) {
      fail(`Possibile segreto in ${path.relative(root, file)}.`);
    }
  }
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function assertHashScript(): Promise<void> {
  const sql = await passwordResetSql('frase-di-collaudo-fase-8', 'amministratore@example.org');
  if (
    !sql.includes('pbkdf2-sha256$10000$') ||
    !sql.includes('UPDATE users') ||
    !sql.includes('UPDATE sessions')
  ) {
    fail('Lo script di reset non produce l’SQL atteso.');
  }
  const rejected = await passwordResetSql('corta', 'amministratore@example.org').then(
    () => false,
    () => true,
  );
  if (!rejected) {
    fail('Lo script di reset accetta una frase troppo corta.');
  }
}

function runMigrations(): void {
  rmSync(persist, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [wrangler, 'd1', 'migrations', 'apply', 'volontari', '--local', '--persist-to', persist],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CI: '1' } },
  );
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || 'Migrazioni locali della preview fallite.');
  }
}

async function assertRouting(): Promise<void> {
  runMigrations();
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--config',
      'dist/worker/wrangler.json',
      '--local',
      '--persist-to',
      persist,
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--inspector-port',
      '9239',
      '--show-interactive-dev-session',
      'false',
      '--test-scheduled',
    ],
    { cwd: root, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  try {
    await waitForReady(child, () => log);
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/api/health`);
    const healthBody = (await health.json()) as { status?: string; database?: string };
    if (health.status !== 200 || healthBody.database !== 'ok') {
      fail(`Health della build: ${health.status}`);
    }
    const page = await fetch(`${base}/attivita/anteprima`);
    const html = await page.text();
    if (page.status !== 200 || !html.includes('id="root"') || !html.includes('Avis Berceto')) {
      fail('Il percorso della PWA non restituisce l’applicazione.');
    }
    const missing = await fetch(`${base}/api/niente`);
    const missingBody = (await missing.json()) as { error?: { code?: string } };
    if (missing.status !== 404 || missingBody.error?.code !== 'not_found') {
      fail('Un’API assente non risponde 404.');
    }
    const worker = await fetch(`${base}/sw.js`);
    const workerText = await worker.text();
    if (worker.status !== 200 || workerText.includes('caches')) {
      fail('Il service worker pubblicato non è quello atteso.');
    }
    const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
    const manifest = (await manifestResponse.json()) as { name?: string };
    if (manifestResponse.status !== 200 || manifest.name !== 'Avis Berceto') {
      fail('Il manifest non è servito.');
    }
    const scheduled = await fetch(`${base}/__scheduled`);
    if (scheduled.status !== 200) {
      fail(`Il cron di prova ha risposto ${scheduled.status}.`);
    }
  } finally {
    stop(child);
  }
}

async function waitForReady(child: ChildProcess, readLog: () => string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 40_000) {
    if (child.exitCode !== null) {
      fail(readLog() || 'La preview si è chiusa.');
    }
    if (readLog().includes(`127.0.0.1:${port}`) || readLog().includes('Ready on')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(readLog() || 'La preview non è partita.');
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
}

assertConfig();
assertBundle();
await assertHashScript();
await assertRouting();
console.log('controlli di rilascio ok');
