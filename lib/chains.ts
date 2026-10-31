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

// De utvalgte kjedene som alltid vises som chips. Resten ligger bak «Flere».
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

// «Alle» + de utvalgte (alfabetisk), med antall. Vises alltid som chips (wrapper).
export function featuredOptionsFor(deals: ChainedProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  const featured = FEATURED_CHAIN_FILTERS.map((option) => ({
    ...option,
    count: countChains(option.chains, counts),
  })).sort((a, b) => a.label.localeCompare(b.label, 'nb'));
  return [
    {
      id: ALL_CHAINS,
      label: ALL_CHAINS,
      chains: FEATURED_CHAIN_FILTERS.flatMap((option) => option.chains),
      count: featured.reduce((sum, option) => sum + option.count, 0),
    },
    ...featured,
  ];
}

// Alle øvrige kjeder (ikke blant de utvalgte), alfabetisk. Ligger bak «Flere».
export function moreOptionsFor(deals: ChainedProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  const present = new Map<string, string>();
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    if (!present.has(key)) present.set(key, deal.chain);
  }
  return Array.from(present)
    .filter(([key]) => !FEATURED_CHAIN_MEMBERS.has(key))
    .map(([key, chain]) => ({
      id: chain,
      label: chain,
      chains: [chain],
      count: counts.get(key) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'nb'));
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
