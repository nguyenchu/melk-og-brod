import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MenyProduct } from './types';

// Statisk katalog matet av Kassal-syncen (scripts/kassal-sync → products.json),
// servert som en vanlig fil. Appen henter den én gang, cacher den, og rangerer/
// filtrerer klient-side. Ingen database, ingen API-token i appen.
const DATA_URL = process.env.EXPO_PUBLIC_DATA_URL ?? null;
const CACHE_KEY = 'catalog.v1';
const TTL_MS = 6 * 60 * 60 * 1000; // hent på nytt hvis cachen er eldre enn 6 t

type CatalogPayload = { computed_at: string; count: number; products: MenyProduct[] };
type CachedCatalog = { fetched_at: number; payload: CatalogPayload };

let memoryProducts: MenyProduct[] | null = null;
let memoryComputedAt: string | null = null;
let inflight: Promise<MenyProduct[]> | null = null;

export function hasDataConfig() {
  return DATA_URL !== null;
}

export function getCatalogComputedAt(): string | null {
  return memoryComputedAt;
}

async function readCache(): Promise<CachedCatalog | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedCatalog) : null;
  } catch {
    return null;
  }
}

async function fetchFresh(): Promise<CatalogPayload | null> {
  if (!DATA_URL) return null;
  const res = await fetch(DATA_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Katalog ${res.status}`);
  return (await res.json()) as CatalogPayload;
}

function adopt(payload: CatalogPayload): MenyProduct[] {
  memoryProducts = payload.products ?? [];
  memoryComputedAt = payload.computed_at ?? null;
  return memoryProducts;
}

async function loadCatalog(forceNetwork: boolean): Promise<MenyProduct[]> {
  const cached = await readCache();
  const stale = !cached || Date.now() - cached.fetched_at > TTL_MS;

  // Fersk nok cache: bruk den uten nettkall.
  if (cached && !stale && !forceNetwork) return adopt(cached.payload);

  try {
    const payload = await fetchFresh();
    if (payload) {
      // Cache er best-effort: store kataloger kan sprenge AsyncStorage/localStorage-grensa
      // (~5–6 MB). En feilet skriving skal aldri hindre at vi bruker de ferske dataene.
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ fetched_at: Date.now(), payload }));
      } catch {
        // ignorer – fortsett med ferske data i minnet
      }
      return adopt(payload);
    }
  } catch (e) {
    // Ingen nett: fall tilbake på cache hvis vi har den.
    if (cached) return adopt(cached.payload);
    throw e;
  }

  if (cached) return adopt(cached.payload);
  return adopt({ computed_at: '', count: 0, products: [] });
}

/** Hele katalogen (cache-først, nett ved utløpt TTL). Deles i minnet for økta. */
export async function getCatalog(): Promise<MenyProduct[]> {
  if (memoryProducts) return memoryProducts;
  if (!inflight) inflight = loadCatalog(false).finally(() => { inflight = null; });
  return inflight;
}

/** Tving nytt nettkall (pull-to-refresh). */
export async function refreshCatalog(): Promise<MenyProduct[]> {
  inflight = loadCatalog(true).finally(() => { inflight = null; });
  return inflight;
}
