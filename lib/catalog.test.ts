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

const CACHE_KEY = 'catalog.v5';
const HOUR = 60 * 60 * 1000;
const freshProduct = { name: 'Lettmelk', price_measure: null };
const cachedProduct = { name: 'Grovbrød', price_measure: null };
const fetchMock = vi.fn();

function catalogResponse(products: unknown, etag = 'W/"v2"') {
  const payload = { computed_at: '2026-10-31T06:00:00Z', count: 1, products };
  return new Response(JSON.stringify(payload), { status: 200, headers: { etag } });
}

const notModified = () => new Response(null, { status: 304 });

// Katalogen slik en tidligere økt la den i lagringen.
function storeCatalog({ age = 0, etag = 'W/"v1"' } = {}) {
  const record = {
    fetched_at: Date.now() - age,
    etag,
    payload: { computed_at: 'x', count: 1, products: [cachedProduct] },
  };
  storage.set(CACHE_KEY, JSON.stringify(record));
  return storage.get(CACHE_KEY);
}

function sentEtag() {
  const [, init] = fetchMock.mock.calls.at(-1)!;
  return init.headers['If-None-Match'] ?? null;
}

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  getItem.mockReset();
  getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => catalogResponse([freshProduct]));
  vi.stubGlobal('fetch', fetchMock);
});

it.each([
  ['payload uten products', { fetched_at: Date.now(), payload: { computed_at: 'x', count: 0 } }],
  ['products som ikke er en liste', { fetched_at: Date.now(), payload: { products: 'oops' } }],
  ['products med null-elementer', { fetched_at: Date.now(), payload: { products: [null] } }],
  ['manglende payload', { fetched_at: Date.now() }],
  ['fetched_at som ikke er et tall', { fetched_at: 'i går', payload: { products: [] } }],
  ['etag som ikke er en tekst', { fetched_at: Date.now(), etag: 7, payload: { products: [] } }],
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
  storeCatalog();
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([cachedProduct]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('lagrer ETag-en fra serveren sammen med katalogen', async () => {
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([freshProduct]);
  expect(sentEtag()).toBeNull();
  expect(JSON.parse(storage.get(CACHE_KEY)!).etag).toBe('W/"v2"');
});

it('godtar cache fra før ETag-en og spør da uten If-None-Match', async () => {
  const payload = { computed_at: 'x', count: 1, products: [cachedProduct] };
  storage.set(CACHE_KEY, JSON.stringify({ fetched_at: Date.now() - 7 * HOUR, payload }));
  const { getCachedCatalog, refreshCatalog } = await import('./catalog');

  await expect(getCachedCatalog()).resolves.toEqual([cachedProduct]);
  await expect(refreshCatalog()).resolves.toEqual([freshProduct]);
  expect(sentEtag()).toBeNull();
});

it('spør med lagret ETag og skriver ikke cachen på nytt ved 304', async () => {
  const stored = storeCatalog({ age: 7 * HOUR });
  fetchMock.mockImplementation(async () => notModified());
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).resolves.toEqual([cachedProduct]);
  expect(sentEtag()).toBe('W/"v1"');
  expect(storage.get(CACHE_KEY)).toBe(stored);
});

it('gir samme liste tilbake ved 304, så skjermen kan hoppe over ny utregning', async () => {
  storeCatalog();
  fetchMock.mockImplementation(async () => notModified());
  const { getCachedCatalog, refreshCatalog } = await import('./catalog');

  const shown = await getCachedCatalog();
  await expect(refreshCatalog()).resolves.toBe(shown);
});

it('erstatter cachen når serveren har en ny katalog', async () => {
  storeCatalog();
  const { getCachedCatalog, refreshCatalog } = await import('./catalog');

  await expect(getCachedCatalog()).resolves.toEqual([cachedProduct]);
  await expect(refreshCatalog()).resolves.toEqual([freshProduct]);
  expect(sentEtag()).toBe('W/"v1"');
  const saved = JSON.parse(storage.get(CACHE_KEY)!);
  expect(saved.etag).toBe('W/"v2"');
  expect(saved.payload.products).toEqual([freshProduct]);
});

it('viser cachen ved oppstart uansett alder og uten nettkall', async () => {
  storeCatalog({ age: 3 * 24 * HOUR });
  const { getCachedCatalog } = await import('./catalog');

  await expect(getCachedCatalog()).resolves.toEqual([cachedProduct]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('gir null ved oppstart når ingenting er cachet', async () => {
  const { getCachedCatalog } = await import('./catalog');

  await expect(getCachedCatalog()).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('beholder cachen når nettet feiler under oppdateringen', async () => {
  storeCatalog();
  fetchMock.mockRejectedValue(new Error('offline'));
  const { refreshCatalog } = await import('./catalog');

  await expect(refreshCatalog()).resolves.toEqual([cachedProduct]);
});

it('beholder cachen når serveren sender en katalog med feil struktur', async () => {
  const stored = storeCatalog();
  fetchMock.mockImplementation(async () => catalogResponse('oops'));
  const { refreshCatalog } = await import('./catalog');

  await expect(refreshCatalog()).resolves.toEqual([cachedProduct]);
  expect(storage.get(CACHE_KEY)).toBe(stored);
});

it('avviser en katalog med feil struktur når det ikke finnes noen cache', async () => {
  fetchMock.mockImplementation(async () => catalogResponse('oops'));
  const { getCatalog } = await import('./catalog');

  await expect(getCatalog()).rejects.toThrow('ugyldig struktur');
});

it('leser lagringen bare én gang når flere spør samtidig ved oppstart', async () => {
  storeCatalog();
  fetchMock.mockImplementation(async () => notModified());
  const { getCachedCatalog, getCatalog, refreshCatalog } = await import('./catalog');

  await Promise.all([getCachedCatalog(), getCatalog(), refreshCatalog()]);
  expect(getItem).toHaveBeenCalledTimes(1);
});
