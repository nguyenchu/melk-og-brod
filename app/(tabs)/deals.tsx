import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
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
const ALL_CHAINS = 'Alle';
const DEALS_SCREEN_LIMIT = 5000;

type ChainOption = {
  id: string;
  label: string;
  chains: string[] | null;
  count: number;
};

function normalizeChainName(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// De 6 utvalgte kjedene som alltid vises som chips. Resten ligger bak «Flere».
const FEATURED_CHAIN_FILTERS: { id: string; label: string; chains: string[] }[] = [
  { id: 'KIWI', label: 'KIWI', chains: ['KIWI'] },
  { id: 'REMA', label: 'REMA', chains: ['REMA 1000'] },
  { id: 'MENY', label: 'MENY', chains: ['Meny'] },
  { id: 'Extra', label: 'Coop Extra', chains: ['Extra', 'Coop Extra'] },
  { id: 'Joker', label: 'Joker', chains: ['Joker'] },
  { id: 'Bunnpris', label: 'Bunnpris', chains: ['Bunnpris'] },
];

const FEATURED_CHAIN_MEMBERS = new Set(
  FEATURED_CHAIN_FILTERS.flatMap((option) => option.chains).map(normalizeChainName),
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
  return (chains ?? []).reduce(
    (sum, chain) => sum + (counts.get(normalizeChainName(chain)) ?? 0),
    0,
  );
}

// «Alle» + de 6 utvalgte (alfabetisk), med antall. Vises alltid som chips (wrapper).
function featuredOptionsFor(deals: MenyProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  const featured = FEATURED_CHAIN_FILTERS.map((option) => ({
    ...option,
    count: countChains(option.chains, counts),
  })).sort((a, b) => a.label.localeCompare(b.label, 'nb'));
  return [{ id: ALL_CHAINS, label: ALL_CHAINS, chains: null, count: deals?.length ?? 0 }, ...featured];
}

// Alle øvrige kjeder (ikke blant de utvalgte), alfabetisk. Ligger bak «Flere».
function moreOptionsFor(deals: MenyProduct[] | null): ChainOption[] {
  const counts = chainCountsFor(deals);
  const present = new Map<string, string>();
  for (const deal of deals ?? []) {
    if (!deal.chain) continue;
    const key = normalizeChainName(deal.chain);
    if (!present.has(key)) present.set(key, deal.chain);
  }
  return Array.from(present)
    .filter(([key]) => !FEATURED_CHAIN_MEMBERS.has(key))
    .map(([key, chain]) => ({ id: chain, label: chain, chains: [chain], count: counts.get(key) ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, 'nb'));
}

function findChainOption(options: ChainOption[], chainFilter: string): ChainOption | undefined {
  const key = normalizeChainName(chainFilter);
  return (
    options.find((option) => normalizeChainName(option.id) === key) ??
    options.find((option) => option.chains?.some((chain) => normalizeChainName(chain) === key))
  );
}

function productMatchesChain(product: MenyProduct, option: ChainOption) {
  if (!option.chains) return true;
  if (!product.chain) return false;
  const selectedChains = new Set(option.chains.map(normalizeChainName));
  return selectedChains.has(normalizeChainName(product.chain));
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const { items: cartItems } = useCart();

  useEffect(() => {
    AsyncStorage.getItem(CHAIN_FILTER_KEY)
      .then((v) => {
        if (v) setChainFilter(v);
      })
      .catch(() => {});
  }, []);

  const selectChain = useCallback((chain: string) => {
    setChainFilter(chain);
    setMoreMenuOpen(false);
    AsyncStorage.setItem(CHAIN_FILTER_KEY, chain).catch(() => {});
  }, []);

  const featuredOptions = useMemo(() => featuredOptionsFor(deals), [deals]);
  const moreOptions = useMemo(() => moreOptionsFor(deals), [deals]);
  const selectedChain = useMemo(
    () => findChainOption([...featuredOptions, ...moreOptions], chainFilter) ?? featuredOptions[0],
    [featuredOptions, moreOptions, chainFilter],
  );
  // En kjede valgt fra «Flere»-panelet (ikke blant de utvalgte) vises på selve knappen.
  const selectedIsFeatured = featuredOptions.some((option) => option.id === selectedChain.id);
  const moreActive = !selectedIsFeatured;
  const moreLabel = moreActive ? selectedChain.label : 'Flere';

  const filteredDeals = useMemo(
    () => (deals ?? []).filter((deal) => productMatchesChain(deal, selectedChain)),
    [deals, selectedChain],
  );
  const emptyMessage = selectedChain.chains
    ? `Ingen aktive kampanjer for ${selectedChain.label} akkurat nå.`
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
      const rows = await fetchTopDeals(5, DEALS_SCREEN_LIMIT, { forceNetwork });
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
    return <DealsSkeleton />;
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
                    <Text style={styles.cacheNotice}>
                      Viser sist hentede tilbud · ingen nettilgang
                    </Text>
                  ) : latestComputedAt ? (
                    <Text style={styles.headerMeta}>{formatComputedAt(latestComputedAt)}</Text>
                  ) : null}
                </View>
                {featuredOptions.length > 1 ? (
                  <View style={styles.filterRow}>
                    {featuredOptions.map((option) => {
                      const active = option.id === selectedChain.id;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => selectChain(option.id)}
                          style={[styles.filterChip, active && styles.filterChipActive]}
                        >
                          <Text
                            style={[styles.filterChipText, active && styles.filterChipTextActive]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {moreOptions.length > 0 ? (
                      <Pressable
                        onPress={() => setMoreMenuOpen((open) => !open)}
                        style={[styles.filterChip, moreActive && styles.filterChipActive]}
                      >
                        <View style={styles.filterChipContent}>
                          <Text
                            style={[
                              styles.filterChipText,
                              moreActive && styles.filterChipTextActive,
                            ]}
                          >
                            {moreLabel}
                          </Text>
                          <Ionicons
                            name={moreMenuOpen ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color={moreActive ? '#fff' : '#555'}
                          />
                        </View>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {moreMenuOpen && moreOptions.length > 0 ? (
                  <View style={styles.moreMenu}>
                    {moreOptions.map((option) => {
                      const active = option.id === selectedChain.id;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => selectChain(option.id)}
                          style={[styles.moreChip, active && styles.filterChipActive]}
                        >
                          <Text
                            style={[styles.filterChipText, active && styles.filterChipTextActive]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </>
            )}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.empty}>{emptyMessage}</Text> : null}
        renderItem={renderItem}
      />
      {selectedDeal && (
        <PriceHistoryModal deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
      )}
    </>
  );
}

function DealsSkeleton() {
  return (
    <View style={styles.skeletonScreen}>
      <View style={styles.list}>
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={i} style={styles.row}>
            <View style={[styles.thumb, styles.skeletonBlock]} />
            <View style={styles.body}>
              <View style={[styles.skeletonBlock, styles.skelPill]} />
              <View style={[styles.skeletonBlock, styles.skelLineWide]} />
              <View style={[styles.skeletonBlock, styles.skelLineNarrow]} />
            </View>
            <View style={[styles.skeletonBlock, styles.skelBadge]} />
          </View>
        ))}
      </View>
    </View>
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
        chain: item.chain,
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
  const unitPriceLabel = formatUnitPriceLabel({
    name: item.name,
    price: item.current_price,
    ean: item.ean,
  });
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
        {item.chain ? (
          <View style={styles.chainPill}>
            <Text style={styles.chainPillText} numberOfLines={1}>
              {item.chain}
            </Text>
          </View>
        ) : null}
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
        {isLikelyCampaignText(item.campaign_text) ? (
          <CampaignBadge text={item.campaign_text!} />
        ) : null}
        {approximate ? (
          <Text style={styles.approximate}>Vektvare, pris kan variere litt</Text>
        ) : null}
        {unitPriceLabel ? <Text style={styles.unitPrice}>{unitPriceLabel}</Text> : null}
        {validUntilLabel ? (
          <Text style={styles.validUntil}>Gjelder til {validUntilLabel}</Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <View style={styles.dropBadge}>
          {drop > 0 ? (
            <Text style={styles.dropText}>−{drop.toFixed(0)}%</Text>
          ) : (
            <Text style={styles.dropText}>Tilbud</Text>
          )}
        </View>
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
            onPress={() =>
              toggleFavorite({
                ean: item.ean,
                name: item.name,
                image_url: item.image_url,
                price: item.current_price,
              })
            }
            hitSlop={8}
          >
            <Ionicons
              name={starred ? 'star' : 'star-outline'}
              size={16}
              color={starred ? '#F5A623' : '#bbb'}
            />
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
        <ScrollView
          contentContainerStyle={styles.modalContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.modalTitle} numberOfLines={2}>
            {deal.name}
          </Text>
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
              {formatValidUntil(deal.valid_until)
                ? ` · gjelder til ${formatValidUntil(deal.valid_until)}`
                : ''}
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

function PriceChart({
  points,
  currentPrice,
}: {
  points: PricePoint[];
  currentPrice: number | null;
}) {
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

  const fmtDate = (d: string) => {
    const [, m, day] = d.split('-');
    return `${day}.${m}`;
  };
  const dateAt = (i: number) => (points[i]?.date ? fmtDate(points[i].date) : '');
  const yTicks = niceTicks(minP, maxP, 4);
  const xTickIdxs =
    points.length <= 2
      ? [0, points.length - 1]
      : points.length <= 5
        ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
        : [
            0,
            Math.floor((points.length - 1) / 3),
            Math.floor(((points.length - 1) * 2) / 3),
            points.length - 1,
          ];

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
        <Line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + chartH}
          stroke="#d0d0d4"
          strokeWidth={1}
        />
        <Line
          x1={PAD.left}
          y1={PAD.top + chartH}
          x2={PAD.left + chartW}
          y2={PAD.top + chartH}
          stroke="#d0d0d4"
          strokeWidth={1}
        />
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
  skeletonScreen: { flex: 1 },
  skeletonBlock: { backgroundColor: '#ececef', borderRadius: 6 },
  skelPill: { width: 60, height: 14, borderRadius: 6, marginBottom: 6 },
  skelLineWide: { width: '80%', height: 14, marginBottom: 6 },
  skelLineNarrow: { width: '45%', height: 12 },
  skelBadge: { width: 44, height: 22, borderRadius: 6 },
  // maxWidth + sentrering gir en pen, sentrert kolonne på brede skjermer (web/nettbrett)
  // i stedet for utstrakte full-bredde rader. På mobil (< 640) er det et no-op.
  list: { padding: 12, gap: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  stickyHeader: {
    backgroundColor: '#f5f5f7',
    paddingBottom: 8,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  headerBlock: { marginBottom: 8, paddingHorizontal: 4, gap: 2 },
  headerSub: { color: '#666' },
  headerMeta: { fontSize: 12, color: '#888' },
  cacheNotice: { fontSize: 12, color: '#A85C00' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f3',
  },
  filterChipContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterChipActive: { backgroundColor: '#E10A0A' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  filterChipTextActive: { color: '#fff' },
  moreMenu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  moreChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f3',
  },
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
  chainPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF3EF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 3,
  },
  chainPillText: { fontSize: 11, fontWeight: '800', color: '#2B6A57', letterSpacing: 0.2 },
  dropBadge: {
    backgroundColor: '#FFF1D6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dropText: { color: '#A85C00', fontWeight: '700', fontSize: 12 },
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
