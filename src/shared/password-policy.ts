export const PASSWORD_MIN_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'passwordpassword',
  '1234567890123456',
  '12345678901234567890',
  'qwertyuiopasdfgh',
  'qwertyuiopasdfghjkl',
  'ciaociaociaociao',
  'volontarivolontari',
  'iloveyouiloveyou',
  'letmeinletmein!!',
  'passw0rdpassw0rd',
  'aaaaaaaaaaaaaaaa',
  '0000000000000000',
]);

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'Usa una frase di almeno 16 caratteri.';
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return 'La frase può avere al massimo 128 caratteri.';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Questa frase è troppo comune. Scegline un'altra.";
  }
  return null;
}
