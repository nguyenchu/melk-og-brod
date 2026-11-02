import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_FOLLOWED_CHAINS } from './chains';

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

// Minimal React-erstatning så useFollowedChains kan kjøres uten renderer:
// effekten kjøres med en gang, og setState-kall fanges opp.
const setState = vi.hoisted(() => vi.fn());
vi.mock('react', () => ({
  useState: (init: unknown) => [init, setState],
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    fn();
  },
}));

const KEY = 'chains.followed.v1';
const stored = () => JSON.parse(storage.get(KEY)!);

beforeEach(() => {
  storage.clear();
  setState.mockReset();
  getItem.mockReset();
  getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
  vi.resetModules();
});

it('follows the featured chains when nothing is stored', async () => {
  const { useFollowedChains } = await import('./followed-chains');
  expect(useFollowedChains()).toEqual(DEFAULT_FOLLOWED_CHAINS);
  await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(DEFAULT_FOLLOWED_CHAINS));
});

it.each([
  ['invalid JSON', '{not json'],
  ['an object', '{"KIWI":true}'],
  ['a string', '"KIWI"'],
  ['null', 'null'],
])('falls back to the featured chains for %s in storage', async (_label, raw) => {
  storage.set(KEY, raw);
  const { toggleFollowedChain } = await import('./followed-chains');
  await toggleFollowedChain('Spar');
  expect(stored()).toEqual([...DEFAULT_FOLLOWED_CHAINS, 'Spar']);
});

it('keeps an empty list as a real choice', async () => {
  storage.set(KEY, '[]');
  const { useFollowedChains } = await import('./followed-chains');
  useFollowedChains();
  await vi.waitFor(() => expect(setState).toHaveBeenCalledWith([]));
});

it('drops non-strings, blanks and duplicates with different spelling', async () => {
  storage.set(KEY, JSON.stringify(['KIWI', 5, null, ' ', 'kiwi', 'Spar']));
  const { useFollowedChains } = await import('./followed-chains');
  useFollowedChains();
  await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(['KIWI', 'Spar']));
});

it('toggles a chain off and on again, ignoring case', async () => {
  storage.set(KEY, JSON.stringify(['KIWI', 'REMA']));
  const { toggleFollowedChain } = await import('./followed-chains');
  await toggleFollowedChain('kiwi');
  expect(stored()).toEqual(['REMA']);
  await toggleFollowedChain('Spar');
  expect(stored()).toEqual(['REMA', 'Spar']);
});

it('notifies mounted hooks when the choice changes', async () => {
  storage.set(KEY, JSON.stringify(['KIWI']));
  const { toggleFollowedChain, useFollowedChains } = await import('./followed-chains');
  useFollowedChains();
  await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(['KIWI']));
  await toggleFollowedChain('REMA');
  await vi.waitFor(() => expect(setState).toHaveBeenLastCalledWith(['KIWI', 'REMA']));
});

it('does not cache the default when AsyncStorage fails, so toggling cannot wipe the choice', async () => {
  storage.set(KEY, JSON.stringify(['Spar']));
  getItem.mockRejectedValueOnce(new Error('disk'));
  const { toggleFollowedChain, useFollowedChains } = await import('./followed-chains');
  useFollowedChains();
  await new Promise((r) => setTimeout(r, 0));
  expect(setState).not.toHaveBeenCalled();

  await toggleFollowedChain('KIWI');
  expect(stored()).toEqual(['Spar', 'KIWI']);
});
