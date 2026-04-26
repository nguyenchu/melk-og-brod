import { supabase } from './supabase';
import type { MenyProduct } from './types';

const MAX_DEAL_AGE_HOURS = 48;

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreProduct(product: MenyProduct, terms: string[]) {
  const name = normalizeSearchText(product.name);
  const brand = normalizeSearchText(product.brand ?? '');
  const vendorUrl = normalizeSearchText(product.vendor_url ?? '');
  const haystack = `${name} ${brand}`.trim();
  const words = haystack.split(/\s+/).filter(Boolean);

  let score = 0;
  for (const term of terms) {
    const exactWord = words.includes(term);
    const prefixWord = words.some((word) => word.startsWith(term));
    const containsWord = words.some((word) => word.includes(term));
    const brandPrefix = brand.startsWith(term);
    const categoryWord = vendorUrl.includes(` ${term} `) || vendorUrl.endsWith(` ${term}`);

    if (!exactWord && !prefixWord && !containsWord && !brandPrefix && !categoryWord) return -1;
    if (exactWord) {
      score += 200;
      continue;
    }
    if (name.startsWith(term)) score += 140;
    if (prefixWord) score += 100;
    if (brandPrefix) score += 50;
    if (categoryWord) score += 60;
    if (containsWord) score += term.length <= 3 ? 8 : 20;
  }

  if (name === terms.join(' ')) score += 200;
  if (product.current_price != null) score += Math.max(0, 20 - product.current_price / 20);
  return score;
}

export async function fetchTopDeals(minDropPct = 10, limit = 100): Promise<MenyProduct[]> {
  const freshestAllowed = new Date(Date.now() - MAX_DEAL_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .not('drop_pct', 'is', null)
    .gte('drop_pct', minDropPct)
    .gte('computed_at', freshestAllowed)
    .order('drop_pct', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MenyProduct[];
}

export async function searchProducts(query: string, limit = 30): Promise<MenyProduct[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const terms = normalizeSearchText(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const clauses = terms
    .slice(0, 4)
    .flatMap((term) => {
      const escaped = term.replace(/[%_]/g, (m) => `\\${m}`);
      return [`name.ilike.%${escaped}%`, `brand.ilike.%${escaped}%`];
    })
    .join(',');
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .or(clauses)
    .limit(Math.max(limit * 4, 60));
  if (error) throw error;
  return ((data ?? []) as MenyProduct[])
    .map((product) => ({ product, score: scoreProduct(product, terms) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.product.current_price == null) return 1;
      if (b.product.current_price == null) return -1;
      return a.product.current_price - b.product.current_price;
    })
    .slice(0, limit)
    .map((entry) => entry.product);
}
