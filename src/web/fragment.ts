const STORAGE_PREFIX = 'volontari.token.';

export function readFragmentToken(purpose: 'invite' | 'reset'): string {
  const key = `${STORAGE_PREFIX}${purpose}`;
  const fromHash = decodeHash();
  if (fromHash) {
    window.sessionStorage.setItem(key, fromHash);
    const nextUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, '', nextUrl);
    return fromHash;
  }
  return window.sessionStorage.getItem(key) ?? '';
}

export function clearFragmentToken(purpose: 'invite' | 'reset'): void {
  window.sessionStorage.removeItem(`${STORAGE_PREFIX}${purpose}`);
}

function decodeHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
