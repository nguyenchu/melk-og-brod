import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('./catalog', () => ({}));

const { isActiveDealProduct, isExpiredOffer, isUpcomingOffer } = await import('./deals');

const NOW = Date.parse('2026-09-24T08:00:00+02:00');

describe('isExpiredOffer', () => {
  it('treats a tjek date without colon in the offset as expired once passed', () => {
    expect(isExpiredOffer({ valid_until: '2026-09-23T21:59:59+0000' }, NOW)).toBe(true);
  });

  it('keeps offers that are still running', () => {
    expect(isExpiredOffer({ valid_until: '2026-09-27T21:59:59+0000' }, NOW)).toBe(false);
  });

  it('never expires rows without a date or with an unparseable one', () => {
    expect(isExpiredOffer({ valid_until: null }, NOW)).toBe(false);
    expect(isExpiredOffer({}, NOW)).toBe(false);
    expect(isExpiredOffer({ valid_until: 'snart' }, NOW)).toBe(false);
  });
});

describe('isActiveDealProduct', () => {
  it('drops an expired weekly offer even though tjek rows always count as deals', () => {
    const offer = {
      price_source: 'tjek' as const,
      campaign_text: null,
      drop_pct: 77,
      valid_until: '2000-01-01T00:00:00+0000',
    };
    expect(isActiveDealProduct(offer)).toBe(false);
    expect(isActiveDealProduct({ ...offer, valid_until: '2999-01-01T00:00:00+0000' })).toBe(true);
  });
});

describe('isUpcomingOffer', () => {
  it('flags a Friday-only offer on Thursday, and not once Friday has started', () => {
    const fridayOnly = { valid_from: '2026-09-24T22:00:00.000Z' }; // fredag 00:00 i Oslo
    expect(isUpcomingOffer(fridayOnly, NOW)).toBe(true); // torsdag 08:00
    expect(isUpcomingOffer(fridayOnly, Date.parse('2026-09-25T08:00:00+02:00'))).toBe(false);
  });

  it('treats offers without a start date as running', () => {
    expect(isUpcomingOffer({ valid_from: null }, NOW)).toBe(false);
    expect(isUpcomingOffer({}, NOW)).toBe(false);
  });
});
