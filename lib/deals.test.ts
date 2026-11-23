import { describe, expect, it, vi } from 'vitest';
import type { MenyProduct } from './types';

const getItem = vi.hoisted(() => vi.fn());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem } }));
vi.mock('./catalog', () => ({}));

const {
  isActiveDealProduct,
  loadCachedDeals,
  matchesDealSearch,
  selectTopDeals,
} = await import('./deals');

describe('matchesDealSearch', () => {
  const product = {
    name: 'Økologisk melk',
    brand: 'TINE',
    chain: 'KIWI',
    campaign_text: '3 for 2',
  };

  it('matches multiple terms without regard to case or Norwegian characters', () => {
    expect(matchesDealSearch(product, 'okologisk MELK')).toBe(true);
    expect(matchesDealSearch(product, 'kiwi tine')).toBe(true);
  });

  it('matches campaign text and returns false when a term is missing', () => {
    expect(matchesDealSearch(product, '3 2')).toBe(true);
    expect(matchesDealSearch(product, 'melk havre')).toBe(false);
  });

  it('matches every deal when the query is blank', () => {
    expect(matchesDealSearch(product, '   ')).toBe(true);
  });
});

describe('loadCachedDeals', () => {
  const deal = { ean: '7038010000000', name: 'Melk' };

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

  it('drops rows without ean or name', async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify([
        null,
        { name: 'uten ean' },
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

  it('ranks running offers by discount and skips excluded chains and small drops', () => {
    const catalog = [
      product('1', { drop_pct: 15 }),
      product('2', { drop_pct: 40 }),
      product('3', { drop_pct: 60, chain: 'Oda' }),
      product('4', { drop_pct: 3 }),
      product('5', { drop_pct: 50 }),
    ];
    expect(selectTopDeals(catalog, 10).map((p) => p.ean)).toEqual(['5', '2', '1']);
    expect(selectTopDeals(catalog, 10, 2).map((p) => p.ean)).toEqual(['5', '2']);
    // Katalogen deles med resten av appen og må ikke sorteres om.
    expect(catalog.map((p) => p.ean)).toEqual(['1', '2', '3', '4', '5']);
  });
});
