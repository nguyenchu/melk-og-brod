import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MenyProduct } from './types';

// Statisk katalog matet av Kassal-syncen (scripts/kassal-sync → products.json),
// servert som en vanlig fil. Appen henter den én gang, cacher den, og rangerer/
// filtrerer klient-side. Ingen database, ingen API-token i appen.
const DEFAULT_DATA_URL = 'https://nguyenchu.com/matkupp/products.json';
const DATA_URL = process.env.EXPO_PUBLIC_DATA_URL || DEFAULT_DATA_URL;
const CACHE_KEY = 'catalog.v5';
const TTL_MS = 6 * 60 * 60 * 1000; // hent på nytt hvis cachen er eldre enn 6 t

type CatalogPayload = { computed_at: string; count: number; products: MenyProduct[] };
// etag kommer fra serveren og sendes tilbake som If-None-Match. Er katalogen
// uendret, svarer serveren 304 uten innhold i stedet for hele fila (~2 MB).
type CachedCatalog = { fetched_at: number; etag?: string | null; payload: CatalogPayload };

let memory: CachedCatalog | null = null;
let storedRead: Promise<CachedCatalog | null> | null = null;
let inflight: Promise<MenyProduct[]> | null = null;

export function hasDataConfig() {
  return DATA_URL !== null;
}

export function getCatalogComputedAt(): string | null {
  return memory?.payload.computed_at ?? null;
}

// Cachen kan være korrupt eller fra et eldre format; da er den verdiløs og
// behandles som bom, slik at vi henter fra nettet i stedet for å krasje.
function isCachedCatalog(value: unknown): value is CachedCatalog {
  if (!value || typeof value !== 'object') return false;
  const { fetched_at, etag, payload } = value as Partial<CachedCatalog>;
  return (
    typeof fetched_at === 'number' &&
    Number.isFinite(fetched_at) &&
    (etag == null || typeof etag === 'string') &&
    !!payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.products) &&
    payload.products.every((p) => !!p && typeof p === 'object')
  );
}

async function readCache(): Promise<CachedCatalog | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedCatalog(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Lagringen leses én gang per økt, selv om flere spør samtidig ved oppstart.
// Etterpå er minnet sannheten.
function readCacheOnce(): Promise<CachedCatalog | null> {
  if (!storedRead) storedRead = readCache();
  return storedRead;
}

async function writeCache(record: CachedCatalog) {
  // Cache er best-effort: store kataloger kan sprenge AsyncStorage/localStorage-grensa
  // (~5–6 MB). En feilet skriving skal aldri hindre at vi bruker de ferske dataene.
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch {
    // ignorer – fortsett med ferske data i minnet
  }
}

function dataUrl() {
  // Unik URL forbi alle mellomlagre; ETag-en gjør det billig når ingenting er endret.
  const separator = DATA_URL.includes('?') ? '&' : '?';
  return `${DATA_URL}${separator}v=${Date.now()}`;
}

// null betyr uendret (304): katalogen vi har, er fortsatt den gjeldende.
async function fetchFresh(etag: string | null): Promise<CachedCatalog | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(dataUrl(), { headers });
  if (res.status === 304 && etag) return null;
  if (!res.ok) throw new Error(`Katalog ${res.status}`);
  const fresh = {
    fetched_at: Date.now(),
    etag: res.headers.get('etag'),
    payload: await res.json(),
  };
  if (!isCachedCatalog(fresh)) throw new Error('Katalog med ugyldig struktur');
  return fresh;
}

function adopt(record: CachedCatalog): MenyProduct[] {
  memory = record;
  return record.payload.products;
}

async function loadCatalog(forceNetwork: boolean): Promise<MenyProduct[]> {
  const cached = memory ?? (await readCacheOnce());
  const stale =
    !cached ||
    Date.now() - cached.fetched_at > TTL_MS ||
    !cached.payload.products.some((p) => 'price_measure' in p);

  // Fersk nok cache: bruk den uten nettkall.
  if (cached && !stale && !forceNetwork) return adopt(cached);

  let fresh: CachedCatalog | null;
  try {
    fresh = await fetchFresh(cached?.etag ?? null);
  } catch (e) {
    // Ingen nett: fall tilbake på cache hvis vi har den.
    if (cached) return adopt(cached);
    throw e;
  }
  if (fresh) {
    await writeCache(fresh);
    return adopt(fresh);
  }
  // 304: samme katalog som før, og samme liste tilbake, så skjermene kan se at
  // ingenting er endret. Bare tidspunktet i minnet flyttes; å skrive 2 MB til
  // lagringen på nytt gir ingenting.
  return adopt({ ...cached!, fetched_at: Date.now() });
}

/** Hele katalogen (cache-først, nett ved utløpt TTL). Deles i minnet for økta. */
export async function getCatalog(): Promise<MenyProduct[]> {
  if (memory) return memory.payload.products;
  if (!inflight)
    inflight = loadCatalog(false).finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Katalogen fra cachen, uansett alder og uten nettkall, så oppstarten kan vise
 * noe med en gang. null når ingenting er cachet.
 */
export async function getCachedCatalog(): Promise<MenyProduct[] | null> {
  if (!memory) {
    const cached = await readCacheOnce();
    // Har en henting fra nettet blitt ferdig mens vi leste, vinner den.
    if (cached && !memory) adopt(cached);
  }
  return memory?.payload.products ?? null;
}

/**
 * Spør serveren om en nyere katalog (pull-to-refresh og etter oppstart).
 * Uendret katalog gir 304 og samme liste tilbake.
 */
export async function refreshCatalog(): Promise<MenyProduct[]> {
  inflight = loadCatalog(true).finally(() => {
    inflight = null;
  });
  return inflight;
}
