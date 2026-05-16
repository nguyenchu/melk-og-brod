import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { isLikelyCampaignText } from './campaigns';
import { hasSupabaseConfig, requireSupabase } from './supabase';
import type { CartItem } from './types';

function haptic(style: Haptics.ImpactFeedbackStyle | 'selection') {
  if (style === 'selection') {
    Haptics.selectionAsync().catch(() => {});
  } else {
    Haptics.impactAsync(style).catch(() => {});
  }
}

const STORAGE_KEY = 'cart.v1';

let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function normalizeCartItem(
  item:
    | CartItem
    | (Omit<CartItem, 'quantity' | 'image_url' | 'drop_pct' | 'deal_expired'> & {
        campaign_text?: string | null;
        quantity?: number;
        image_url?: string | null;
        drop_pct?: number | null;
        deal_expired?: boolean;
      }),
): CartItem {
  return {
    ...item,
    image_url: item.image_url ?? null,
    drop_pct: item.drop_pct ?? null,
    campaign_text: isLikelyCampaignText(item.campaign_text) ? item.campaign_text ?? null : null,
    quantity: Math.max(1, item.quantity ?? 1),
    deal_expired: item.deal_expired ?? false,
  };
}

function hasDealSignal(item: { drop_pct?: number | null; campaign_text?: string | null }): boolean {
  return (item.drop_pct ?? 0) >= 5 || isLikelyCampaignText(item.campaign_text);
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

  const eansToRefresh = items.filter((item) => item.ean).map((item) => item.ean as string);
  const missingProductDataByName = items
    .filter((item) => !item.ean && (!item.image_url || !item.campaign_text))
    .map((item) => item.name.trim())
    .filter(Boolean);

  if (eansToRefresh.length === 0 && missingProductDataByName.length === 0) return items;

  const supabase = requireSupabase();
  const eanLookup = eansToRefresh.length
    ? await supabase
        .from('meny_products')
        .select('ean,image_url,campaign_text,current_price,drop_pct')
        .in('ean', eansToRefresh)
    : { data: [], error: null };

  const nameLookup = missingProductDataByName.length
    ? await supabase
        .from('meny_products')
        .select('name,image_url,campaign_text')
        .in('name', missingProductDataByName)
    : { data: [], error: null };

  if (eanLookup.error && nameLookup.error) return items;

  const liveByEan = new Map(
    (eanLookup.data ?? [])
      .filter((row) => row.ean)
      .map((row) => [
        row.ean as string,
        {
          image_url: (row.image_url as string | null) ?? null,
          campaign_text: isLikelyCampaignText(row.campaign_text as string | null | undefined)
            ? (row.campaign_text as string)
            : null,
          current_price: (row.current_price as number | null) ?? null,
          drop_pct: (row.drop_pct as number | null) ?? null,
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

  // Other writes (addToCart/removeFromCart) may have landed while the Supabase
  // queries were in flight. Apply live data to the *current* cart, not the
  // snapshot captured at call time, or we'd clobber those writes.
  const current = cache ?? items;
  let changed = false;
  const hydrated = current.map((item) => {
    if (item.ean) {
      const live = liveByEan.get(item.ean);
      // Not found means the product is discontinued — leave the snapshot untouched;
      // the cart screen flags these separately via fetchDiscontinuedEans.
      if (!live) return item;

      const nowOnDeal = hasDealSignal(live);
      const next: CartItem = {
        ...item,
        image_url: item.image_url ?? live.image_url,
        price: live.current_price ?? item.price,
        drop_pct: live.drop_pct,
        campaign_text: live.campaign_text,
        deal_expired: nowOnDeal ? false : item.deal_expired || (hasDealSignal(item) && !nowOnDeal),
      };
      if (
        next.image_url !== item.image_url ||
        next.price !== item.price ||
        next.drop_pct !== item.drop_pct ||
        next.campaign_text !== item.campaign_text ||
        next.deal_expired !== item.deal_expired
      ) {
        changed = true;
        return next;
      }
      return item;
    }

    const named = productByName.get(item.name.trim().toLowerCase());
    if (!named) return item;
    const nextImageUrl = item.image_url ?? named.image_url;
    const nextCampaignText = item.campaign_text ?? named.campaign_text;
    if (nextImageUrl === item.image_url && nextCampaignText === item.campaign_text) return item;

    changed = true;
    return { ...item, image_url: nextImageUrl, campaign_text: nextCampaignText };
  });

  if (changed) {
    cache = hydrated;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
    return hydrated;
  }

  return current;
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

  return { items, loading, sync };
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
        i.id === existing.id
          ? { ...i, quantity: nextQuantity, campaign_text: nextCampaignText, deal_expired: false }
          : i,
      ),
    );
    haptic(Haptics.ImpactFeedbackStyle.Light);
    return { ...existing, quantity: nextQuantity, campaign_text: nextCampaignText, deal_expired: false };
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
    deal_expired: false,
  };
  await persist([...items, item]);
  haptic(Haptics.ImpactFeedbackStyle.Medium);
  return item;
}

export async function toggleChecked(id: string) {
  const items = await loadFromStorage();
  await persist(items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
  haptic('selection');
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
