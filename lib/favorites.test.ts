import { beforeEach, expect, it, vi } from 'vitest';

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
vi.mock('./notifications', () => ({ syncFavoritesToServer: async () => {} }));

// Minimal React-erstatning så useFavorites kan kjøres uten renderer: effekten
// kjøres med en gang, og setState-kall fanges opp.
const setState = vi.hoisted(() => vi.fn());
vi.mock('react', () => ({
  useState: (init: unknown) => [init, setState],
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    fn();
  },
}));

const KEY = 'favorites.v1';
const milk = { ean: '7038010000000', name: 'Melk', image_url: null, price: 24.9 };

beforeEach(() => {
  storage.clear();
  setState.mockReset();
  getItem.mockReset();
  getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
  vi.resetModules();
});

it.each([
  ['invalid JSON', '{not json'],
  ['an object', '{"ean":"123"}'],
  ['a string', '"hei"'],
  ['null', 'null'],
  ['a number', '42'],
])('treats %s in storage as no favorites', async (_label, raw) => {
  storage.set(KEY, raw);
  const { isFavorite } = await import('./favorites');
  await expect(isFavorite('123')).resolves.toBe(false);
});

it('drops entries without a string ean but keeps valid ones', async () => {
  storage.set(KEY, JSON.stringify([null, 'x', { name: 'uten ean' }, { ean: 5 }, milk]));
  const { isFavorite, toggleFavorite } = await import('./favorites');
  await expect(isFavorite(milk.ean)).resolves.toBe(true);

  await toggleFavorite({ ...milk, ean: '999' });
  expect(JSON.parse(storage.get(KEY)!)).toEqual([milk, { ...milk, ean: '999' }]);
});

it('drops favorites with missing or non-string names before they reach the UI', async () => {
  storage.set(
    KEY,
    JSON.stringify([
      { ean: 'missing' },
      { ean: 'object', name: { bad: true } },
      { ean: 'number', name: 42 },
      milk,
    ]),
  );
  const { toggleFavorite } = await import('./favorites');
  await toggleFavorite({ ...milk, ean: '999' });
  expect(JSON.parse(storage.get(KEY)!)).toEqual([milk, { ...milk, ean: '999' }]);
});

it('keeps older favorites without optional metadata and supplies safe missing values', async () => {
  storage.set(KEY, JSON.stringify([{ ean: 'old', name: 'Eldre favoritt' }]));
  const { toggleFavorite } = await import('./favorites');
  await toggleFavorite(milk);
  expect(JSON.parse(storage.get(KEY)!)).toEqual([
    { ean: 'old', name: 'Eldre favoritt', image_url: null, price: null },
    milk,
  ]);
});

it('normalizes unsafe price and image metadata without losing the favorite', async () => {
  storage.set(
    KEY,
    JSON.stringify([
      {
        ...milk,
        image_url: { uri: 'invalid' },
        price: '24.9',
        price_measure: { amount: 1, unit: 'bad', loose: true },
        unit_price: '24.9',
      },
    ]),
  );
  const { toggleFavorite } = await import('./favorites');
  await toggleFavorite({ ...milk, ean: '999' });
  expect(JSON.parse(storage.get(KEY)!)).toEqual([
    { ...milk, image_url: null, price: null, price_measure: null, unit_price: null },
    { ...milk, ean: '999' },
  ]);
});

it('keeps valid price metadata and removes a favorite when toggled again', async () => {
  const weighed = {
    ...milk,
    price_measure: { amount: 1, unit: 'l', loose: false },
    unit_price: 24.9,
  };
  storage.set(KEY, JSON.stringify([weighed, { ...milk, ean: '999' }]));
  const { toggleFavorite } = await import('./favorites');
  await toggleFavorite({ ...milk, ean: '999' });
  expect(JSON.parse(storage.get(KEY)!)).toEqual([weighed]);
});

it('overwrites corrupt data with a valid list on the next toggle', async () => {
  storage.set(KEY, '{not json');
  const { toggleFavorite } = await import('./favorites');
  await toggleFavorite(milk);
  expect(JSON.parse(storage.get(KEY)!)).toEqual([milk]);
});

it('still reads valid favorites', async () => {
  storage.set(KEY, JSON.stringify([milk]));
  const { isFavorite } = await import('./favorites');
  await expect(isFavorite(milk.ean)).resolves.toBe(true);
  await expect(isFavorite('annet')).resolves.toBe(false);
});

it('does not cache an empty list when AsyncStorage fails, so toggling cannot wipe saved favorites', async () => {
  storage.set(KEY, JSON.stringify([milk]));
  getItem.mockRejectedValueOnce(new Error('disk'));
  const { isFavorite, toggleFavorite } = await import('./favorites');

  await expect(isFavorite(milk.ean)).rejects.toThrow('disk');
  await toggleFavorite({ ...milk, ean: '999' });
  expect(JSON.parse(storage.get(KEY)!)).toEqual([milk, { ...milk, ean: '999' }]);
});

it('useFavorites sets an empty list for corrupt data', async () => {
  storage.set(KEY, '{not json');
  const { useFavorites } = await import('./favorites');
  useFavorites();
  await vi.waitFor(() => expect(setState).toHaveBeenCalledWith([]));
});

it('useFavorites swallows storage errors instead of leaving an unhandled rejection', async () => {
  getItem.mockRejectedValueOnce(new Error('disk'));
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { useFavorites } = await import('./favorites');
    expect(useFavorites()).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
