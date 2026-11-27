import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio } from '../src/shared/contrast.ts';

const root = path.resolve(import.meta.dirname, '..');
const skip = new Set([
  'node_modules',
  'dist',
  '.wrangler',
  '.git',
  'coverage',
  '.restore',
  '.restore-proof',
  '.routing-preview',
  'playwright-report',
  'test-results',
  'blob-report',
]);

const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!gitignore.split('\n').some((line) => line.trim() === '.dev.vars')) {
  console.error('.dev.vars non è ignorato');
  process.exit(1);
}

const textFile = /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|css|html|sql|txt|yml|yaml|example)$/i;
const secrets: string[] = [];
for (const file of walk(root)) {
  const relative = path.relative(root, file);
  if (
    relative === '.dev.vars' ||
    relative.endsWith(`${path.sep}.dev.vars`) ||
    !textFile.test(file)
  ) {
    continue;
  }
  const source = readFileSync(file, 'utf8');
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(source)) {
    secrets.push(`${relative}: chiave privata`);
  }
  for (const match of source.matchAll(/^([A-Z0-9_]*PRIVATE_KEY|BOOTSTRAP_TOKEN)=(.*)$/gm)) {
    const value = match[2]?.trim() ?? '';
    if (value.length > 0 && value !== 'token-di-collaudo-fase-2') {
      secrets.push(`${relative}: ${match[1]}`);
    }
  }
}

if (secrets.length > 0) {
  console.error(secrets.join('\n'));
  process.exit(1);
}

const css = readFileSync(path.join(root, 'src/web/index.css'), 'utf8');
const color = (name: string): string => {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  const value = match?.[1];
  if (!value) {
    throw new Error(`colore ${name} mancante`);
  }
  return value;
};

const pairs: [string, string][] = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['muted', 'canvas'],
  ['muted', 'surface'],
  ['surface', 'brand'],
  ['surface', 'brand-strong'],
];

for (const [foreground, background] of pairs) {
  const ratio = contrastRatio(color(foreground), color(background));
  if (ratio < 4.5) {
    throw new Error(`${foreground} su ${background}: ${ratio.toFixed(2)}`);
  }
}

console.log('controlli repository e contrasto ok');

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (skip.has(entry)) {
      continue;
    }
    const full = path.join(directory, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...walk(full));
    } else if (info.isFile() && info.size < 1_000_000) {
      files.push(full);
    }
  }
  return files;
}
