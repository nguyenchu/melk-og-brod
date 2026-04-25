import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { CartItem } from './types';

const STORAGE_KEY = 'cart.v1';

let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function normalizeCartItem(
  item: CartItem | (Omit<CartItem, 'quantity'> & { quantity?: number }),
): CartItem {
  return {
    ...item,
    quantity: Math.max(1, item.quantity ?? 1),
  };
}

async function loadFromStorage(): Promise<CartItem[]> {
  if (cache !== null) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = raw
    ? (JSON.parse(raw) as Array<CartItem | (Omit<CartItem, 'quantity'> & { quantity?: number })>).map(
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

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(async () => {
    const next = await loadFromStorage();
    setItems([...next]);
    setLoading(false);
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
  price?: number | null;
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
    await persist(
      items.map((i) =>
        i.id === existing.id ? { ...i, quantity: nextQuantity } : i,
      ),
    );
    return { ...existing, quantity: nextQuantity };
  }
  const item: CartItem = {
    id: uid(),
    name: input.name,
    ean: input.ean ?? null,
    price: input.price ?? null,
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
