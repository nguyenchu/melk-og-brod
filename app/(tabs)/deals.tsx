import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Line, Path, Svg, Circle as SvgCircle, Text as SvgText } from 'react-native-svg';
import { addToCart, removeFromCart, updateQuantity, useCart } from '@/lib/cart';
import { getCampaignKind, isLikelyCampaignText } from '@/lib/campaigns';
import { fetchTopDeals, loadCachedDeals, saveCachedDeals } from '@/lib/deals';
import { toggleFavorite, useFavorites } from '@/lib/favorites';
import { hasDataConfig } from '@/lib/catalog';
import { formatDisplayPrice, formatUnitPriceLabel, isApproximateWeight } from '@/lib/pricing';
import type { MenyProduct, PricePoint } from '@/lib/types';

const CHAIN_FILTER_KEY = 'deals.chainFilter.v1';
const COOP_FILTER_KEY = 'deals.coopFilter.v1';
const ALL_CHAINS = 'Alle';
const DEALS_SCREEN_LIMIT = 5000;
const COOP_FILTER_ID = 'Coop';
const COOP_ALL_FILTER_ID = 'CoopAll';
const COOP_DEFAULT_FILTER_ID = 'Extra';

type ChainOption = { id: string; label: string; chains: string[] | null; count: number; secondary?: boolean };

const COOP_CHAINS = ['Extra', 'Coop Extra', 'Obs', 'Coop Mega', 'Coop Prix', 'Coop Marked'];
const COOP_CHAIN_PRIORITY = new Map(
  COOP_CHAINS.map((chain, index) => [normalizeChainName(chain), index]),
);

const COOP_CHAIN_FILTERS: ChainOption[] = [
  { id: 'Extra', label: 'Extra', chains: ['Extra', 'Coop Extra'], count: 0 },
  { id: 'Obs', label: 'Obs', chains: ['Obs'], count: 0 },
  { id: 'Coop Mega', label: 'Coop Mega', chains: ['Coop Mega'], count: 0 },
  { id: 'Coop Prix', label: 'Coop Prix', chains: ['Coop Prix'], count: 0 },
  { id: 'Coop Marked', label: 'Coop Marked', chains: ['Coop Marked'], count: 0 },
  { id: COOP_ALL_FILTER_ID, label: 'Alle Coop', chains: COOP_CHAINS, count: 0 },
];

const FEATURED_CHAIN_FILTERS: ChainOption[] = [
  { id: 'KIWI', label: 'KIWI', chains: ['KIWI'], count: 0 },
  { id: 'REMA', label: 'REMA', chains: ['REMA 1000'], count: 0 },
  { id: COOP_FILTER_ID, label: 'Coop', chains: COOP_CHAINS, count: 0 },
];

const SECONDARY_CHAIN_NAMES = new Set(['jacobs', 'matkroken', 'spar', 'eurospar'].map(normalizeChainName));

function normalizeChainName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const FEATURED_CHAIN_MEMBERS = new Set(
  FEATURED_CHAIN_FILTERS.flatMap((option) => option.chains ?? []).map(normalizeChainName),
);

function chainCountsFor(deals: MenyProduct[] | null) {
  const counts = new Map<string, number>();
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countChains(chains: string[] | null, counts: Map<string, number>) {
  return (chains ?? []).reduce((sum, chain) => sum + (counts.get(normalizeChainName(chain)) ?? 0), 0);
}

function coopFilterIdForStoredValue(value: string | null | undefined) {
  if (!value) return COOP_DEFAULT_FILTER_ID;
  const key = normalizeChainName(value);
  if (key === normalizeChainName(COOP_FILTER_ID) || key === normalizeChainName(COOP_ALL_FILTER_ID)) {
    return COOP_DEFAULT_FILTER_ID;
  }
  return (
    COOP_CHAIN_FILTERS.find((option) =>
      option.chains?.some((chain) => normalizeChainName(chain) === key),
    )?.id ?? COOP_DEFAULT_FILTER_ID
  );
}

function chainOptionsFor(deals: MenyProduct[] | null): ChainOption[] {
  const present = new Map<string, string>();
  const counts = chainCountsFor(deals);
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    if (!present.has(key)) present.set(key, deal.chain);
  }

  const options: ChainOption[] = [
    { id: ALL_CHAINS, label: ALL_CHAINS, chains: null, count: deals?.length ?? 0 },
  ];
  for (const option of FEATURED_CHAIN_FILTERS) {
    const chains = option.chains ?? [];
    const count = countChains(chains, counts);
    options.push({ ...option, chains, count });
  }

  const remaining = Array.from(present)
    .map(([key, chain]) => ({ key, chain }))
    .filter(({ key }) => !FEATURED_CHAIN_MEMBERS.has(key))
    .sort((a, b) => a.chain.localeCompare(b.chain, 'nb'));

  const chainOptions = options.slice(1).concat(
    remaining.map(({ chain }) => ({
      id: chain,
      label: chain,
      chains: [chain],
      count: counts.get(normalizeChainName(chain)) ?? 0,
      secondary: SECONDARY_CHAIN_NAMES.has(normalizeChainName(chain)),
    })),
  );
  chainOptions.sort((a, b) => {
    const secondaryOrder = Number(a.secondary ?? false) - Number(b.secondary ?? false);
    if (secondaryOrder !== 0) return secondaryOrder;
    return a.label.localeCompare(b.label, 'nb');
  });
  return [options[0], ...chainOptions];
}

function coopOptionsFor(deals: MenyProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  return COOP_CHAIN_FILTERS.map((option) => ({
    ...option,
    count: countChains(option.chains, counts),
  }));
}

function selectedChainOption(options: ChainOption[], chainFilter: string): ChainOption {
  const selectedKey = normalizeChainName(chainFilter);
  return (
    options.find((option) => normalizeChainName(option.id) === selectedKey) ??
    options.find((option) => normalizeChainName(option.label) === selectedKey) ??
    options.find((option) => option.chains?.some((chain) => normalizeChainName(chain) === selectedKey)) ??
    options[0]
  );
}

function selectedCoopOption(options: ChainOption[], coopFilter: string): ChainOption {
  const selectedKey = normalizeChainName(coopFilter);
  return (
    options.find((option) => normalizeChainName(option.id) === selectedKey) ??
    options.find((option) => normalizeChainName(option.label) === selectedKey) ??
    options.find((option) => option.chains?.some((chain) => normalizeChainName(chain) === selectedKey)) ??
    options.find((option) => option.id === COOP_DEFAULT_FILTER_ID) ??
    options[0]
  );
}

function productMatchesChain(product: MenyProduct, option: ChainOption) {
  if (!option.chains) return true;
  if (!product.chain) return false;
  const selectedChains = new Set(option.chains.map(normalizeChainName));
  return selectedChains.has(normalizeChainName(product.chain));
}

function chainPriorityForOption(product: MenyProduct, option: ChainOption) {
  if (option.id !== COOP_FILTER_ID || !product.chain) return 0;
  return COOP_CHAIN_PRIORITY.get(normalizeChainName(product.chain)) ?? COOP_CHAINS.length;
}

function formatComputedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Oppdatert tidspunkt ukjent';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
  const absolute = new Intl.DateTimeFormat('nb-NO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (diffHours < 1) return `Oppdatert nylig · ${absolute}`;
  if (diffHours < 24) return `Oppdatert for ${diffHours} t siden · ${absolute}`;

  const diffDays = Math.round(diffHours / 24);
  return `Oppdatert for ${diffDays} d siden · ${absolute}`;
}

function formatValidUntil(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(date);
}

function shouldShowBrand(name: string, brand: string | null | undefined) {
  if (!brand) return false;

  const normalizedName = name.toLowerCase();
  const normalizedBrand = brand.toLowerCase().trim();
  if (!normalizedBrand) return false;

  return !normalizedName.includes(normalizedBrand);
}

export default function DealsScreen() {
  const [deals, setDeals] = useState<MenyProduct[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<MenyProduct | null>(null);
  const [chainFilter, setChainFilter] = useState<string>(ALL_CHAINS);
  const [coopFilter, setCoopFilter] = useState<string>(COOP_DEFAULT_FILTER_ID);
  const [coopMenuOpen, setCoopMenuOpen] = useState(false);
  const { items: cartItems } = useCart();

  useEffect(() => {
    AsyncStorage.getItem(CHAIN_FILTER_KEY)
      .then((v) => {
        if (!v) return;
        const coopId = coopFilterIdForStoredValue(v);
        if (coopId !== COOP_DEFAULT_FILTER_ID || normalizeChainName(v) === normalizeChainName(COOP_FILTER_ID)) {
          setChainFilter(COOP_FILTER_ID);
          setCoopFilter(coopId);
        } else {
          setChainFilter(v);
        }
      })
      .catch(() => {});
    AsyncStorage.getItem(COOP_FILTER_KEY)
      .then((v) => {
        if (v) setCoopFilter(coopFilterIdForStoredValue(v));
      })
      .catch(() => {});
  }, []);

  const selectChain = useCallback((chain: string) => {
    setChainFilter(chain);
    if (chain !== COOP_FILTER_ID) setCoopMenuOpen(false);
    AsyncStorage.setItem(CHAIN_FILTER_KEY, chain).catch(() => {});
  }, []);

  const selectCoopChain = useCallback((chain: string) => {
    const coopId = coopFilterIdForStoredValue(chain);
    setCoopFilter(coopId);
    setCoopMenuOpen(false);
    AsyncStorage.setItem(COOP_FILTER_KEY, coopId).catch(() => {});
  }, []);

  const chainOptions = useMemo(() => chainOptionsFor(deals), [deals]);
  const coopOptions = useMemo(() => coopOptionsFor(deals), [deals]);
  const selectedChain = useMemo(
    () => selectedChainOption(chainOptions, chainFilter),
    [chainOptions, chainFilter],
  );
  const selectedCoopChain = useMemo(
    () => selectedCoopOption(coopOptions, coopFilter),
    [coopOptions, coopFilter],
  );
  const effectiveChain = selectedChain.id === COOP_FILTER_ID ? selectedCoopChain : selectedChain;
  const showCoopFilters = selectedChain.id === COOP_FILTER_ID;

  const filteredDeals = useMemo(() => {
    const matches = (deals ?? []).filter((deal) => productMatchesChain(deal, effectiveChain));
    if (selectedChain.id !== COOP_FILTER_ID) return matches;
    return matches.sort(
      (a, b) => chainPriorityForOption(a, selectedChain) - chainPriorityForOption(b, selectedChain),
    );
  }, [deals, effectiveChain, selectedChain]);
  const emptyMessage = effectiveChain.chains
    ? `Ingen aktive kampanjer for ${effectiveChain.label} akkurat nå.`
    : 'Ingen aktive kampanjer akkurat nå. Prøv igjen senere.';

  const cartByEan = useMemo(() => {
    const map = new Map<string, { id: string; quantity: number }>();
    for (const item of cartItems) {
      if (!item.ean || item.checked) continue;
      map.set(item.ean, { id: item.id, quantity: item.quantity });
    }
    return map;
  }, [cartItems]);

  const load = useCallback(async (forceNetwork = false) => {
    if (!hasDataConfig()) {
      setError('Tilbud er ikke tilgjengelig akkurat nå. Prøv igjen senere.');
      return;
    }
    try {
      setError(null);
      const rows = await fetchTopDeals(0.1, DEALS_SCREEN_LIMIT, { forceNetwork });
      setDeals(rows);
      setFromCache(false);
      saveCachedDeals(rows);
    } catch {
      const cached = await loadCachedDeals();
      if (cached && cached.length > 0) {
        setDeals(cached);
        setFromCache(true);
        setError(null);
      } else {
        setError('Ingen nettilgang og ingen lagrede tilbud.');
      }
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const latestComputedAt = deals?.[0]?.computed_at ?? null;

  async function onRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  const handleSelect = useCallback((item: MenyProduct) => setSelectedDeal(item), []);

  const renderItem = useCallback(
    ({ item }: { item: MenyProduct }) => {
      const cart = item.ean ? cartByEan.get(item.ean) : undefined;
      return (
        <DealRow
          item={item}
          cartItemId={cart?.id ?? null}
          cartQuantity={cart?.quantity ?? 0}
          onSelect={handleSelect}
        />
      );
    },
    [cartByEan, handleSelect],
  );

  if (deals === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
    <FlatList
      data={filteredDeals}
      keyExtractor={(d) => d.ean}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      stickyHeaderIndices={[0]}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      ListHeaderComponent={
        <View style={styles.stickyHeader}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <>
              <View style={styles.headerBlock}>
                <Text style={styles.headerSub}>Ekte tilbud fra alle kjeder</Text>
                {fromCache ? (
                  <Text style={styles.cacheNotice}>Viser sist hentede tilbud · ingen nettilgang</Text>
                ) : latestComputedAt ? (
                  <Text style={styles.headerMeta}>{formatComputedAt(latestComputedAt)}</Text>
                ) : null}
              </View>
              {chainOptions.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {chainOptions.map((option) => {
                    const active = option.id === selectedChain.id;
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() => selectChain(option.id)}
                        style={[
                          styles.filterChip,
                          option.secondary && styles.filterChipSecondary,
                          active && styles.filterChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            option.secondary && styles.filterChipTextSecondary,
                            active && styles.filterChipTextActive,
                          ]}
                        >
                          {option.label} {option.count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              {showCoopFilters ? (
                <View style={styles.coopDropdown}>
                  <Pressable
                    onPress={() => setCoopMenuOpen((open) => !open)}
                    style={[styles.coopDropdownButton, coopMenuOpen && styles.coopDropdownButtonOpen]}
                  >
                    <Text style={styles.coopDropdownButtonText}>
                      {selectedCoopChain.label} {selectedCoopChain.count}
                    </Text>
                    <Ionicons name={coopMenuOpen ? 'chevron-up' : 'chevron-down'} size={15} color="#555" />
                  </Pressable>
                  {coopMenuOpen ? (
                    <View style={styles.coopDropdownMenu}>
                      {coopOptions.map((option) => {
                        const active = option.id === selectedCoopChain.id;
                        return (
                          <Pressable
                            key={option.id}
                            onPress={() => selectCoopChain(option.id)}
                            style={[styles.coopDropdownItem, active && styles.coopDropdownItemActive]}
                          >
                            <Text style={[styles.coopDropdownItemText, active && styles.coopDropdownItemTextActive]}>
                              {option.label}
                            </Text>
                            <Text style={[styles.coopDropdownItemCount, active && styles.coopDropdownItemTextActive]}>
                              {option.count}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          <Text style={styles.empty}>
            {emptyMessage}
          </Text>
        ) : null
      }
      renderItem={renderItem}
    />
    {selectedDeal && (
      <PriceHistoryModal deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
    )}
    </>
  );
}

const DealRow = memo(function DealRow({
  item,
  cartItemId,
  cartQuantity,
  onSelect,
}: {
  item: MenyProduct;
  cartItemId: string | null;
  cartQuantity: number;
  onSelect: (item: MenyProduct) => void;
}) {
  const favorites = useFavorites();
  const starred = favorites.some((f) => f.ean === item.ean);
  const inCart = cartQuantity > 0;

  async function onIncrement() {
    try {
      await addToCart({
        name: item.name,
        ean: item.ean,
        image_url: item.image_url,
        price: item.current_price,
        drop_pct: item.drop_pct,
        campaign_text: item.campaign_text,
      });
    } catch (e: any) {
      Alert.alert('Kunne ikke legge til', e.message);
    }
  }

  async function onDecrement() {
    if (!cartItemId) return;
    try {
      if (cartQuantity <= 1) {
        await removeFromCart(cartItemId);
      } else {
        await updateQuantity(cartItemId, cartQuantity - 1);
      }
    } catch (e: any) {
      Alert.alert('Kunne ikke oppdatere', e.message);
    }
  }

  const drop = item.drop_pct ?? 0;
  const isWeekly = item.price_source === 'tjek';
  const approximate = isApproximateWeight(item.name, item.ean);
  const currentPriceLabel = formatDisplayPrice(item.current_price, approximate);
  const beforePriceLabel = formatDisplayPrice(item.median_30d, approximate);
  const beforePricePrefix = isWeekly ? 'før' : 'vanligvis';
  const validUntilLabel = isWeekly ? formatValidUntil(item.valid_until) : null;
  const unitPriceLabel = formatUnitPriceLabel({ name: item.name, price: item.current_price, ean: item.ean });
  const showBrand = shouldShowBrand(item.name, item.brand);

  return (
    <View style={[styles.row, inCart && styles.rowInCart]}>
      {item.image_url ? (
        <Image source={item.image_url} style={styles.thumb} contentFit="contain" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons name="image-outline" size={24} color="#ccc" />
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        {showBrand ? <Text style={styles.brand}>{item.brand}</Text> : null}
        <View style={styles.priceRow}>
          {currentPriceLabel ? (
            <Text style={styles.price}>
              {approximate ? 'ca. ' : ''}
              {currentPriceLabel}
            </Text>
          ) : null}
          {beforePriceLabel ? (
            <Text style={styles.median}>
              {beforePricePrefix} {approximate ? 'ca. ' : ''}
              {beforePriceLabel}
            </Text>
          ) : null}
        </View>
        {isLikelyCampaignText(item.campaign_text) ? <CampaignBadge text={item.campaign_text!} /> : null}
        {approximate ? <Text style={styles.approximate}>Vektvare, pris kan variere litt</Text> : null}
        {unitPriceLabel ? <Text style={styles.unitPrice}>{unitPriceLabel}</Text> : null}
        {validUntilLabel ? <Text style={styles.validUntil}>Gjelder til {validUntilLabel}</Text> : null}
      </View>
      <View style={styles.right}>
        <View style={styles.dropBadge}>
          {drop > 0 ? (
            <Text style={styles.dropText}>−{drop.toFixed(0)}%</Text>
          ) : (
            <Text style={styles.dropText}>Tilbud</Text>
          )}
        </View>
        {item.chain ? (
          <Text style={styles.chainLabel} numberOfLines={1}>{item.chain}</Text>
        ) : null}
        {inCart ? (
          <View style={styles.quantityControl}>
            <Pressable onPress={onDecrement} hitSlop={8} style={styles.quantityButton}>
              <Ionicons name="remove" size={16} color="#444" />
            </Pressable>
            <Text style={styles.quantityValue}>{cartQuantity}</Text>
            <Pressable onPress={onIncrement} hitSlop={8} style={styles.quantityButton}>
              <Ionicons name="add" size={16} color="#444" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onIncrement} style={styles.addBtn}>
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        )}
        <View style={styles.rightExtras}>
          <Pressable
            onPress={() => toggleFavorite({ ean: item.ean, name: item.name, image_url: item.image_url, price: item.current_price })}
            hitSlop={8}
          >
            <Ionicons name={starred ? 'star' : 'star-outline'} size={16} color={starred ? '#F5A623' : '#bbb'} />
          </Pressable>
          <Pressable onPress={() => onSelect(item)} hitSlop={8}>
            <Ionicons name="stats-chart-outline" size={14} color="#aaa" />
          </Pressable>
        </View>
      </View>
    </View>
  );
});

function PriceHistoryModal({ deal, onClose }: { deal: MenyProduct; onClose: () => void }) {
  const history = deal.price_history ?? [];
  const stores = (deal.stores ?? []).filter((s) => s.price != null);
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.modalTitle} numberOfLines={2}>{deal.name}</Text>
          {deal.brand ? <Text style={styles.modalBrand}>{deal.brand}</Text> : null}
          <View style={styles.modalPriceRow}>
            <Text style={styles.modalPrice}>
              {deal.current_price != null ? `${deal.current_price.toFixed(2)} kr` : '—'}
            </Text>
            {deal.chain ? <Text style={styles.modalChain}>@ {deal.chain}</Text> : null}
            {deal.drop_pct != null ? (
              <View style={styles.dropBadge}>
                <Text style={styles.dropText}>−{deal.drop_pct.toFixed(0)}%</Text>
              </View>
            ) : null}
          </View>
          {stores.length > 0 ? (
            <View style={styles.storeBlock}>
              <Text style={styles.storeBlockTitle}>Pris i butikkene</Text>
              {stores.map((s, i) => (
                <View key={s.code ?? s.chain ?? String(i)} style={styles.storeRow}>
                  <Text style={styles.storeName} numberOfLines={1}>
                    {i === 0 ? '🏆 ' : ''}
                    {s.chain ?? 'Ukjent butikk'}
                  </Text>
                  {s.drop_pct != null ? (
                    <Text style={styles.storeDrop}>−{s.drop_pct.toFixed(0)}%</Text>
                  ) : null}
                  <Text style={[styles.storePrice, i === 0 && styles.storePriceBest]}>
                    {s.price.toFixed(2)} kr
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {deal.price_source === 'tjek' ? (
            <Text style={styles.validUntilModal}>
              Ukestilbud fra kundeavisen
              {formatValidUntil(deal.valid_until) ? ` · gjelder til ${formatValidUntil(deal.valid_until)}` : ''}
            </Text>
          ) : history.length >= 2 ? (
            <PriceChart points={history} currentPrice={deal.current_price} />
          ) : (
            <Text style={styles.noChartText}>Ikke nok prishistorikk ennå</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max - min < 1e-9) {
    const v = Math.round(min * 10) / 10;
    return [v];
  }
  const range = max - min;
  const rough = range / (count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * pow;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function PriceChart({ points, currentPrice }: { points: PricePoint[]; currentPrice: number | null }) {
  const W = 300;
  const H = 150;
  const PAD = { top: 12, bottom: 28, left: 42, right: 10 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const prices = points.map((p) => p.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const padding = (rawMax - rawMin) * 0.12 || rawMax * 0.05 || 1;
  const minP = Math.max(0, rawMin - padding);
  const maxP = rawMax + padding;
  const range = maxP - minP || 1;

  const toX = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * chartW;
  const toY = (price: number) => PAD.top + chartH - ((price - minP) / range) * chartH;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.price).toFixed(1)}`)
    .join(' ');

  const fmtDate = (d: string) => { const [, m, day] = d.split('-'); return `${day}.${m}`; };
  const dateAt = (i: number) => (points[i]?.date ? fmtDate(points[i].date) : '');
  const yTicks = niceTicks(minP, maxP, 4);
  const xTickIdxs =
    points.length <= 2
      ? [0, points.length - 1]
      : points.length <= 5
        ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
        : [0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1];

  return (
    <View style={styles.chartWrap}>
      <Text style={styles.chartLabel}>Prishistorikk (siste {points.length} dager)</Text>
      <Svg width={W} height={H}>
        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <Line
              key={`grid-${tick}`}
              x1={PAD.left}
              y1={y}
              x2={PAD.left + chartW}
              y2={y}
              stroke="#f0f0f3"
              strokeWidth={1}
            />
          );
        })}
        <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#d0d0d4" strokeWidth={1} />
        <Line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#d0d0d4" strokeWidth={1} />
        {yTicks.map((tick) => (
          <SvgText
            key={`yl-${tick}`}
            x={PAD.left - 6}
            y={toY(tick) + 3}
            fontSize="9"
            fill="#888"
            textAnchor="end"
          >
            {tick.toFixed(tick < 10 ? 1 : 0)}
          </SvgText>
        ))}
        {xTickIdxs.map((i) => (
          <SvgText
            key={`xl-${i}`}
            x={toX(i)}
            y={PAD.top + chartH + 14}
            fontSize="9"
            fill="#888"
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          >
            {dateAt(i)}
          </SvgText>
        ))}
        <Path d={pathD} stroke="#E10A0A" strokeWidth={2} fill="none" />
        {points.map((p, i) => (
          <SvgCircle key={i} cx={toX(i)} cy={toY(p.price)} r={2.5} fill="#E10A0A" />
        ))}
        {currentPrice != null && (
          <>
            <Line
              x1={PAD.left}
              y1={toY(currentPrice)}
              x2={PAD.left + chartW}
              y2={toY(currentPrice)}
              stroke="#2E8B57"
              strokeWidth={1}
              strokeDasharray="4,3"
            />
            <SvgText
              x={PAD.left + chartW}
              y={toY(currentPrice) - 4}
              fontSize="9"
              fill="#2E8B57"
              fontWeight="700"
              textAnchor="end"
            >
              nå {currentPrice.toFixed(currentPrice < 10 ? 1 : 0)}
            </SvgText>
          </>
        )}
      </Svg>
      <View style={styles.chartLegend}>
        <View style={styles.chartLegendDot} />
        <Text style={styles.chartLegendText}>Historisk pris (kr)</Text>
        <View style={[styles.chartLegendDot, { backgroundColor: '#2E8B57' }]} />
        <Text style={styles.chartLegendText}>Nå</Text>
      </View>
    </View>
  );
}

function CampaignBadge({ text }: { text: string }) {
  const kind = getCampaignKind(text);
  const badgeStyle = [
    styles.campaign,
    kind === 'bundle' && styles.campaignBundle,
    kind === 'member' && styles.campaignMember,
    kind === 'bonus' && styles.campaignBonus,
    kind === 'clearance' && styles.campaignClearance,
  ];
  const iconName =
    kind === 'bundle'
      ? 'pricetags'
      : kind === 'member'
        ? 'people'
        : kind === 'bonus'
          ? 'star'
          : kind === 'clearance'
            ? 'flash'
            : 'ticket';

  return (
    <View style={badgeStyle}>
      <Ionicons name={iconName} size={12} color="#fff" />
      <Text style={styles.campaignText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 12, gap: 8 },
  stickyHeader: { backgroundColor: '#f5f5f7', paddingBottom: 8, marginHorizontal: -12, paddingHorizontal: 12 },
  headerBlock: { marginBottom: 8, paddingHorizontal: 4, gap: 2 },
  headerSub: { color: '#666' },
  headerMeta: { fontSize: 12, color: '#888' },
  cacheNotice: { fontSize: 12, color: '#A85C00' },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f3',
  },
  filterChipSecondary: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  filterChipActive: { backgroundColor: '#E10A0A' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  filterChipTextSecondary: { color: '#888', fontWeight: '500' },
  filterChipTextActive: { color: '#fff' },
  coopDropdown: { marginTop: 8, alignSelf: 'flex-start', minWidth: 190 },
  coopDropdownButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  coopDropdownButtonOpen: { borderColor: '#E10A0A' },
  coopDropdownButtonText: { fontSize: 13, fontWeight: '700', color: '#333' },
  coopDropdownMenu: {
    marginTop: 4,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  coopDropdownItem: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  coopDropdownItemActive: { backgroundColor: '#FFF1F1' },
  coopDropdownItemText: { fontSize: 13, color: '#333', fontWeight: '600' },
  coopDropdownItemCount: { fontSize: 12, color: '#777', fontWeight: '700' },
  coopDropdownItemTextActive: { color: '#C60000' },
  errorBox: { backgroundColor: '#FFE5E5', padding: 12, borderRadius: 8, marginBottom: 8 },
  errorText: { color: '#C00' },
  empty: { color: '#999', textAlign: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 10,
  },
  rowInCart: { backgroundColor: '#F2FBF5', opacity: 0.92 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#f5f5f7' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 3 },
  price: { fontSize: 16, fontWeight: '700', color: '#E10A0A' },
  median: { fontSize: 12, color: '#999', textDecorationLine: 'line-through' },
  campaign: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2B6A57',
    alignSelf: 'flex-start',
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  campaignBundle: { backgroundColor: '#0B6B3A' },
  campaignMember: { backgroundColor: '#005B99' },
  campaignBonus: { backgroundColor: '#7A4E00' },
  campaignClearance: { backgroundColor: '#A63D40' },
  campaignText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  approximate: { fontSize: 12, color: '#8b6b34', marginTop: 3 },
  unitPrice: { fontSize: 12, color: '#666', marginTop: 1 },
  validUntil: { fontSize: 12, color: '#005B99', marginTop: 2, fontWeight: '600' },
  validUntilModal: { fontSize: 13, color: '#005B99', fontWeight: '600', marginTop: 16 },
  right: { alignItems: 'center', gap: 6, minWidth: 84 },
  dropBadge: {
    backgroundColor: '#FFF1D6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dropBadgeMedian: { backgroundColor: '#F0F0F3' },
  dropText: { color: '#A85C00', fontWeight: '700', fontSize: 12 },
  dropTextMedian: { color: '#666' },
  sourceLabel: { fontSize: 10, fontWeight: '600' },
  sourceLabelMeny: { color: '#2B6A57' },
  sourceLabelMedian: { color: '#999' },
  chainLabel: { fontSize: 11, fontWeight: '700', color: '#2B6A57', maxWidth: 80 },
  addBtn: {
    backgroundColor: '#E10A0A',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f5f7',
    borderRadius: 18,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  quantityButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityValue: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#2E8B57',
  },
  infoBtn: { marginTop: 4, padding: 2 },
  rightExtras: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalContent: { padding: 20, gap: 6 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  modalBrand: { fontSize: 13, color: '#888' },
  modalPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  modalPrice: { fontSize: 22, fontWeight: '700', color: '#E10A0A' },
  modalChain: { fontSize: 14, fontWeight: '600', color: '#2B6A57' },
  storeBlock: { marginTop: 16, gap: 2 },
  storeBlockTitle: { fontSize: 13, fontWeight: '700', color: '#444', marginBottom: 4 },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  storeName: { flex: 1, fontSize: 14, color: '#222' },
  storeDrop: { fontSize: 12, fontWeight: '700', color: '#A85C00' },
  storePrice: { fontSize: 14, fontWeight: '600', color: '#333', minWidth: 64, textAlign: 'right' },
  storePriceBest: { color: '#0B6B3A', fontWeight: '800' },
  noChartText: { color: '#aaa', fontSize: 13, padding: 24, textAlign: 'center' },
  chartWrap: { marginTop: 12 },
  chartLabel: { fontSize: 12, color: '#888', marginBottom: 6 },
  chartLegend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  chartLegendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E10A0A' },
  chartLegendText: { fontSize: 11, color: '#888' },
});
