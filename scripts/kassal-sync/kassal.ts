// Tynn klient mot Kassal.app-API-et (https://kassal.app/api).
// Token holdes server-side (sync-jobben) – aldri i app-bundelen.

const BASE = 'https://kassal.app/api/v1';
const TOKEN = process.env.KASSAL_API_TOKEN;

export interface KassalStore {
  name?: string;
  code?: string;
  url?: string;
  logo?: string;
}

export interface KassalPricePoint {
  price: number | string;
  date?: string;
}

export interface KassalSearchProduct {
  id: number;
  name: string;
  brand?: string | null;
  vendor?: string | null;
  ean?: string | null;
  url?: string | null;
  image?: string | null;
  category?: { name?: string }[] | null;
  current_price?: number | string | null;
  current_unit_price?: number | string | null;
  store?: KassalStore | null;
  price_history?: KassalPricePoint[];
}

interface KassalList<T> {
  data: T[];
  links?: { next?: string | null };
  meta?: { current_page?: number; per_page?: number; to?: number };
}

async function kassal<T>(path: string, params: Record<string, string | number> = {}): Promise<KassalList<T>> {
  if (!TOKEN) throw new Error('KASSAL_API_TOKEN mangler i miljøet');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (res.status === 429) throw new Error('Kassal rate limit (60/min) – senk farten på syncen');
  if (!res.ok) throw new Error(`Kassal ${res.status}: ${await res.text()}`);
  return (await res.json()) as KassalList<T>;
}

/** Søk i produktkatalogen. Ett søk returnerer samme EAN på tvers av alle kjeder. */
export function searchProducts(search: string, page = 1, size = 100) {
  return kassal<KassalSearchProduct>('/products', { search, page, size });
}
