import { describe, expect, it } from 'vitest';
import { isLooseProduct, measureFromMetadata } from './price-measure';

const measure = (
  weight: number | string | null | undefined,
  weight_unit: string | null | undefined,
  name = 'Vare',
  ean?: string | null,
) => measureFromMetadata({ name, ean, weight, weight_unit });

describe('isLooseProduct', () => {
  it('treats 4- and 5-digit PLU codes as loose produce', () => {
    expect(isLooseProduct('Banan', '4011')).toBe(true);
    expect(isLooseProduct('Banan', '94011')).toBe(true);
  });
  it('does not treat other EAN lengths as PLU codes', () => {
    expect(isLooseProduct('Banan', '401')).toBe(false);
    expect(isLooseProduct('Banan', '401100')).toBe(false);
    expect(isLooseProduct('Melk', '7038010009457')).toBe(false);
    expect(isLooseProduct('Banan', '40a1')).toBe(false);
  });
  it('recognizes loose weight from the product name', () => {
    expect(isLooseProduct('Poteter løsvekt')).toBe(true);
    expect(isLooseProduct('Poteter LØSVEKT')).toBe(true);
    expect(isLooseProduct('Poteter losvekt')).toBe(true);
    expect(isLooseProduct('Epler pr. kg')).toBe(true);
    expect(isLooseProduct('Epler pr kg')).toBe(true);
    expect(isLooseProduct('Epler per kilo')).toBe(true);
    expect(isLooseProduct('Avokado pr stk')).toBe(true);
    expect(isLooseProduct('Avokado per stykk')).toBe(true);
  });
  it('does not match unit words inside other words', () => {
    expect(isLooseProduct('Kyllingfilet 400g')).toBe(false);
    expect(isLooseProduct('Super kgb')).toBe(false);
    expect(isLooseProduct('Upr kg')).toBe(false);
  });
  it('handles a missing or null EAN', () => {
    expect(isLooseProduct('Melk')).toBe(false);
    expect(isLooseProduct('Melk', null)).toBe(false);
    expect(isLooseProduct('Melk', '')).toBe(false);
  });
});

describe('measureFromMetadata unit conversion', () => {
  it('converts weights to kilograms', () => {
    expect(measure(2, 'kg')).toEqual({ amount: 2, unit: 'kg', loose: false });
    expect(measure(500, 'g')).toEqual({ amount: 0.5, unit: 'kg', loose: false });
    expect(measure(130, 'g')).toEqual({ amount: 0.13, unit: 'kg', loose: false });
  });
  it('converts volumes to litres', () => {
    expect(measure(1.5, 'l')).toEqual({ amount: 1.5, unit: 'l', loose: false });
    expect(measure(5, 'dl')).toEqual({ amount: 0.5, unit: 'l', loose: false });
    expect(measure(33, 'cl')).toEqual({ amount: 0.33, unit: 'l', loose: false });
    expect(measure(330, 'ml')).toEqual({ amount: 0.33, unit: 'l', loose: false });
  });
  it('keeps the exact quotient without rounding', () => {
    expect(measure(1, 'g')?.amount).toBe(0.001);
    expect(measure(1, 'ml')?.amount).toBe(0.001);
    expect(measure(1234.5, 'g')?.amount).toBeCloseTo(1.2345, 10);
    expect(measure(7, 'cl')?.amount).toBeCloseTo(0.07, 10);
  });
  it('ignores case and surrounding whitespace in the unit', () => {
    expect(measure(500, ' G ')?.amount).toBe(0.5);
    expect(measure(1, 'KG')?.unit).toBe('kg');
    expect(measure(1, 'Ml')?.unit).toBe('l');
  });
  it('rejects count-based and unknown units', () => {
    expect(measure(6, 'stk')).toBeNull();
    expect(measure(1, 'pk')).toBeNull();
    expect(measure(1, 'gram')).toBeNull();
    expect(measure(1, 'portion')).toBeNull();
  });
  it('rejects units that only exist on Object.prototype', () => {
    expect(measure(1, 'constructor')).toBeNull();
    expect(measure(1, '__proto__')).toBeNull();
  });
});

describe('measureFromMetadata weight parsing', () => {
  it('accepts numeric strings with a decimal comma or point', () => {
    expect(measure('0,5', 'kg')?.amount).toBe(0.5);
    expect(measure('0.5', 'kg')?.amount).toBe(0.5);
    expect(measure(' 250 ', 'g')?.amount).toBe(0.25);
  });
  it('returns null for missing, null or empty values', () => {
    expect(measure(undefined, 'g')).toBeNull();
    expect(measure(null, 'g')).toBeNull();
    expect(measure('', 'g')).toBeNull();
    expect(measure(500, undefined)).toBeNull();
    expect(measure(500, null)).toBeNull();
    expect(measure(500, '')).toBeNull();
    expect(measure(500, '   ')).toBeNull();
  });
  it('returns null for zero, negative and non-finite weights', () => {
    expect(measure(0, 'g')).toBeNull();
    expect(measure('0', 'g')).toBeNull();
    expect(measure(-100, 'g')).toBeNull();
    expect(measure(Number.NaN, 'g')).toBeNull();
    expect(measure(Number.POSITIVE_INFINITY, 'g')).toBeNull();
    expect(measure('500 g', 'g')).toBeNull();
    expect(measure('1.234,5', 'g')).toBeNull();
  });
  it('accepts a very small positive weight', () => {
    expect(measure(0.001, 'kg')).toEqual({ amount: 0.001, unit: 'kg', loose: false });
  });
});

describe('measureFromMetadata loose flag', () => {
  it('marks loose products sold by weight', () => {
    expect(measure(180, 'g', 'Banan', '4011')?.loose).toBe(true);
    expect(measure(1, 'kg', 'Epler pr. kg')?.loose).toBe(true);
  });
  it('never marks a volume as loose', () => {
    expect(measure(1, 'l', 'Melk løsvekt', '4011')?.loose).toBe(false);
  });
  it('does not mark packaged products as loose', () => {
    expect(measure(400, 'g', 'Kyllingfilet', '7038010009457')?.loose).toBe(false);
  });
});
