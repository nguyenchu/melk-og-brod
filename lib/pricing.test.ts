import { describe, expect, it } from 'vitest';
import { measureFromMetadata } from './price-measure';
import { formatUnitPriceLabel, pricePresentation } from './pricing';

const potato = {
  name: 'Poteter løsvekt',
  ean: '4073',
  price: 1.3,
  unit_price: 10,
  price_measure: measureFromMetadata({
    name: 'Poteter løsvekt',
    ean: '4073',
    weight: 130,
    weight_unit: 'g',
  }),
};

describe('store quantity metadata', () => {
  it('keeps the 130 gram purchase basis for potatoes instead of assuming a kilo', () => {
    expect(potato.price_measure).toEqual({ amount: 0.13, unit: 'kg', loose: true });
  });
  it('recognizes a loose PLU product even without løsvekt in its name', () => {
    expect(
      measureFromMetadata({ name: 'Banan', ean: '4011', weight: '180', weight_unit: 'g' })?.loose,
    ).toBe(true);
  });
  it('keeps packaged liquid prices on a litre basis', () => {
    expect(
      measureFromMetadata({
        name: 'Pepsi Max',
        ean: '7044618874687',
        weight: 6000,
        weight_unit: 'ml',
      }),
    ).toEqual({ amount: 6, unit: 'l', loose: false });
  });
  it.each([null, 0, -1, 'unknown', Number.NaN])('rejects invalid weight %s', (weight) => {
    expect(measureFromMetadata({ name: 'Poteter løsvekt', weight, weight_unit: 'g' })).toBeNull();
  });
  it('does not guess an unknown weight unit', () => {
    expect(
      measureFromMetadata({ name: 'Poteter løsvekt', weight: 130, weight_unit: 'portion' }),
    ).toBeNull();
  });
});

describe('price presentation', () => {
  it('shows 10 kr/kg prominently and the estimated purchase price underneath', () => {
    expect(pricePresentation(potato)).toMatchObject({
      primary: '10,00 kr/kg',
      secondary: 'ca. 1,30 kr per 130 g',
      purchase: 'ca. 1,30 kr/stk',
      loose: true,
    });
  });
  it('uses the same weight basis for the historical median, without the current unit price', () => {
    expect(pricePresentation({ ...potato, price: 4.28, unit_price: null }).primary).toBe(
      '32,92 kr/kg',
    );
  });
  it('calculates unit price from quantity when a store has no explicit unit price', () => {
    expect(pricePresentation({ ...potato, price: 3.5, unit_price: null }).primary).toBe(
      '26,92 kr/kg',
    );
  });
  it('ignores invalid unit prices', () => {
    expect(pricePresentation({ ...potato, unit_price: Number.NaN }).primary).toBe('10,00 kr/kg');
  });
  it('labels old cached prices as per piece without inventing the missing weight', () => {
    expect(pricePresentation({ name: 'Poteter løsvekt', ean: '4073', price: 1.3 })).toMatchObject({
      primary: 'ca. 1,30 kr/stk',
      secondary: 'Løsvekt · kilopris mangler',
    });
  });
  it('does not treat a packaged product as loose weight', () => {
    const product = { name: 'Kaviar 185g', ean: '7038010000010', price: 21.54 };
    expect(pricePresentation(product)).toMatchObject({
      primary: '21.54 kr',
      secondary: '116.43 kr/kg',
      loose: false,
    });
  });
  it('uses metadata for a package whose name does not contain its size', () => {
    const product = {
      name: 'Pepsi Max',
      price: 99,
      price_measure: { amount: 6, unit: 'l' as const, loose: false },
      unit_price: 16.5,
    };
    expect(formatUnitPriceLabel(product)).toBe('16.50 kr/l');
    expect(pricePresentation(product).primary).toBe('99.00 kr');
  });
});
