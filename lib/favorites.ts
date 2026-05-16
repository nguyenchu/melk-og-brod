import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { syncFavoritesToServer } from './notifications';

const FAVORITES_KEY = 'favorites.v1';

export type FavoriteItem = {
  ean: string;
  name: string;
  image_url: string | null;
  price: number | null;
};

let cache: FavoriteItem[] | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<FavoriteItem[]> {
  if (cache !== null) return cache;
  const raw = await AsyncStorage.getItem(FAVORITES_KEY);
  cache = raw ? (JSON.parse(raw) as FavoriteItem[]) : [];
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
    setFavorites(await load());
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
