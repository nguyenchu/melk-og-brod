type UnitKind = 'kg' | 'l' | 'stk';

type ParsedUnit = {
  amount: number;
  unit: UnitKind;
  approximate: boolean;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function unitAmountToBase(value: number, unit: UnitKind | 'g' | 'ml' | 'cl' | 'dl') {
  if (unit === 'kg') return { amount: value, unit: 'kg' as const };
  if (unit === 'g') return { amount: value / 1000, unit: 'kg' as const };
  if (unit === 'l') return { amount: value, unit: 'l' as const };
  if (unit === 'dl') return { amount: value / 10, unit: 'l' as const };
  if (unit === 'cl') return { amount: value / 100, unit: 'l' as const };
  return { amount: value / 1000, unit: 'l' as const };
}

function parseMultipackAmount(normalized: string, approximate: boolean): ParsedUnit | null {
  const patterns = [
    /(\d+)\s*(?:pk|pak|poser?|bokser?)?\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|l|dl|cl|ml)\b/,
    /(\d+)\s*(?:stk|stykker)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|l|dl|cl|ml)\b/,
    /(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|l|dl|cl|ml)\b/,
  ] as const;

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const packs = Number(match[1]);
    const perPack = Number(match[2].replace(',', '.'));
    const rawUnit = match[3] as 'kg' | 'g' | 'l' | 'dl' | 'cl' | 'ml';
    if (!Number.isFinite(packs) || !Number.isFinite(perPack) || packs <= 0 || perPack <= 0) continue;

    const converted = unitAmountToBase(perPack * packs, rawUnit);
    return { amount: converted.amount, unit: converted.unit, approximate };
  }

  return null;
}

export function isApproximateWeight(name: string, ean?: string | null) {
  const normalizedName = normalizeText(name);
  return (
    Boolean(ean?.startsWith('2')) ||
    /ca[\s.]*\d+[,.]?\d*\s*kg\b/.test(normalizedName) ||
    /ca[\s.]*\d+[,.]?\d*\s*g\b/.test(normalizedName) ||
    normalizedName.includes('ca ')
  );
}

function parseWeightOrVolume(name: string, approximate: boolean): ParsedUnit | null {
  const normalized = normalizeText(name);
  const multipack = parseMultipackAmount(normalized, approximate);
  if (multipack) return multipack;

  const kgMatch = normalized.match(/(?:ca[\s.]*)?(\d+[.,]?\d*)\s*kg\b/);
  if (kgMatch) {
    return { amount: Number(kgMatch[1].replace(',', '.')), unit: 'kg', approximate };
  }

  const gramMatch = normalized.match(/(?:ca[\s.]*)?(\d+[.,]?\d*)\s*g\b/);
  if (gramMatch) {
    return { amount: Number(gramMatch[1].replace(',', '.')) / 1000, unit: 'kg', approximate };
  }

  const literMatch = normalized.match(/(\d+[.,]?\d*)\s*l\b/);
  if (literMatch) {
    return { amount: Number(literMatch[1].replace(',', '.')), unit: 'l', approximate: false };
  }

  const dlMatch = normalized.match(/(\d+[.,]?\d*)\s*dl\b/);
  if (dlMatch) {
    return { amount: Number(dlMatch[1].replace(',', '.')) / 10, unit: 'l', approximate: false };
  }

  const clMatch = normalized.match(/(\d+[.,]?\d*)\s*cl\b/);
  if (clMatch) {
    return { amount: Number(clMatch[1].replace(',', '.')) / 100, unit: 'l', approximate: false };
  }

  const mlMatch = normalized.match(/(\d+[.,]?\d*)\s*ml\b/);
  if (mlMatch) {
    return { amount: Number(mlMatch[1].replace(',', '.')) / 1000, unit: 'l', approximate: false };
  }

  return null;
}

function parseCount(name: string): ParsedUnit | null {
  const normalized = normalizeText(name);
  const countMatch =
    normalized.match(/\b(\d+)\s*stk\b/) ??
    normalized.match(/\b(\d+)\s*pk\b/) ??
    normalized.match(/\b(\d+)-pk\b/) ??
    normalized.match(/\b(\d+)pk\b/);

  if (!countMatch) return null;

  const amount = Number(countMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit: 'stk', approximate: false };
}

export function inferUnitFromProduct(name: string, ean?: string | null) {
  const approximate = isApproximateWeight(name, ean);
  return parseWeightOrVolume(name, approximate) ?? parseCount(name);
}

export function formatDisplayPrice(value: number | null | undefined, approximate = false) {
  if (value == null) return null;
  return approximate ? `${Math.round(value)} kr` : `${value.toFixed(2)} kr`;
}

export function formatUnitPriceLabel(input: {
  name: string;
  price: number | null | undefined;
  ean?: string | null;
}) {
  if (input.price == null) return null;

  const parsed = inferUnitFromProduct(input.name, input.ean);
  if (!parsed || !Number.isFinite(parsed.amount) || parsed.amount <= 0) return null;

  const unitPrice = input.price / parsed.amount;
  const value = parsed.approximate ? `${Math.round(unitPrice)} kr/${parsed.unit}` : `${unitPrice.toFixed(2)} kr/${parsed.unit}`;
  return parsed.approximate ? `ca. ${value}` : value;
}
