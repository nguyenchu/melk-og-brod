import { describe, expect, it } from 'vitest';
import { selectSuperDeals } from './super-deals';
import type { MenyProduct } from './types';

const now = Date.parse('2026-11-04T10:00:00Z');
const deal: MenyProduct = {
  ean: '123',
  name: 'Kaffe',
  brand: null,
  image_url: null,
  vendor_url: null,
  chain: 'Meny',
  current_price: 30,
  median_30d: 50,
  original_price: 50,
  price_source: 'tjek',
  drop_pct: 40,
  campaign_text: null,
  cheapest_price: null,
  cheapest_chain: null,
  stores: null,
  computed_at: new Date(now).toISOString(),
  price_history: null,
};

describe('selectSuperDeals', () => {
  it('requires both thresholds and ranks by discount then savings', () => {
    const offers = [
      deal,
      { ...deal, ean: '124', current_price: 30.01 },
      { ...deal, ean: '125', current_price: 10, original_price: 29.99 },
      { ...deal, ean: '126', current_price: 20 },
      { ...deal, ean: '127', current_price: 60, original_price: 100 },
    ];
    expect(selectSuperDeals(offers, now).map(({ product }) => product.ean)).toEqual([
      '126',
      '127',
      '123',
    ]);
  });

  it('skips unknown comparison prices and campaigns outside their validity period', () => {
    expect(
      selectSuperDeals(
        [
          { ...deal, original_price: null },
          { ...deal, valid_from: '2026-11-05T10:00:00+0000' },
          { ...deal, valid_until: '2026-11-04T10:00:00+0000' },
          { ...deal, valid_until: 'invalid' },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it('uses the historical median for catalog price drops', () => {
    const [result] = selectSuperDeals(
      [{ ...deal, price_source: 'median', original_price: null }],
      now,
    );
    expect(result).toMatchObject({ saved: 2000, discount: 40 });
  });
});
