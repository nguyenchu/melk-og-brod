import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { isLikelyCampaignText } from './campaigns';
import { hasSupabaseConfig, requireSupabase } from './supabase';
import type { CartItem } from './types';

const STORAGE_KEY = 'cart.v1';

let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function normalizeCartItem(
  item:
    | CartItem
    | (Omit<CartItem, 'quantity' | 'image_url' | 'drop_pct'> & {
        campaign_text?: string | null;
        quantity?: number;
        image_url?: string | null;
        drop_pct?: number | null;
      }),
): CartItem {
  return {
    ...item,
    image_url: item.image_url ?? null,
    drop_pct: item.drop_pct ?? null,
    campaign_text: isLikelyCampaignText(item.campaign_text) ? item.campaign_text ?? null : null,
    quantity: Math.max(1, item.quantity ?? 1),
  };
}

async function loadFromStorage(): Promise<CartItem[]> {
  if (cache !== null) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = raw
    ? (JSON.parse(raw) as Array<CartItem | (Omit<CartItem, 'quantity' | 'image_url'> & {
        quantity?: number;
        image_url?: string | null;
        campaign_text?: string | null;
      })>).map(
        normalizeCartItem,
      )
    : [];
  return cache;
}

async function persist(items: CartItem[]) {
  const normalizedItems = items.map(normalizeCartItem);
  cache = normalizedItems;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedItems));
  listeners.forEach((l) => l());
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function hydrateCartProductData(items: CartItem[]): Promise<CartItem[]> {
  if (!hasSupabaseConfig()) return items;

  const missingProductDataByEan = items
    .filter((item) => item.ean && (!item.image_url || !item.campaign_text))
    .map((item) => item.ean as string);
  const missingProductDataByName = items
    .filter((item) => !item.ean && (!item.image_url || !item.campaign_text))
    .map((item) => item.name.trim())
    .filter(Boolean);

  if (missingProductDataByEan.length === 0 && missingProductDataByName.length === 0) return items;

  const supabase = requireSupabase();
  const eanLookup = missingProductDataByEan.length
    ? await supabase
        .from('meny_products')
        .select('ean,image_url,campaign_text')
        .in('ean', missingProductDataByEan)
    : { data: [], error: null };

  const nameLookup = missingProductDataByName.length
    ? await supabase
        .from('meny_products')
        .select('name,image_url,campaign_text')
        .in('name', missingProductDataByName)
    : { data: [], error: null };

  if (eanLookup.error && nameLookup.error) return items;

  const productByEan = new Map(
    (eanLookup.data ?? [])
      .filter((row) => row.ean)
      .map((row) => [
        row.ean as string,
        {
          image_url: (row.image_url as string | null) ?? null,
          campaign_text: isLikelyCampaignText(row.campaign_text as string | null | undefined)
            ? (row.campaign_text as string)
            : null,
        },
      ]),
  );

  const productByName = new Map(
    (nameLookup.data ?? [])
      .filter((row) => row.name)
      .map((row) => [
        String(row.name).trim().toLowerCase(),
        {
          image_url: (row.image_url as string | null) ?? null,
          campaign_text: isLikelyCampaignText(row.campaign_text as string | null | undefined)
            ? (row.campaign_text as string)
            : null,
        },
      ]),
  );

  let changed = false;
  const hydrated = items.map((item) => {
    const hydratedProduct = item.ean
      ? productByEan.get(item.ean)
      : productByName.get(item.name.trim().toLowerCase());
    if (!hydratedProduct) return item;

    const nextImageUrl = item.image_url ?? hydratedProduct.image_url;
    const nextCampaignText = item.campaign_text ?? hydratedProduct.campaign_text;
    if (nextImageUrl === item.image_url && nextCampaignText === item.campaign_text) return item;

    changed = true;
    return {
      ...item,
      image_url: nextImageUrl,
      campaign_text: nextCampaignText,
    };
  });

  if (changed) {
    cache = hydrated;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
  }

  return hydrated;
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(async () => {
    try {
      const next = await hydrateCartProductData(await loadFromStorage());
      setItems([...next]);
    } catch {
      const fallback = await loadFromStorage();
      setItems([...fallback]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    sync();
    const l = () => sync();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [sync]);

  return { items, loading };
}

export async function addToCart(input: {
  name: string;
  ean?: string | null;
  image_url?: string | null;
  price?: number | null;
  drop_pct?: number | null;
  campaign_text?: string | null;
}): Promise<CartItem> {
  const items = await loadFromStorage();
  const normalizedName = input.name.trim().toLowerCase();
  const existing = items.find((i) => {
    if (i.checked) return false;
    if (input.ean) return i.ean === input.ean;
    return i.name.trim().toLowerCase() === normalizedName;
  });
  if (existing) {
    const nextQuantity = existing.quantity + 1;
    const nextCampaignText =
      existing.campaign_text ?? (isLikelyCampaignText(input.campaign_text) ? input.campaign_text ?? null : null);
    await persist(
      items.map((i) =>
        i.id === existing.id ? { ...i, quantity: nextQuantity, campaign_text: nextCampaignText } : i,
      ),
    );
    return { ...existing, quantity: nextQuantity, campaign_text: nextCampaignText };
  }
  const item: CartItem = {
    id: uid(),
    name: input.name,
    ean: input.ean ?? null,
    image_url: input.image_url ?? null,
    price: input.price ?? null,
    drop_pct: input.drop_pct ?? null,
    campaign_text: isLikelyCampaignText(input.campaign_text) ? input.campaign_text ?? null : null,
    quantity: 1,
    checked: false,
    added_at: new Date().toISOString(),
  };
  await persist([...items, item]);
  return item;
}

export async function toggleChecked(id: string) {
  const items = await loadFromStorage();
  await persist(items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
}

export async function removeFromCart(id: string) {
  const items = await loadFromStorage();
  await persist(items.filter((i) => i.id !== id));
}

export async function removeActiveProductFromCart(input: { ean?: string | null; name: string }) {
  const items = await loadFromStorage();
  const normalizedName = input.name.trim().toLowerCase();
  await persist(
    items.filter((item) => {
      if (item.checked) return true;
      if (input.ean) return item.ean !== input.ean;
      return item.name.trim().toLowerCase() !== normalizedName;
    }),
  );
}

export async function updateQuantity(id: string, quantity: number) {
  const items = await loadFromStorage();
  if (quantity < 1) {
    await persist(items.filter((i) => i.id !== id));
    return;
  }
  await persist(items.map((i) => (i.id === id ? { ...i, quantity } : i)));
}

export async function clearChecked() {
  const items = await loadFromStorage();
  await persist(items.filter((i) => !i.checked));
}
