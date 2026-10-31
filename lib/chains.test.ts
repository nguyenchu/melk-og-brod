import { describe, expect, it } from 'vitest';
import {
  ALL_CHAINS,
  FEATURED_CHAIN_FILTERS,
  FEATURED_CHAIN_MEMBERS,
  chainCountsFor,
  countChains,
  featuredOptionsFor,
  findChainOption,
  moreOptionsFor,
  normalizeChainName,
  productMatchesChain,
} from './chains';

const deal = (chain: string | null) => ({ chain });

const deals = [
  deal('KIWI'),
  deal('kiwi '),
  deal('REMA 1000'),
  deal('Extra'),
  deal('Coop Extra'),
  deal('Marked'),
  deal('Coop  Marked'),
  deal('Spar'),
  deal('Obs'),
  deal(null),
];

const option = (id: string) => {
  const found = featuredOptionsFor(deals).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`mangler ${id}`);
  return found;
};

describe('chain name normalization', () => {
  it('collapses whitespace, trims and lowercases', () => {
    expect(normalizeChainName('  REMA   1000 ')).toBe('rema 1000');
    expect(normalizeChainName('Coop\tMarked')).toBe('coop marked');
  });
  it('folds compatibility characters with NFKC', () => {
    expect(normalizeChainName('REMA 1000')).toBe('rema 1000');
    expect(normalizeChainName('ＫＩＷＩ')).toBe('kiwi');
  });
  it('knows every featured alias as a normalized member', () => {
    expect(FEATURED_CHAIN_MEMBERS.has('marked')).toBe(true);
    expect(FEATURED_CHAIN_MEMBERS.has('coop extra')).toBe(true);
    expect(FEATURED_CHAIN_MEMBERS.has('spar')).toBe(false);
  });
});

describe('chain counts', () => {
  it('counts deals per normalized chain and skips deals without a chain', () => {
    const counts = chainCountsFor(deals);
    expect(counts.get('kiwi')).toBe(2);
    expect(counts.get('coop marked')).toBe(1);
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(9);
  });
  it('treats missing deals as empty', () => {
    expect(chainCountsFor(null).size).toBe(0);
    expect(countChains(null, chainCountsFor(deals))).toBe(0);
  });
  it('sums aliases regardless of spelling', () => {
    expect(countChains(['Coop Marked', 'MARKED'], chainCountsFor(deals))).toBe(2);
  });
});

describe('featured chain options', () => {
  it('merges the aliases Coop Marked/Marked and Extra/Coop Extra', () => {
    expect(option('Coop Marked').count).toBe(2);
    expect(option('Extra')).toMatchObject({ label: 'Coop Extra', count: 2 });
  });
  it('counts «Alle» as the sum of the featured chains only', () => {
    const [all, ...featured] = featuredOptionsFor(deals);
    expect(all.id).toBe(ALL_CHAINS);
    expect(all.count).toBe(featured.reduce((sum, candidate) => sum + candidate.count, 0));
    expect(all.count).toBe(7);
    expect(all.chains).toEqual(FEATURED_CHAIN_FILTERS.flatMap((filter) => filter.chains));
  });
  it('lists the featured chains alphabetically after «Alle», with zero counts when absent', () => {
    const labels = featuredOptionsFor(null).map((candidate) => candidate.label);
    expect(labels[0]).toBe(ALL_CHAINS);
    expect(labels.slice(1)).toEqual([...labels.slice(1)].sort((a, b) => a.localeCompare(b, 'nb')));
    expect(featuredOptionsFor(null).every((candidate) => candidate.count === 0)).toBe(true);
  });
});

describe('more chain options', () => {
  it('lists only non-featured chains, alphabetically', () => {
    expect(moreOptionsFor(deals)).toEqual([
      { id: 'Obs', label: 'Obs', chains: ['Obs'], count: 1 },
      { id: 'Spar', label: 'Spar', chains: ['Spar'], count: 1 },
    ]);
  });
});

describe('chain option lookup', () => {
  const options = [...featuredOptionsFor(deals), ...moreOptionsFor(deals)];
  it('finds an option by id or by one of its chains', () => {
    expect(findChainOption(options, 'coop marked')?.id).toBe('Coop Marked');
    expect(findChainOption(options, 'kiwi')?.id).toBe('KIWI');
    expect(findChainOption(options, 'spar')?.id).toBe('Spar');
  });
  it('resolves a featured chain name that is not an id to «Alle», which lists every chain first', () => {
    expect(findChainOption(options, 'Marked')?.id).toBe(ALL_CHAINS);
    expect(findChainOption(options, 'REMA 1000')?.id).toBe(ALL_CHAINS);
  });
  it('returns undefined for an unknown chain', () => {
    expect(findChainOption(options, 'Ukjent')).toBeUndefined();
  });
});

describe('product chain matching', () => {
  it('matches aliases case- and whitespace-insensitively', () => {
    expect(productMatchesChain(deal(' marked'), option('Coop Marked'))).toBe(true);
    expect(productMatchesChain(deal('COOP EXTRA'), option('Extra'))).toBe(true);
    expect(productMatchesChain(deal('KIWI'), option('Extra'))).toBe(false);
  });
  it('excludes products without a chain from a chain filter', () => {
    expect(productMatchesChain(deal(null), option('KIWI'))).toBe(false);
    expect(productMatchesChain(deal(null), option(ALL_CHAINS))).toBe(false);
  });
  it('lets everything through when the option has no chain list', () => {
    const anything = { id: 'x', label: 'x', chains: null, count: 0 };
    expect(productMatchesChain(deal(null), anything)).toBe(true);
    expect(productMatchesChain(deal('Spar'), anything)).toBe(true);
  });
});
