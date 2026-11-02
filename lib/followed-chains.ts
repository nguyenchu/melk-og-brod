import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FOLLOWED_CHAINS, normalizeChainName } from './chains';

const FOLLOWED_CHAINS_KEY = 'chains.followed.v1';

let cache: string[] | null = null;
const listeners = new Set<() => void>();

// Ingen lagret liste (eller ødelagte data) betyr standardutvalget. En tom liste
// er et gyldig valg og beholdes. Duplikater med ulik skrivemåte slås sammen.
function parseFollowed(raw: string | null): string[] {
  if (!raw) return DEFAULT_FOLLOWED_CHAINS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FOLLOWED_CHAINS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_FOLLOWED_CHAINS;
  const seen = new Set<string>();
  const chains: string[] = [];
  for (const value of parsed) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const key = normalizeChainName(value);
    if (seen.has(key)) continue;
    seen.add(key);
    chains.push(value);
  }
  return chains;
}

// Feiler lesingen fra AsyncStorage, caches ingenting, slik at neste kall prøver
// igjen i stedet for å overskrive valget med standardutvalget.
async function load(): Promise<string[]> {
  if (cache !== null) return cache;
  const raw = await AsyncStorage.getItem(FOLLOWED_CHAINS_KEY);
  cache = parseFollowed(raw);
  return cache;
}

async function persist(chains: string[]) {
  cache = chains;
  listeners.forEach((l) => l());
  await AsyncStorage.setItem(FOLLOWED_CHAINS_KEY, JSON.stringify(chains));
}

export async function toggleFollowedChain(id: string) {
  const chains = await load();
  const key = normalizeChainName(id);
  const following = chains.some((chain) => normalizeChainName(chain) === key);
  await persist(
    following ? chains.filter((chain) => normalizeChainName(chain) !== key) : [...chains, id],
  );
}

export function useFollowedChains() {
  const [followed, setFollowed] = useState<string[]>(cache ?? DEFAULT_FOLLOWED_CHAINS);

  const sync = useCallback(async () => {
    try {
      setFollowed(await load());
    } catch {
      // Behold det vi viser nå; neste sync prøver å lese på nytt.
    }
  }, []);

  useEffect(() => {
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [sync]);

  return followed;
}
