import path from 'node:path';
import { passwordProblem } from '../src/shared/password-policy.ts';
import { hashPassword } from '../src/worker/passwords.ts';

const scriptPath = path.resolve(import.meta.dirname, 'print-password-hash.ts');

export async function passwordResetSql(password: string, email: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) {
    throw new Error(problem);
  }
  const hash = await hashPassword(password);
  const now = Date.now();
  const safeEmail = email.replaceAll("'", "''");
  return [
    '-- Hash locale. Non esegue nulla sul database.',
    '-- Applicalo solo in emergenza, dall’account Cloudflare, e solo dopo la Fase 9.',
    'UPDATE users',
    `SET password_hash = '${hash}',`,
    `    status = 'active',`,
    '    disabled_at = NULL,',
    `    password_changed_at = ${now},`,
    `    updated_at = ${now}`,
    `WHERE email = '${safeEmail}' AND role = 'admin';`,
    '',
    'UPDATE sessions',
    `SET revoked_at = ${now}`,
    `WHERE user_id = (SELECT id FROM users WHERE email = '${safeEmail}' AND role = 'admin')`,
    '  AND revoked_at IS NULL;',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const password = process.argv[2];
  const email = process.argv[3] ?? 'amministratore@example.org';
  if (!password) {
    console.error('Uso: node scripts/print-password-hash.ts "frase di almeno 16 caratteri" email');
    process.exit(1);
  }
  passwordResetSql(password, email)
    .then((sql) => {
      console.log(sql);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Hash non generato.');
      process.exit(1);
    });
}
