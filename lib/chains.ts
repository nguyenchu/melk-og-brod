import type { MenyProduct } from './types';

export const ALL_CHAINS = 'Alle';

type ChainedProduct = Pick<MenyProduct, 'chain'>;

export type ChainOption = {
  id: string;
  label: string;
  chains: string[] | null;
  count: number;
};

export function normalizeChainName(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// De utvalgte kjedene: følges som standard og står først i kjede-arket.
export const FEATURED_CHAIN_FILTERS: { id: string; label: string; chains: string[] }[] = [
  { id: 'KIWI', label: 'KIWI', chains: ['KIWI'] },
  { id: 'REMA', label: 'REMA', chains: ['REMA 1000'] },
  { id: 'MENY', label: 'MENY', chains: ['Meny'] },
  { id: 'Extra', label: 'Coop Extra', chains: ['Extra', 'Coop Extra'] },
  { id: 'Joker', label: 'Joker', chains: ['Joker'] },
  { id: 'Bunnpris', label: 'Bunnpris', chains: ['Bunnpris'] },
  { id: 'Coop Marked', label: 'Coop Marked', chains: ['Coop Marked', 'Marked'] },
  { id: 'Gigaboks', label: 'Gigaboks', chains: ['Gigaboks'] },
];

export const FEATURED_CHAIN_MEMBERS = new Set(
  FEATURED_CHAIN_FILTERS.flatMap((option) => option.chains).map(normalizeChainName),
);

export function chainCountsFor(deals: ChainedProduct[] | null) {
  const counts = new Map<string, number>();
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function countChains(chains: string[] | null, counts: Map<string, number>) {
  return (chains ?? []).reduce(
    (sum, chain) => sum + (counts.get(normalizeChainName(chain)) ?? 0),
    0,
  );
}

// Kjedene en ny bruker følger: de utvalgte.
export const DEFAULT_FOLLOWED_CHAINS = FEATURED_CHAIN_FILTERS.map((option) => option.id);

const FEATURED_IDS = new Set(DEFAULT_FOLLOWED_CHAINS.map(normalizeChainName));

export function isFeaturedChainOption(option: Pick<ChainOption, 'id'>) {
  return FEATURED_IDS.has(normalizeChainName(option.id));
}

// Alle kjeder brukeren kan følge: de utvalgte først (også uten tilbud nå), så
// øvrige kjeder som har tilbud, hver gruppe alfabetisk, med antall.
export function chainOptionsFor(deals: ChainedProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  const byLabel = (a: ChainOption, b: ChainOption) => a.label.localeCompare(b.label, 'nb');
  const featured = FEATURED_CHAIN_FILTERS.map((option) => ({
    ...option,
    count: countChains(option.chains, counts),
  })).sort(byLabel);

  const present = new Map<string, string>();
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    if (!present.has(key)) present.set(key, deal.chain);
  }
  const others = Array.from(present)
    .filter(([key]) => !FEATURED_CHAIN_MEMBERS.has(key))
    .map(([key, chain]) => ({
      id: chain,
      label: chain,
      chains: [chain],
      count: counts.get(key) ?? 0,
    }))
    .sort(byLabel);

  return [...featured, ...others];
}

// Kjedene brukeren følger, i samme rekkefølge som chainOptionsFor. En fulgt
// kjede uten tilbud akkurat nå (og som ikke er utvalgt) er ikke med.
export function followedOptionsFor(options: ChainOption[], followed: string[]): ChainOption[] {
  const keys = new Set(followed.map(normalizeChainName));
  return options.filter((option) => keys.has(normalizeChainName(option.id)));
}

// «Alle mine»: summen av de fulgte kjedene. Lagres som ALL_CHAINS, slik at et
// gammelt «Alle»-filter fortsatt betyr «alt jeg følger».
export function allFollowedOption(followed: ChainOption[]): ChainOption {
  return {
    id: ALL_CHAINS,
    label: 'Alle mine',
    chains: followed.flatMap((option) => option.chains ?? []),
    count: followed.reduce((sum, option) => sum + option.count, 0),
  };
}

export function findChainOption(
  options: ChainOption[],
  chainFilter: string,
): ChainOption | undefined {
  const key = normalizeChainName(chainFilter);
  return (
    options.find((option) => normalizeChainName(option.id) === key) ??
    options.find((option) => option.chains?.some((chain) => normalizeChainName(chain) === key))
  );
}

export function productMatchesChain(product: ChainedProduct, option: ChainOption) {
  if (!option.chains) return true;
  if (!product.chain) return false;
  const selectedChains = new Set(option.chains.map(normalizeChainName));
  return selectedChains.has(normalizeChainName(product.chain));
}
