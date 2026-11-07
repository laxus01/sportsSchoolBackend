import {
  addCalendarDays,
  bogotaMidnightUtc,
  computeOfflineUntil,
  getSubscriptionBounds,
  isDateOnly,
} from '../src/common/date-policy';

describe('license date policy', () => {
  it('treats the paid-through date as inclusive in America/Bogota', () => {
    const bounds = getSubscriptionBounds('2026-12-01', 10);
    expect(bounds.paidThrough.toISOString()).toBe('2026-12-02T05:00:00.000Z');
    expect(bounds.graceUntil.toISOString()).toBe('2026-12-12T05:00:00.000Z');
  });

  it('caps a subscription offline grant by the grace boundary and 30 days', () => {
    const issuedAt = new Date('2026-11-01T12:00:00.000Z');
    const graceUntil = new Date('2026-11-20T00:00:00.000Z');
    expect(computeOfflineUntil(graceUntil, issuedAt).toISOString()).toBe(
      graceUntil.toISOString(),
    );
    expect(
      computeOfflineUntil(
        new Date('2026-12-20T00:00:00.000Z'),
        issuedAt,
      ).toISOString(),
    ).toBe('2026-12-01T12:00:00.000Z');
  });

  it('validates date-only inputs without normalizing impossible dates', () => {
    expect(isDateOnly('2026-02-28')).toBe(true);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(addCalendarDays('2026-12-01', 11)).toBe('2026-12-12');
  });

  it('converts Bogota local midnight to UTC', () => {
    expect(bogotaMidnightUtc('2026-12-12').toISOString()).toBe(
      '2026-12-12T05:00:00.000Z',
    );
  });
});
