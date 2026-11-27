export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceSpec = {
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekdays: number[] | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startsOn: string;
  endsOn: string | null;
};

const ZONE = 'Europe/Rome';

export function romeToday(now: number): string {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(ZONE)
    .toPlainDate()
    .toString();
}

export function dueAtMillis(localDate: string, localTime: string): number {
  const date = Temporal.PlainDate.from(localDate);
  const [hour, minute] = localTime.split(':').map((part) => Number(part));
  return Temporal.ZonedDateTime.from(
    {
      timeZone: ZONE,
      year: date.year,
      month: date.month,
      day: date.day,
      hour: hour ?? 0,
      minute: minute ?? 0,
    },
    { disambiguation: 'compatible' },
  ).epochMilliseconds;
}

export function romeDayStart(localDate: string): number {
  return dueAtMillis(localDate, '00:00');
}

export function occurrenceDates(spec: RecurrenceSpec, today: string): string[] {
  if (spec.intervalCount < 1) {
    return [];
  }
  const window = generationWindow(spec, Temporal.PlainDate.from(today));
  if (!window) {
    return [];
  }
  if (spec.frequency === 'daily') {
    return dailyDates(spec, window);
  }
  if (spec.frequency === 'weekly') {
    return weeklyDates(spec, window);
  }
  if (spec.frequency === 'monthly') {
    return monthlyDates(spec, window);
  }
  return yearlyDates(spec, window);
}

function generationWindow(
  spec: RecurrenceSpec,
  today: Temporal.PlainDate,
): { start: Temporal.PlainDate; end: Temporal.PlainDate } | null {
  const starts = Temporal.PlainDate.from(spec.startsOn);
  const start = Temporal.PlainDate.compare(starts, today) > 0 ? starts : today;
  const nextMonth = today.add({ months: 1 });
  const endOfNextMonth = nextMonth.with({ day: nextMonth.daysInMonth });
  const plus62 = today.add({ days: 62 });
  let end = Temporal.PlainDate.compare(endOfNextMonth, plus62) <= 0 ? endOfNextMonth : plus62;
  if (spec.endsOn) {
    const ends = Temporal.PlainDate.from(spec.endsOn);
    if (Temporal.PlainDate.compare(ends, end) < 0) {
      end = ends;
    }
  }
  if (Temporal.PlainDate.compare(start, end) > 0) {
    return null;
  }
  return { start, end };
}

function dailyDates(
  spec: RecurrenceSpec,
  window: { start: Temporal.PlainDate; end: Temporal.PlainDate },
): string[] {
  const starts = Temporal.PlainDate.from(spec.startsOn);
  let cursor = starts;
  if (Temporal.PlainDate.compare(cursor, window.start) < 0) {
    const days = cursor.until(window.start, { largestUnit: 'day' }).days;
    const steps = Math.ceil(days / spec.intervalCount);
    cursor = cursor.add({ days: steps * spec.intervalCount });
  }
  const dates: string[] = [];
  let guard = 0;
  while (Temporal.PlainDate.compare(cursor, window.end) <= 0 && guard < 70) {
    dates.push(cursor.toString());
    cursor = cursor.add({ days: spec.intervalCount });
    guard += 1;
  }
  return dates;
}

function weeklyDates(
  spec: RecurrenceSpec,
  window: { start: Temporal.PlainDate; end: Temporal.PlainDate },
): string[] {
  const selected = new Set(spec.weekdays ?? []);
  const starts = Temporal.PlainDate.from(spec.startsOn);
  const startMonday = starts.subtract({ days: starts.dayOfWeek - 1 });
  const dates: string[] = [];
  let cursor = window.start;
  let guard = 0;
  while (Temporal.PlainDate.compare(cursor, window.end) <= 0 && guard < 70) {
    if (selected.has(cursor.dayOfWeek)) {
      const monday = cursor.subtract({ days: cursor.dayOfWeek - 1 });
      const weeks = startMonday.until(monday, { largestUnit: 'week' }).weeks;
      if (weeks % spec.intervalCount === 0) {
        dates.push(cursor.toString());
      }
    }
    cursor = cursor.add({ days: 1 });
    guard += 1;
  }
  return dates;
}

function monthlyDates(
  spec: RecurrenceSpec,
  window: { start: Temporal.PlainDate; end: Temporal.PlainDate },
): string[] {
  const starts = Temporal.PlainDate.from(spec.startsOn).with({ day: 1 });
  const anchor = spec.dayOfMonth ?? 1;
  let month = window.start.with({ day: 1 });
  const elapsed = starts.until(month, { largestUnit: 'month' }).months;
  const remainder = elapsed % spec.intervalCount;
  if (remainder !== 0) {
    month = month.add({ months: spec.intervalCount - remainder });
  }
  const dates: string[] = [];
  let guard = 0;
  while (Temporal.PlainDate.compare(month, window.end) <= 0 && guard < 8) {
    const occurrence = month.with({ day: Math.min(anchor, month.daysInMonth) });
    if (
      Temporal.PlainDate.compare(occurrence, Temporal.PlainDate.from(spec.startsOn)) >= 0 &&
      Temporal.PlainDate.compare(occurrence, window.start) >= 0 &&
      Temporal.PlainDate.compare(occurrence, window.end) <= 0
    ) {
      dates.push(occurrence.toString());
    }
    month = month.add({ months: spec.intervalCount });
    guard += 1;
  }
  return dates;
}

function yearlyDates(
  spec: RecurrenceSpec,
  window: { start: Temporal.PlainDate; end: Temporal.PlainDate },
): string[] {
  const starts = Temporal.PlainDate.from(spec.startsOn);
  const anchorMonth = spec.monthOfYear ?? 1;
  const anchorDay = spec.dayOfMonth ?? 1;
  let year = window.start.year;
  const elapsed = year - starts.year;
  const remainder = elapsed % spec.intervalCount;
  if (remainder !== 0) {
    year += spec.intervalCount - remainder;
  }
  const dates: string[] = [];
  let guard = 0;
  while (year <= window.end.year && guard < 6) {
    const month = Temporal.PlainDate.from({ year, month: anchorMonth, day: 1 });
    const occurrence = month.with({ day: Math.min(anchorDay, month.daysInMonth) });
    if (
      Temporal.PlainDate.compare(occurrence, starts) >= 0 &&
      Temporal.PlainDate.compare(occurrence, window.start) >= 0 &&
      Temporal.PlainDate.compare(occurrence, window.end) <= 0
    ) {
      dates.push(occurrence.toString());
    }
    year += spec.intervalCount;
    guard += 1;
  }
  return dates;
}
