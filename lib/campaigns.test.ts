import { describe, expect, it } from 'vitest';
import {
  computeCartTotals,
  getBundlePayForOffer,
  getCampaignKind,
  isLikelyCampaignText,
} from './campaigns';

describe('getBundlePayForOffer', () => {
  it('parses "3 for 2"', () => {
    expect(getBundlePayForOffer('3 for 2')).toEqual({ buy: 3, payFor: 2 });
  });

  it('parses "3 for 2 på all tannpleie"', () => {
    expect(getBundlePayForOffer('3 for 2 på all tannpleie')).toEqual({ buy: 3, payFor: 2 });
  });

  it('parses dashed form "3-for-2"', () => {
    expect(getBundlePayForOffer('3-for-2')).toEqual({ buy: 3, payFor: 2 });
  });

  it('parses "kjøp 3 betal 2"', () => {
    expect(getBundlePayForOffer('kjøp 3 betal 2')).toEqual({ buy: 3, payFor: 2 });
  });

  it('parses "kjop 5 betal for 4"', () => {
    expect(getBundlePayForOffer('kjop 5 betal for 4')).toEqual({ buy: 5, payFor: 4 });
  });

  it('rejects invalid ratios where payFor >= buy', () => {
    expect(getBundlePayForOffer('2 for 3')).toBeNull();
    expect(getBundlePayForOffer('2 for 2')).toBeNull();
  });

  it('rejects single-unit "1 for 1"', () => {
    expect(getBundlePayForOffer('1 for 1')).toBeNull();
  });

  it('returns null for non-bundle text', () => {
    expect(getBundlePayForOffer('Tilbud')).toBeNull();
    expect(getBundlePayForOffer('−30% rabatt')).toBeNull();
    expect(getBundlePayForOffer('')).toBeNull();
    expect(getBundlePayForOffer(null)).toBeNull();
    expect(getBundlePayForOffer(undefined)).toBeNull();
  });
});

describe('isLikelyCampaignText', () => {
  it('accepts common Norwegian campaign phrases', () => {
    expect(isLikelyCampaignText('3 for 2')).toBe(true);
    expect(isLikelyCampaignText('Kjøp 3 betal 2')).toBe(true);
    expect(isLikelyCampaignText('Plukk & miks Jacobs Utvalgte')).toBe(true);
    expect(isLikelyCampaignText('Medlemspris')).toBe(true);
    expect(isLikelyCampaignText('Tilbud')).toBe(true);
    expect(isLikelyCampaignText('−30% rabatt')).toBe(true);
    expect(isLikelyCampaignText('Ryddesalg')).toBe(true);
    expect(isLikelyCampaignText('Fast sommerpris')).toBe(true);
  });

  it('rejects empty and structural noise', () => {
    expect(isLikelyCampaignText('')).toBe(false);
    expect(isLikelyCampaignText(null)).toBe(false);
    expect(isLikelyCampaignText(undefined)).toBe(false);
    expect(isLikelyCampaignText('{"foo": "bar"}')).toBe(false);
    expect(isLikelyCampaignText('chainId=1300')).toBe(false);
    expect(isLikelyCampaignText('rainforest_alliance')).toBe(false);
  });

  it('rejects overly long text', () => {
    expect(isLikelyCampaignText('x'.repeat(80))).toBe(false);
  });

  it('rejects generic words without a campaign signal', () => {
    expect(isLikelyCampaignText('Best i test')).toBe(false);
    expect(isLikelyCampaignText('Made in Norway')).toBe(false);
  });
});

describe('getCampaignKind', () => {
  it('classifies bundle offers', () => {
    expect(getCampaignKind('3 for 2')).toBe('bundle');
    expect(getCampaignKind('Kjøp 3 betal 2')).toBe('bundle');
  });

  it('classifies membership pricing', () => {
    expect(getCampaignKind('Medlemspris')).toBe('member');
  });

  it('classifies Trumf bonus', () => {
    expect(getCampaignKind('+20% Trumf-bonus')).toBe('bonus');
  });

  it('classifies clearance', () => {
    expect(getCampaignKind('Ryddesalg')).toBe('clearance');
  });

  it('falls back to generic for ordinary sale text', () => {
    expect(getCampaignKind('Tilbud')).toBe('generic');
    expect(getCampaignKind('−30% rabatt')).toBe('generic');
    expect(getCampaignKind('')).toBe('generic');
    expect(getCampaignKind(null)).toBe('generic');
  });
});

describe('computeCartTotals', () => {
  it('returns 0 for empty list', () => {
    const out = computeCartTotals([]);
    expect(out.total).toBe(0);
    expect(out.savings).toBe(0);
    expect(out.bundleSavings).toEqual([]);
  });

  it('skips checked items', () => {
    const out = computeCartTotals([{ price: 50, quantity: 2, checked: true, campaign_text: null }]);
    expect(out.total).toBe(0);
  });

  it('skips items with null or zero price', () => {
    const out = computeCartTotals([
      { price: null, quantity: 2, campaign_text: null },
      { price: 0, quantity: 2, campaign_text: null },
    ]);
    expect(out.total).toBe(0);
  });

  it('sums non-bundle items at full price', () => {
    const out = computeCartTotals([
      { price: 50, quantity: 2, campaign_text: null },
      { price: 30, quantity: 1, campaign_text: 'Tilbud' }, // not a bundle
    ]);
    expect(out.total).toBe(130);
    expect(out.savings).toBe(0);
  });

  it('discounts a single-product bundle (3x same item, 3-for-2)', () => {
    const out = computeCartTotals([{ price: 52.43, quantity: 3, campaign_text: '3 for 2' }]);
    expect(out.total).toBeCloseTo(104.86, 2);
    expect(out.savings).toBeCloseTo(52.43, 2);
  });

  it('discounts across mixed products in the same campaign', () => {
    // 3 different Jacobs Utvalgte items, all "3 for 2" — cheapest is free
    const out = computeCartTotals([
      { price: 52.43, quantity: 1, campaign_text: '3 for 2' },
      { price: 52.85, quantity: 1, campaign_text: '3 for 2' },
      { price: 52.43, quantity: 1, campaign_text: '3 for 2' },
    ]);
    expect(out.total).toBeCloseTo(105.28, 2); // 52.43 + 52.85
    expect(out.savings).toBeCloseTo(52.43, 2);
  });

  it('applies multiple bundles within a single group (6 items = 2 bundles)', () => {
    const out = computeCartTotals([
      { price: 52.43, quantity: 2, campaign_text: '3 for 2' },
      { price: 60.0, quantity: 1, campaign_text: '3 for 2' },
      { price: 52.85, quantity: 3, campaign_text: '3 for 2' },
    ]);
    // sorted: [52.43, 52.43, 52.85, 52.85, 52.85, 60.0]
    // 2 cheapest (52.43 + 52.43) free → paid = 52.85 + 52.85 + 52.85 + 60 = 218.55
    expect(out.total).toBeCloseTo(218.55, 2);
    expect(out.savings).toBeCloseTo(104.86, 2);
  });

  it('prices a fixed-price multibuy ("3 for 100"): 1 = single, 3 = exact bundle', () => {
    const multibuy = { quantity: 3, price: 100, single: 69.6 };
    const one = computeCartTotals([
      { price: 69.6, quantity: 1, campaign_text: '3 for 100 kr', multibuy },
    ]);
    expect(one.total).toBeCloseTo(69.6, 2); // 1 stk = vanlig enkeltpris, ikke 33.33
    const three = computeCartTotals([
      { price: 69.6, quantity: 3, campaign_text: '3 for 100 kr', multibuy },
    ]);
    expect(three.total).toBe(100); // eksakt, ingen 99.99-avrunding
    expect(three.savings).toBeCloseTo(108.8, 2);
  });

  it('multibuy charges the remainder at single price (4 = bundle + 1)', () => {
    const multibuy = { quantity: 3, price: 100, single: 69.6 };
    const out = computeCartTotals([
      { price: 69.6, quantity: 4, campaign_text: '3 for 100 kr', multibuy },
    ]);
    expect(out.total).toBeCloseTo(169.6, 2); // 100 + 69.60
  });

  it('does not mix items from different campaigns', () => {
    const out = computeCartTotals([
      { price: 50, quantity: 1, campaign_text: '3 for 2' },
      { price: 50, quantity: 1, campaign_text: '3 for 2 på tannpleie' },
      { price: 50, quantity: 1, campaign_text: '3 for 2' },
    ]);
    // Each campaign group has < 3 items, no bundle triggers
    expect(out.total).toBe(150);
    expect(out.savings).toBe(0);
  });

  it('reports bundle savings per campaign label', () => {
    const out = computeCartTotals([
      { price: 50, quantity: 3, campaign_text: '3 for 2' },
      { price: 80, quantity: 3, campaign_text: '3 for 2 på all tannpleie' },
    ]);
    expect(out.bundleSavings).toHaveLength(2);
    const labels = out.bundleSavings.map((b) => b.campaign).sort();
    expect(labels).toEqual(['3 for 2', '3 for 2 på all tannpleie']);
    expect(out.total).toBeCloseTo(50 * 2 + 80 * 2, 2);
  });

  it('handles partial bundles (4 items, "3 for 2" = 1 free)', () => {
    const out = computeCartTotals([{ price: 50, quantity: 4, campaign_text: '3 for 2' }]);
    // 4 units, 1 bundle of 3 → 1 free; the 4th is full price
    expect(out.total).toBe(50 * 3); // 150
    expect(out.savings).toBe(50);
  });

  it('handles "kjøp 3 betal 2" alongside "3 for 2" as separate groups', () => {
    const out = computeCartTotals([
      { price: 50, quantity: 3, campaign_text: 'kjøp 3 betal 2' },
      { price: 50, quantity: 3, campaign_text: '3 for 2' },
    ]);
    // Both are bundles, but in separate groups (different campaign_text)
    expect(out.total).toBe(50 * 4); // each group: 2 paid, 1 free
    expect(out.savings).toBe(50 * 2);
  });
});
