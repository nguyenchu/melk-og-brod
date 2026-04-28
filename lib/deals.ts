import { supabase } from './supabase';
import type { MenyProduct } from './types';

const MAX_DEAL_AGE_HOURS = 48;
const STAPLE_PROFILES: Record<
  string,
  {
    include: string[];
    avoid?: string[];
  }
> = {
  egg: {
    include: ['egg', '10pk', '12pk', '6pk', 'frittgaende', 'gardsegg', 'frokostegg', 'solegg', 'prior', 'bakketun'],
    avoid: ['eggesalat', 'eggelikor', 'ammeinnlegg', 'palegg', 'reker', 'majones'],
  },
  melk: {
    include: ['melk', 'lettmelk', 'helmelk', 'skummetmelk', 'h melk', 'laktosefri', 'tinemelk', 'q melk'],
    avoid: ['melkesjokolade', 'sjokolademelk', 'havremelk', 'mandelmelk', 'kokosmelk', 'proteinmelk', 'kaffe'],
  },
  smor: {
    include: ['smør', 'meierismør', 'lettsmør', 'lurpak', 'brelett', 'bremykt', 'smøremyk', 'soyasmør'],
    avoid: ['smørbrød', 'smørsmak', 'kryddersmør', 'hvitløksmør', 'sandefjordsmør', 'kyllingsmør'],
  },
  brod: {
    include: ['brod', 'grovbrod', 'kneipp', 'rundstykker', 'toastbrod', 'havrebrod', 'fjellbrod', 'mors brod'],
    avoid: ['knaeckebrod', 'broding', 'brodform', 'brodmix'],
  },
  ost: {
    include: ['ost', 'gulost', 'hvitost', 'cheddar', 'mozzarella', 'norvegia'],
    avoid: ['salatost', 'ostekake', 'toast', 'ostepop'],
  },
  yoghurt: {
    include: ['yoghurt', 'yogurt'],
    avoid: ['yoghurtdressing'],
  },
  kaffe: {
    include: ['kaffe', 'filterkaffe', 'espressobonner'],
  },
  bleie: {
    include: ['bleie', 'bleier', 'buksebleie', 'lillego', 'libero', 'pampers'],
    avoid: ['bleieposer', 'truseinnlegg', 'ammeinnlegg'],
  },
  bleier: {
    include: ['bleie', 'bleier', 'buksebleie', 'lillego', 'libero', 'pampers'],
    avoid: ['bleieposer', 'truseinnlegg', 'ammeinnlegg'],
  },
  juice: {
    include: ['juice', 'appelsinjuice', 'eplejuice'],
  },
  banan: {
    include: ['banan'],
    avoid: ['bananpalegg'],
  },
  eple: {
    include: ['eple'],
  },
  tomat: {
    include: ['tomat'],
    avoid: ['tomatsuppe', 'tomatpure', 'pastasaus'],
  },
  agurk: {
    include: ['agurk'],
  },
  potet: {
    include: ['potet'],
    avoid: ['potetgull'],
  },
};

function replaceNordicLetters(value: string) {
  return value
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a');
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[æøå]/g, (letter) => replaceNordicLetters(letter))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getStapleProfile(terms: string[]) {
  return terms.length === 1 ? STAPLE_PROFILES[terms[0]] : undefined;
}

function scoreProduct(product: MenyProduct, terms: string[]) {
  const name = normalizeSearchText(product.name);
  const brand = normalizeSearchText(product.brand ?? '');
  const vendorUrl = normalizeSearchText(product.vendor_url ?? '');
  const haystack = `${name} ${brand}`.trim();
  const words = haystack.split(/\s+/).filter(Boolean);
  const vendorWords = vendorUrl.split(/\s+/).filter(Boolean);
  const stapleProfile = getStapleProfile(terms);
  const strongStapleSignals = new Set<string>();

  const matchInfo = (term: string) => {
    const exactWord = words.includes(term);
    const prefixWord = words.some((word) => word.startsWith(term));
    const suffixWord = !exactWord && words.some((word) => word.endsWith(term));
    const containsWord = words.some((word) => word.includes(term));
    const brandPrefix = brand.startsWith(term);
    const inVendor = vendorWords.includes(term);
    return { exactWord, prefixWord, suffixWord, containsWord, brandPrefix, inVendor };
  };

  let score = 0;
  let primaryMatched = true;
  for (const term of terms) {
    const m = matchInfo(term);
    const matched =
      m.exactWord || m.prefixWord || m.suffixWord || m.containsWord || m.brandPrefix || m.inVendor;
    if (!matched) primaryMatched = false;

    if (m.exactWord) {
      score += 260;
      continue;
    }
    if (name.startsWith(term)) score += 180;
    if (m.prefixWord) score += 140;
    if (m.suffixWord) score += 110;
    if (m.brandPrefix) score += 50;
    if (m.inVendor) score += 60;
    if (m.containsWord) score += term.length <= 3 ? 8 : 20;
  }

  let stapleMatched = primaryMatched;
  if (stapleProfile) {
    const preferredHits = stapleProfile.include.filter((term) => {
      const m = matchInfo(term);
      const strong = m.exactWord || m.prefixWord || m.suffixWord || m.inVendor;
      const weak = haystack.includes(term);
      if (strong) {
        strongStapleSignals.add(term);
        stapleMatched = true;
      } else if (weak) {
        stapleMatched = true;
      }
      return strong || weak;
    });
    if (preferredHits.length > 0) score += preferredHits.length * 90;

    const avoidHits = (stapleProfile.avoid ?? []).filter((term) => haystack.includes(term));
    if (avoidHits.length > 0) score -= avoidHits.length * 140;

    const strongAvoid = (stapleProfile.avoid ?? []).some((term) => {
      const m = matchInfo(term);
      return m.exactWord || m.prefixWord || m.suffixWord;
    });
    if (strongAvoid) return -1;

    if (!stapleMatched) return -1;
    if (strongStapleSignals.size === 0 && !primaryMatched) return -1;
    if (strongStapleSignals.size === 0) score -= 60;
  } else if (!primaryMatched) {
    return -1;
  }

  if (name === terms.join(' ')) score += 200;
  if (product.current_price != null) score += Math.max(0, 20 - product.current_price / 20);
  return score;
}

function expandSearchTerms(terms: string[]) {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const extra of STAPLE_PROFILES[term]?.include ?? []) {
      expanded.add(extra);
    }
    if (term.endsWith('er') && term.length > 4) {
      expanded.add(term.slice(0, -2));
    }
    if (term.endsWith('e') && term.length > 4) {
      expanded.add(`${term}r`);
    }
    if (term.endsWith('ie')) {
      expanded.add(`${term}r`);
    }
  }
  return [...expanded];
}

function tidyDisplayName(name: string): string {
  return name
    .replace(/[\s.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function disambiguateDisplayNames(products: MenyProduct[]): MenyProduct[] {
  const counts = new Map<string, number>();
  const prepared = products.map((product) => {
    const clean = tidyDisplayName(product.name);
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
    return { product, clean };
  });
  return prepared.map(({ product, clean }) => {
    const collides = (counts.get(clean) ?? 0) > 1;
    if (collides && product.ean) {
      return { ...product, name: `${clean} · #${product.ean.slice(-4)}` };
    }
    if (clean !== product.name) return { ...product, name: clean };
    return product;
  });
}

function dedupeProducts(products: MenyProduct[]): MenyProduct[] {
  const seen = new Map<string, MenyProduct>();
  for (const product of products) {
    const nameKey = normalizeSearchText(product.name).replace(/\s+/g, ' ').trim();
    const priceKey = product.current_price != null ? product.current_price.toFixed(2) : 'null';
    const key = `${nameKey}|${priceKey}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, product);
      continue;
    }
    const existingScore =
      (existing.image_url ? 2 : 0) + (existing.brand ? 1 : 0) + (existing.drop_pct != null ? 1 : 0);
    const candidateScore =
      (product.image_url ? 2 : 0) + (product.brand ? 1 : 0) + (product.drop_pct != null ? 1 : 0);
    if (candidateScore > existingScore) seen.set(key, product);
  }
  return [...seen.values()];
}

export async function fetchTopDeals(minDropPct = 10, limit = 100): Promise<MenyProduct[]> {
  const freshestAllowed = new Date(Date.now() - MAX_DEAL_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .not('drop_pct', 'is', null)
    .gte('drop_pct', minDropPct)
    .gte('computed_at', freshestAllowed)
    .not('vendor_url', 'ilike', '%kioskvarer%')
    .order('drop_pct', { ascending: false })
    .limit(limit * 2);
  if (error) throw error;
  return disambiguateDisplayNames(dedupeProducts((data ?? []) as MenyProduct[]).slice(0, limit));
}

export async function searchProducts(query: string, limit = 30): Promise<MenyProduct[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rawTerms = q
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const terms = normalizeSearchText(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const expandedTerms = expandSearchTerms(terms);
  const stapleProfile = getStapleProfile(terms);
  const queryTerms = stapleProfile ? expandedTerms : expandedTerms.slice(0, 4);
  const dbTerms = [...new Set([...rawTerms, ...queryTerms])]
    .filter(Boolean);
  const clauses = dbTerms
    .flatMap((term) => {
      const escaped = term.replace(/[%_]/g, (m) => `\\${m}`);
      return [
        `name.ilike.%${escaped}%`,
        `brand.ilike.%${escaped}%`,
        `vendor_url.ilike.%${escaped}%`,
      ];
    })
    .join(',');
  const candidateLimit = stapleProfile ? Math.max(limit * 24, 1500) : Math.max(limit * 8, 180);
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .or(clauses)
    .limit(candidateLimit);
  if (error) throw error;
  const ranked = ((data ?? []) as MenyProduct[])
    .map((product) => ({ product, score: scoreProduct(product, terms) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.product.current_price == null) return 1;
      if (b.product.current_price == null) return -1;
      return a.product.current_price - b.product.current_price;
    })
    .map((entry) => entry.product);
  return disambiguateDisplayNames(dedupeProducts(ranked).slice(0, limit));
}
