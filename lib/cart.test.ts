import { beforeEach, expect, it, vi } from 'vitest';
import { computeCartTotals } from './campaigns';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));
vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
  impactAsync: async () => {},
  selectionAsync: async () => {},
}));
vi.mock('./catalog', () => ({ hasDataConfig: () => false }));
vi.mock('./deals', () => ({ isExpiredOffer: () => false }));

const measure = { amount: 0.13, unit: 'kg' as const, loose: true };
beforeEach(() => {
  storage.clear();
  vi.resetModules();
});

it('keeps a potato purchase at 1.30 kr while retaining its 10 kr/kg display data', async () => {
  const { addToCart } = await import('./cart');
  const input = {
    name: 'Poteter løsvekt',
    ean: '4073',
    price: 1.3,
    price_measure: measure,
    unit_price: 10,
  };
  await addToCart(input);
  await addToCart(input);
  await addToCart(input);
  const items = JSON.parse(storage.get('cart.v1')!);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    quantity: 3,
    price: 1.3,
    price_measure: measure,
    unit_price: 10,
  });
  expect(computeCartTotals(items).total).toBeCloseTo(3.9);
});

it('backfills metadata when an old saved item is incremented', async () => {
  storage.set(
    'cart.v1',
    JSON.stringify([
      {
        id: 'saved',
        name: 'Poteter løsvekt',
        ean: '4073',
        price: 1.3,
        quantity: 2,
        checked: false,
        added_at: '2026-10-11',
      },
    ]),
  );
  const { addToCart } = await import('./cart');
  const item = await addToCart({
    name: 'Poteter løsvekt',
    ean: '4073',
    price: 1.3,
    price_measure: measure,
    unit_price: 10,
  });
  expect(item).toMatchObject({
    id: 'saved',
    quantity: 3,
    price: 1.3,
    price_measure: measure,
    unit_price: 10,
  });
});
