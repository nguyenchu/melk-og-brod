import { describe, expect, it } from 'vitest';
import {
  ALL_CHAINS,
  DEFAULT_FOLLOWED_CHAINS,
  FEATURED_CHAIN_FILTERS,
  FEATURED_CHAIN_MEMBERS,
  allFollowedOption,
  chainCountsFor,
  chainOptionsFor,
  countChains,
  findChainOption,
  followedOptionsFor,
  isFeaturedChainOption,
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
  const found = chainOptionsFor(deals).find((candidate) => candidate.id === id);
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

describe('chain options', () => {
  it('merges the aliases Coop Marked/Marked and Extra/Coop Extra', () => {
    expect(option('Coop Marked').count).toBe(2);
    expect(option('Extra')).toMatchObject({ label: 'Coop Extra', count: 2 });
  });
  it('lists every featured chain first, alphabetically, with zero counts when absent', () => {
    const options = chainOptionsFor(null);
    expect(options.map((candidate) => candidate.id).sort()).toEqual(
      [...DEFAULT_FOLLOWED_CHAINS].sort(),
    );
    const labels = options.map((candidate) => candidate.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'nb')));
    expect(options.every((candidate) => candidate.count === 0)).toBe(true);
  });
  it('lists non-featured chains with deals after the featured ones, alphabetically', () => {
    const options = chainOptionsFor(deals);
    expect(options.slice(FEATURED_CHAIN_FILTERS.length)).toEqual([
      { id: 'Obs', label: 'Obs', chains: ['Obs'], count: 1 },
      { id: 'Spar', label: 'Spar', chains: ['Spar'], count: 1 },
    ]);
    expect(options.slice(0, FEATURED_CHAIN_FILTERS.length).every(isFeaturedChainOption)).toBe(true);
    expect(isFeaturedChainOption(option('Spar'))).toBe(false);
  });
});

describe('followed chains', () => {
  const options = chainOptionsFor(deals);
  it('keeps the option order and matches ids case-insensitively', () => {
    const followed = followedOptionsFor(options, ['spar', 'REMA', 'kiwi']);
    expect(followed.map((candidate) => candidate.id)).toEqual(['KIWI', 'REMA', 'Spar']);
  });
  it('skips followed chains that have no option right now', () => {
    expect(followedOptionsFor(options, ['Ukjent', 'KIWI']).map((c) => c.id)).toEqual(['KIWI']);
  });
  it('sums the followed chains into «Alle mine»', () => {
    const all = allFollowedOption(followedOptionsFor(options, ['KIWI', 'Coop Marked', 'Spar']));
    expect(all).toEqual({
      id: ALL_CHAINS,
      label: 'Alle mine',
      chains: ['Coop Marked', 'Marked', 'KIWI', 'Spar'],
      count: 5,
    });
    expect(productMatchesChain(deal('Marked'), all)).toBe(true);
    expect(productMatchesChain(deal('REMA 1000'), all)).toBe(false);
  });
  it('matches nothing when no chains are followed', () => {
    const none = allFollowedOption([]);
    expect(none.count).toBe(0);
    expect(productMatchesChain(deal('KIWI'), none)).toBe(false);
  });
});

describe('chain option lookup', () => {
  const options = chainOptionsFor(deals);
  it('finds an option by id or by one of its chains', () => {
    expect(findChainOption(options, 'coop marked')?.id).toBe('Coop Marked');
    expect(findChainOption(options, 'kiwi')?.id).toBe('KIWI');
    expect(findChainOption(options, 'spar')?.id).toBe('Spar');
    expect(findChainOption(options, 'REMA 1000')?.id).toBe('REMA');
  });
  it('returns undefined for «Alle» and unknown chains', () => {
    expect(findChainOption(options, ALL_CHAINS)).toBeUndefined();
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
    expect(productMatchesChain(deal(null), allFollowedOption(chainOptionsFor(deals)))).toBe(false);
  });
  it('lets everything through when the option has no chain list', () => {
    const anything = { id: 'x', label: 'x', chains: null, count: 0 };
    expect(productMatchesChain(deal(null), anything)).toBe(true);
    expect(productMatchesChain(deal('Spar'), anything)).toBe(true);
  });
});
