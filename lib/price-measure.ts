/** The quantity represented by a product's purchase price, supplied by its store. */
export type PriceMeasure = {
  amount: number;
  unit: 'kg' | 'l';
  loose: boolean;
};

export function isLooseProduct(name: string, ean?: string | null) {
  return (
    /^\d{4,5}$/.test(ean ?? '') ||
    /løsvekt|losvekt|\b(?:pr\.?|per)\s*(?:kg|kilo|stk|stykk)\b/i.test(name)
  );
}

export function measureFromMetadata(input: {
  name: string;
  ean?: string | null;
  weight?: number | string | null;
  weight_unit?: string | null;
}): PriceMeasure | null {
  const weight = Number(String(input.weight ?? '').replace(',', '.'));
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const unit = input.weight_unit?.trim().toLowerCase();
  const conversions: Record<string, { unit: 'kg' | 'l'; divisor: number }> = {
    kg: { unit: 'kg', divisor: 1 },
    g: { unit: 'kg', divisor: 1000 },
    l: { unit: 'l', divisor: 1 },
    dl: { unit: 'l', divisor: 10 },
    cl: { unit: 'l', divisor: 100 },
    ml: { unit: 'l', divisor: 1000 },
  };
  const conversion = unit ? conversions[unit] : null;
  if (!conversion) return null;
  return {
    amount: weight / conversion.divisor,
    unit: conversion.unit,
    loose: conversion.unit === 'kg' && isLooseProduct(input.name, input.ean),
  };
}
