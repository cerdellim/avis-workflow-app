const ROME = 'Europe/Rome';

export function formatRome(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: ROME,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function isoToRomeInput(iso: string): string {
  return wallClock(new Date(iso));
}

export function romeInputToIso(value: string): string {
  const desired = wallParts(value);
  if (!desired) {
    throw new Error('data');
  }
  const desiredUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const shown = wallParts(wallClock(new Date(desiredUtc)));
  if (!shown) {
    throw new Error('data');
  }
  const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
  return new Date(desiredUtc - (shownUtc - desiredUtc)).toISOString();
}

function wallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = read('hour') === '24' ? '00' : read('hour');
  return `${read('year')}-${read('month')}-${read('day')}T${hour}:${read('minute')}`;
}

function wallParts(
  value: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

export function formatLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(date);
}
