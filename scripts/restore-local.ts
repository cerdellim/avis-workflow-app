import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { backupScript, type BackupDocument } from '../src/shared/backup-format.ts';

const root = path.resolve(import.meta.dirname, '..');
const jsonPath = process.argv[2];
const persistDir = process.argv[3];

if (!jsonPath || !persistDir) {
  console.error('Uso: node scripts/restore-local.ts copia.json directory-locale');
  process.exit(1);
}

const persist = path.resolve(persistDir);
if (persist.includes(`${path.sep}.wrangler`)) {
  console.error('La directory di ripristino non può essere il database locale in uso.');
  process.exit(1);
}

const document = JSON.parse(readFileSync(jsonPath, 'utf8')) as BackupDocument;
rmSync(persist, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });
const sqlPath = path.join(persist, 'ripristino.sql');
writeFileSync(sqlPath, backupScript(document));

const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
wranglerRun(wrangler, [
  'd1',
  'migrations',
  'apply',
  'volontari',
  '--local',
  '--persist-to',
  persist,
]);
wranglerRun(wrangler, [
  'd1',
  'execute',
  'volontari',
  '--local',
  '--persist-to',
  persist,
  '--file',
  sqlPath,
  '-y',
]);
const output = wranglerRun(wrangler, [
  'd1',
  'execute',
  'volontari',
  '--local',
  '--persist-to',
  persist,
  '--json',
  '--command',
  `SELECT
     (SELECT COUNT(*) FROM users) AS users,
     (SELECT COUNT(*) FROM groups) AS groups,
     (SELECT COUNT(*) FROM group_members) AS members,
     (SELECT COUNT(*) FROM tasks) AS tasks,
     (SELECT COUNT(*) FROM sessions) AS sessions,
     (SELECT COUNT(*) FROM app_settings) AS settings,
     (SELECT email FROM users LIMIT 1) AS email,
     (SELECT title FROM tasks LIMIT 1) AS title`,
  '-y',
]);
const parsed = JSON.parse(output.slice(output.indexOf('['))) as {
  results?: Record<string, unknown>[];
}[];
const row = parsed[0]?.results?.[0];
if (!row) {
  throw new Error(output);
}
console.log(JSON.stringify(row));

function wranglerRun(command: string, args: string[]): string {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
