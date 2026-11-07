const bogotaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addCalendarDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function bogotaMidnightUtc(dateOnly: string): Date {
  if (!isDateOnly(dateOnly)) throw new TypeError('Invalid calendar date');
  const [year, month, day] = dateOnly.split('-').map(Number);
  const wallMidnight = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(
    bogotaFormatter
      .formatToParts(new Date(wallMidnight))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = representedAsUtc - wallMidnight;
  return new Date(wallMidnight - offset);
}

export function getSubscriptionBounds(
  paidThroughDate: string,
  graceDays = 10,
): { paidThrough: Date; graceUntil: Date } {
  if (!isDateOnly(paidThroughDate)) {
    throw new TypeError('Invalid paid-through date');
  }
  const paidThrough = bogotaMidnightUtc(
    addCalendarDays(paidThroughDate, 1),
  );
  const graceUntil = bogotaMidnightUtc(
    addCalendarDays(paidThroughDate, graceDays + 1),
  );
  return { paidThrough, graceUntil };
}

export function computeOfflineUntil(
  graceUntil: Date,
  issuedAt: Date,
  offlineDays = 30,
): Date {
  const grace = graceUntil.valueOf();
  const issued = issuedAt.valueOf();
  if (!Number.isFinite(grace) || !Number.isFinite(issued)) {
    throw new TypeError('Invalid license time');
  }
  const maximumOffline = issued + offlineDays * 24 * 60 * 60 * 1000;
  return new Date(Math.min(grace, maximumOffline));
}
