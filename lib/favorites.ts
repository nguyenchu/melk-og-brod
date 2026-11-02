import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { PriceMeasure } from './price-measure';
import { syncFavoritesToServer } from './notifications';

const FAVORITES_KEY = 'favorites.v1';

export type FavoriteItem = {
  ean: string;
  name: string;
  image_url: string | null;
  price: number | null;
  price_measure?: PriceMeasure | null;
  unit_price?: number | null;
};

let cache: FavoriteItem[] | null = null;
const listeners = new Set<() => void>();

// Favoritter uten ean eller navn kastes. Ugyldig bilde- og prisinfo blir null,
// slik at favoritten beholdes og skjermene ikke får uventede typer.
function normalizeFavorite(value: unknown): FavoriteItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.ean !== 'string' || typeof item.name !== 'string') return null;

  const favorite: FavoriteItem = {
    ean: item.ean,
    name: item.name,
    image_url: typeof item.image_url === 'string' ? item.image_url : null,
    price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null,
  };
  if ('unit_price' in item) {
    favorite.unit_price =
      typeof item.unit_price === 'number' && Number.isFinite(item.unit_price)
        ? item.unit_price
        : null;
  }
  if ('price_measure' in item) {
    const measure = item.price_measure as Record<string, unknown> | null;
    favorite.price_measure =
      typeof measure === 'object' &&
      measure !== null &&
      typeof measure.amount === 'number' &&
      Number.isFinite(measure.amount) &&
      measure.amount > 0 &&
      (measure.unit === 'kg' || measure.unit === 'l') &&
      typeof measure.loose === 'boolean'
        ? { amount: measure.amount, unit: measure.unit, loose: measure.loose }
        : null;
  }
  return favorite;
}

function parseFavorites(raw: string | null): FavoriteItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeFavorite).filter((f): f is FavoriteItem => f !== null);
}

// Ødelagte data gir tom liste. Feiler selve lesingen fra AsyncStorage, caches
// ingenting, slik at neste kall prøver igjen i stedet for å overskrive lagrede
// favoritter med en tom liste.
async function load(): Promise<FavoriteItem[]> {
  if (cache !== null) return cache;
  const raw = await AsyncStorage.getItem(FAVORITES_KEY);
  cache = parseFavorites(raw);
  return cache;
}

async function persist(items: FavoriteItem[]) {
  cache = items;
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
  // Best-effort: keep server's view of this device's favorites in sync so the
  // scraper can target push notifications when a favorite drops in price.
  syncFavoritesToServer(items.map((i) => i.ean)).catch(() => {});
}

export async function toggleFavorite(item: FavoriteItem) {
  const items = await load();
  const exists = items.some((f) => f.ean === item.ean);
  await persist(exists ? items.filter((f) => f.ean !== item.ean) : [...items, item]);
}

export async function isFavorite(ean: string): Promise<boolean> {
  const items = await load();
  return items.some((f) => f.ean === ean);
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  const sync = useCallback(async () => {
    try {
      setFavorites(await load());
    } catch {
      // Behold det vi viser nå; neste sync prøver å lese på nytt.
    }
  }, []);

  useEffect(() => {
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [sync]);

  return favorites;
}
