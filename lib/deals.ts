import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCatalog, refreshCatalog } from './catalog';
import type { MenyProduct } from './types';
import { isLikelyCampaignText } from './campaigns';

const DEALS_CACHE_KEY = 'deals.cache.v5';
const DEFAULT_SEARCH_LIMIT = 60;
const DEAL_SEARCH_LIMIT = 80;
const ACTIVE_DEAL_DROP_PCT = 5;

export async function saveCachedDeals(deals: MenyProduct[]) {
  // Best-effort: tilbudslista kan sprenge AsyncStorage/localStorage-grensa
  // (~5–6 MB, særlig på web). En feilet skriving skal aldri velte appen.
  try {
    await AsyncStorage.setItem(DEALS_CACHE_KEY, JSON.stringify(deals));
  } catch {
    // ignorer – cache er bare en bonus for offline-visning
  }
}

export async function loadCachedDeals(): Promise<MenyProduct[] | null> {
  const raw = await AsyncStorage.getItem(DEALS_CACHE_KEY);
  if (!raw) return null;
  // Cachen kan være fra forrige uke (offline-fallback) – ikke vis utløpte tilbud.
  return (JSON.parse(raw) as MenyProduct[]).filter((product) => !isExpiredOffer(product));
}

function hasCampaignSignal(product: Pick<MenyProduct, 'campaign_text' | 'price_source'>) {
  // 'tjek' = ukentlig kundeavis-tilbud (KIWI/REMA/Coop m.fl.); alltid et reelt
  // tilbud selv uten oppgitt før-pris, så det teller som kampanjesignal.
  return (
    product.price_source === 'meny' ||
    product.price_source === 'tjek' ||
    isLikelyCampaignText(product.campaign_text)
  );
}

// Tjek sender «2026-09-23T21:59:59+0000»; legg inn kolon i tidssonen så
// strengen er gyldig ISO og parses likt i alle JS-motorer (også Hermes).
function parseValidUntil(value: string): number {
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

// Ukestilbud (tjek) har en sluttdato. Syncen kjører bare om natta, så uten
// denne sjekken vises gårsdagens tilbud fram til neste sync.
export function isExpiredOffer(
  product: Pick<MenyProduct, 'valid_until'>,
  now: number = Date.now(),
) {
  if (!product.valid_until) return false;
  const until = parseValidUntil(product.valid_until);
  return Number.isFinite(until) && until < now;
}

export function isActiveDealProduct(
  product: Pick<MenyProduct, 'campaign_text' | 'price_source' | 'drop_pct' | 'valid_until'>,
  minDropPct = ACTIVE_DEAL_DROP_PCT,
) {
  if (isExpiredOffer(product)) return false;
  return hasCampaignSignal(product) || (product.drop_pct ?? 0) >= minDropPct;
}

const STAPLE_PROFILES: Record<
  string,
  {
    include: string[];
    avoid?: string[];
  }
> = {
  egg: {
    include: [
      'egg',
      '10pk',
      '12pk',
      '6pk',
      'frittgaende',
      'gardsegg',
      'frokostegg',
      'solegg',
      'prior',
      'bakketun',
    ],
    avoid: ['eggesalat', 'eggelikor', 'ammeinnlegg', 'palegg', 'reker', 'majones'],
  },
  melk: {
    include: [
      'melk',
      'lettmelk',
      'helmelk',
      'skummetmelk',
      'h melk',
      'laktosefri',
      'tinemelk',
      'q melk',
    ],
    avoid: [
      'melkesjokolade',
      'sjokolademelk',
      'havremelk',
      'mandelmelk',
      'kokosmelk',
      'proteinmelk',
      'kaffe',
    ],
  },
  smor: {
    include: [
      'smør',
      'meierismør',
      'lettsmør',
      'lurpak',
      'brelett',
      'bremykt',
      'smøremyk',
      'soyasmør',
    ],
    avoid: ['smørbrød', 'smørsmak', 'kryddersmør', 'hvitløksmør', 'sandefjordsmør', 'kyllingsmør'],
  },
  brod: {
    include: [
      'brod',
      'grovbrod',
      'kneipp',
      'rundstykker',
      'toastbrod',
      'havrebrod',
      'fjellbrod',
      'mors brod',
    ],
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
  avocado: {
    include: ['avokado', 'avocado'],
  },
  avokado: {
    include: ['avokado', 'avocado'],
  },
  tagliatelle: {
    include: ['tagliatelle', 'pasta', 'de cecco', 'fersk pasta'],
  },
  sjokoladekake: {
    include: ['sjokoladekake', 'kake', 'sjokolade'],
  },
  speltbrod: {
    include: ['speltbrod', 'brod'],
  },
  fiskeburger: {
    include: ['fiskeburger', 'lofotburger', 'lofoten', 'fiskekake'],
  },
  lofoten: {
    include: ['lofoten', 'lofotburger', 'fiskeburger'],
  },
  lofotburger: {
    include: ['lofotburger', 'lofoten', 'fiskeburger'],
  },
  coca: {
    include: ['coca', 'cola', 'coca cola', 'coca-cola', 'zero', '1 5l', '1 5lx8'],
  },
  cola: {
    include: ['coca', 'cola', 'coca cola', 'coca-cola', 'zero', '1 5l', '1 5lx8'],
  },
  zero: {
    include: ['zero', 'coca', 'cola', 'u sukker'],
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
  ketchup: {
    include: ['ketchup', 'tomatketchup', 'idun', 'heinz'],
  },
  pannekaker: {
    include: ['pannekaker', 'pannekake', 'pannekakemix', 'mix', 'toro'],
    avoid: ['proteinbar'],
  },
  kotelett: {
    include: ['kotelett', 'koteletter', 'svinekotelett', 'nakkekotelett', 'jacobs'],
  },
  koteletter: {
    include: ['kotelett', 'koteletter', 'svinekotelett', 'nakkekotelett', 'jacobs'],
  },
  spaghetti: {
    include: ['spaghetti', 'spagetti', 'pasta', 'sopps', 'barilla'],
  },
};

function replaceNordicLetters(value: string) {
  return value.replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a');
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

// Reject "Husets pr Kg / pr stykk" subdivision rows whose listed price is a
// per-gram or per-item fraction (typically 0.10 kr), so they don't pollute search.
const BAD_SUBDIVISION_NAME = /\b(pr\.?\s*(kg|stk|stykk))\b|\bhusets\b/i;

function isBogusSubdivisionRow(product: MenyProduct): boolean {
  if (product.current_price == null) return false;
  if (product.current_price >= 5) return false;
  return BAD_SUBDIVISION_NAME.test(product.name);
}

function scoreProduct(product: MenyProduct, terms: string[]) {
  if (isBogusSubdivisionRow(product)) return -1;

  const name = normalizeSearchText(product.name);
  const nameDense = name.replace(/\s+/g, '');
  const brand = normalizeSearchText(product.brand ?? '');
  const vendorUrl = normalizeSearchText(product.vendor_url ?? '');
  const campaignText = normalizeSearchText(product.campaign_text ?? '');
  const haystack = `${name} ${brand} ${campaignText}`.trim();
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
    const inCampaign = campaignText.includes(term);
    const inVendor = vendorWords.includes(term);
    return { exactWord, prefixWord, suffixWord, containsWord, brandPrefix, inCampaign, inVendor };
  };

  let score = 0;
  let primaryMatched = true;
  let matchedTerms = 0;
  let strongMatchedTerms = 0;
  for (const term of terms) {
    const m = matchInfo(term);
    const strongMatch = m.exactWord || m.prefixWord || m.suffixWord || m.inVendor;
    // Hyphen-bridge: "kroneis" matches "krone is" / "krone-is" via the
    // separator-stripped name. Acts like a contains-match, counts as matched.
    const denseMatch = !strongMatch && term.length >= 4 && nameDense.includes(term);
    const matched = strongMatch || m.containsWord || m.brandPrefix || denseMatch;
    if (!matched) primaryMatched = false;
    if (matched) matchedTerms += 1;
    if (strongMatch) strongMatchedTerms += 1;

    if (m.exactWord) {
      score += 260;
      continue;
    }
    if (name.startsWith(term)) score += 180;
    if (m.prefixWord) score += 140;
    if (m.suffixWord) score += 110;
    if (m.brandPrefix) score += 50;
    if (m.inCampaign) score += 75;
    if (m.inVendor) score += 60;
    if (m.containsWord) score += term.length <= 3 ? 8 : 20;
    if (denseMatch) score += 90;
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
    if (matchedTerms === 0) return -1;
    if (terms.length === 1 && strongMatchedTerms === 0) return -1;
    if (terms.length > 1) {
      const minMatches = Math.max(1, Math.ceil(terms.length / 2));
      if (matchedTerms < minMatches) return -1;
      score -= (terms.length - matchedTerms) * 65;
      if (strongMatchedTerms === 0) score -= 40;
    }
  }

  if (name === terms.join(' ')) score += 200;
  if (matchedTerms === terms.length) score += 120;
  else if (matchedTerms > 0) score += matchedTerms * 24;
  if (hasCampaignSignal(product)) score += 180;
  if ((product.drop_pct ?? 0) >= ACTIVE_DEAL_DROP_PCT)
    score += Math.min(140, (product.drop_pct ?? 0) * 5);
  if (product.current_price != null) score += Math.max(0, 20 - product.current_price / 20);
  return score;
}

function tidyDisplayName(name: string): string {
  return name
    .replace(/[\s.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Like navn i ulike kjeder skilles allerede av kjede-merket på kortet, så
// bare like navn i samme kjede får EAN-suffiks. Tjek-rader har en syntetisk
// id i stedet for EAN (tjek:…), som ikke sier brukeren noe – de får ingen.
function disambiguateDisplayNames(products: MenyProduct[]): MenyProduct[] {
  const counts = new Map<string, number>();
  const keyOf = (clean: string, product: MenyProduct) => `${product.chain ?? ''}|${clean}`;
  const prepared = products.map((product) => {
    const clean = tidyDisplayName(product.name);
    const key = keyOf(clean, product);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return { product, clean };
  });
  return prepared.map(({ product, clean }) => {
    const collides = (counts.get(keyOf(clean, product)) ?? 0) > 1;
    if (collides && product.ean && product.price_source !== 'tjek') {
      return { ...product, name: `${clean} · #${product.ean.slice(-4)}` };
    }
    if (clean !== product.name) return { ...product, name: clean };
    return product;
  });
}

function dedupeProducts(products: MenyProduct[]): MenyProduct[] {
  const seen = new Map<string, MenyProduct>();
  for (const product of products) {
    const key =
      product.ean ||
      `${normalizeSearchText(product.name).replace(/\s+/g, ' ').trim()}|${product.current_price != null ? product.current_price.toFixed(2) : 'null'}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, product);
      continue;
    }
    const existingScore =
      (existing.image_url ? 2 : 0) +
      (existing.brand ? 1 : 0) +
      (existing.drop_pct != null ? 1 : 0) +
      (hasCampaignSignal(existing) ? 3 : 0);
    const candidateScore =
      (product.image_url ? 2 : 0) +
      (product.brand ? 1 : 0) +
      (product.drop_pct != null ? 1 : 0) +
      (hasCampaignSignal(product) ? 3 : 0);
    if (candidateScore > existingScore) seen.set(key, product);
  }
  return [...seen.values()];
}

export async function fetchDiscontinuedEans(eans: string[]): Promise<Set<string>> {
  const unique = [...new Set(eans.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const catalog = await getCatalog();
  const present = new Set(catalog.map((p) => p.ean));
  return new Set(unique.filter((ean) => !present.has(ean)));
}

// Hold i sync med DEFAULT_EXCLUDED i scripts/kassal-sync/sync.ts. Dette er
// sikkerhetsnettet som filtrerer bort ikke-fysiske/ikke-dagligvare-kjeder også
// når den serverte products.json er eldre enn ekskluderingslista (f.eks. Oda
// = nettbutikk, Europris = varehus).
const EXCLUDED_CHAINS = new Set([
  'Oda',
  'Europris',
  'Engrosnett',
  'Havaristen',
  'Holdbart',
  'FastCandy.no',
  'Slowly.no',
  'Leske.no',
]);

export async function fetchTopDeals(
  minDropPct = 10,
  limit = 100,
  options: { forceNetwork?: boolean } = {},
): Promise<MenyProduct[]> {
  const catalog = options.forceNetwork ? await refreshCatalog() : await getCatalog();
  const products = catalog.filter(
    (product) =>
      !EXCLUDED_CHAINS.has(product.chain ?? '') && isActiveDealProduct(product, minDropPct),
  );
  const sorted = products.sort((a, b) => {
    // Tilbud med kvantifisert rabatt (reelt drop_pct) først, sortert på dybde –
    // gjelder både Kassal-prisfall og tjek-tilbud med før-pris. Deretter tjek-
    // tilbud uten oppgitt %-rabatt, så de ikke fortrenger de tallfestede tilbudene.
    const aHasDrop = (a.drop_pct ?? 0) > 0 ? 1 : 0;
    const bHasDrop = (b.drop_pct ?? 0) > 0 ? 1 : 0;
    if (bHasDrop !== aHasDrop) return bHasDrop - aHasDrop;
    return (b.drop_pct ?? 0) - (a.drop_pct ?? 0);
  });
  return disambiguateDisplayNames(dedupeProducts(sorted).slice(0, limit));
}

export async function searchProducts(
  query: string,
  options?: number | { limit?: number; dealsOnly?: boolean },
): Promise<MenyProduct[]> {
  const normalizedOptions = typeof options === 'number' ? { limit: options } : (options ?? {});
  const limit = normalizedOptions.limit ?? DEFAULT_SEARCH_LIMIT;
  const dealsOnly = normalizedOptions.dealsOnly ?? false;
  const q = query.trim();
  if (q.length < 2) return [];
  const terms = normalizeSearchText(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const catalog = await getCatalog();
  const pool = dealsOnly
    ? catalog.filter((product) => isActiveDealProduct(product, ACTIVE_DEAL_DROP_PCT))
    : catalog;

  const ranked = pool
    .map((product) => ({ product, score: scoreProduct(product, terms) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aHasCampaign = hasCampaignSignal(a.product) ? 1 : 0;
      const bHasCampaign = hasCampaignSignal(b.product) ? 1 : 0;
      if (bHasCampaign !== aHasCampaign) return bHasCampaign - aHasCampaign;
      if ((b.product.drop_pct ?? 0) !== (a.product.drop_pct ?? 0)) {
        return (b.product.drop_pct ?? 0) - (a.product.drop_pct ?? 0);
      }
      if (a.product.current_price == null) return 1;
      if (b.product.current_price == null) return -1;
      return a.product.current_price - b.product.current_price;
    })
    .map((entry) => entry.product);
  const finalLimit = dealsOnly ? Math.max(limit, DEAL_SEARCH_LIMIT) : limit;
  return disambiguateDisplayNames(dedupeProducts(ranked).slice(0, finalLimit));
}
