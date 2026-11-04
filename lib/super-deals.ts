import type { MenyProduct } from './types';

const MIN_SAVED_ORE = 2000;
const MIN_DISCOUNT_PCT = 40;

function offerDate(value: string | null | undefined, fallback: number) {
  return value ? Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : fallback;
}

export function selectSuperDeals(catalog: MenyProduct[], now = Date.now()) {
  const deals = catalog.flatMap((product) => {
    const starts = offerDate(product.valid_from, -Infinity);
    const ends = offerDate(product.valid_until, Infinity);
    if (!(starts <= now && now < ends) || product.multibuy) return [];
    const comparison =
      product.price_source === 'median' ? product.median_30d : product.original_price;
    if (!comparison || !product.current_price || !product.chain) return [];
    const price = Math.round(product.current_price * 100);
    const normal = Math.round(comparison * 100);
    if (!Number.isSafeInteger(price) || !Number.isSafeInteger(normal) || price <= 0) return [];
    const saved = normal - price;
    if (saved < MIN_SAVED_ORE || saved * 100 < normal * MIN_DISCOUNT_PCT) return [];
    const campaign = JSON.stringify([product.chain, product.ean, starts, ends]);
    return [{ product, campaign, saved, discount: Math.floor((saved * 100) / normal), ends }];
  });
  return deals.sort((a, b) => b.discount - a.discount || b.saved - a.saved);
}
