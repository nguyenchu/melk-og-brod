import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

const CACHE_KEY = 'catalog.v5';
const freshProduct = { name: 'Lettmelk', price_measure: null };
const fetchMock = vi.fn();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ computed_at: '2026-10-31T06:00:00Z', count: 1, products: [freshProduct] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

it.each([
  ['payload uten products', { fetched_at: Date.now(), payload: { computed_at: 'x', count: 0 } }],
  ['products som ikke er en liste', { fetched_at: Date.now(), payload: { products: 'oops' } }],
  ['products med null-elementer', { fetched_at: Date.now(), payload: { products: [null] } }],
  ['manglende payload', { fetched_at: Date.now() }],
  ['fetched_at som ikke er et tall', { fetched_at: 'i går', payload: { products: [] } }],
  ['en JSON-verdi som ikke er et objekt', 42],
])('behandler cache med %s som bom og henter fra nettet', async (_label, cached) => {
  storage.set(CACHE_KEY, JSON.stringify(cached));
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([freshProduct]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.get(CACHE_KEY)!).payload.products).toEqual([freshProduct]);
});

it('behandler uparsbar JSON som bom', async () => {
  storage.set(CACHE_KEY, '{ikke json');
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([freshProduct]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('faller ikke tilbake på ugyldig cache når nettet feiler', async () => {
  storage.set(CACHE_KEY, JSON.stringify({ fetched_at: Date.now(), payload: {} }));
  fetchMock.mockRejectedValue(new Error('offline'));
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).rejects.toThrow('offline');
});

it('bruker gyldig, fersk cache uten nettkall', async () => {
  const cachedProduct = { name: 'Grovbrød', price_measure: null };
  storage.set(
    CACHE_KEY,
    JSON.stringify({ fetched_at: Date.now(), payload: { computed_at: 'x', count: 1, products: [cachedProduct] } }),
  );
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([cachedProduct]);
  expect(fetchMock).not.toHaveBeenCalled();
});
