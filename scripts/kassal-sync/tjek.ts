// Klient mot Tjek / eTilbudsavis (squid-api.tjek.com) – den åpne API-en bak
// eTilbudsavis.no. Gir ukentlige kundeavis-tilbud for norske kjeder med
// før→nå-pris og gyldighetsdatoer. Dekker KIWI, REMA 1000, Coop (Extra/Obs),
// Meny, SPAR, Joker, Bunnpris m.fl. – nettopp kjedene Kassal ikke har ferske
// priser for. Ingen token nødvendig.
//
// API-et er stedsbasert: kataloger returneres for et koordinatpunkt. Nasjonale
// kjeder dekkes av Oslo, men vi spør flere byer og deduper på katalog-id for å
// fange eventuelle regionale kataloger.

const BASE = 'https://squid-api.tjek.com/v2';

export interface TjekOffer {
  id: string;
  heading: string;
  description?: string | null;
  pricing?: { price: number; pre_price: number | null; currency: string } | null;
  quantity?: {
    unit?: { symbol?: string } | null;
    size?: { from?: number; to?: number } | null;
    pieces?: { from?: number; to?: number; min?: number | null; max?: number | null } | null;
  } | null;
  images?: { thumb?: string; view?: string; zoom?: string } | null;
  run_from?: string | null;
  run_till?: string | null;
  branding?: { name?: string } | null;
  dealer?: { name?: string; country?: { id?: string } | null } | null;
}

export interface TjekCatalog {
  id: string;
  offer_count?: number;
  run_from?: string;
  run_till?: string;
  branding?: { name?: string } | null;
  dealer?: { name?: string } | null;
  dealer_id?: string;
}

async function tjek<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Tjek ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// Punkter vi scoper katalog-søket mot. Dedupe på katalog-id gjør overlapp gratis.
const CITIES: { name: string; lat: number; lng: number }[] = [
  { name: 'Oslo', lat: 59.913, lng: 10.739 },
  { name: 'Bergen', lat: 60.391, lng: 5.322 },
  { name: 'Trondheim', lat: 63.43, lng: 10.395 },
  { name: 'Stavanger', lat: 58.97, lng: 5.733 },
  { name: 'Tromsø', lat: 69.649, lng: 18.956 },
];

export function catalogChain(c: TjekCatalog): string | null {
  return c.branding?.name ?? c.dealer?.name ?? null;
}

/** Alle (unike) kataloger nær de norske byene. */
export async function fetchNorwegianCatalogs(): Promise<TjekCatalog[]> {
  const byId = new Map<string, TjekCatalog>();
  for (const city of CITIES) {
    try {
      const cats = await tjek<TjekCatalog[]>(
        `/catalogs?r_lat=${city.lat}&r_lng=${city.lng}&r_radius=80000&limit=24`,
      );
      for (const cat of cats) if (cat?.id) byId.set(cat.id, cat);
    } catch (e) {
      console.error(`[tjek] kataloger for ${city.name} feilet: ${(e as Error).message}`);
    }
  }
  return [...byId.values()];
}

/** Alle tilbud i én katalog (paginerer i bolker på 100). */
export async function fetchCatalogOffers(catalogId: string): Promise<TjekOffer[]> {
  const all: TjekOffer[] = [];
  let offset = 0;
  for (let i = 0; i < 8; i++) {
    const page = await tjek<TjekOffer[]>(
      `/offers?catalog_id=${catalogId}&limit=100&offset=${offset}`,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 100) break;
    offset += 100;
  }
  return all;
}
