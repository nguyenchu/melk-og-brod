import { beforeEach, expect, it, vi } from 'vitest';
import { computeCartTotals } from './campaigns';

const storage = vi.hoisted(() => new Map<string, string>());
const getItem = vi.hoisted(() => vi.fn());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem,
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

// Minimal React-erstatning så useCart kan kjøres uten renderer: effekten
// kjøres med en gang, og setState-kall fanges opp.
const setState = vi.hoisted(() => vi.fn());
vi.mock('react', () => ({
  useState: (init: unknown) => [init, setState],
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    fn();
  },
}));

const measure = { amount: 0.13, unit: 'kg' as const, loose: true };
beforeEach(() => {
  storage.clear();
  setState.mockReset();
  getItem.mockReset();
  getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
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

const saved = {
  id: 'saved',
  name: 'Melk',
  ean: '7038010000000',
  price: 24.9,
  quantity: 1,
  checked: false,
  added_at: '2026-10-31',
};
const namesInStorage = () =>
  JSON.parse(storage.get('cart.v1')!).map((item: { name: string }) => item.name);

it.each([
  ['invalid JSON', '{ikke json'],
  ['an object instead of a list', '{"id":"x","name":"Melk"}'],
  ['null', 'null'],
])(
  'starts from an empty cart and backs up the raw data when the saved cart is %s',
  async (_label, raw) => {
    storage.set('cart.v1', raw);
    const { addToCart } = await import('./cart');
    await addToCart({ name: 'Brød', price: 30 });
    expect(namesInStorage()).toEqual(['Brød']);
    expect(storage.get('cart.v1.backup')).toBe(raw);
  },
);

it('keeps valid items when some entries are broken, and backs up the original', async () => {
  const raw = JSON.stringify([
    null,
    'x',
    { name: 'uten id' },
    { id: 'a', name: 'Ost', ean: 5 },
    saved,
  ]);
  storage.set('cart.v1', raw);
  const { addToCart } = await import('./cart');
  await addToCart({ name: 'Brød', price: 30 });
  expect(namesInStorage()).toEqual(['Melk', 'Brød']);
  expect(storage.get('cart.v1.backup')).toBe(raw);
});

it('does not write a backup for a healthy cart', async () => {
  storage.set('cart.v1', JSON.stringify([saved]));
  const { addToCart } = await import('./cart');
  await addToCart({ name: 'Brød', price: 30 });
  expect(namesInStorage()).toEqual(['Melk', 'Brød']);
  expect(storage.has('cart.v1.backup')).toBe(false);
});

it('does not overwrite the saved cart when reading it fails', async () => {
  storage.set('cart.v1', JSON.stringify([saved]));
  getItem.mockRejectedValueOnce(new Error('disk'));
  const { addToCart } = await import('./cart');
  await expect(addToCart({ name: 'Brød', price: 30 })).rejects.toThrow('disk');
  await addToCart({ name: 'Brød', price: 30 });
  expect(namesInStorage()).toEqual(['Melk', 'Brød']);
});

it('useCart swallows storage errors instead of leaving an unhandled rejection', async () => {
  getItem.mockRejectedValue(new Error('disk'));
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { useCart } = await import('./cart');
    expect(useCart().items).toEqual([]);
    await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(false));
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalledWith(expect.any(Array));
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
