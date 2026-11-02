import { describe, expect, it, vi } from 'vitest';
import type { MenyProduct } from './types';

const getItem = vi.hoisted(() => vi.fn());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem } }));
vi.mock('./catalog', () => ({}));

const { isActiveDealProduct, isExpiredOffer, isUpcomingOffer, loadCachedDeals, selectTopDeals } =
  await import('./deals');

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

describe('loadCachedDeals', () => {
  const deal = { ean: '7038010000000', name: 'Melk', valid_until: null };

  it('returns nothing when the cache is missing, unreadable or not a list', async () => {
    for (const raw of [null, '{ikke json', '{"ean":"1","name":"Melk"}', 'null']) {
      getItem.mockResolvedValueOnce(raw);
      await expect(loadCachedDeals()).resolves.toBeNull();
    }
  });

  it('returns nothing instead of throwing when storage fails', async () => {
    getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(loadCachedDeals()).resolves.toBeNull();
  });

  it('drops rows without ean or name, rows with a bad date, and expired offers', async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify([
        null,
        { name: 'uten ean' },
        { ean: '1', name: 'Dato som tall', valid_until: 20261101 },
        { ean: '2', name: 'Utløpt', valid_until: '2000-01-01T00:00:00+0000' },
        deal,
      ]),
    );
    await expect(loadCachedDeals()).resolves.toEqual([deal]);
  });
});

describe('selectTopDeals', () => {
  const product = (ean: string, fields: Partial<MenyProduct>): MenyProduct => ({
    ean,
    name: `Vare ${ean}`,
    brand: null,
    image_url: null,
    vendor_url: null,
    chain: 'KIWI',
    current_price: 10,
    median_30d: null,
    original_price: null,
    price_source: 'median',
    drop_pct: null,
    campaign_text: null,
    cheapest_price: null,
    cheapest_chain: null,
    stores: null,
    computed_at: '2026-09-24T06:00:00Z',
    price_history: null,
    ...fields,
  });

  it('ranks running offers by discount and skips excluded chains, expired and small drops', () => {
    const catalog = [
      product('1', { drop_pct: 15 }),
      product('2', { drop_pct: 40 }),
      product('3', { drop_pct: 60, chain: 'Oda' }),
      product('4', { drop_pct: 3 }),
      product('5', { drop_pct: 50, valid_from: '2999-01-01T00:00:00+0000' }),
      product('6', { drop_pct: 70, valid_until: '2000-01-01T00:00:00+0000' }),
    ];
    expect(selectTopDeals(catalog, 10).map((p) => p.ean)).toEqual(['2', '1', '5']);
    expect(selectTopDeals(catalog, 10, 2).map((p) => p.ean)).toEqual(['2', '1']);
    // Katalogen deles med resten av appen og må ikke sorteres om.
    expect(catalog.map((p) => p.ean)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});
