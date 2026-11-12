import { useLocalSearchParams, useRouter } from 'expo-router';
import { selectSuperDeals } from '@/lib/super-deals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ALL_CHAINS,
  allFollowedOption,
  chainOptionsFor,
  findChainOption,
  followedOptionsFor,
  isFeaturedChainOption,
  productMatchesChain,
  type ChainOption,
} from '@/lib/chains';
import { addToCart, removeFromCart, updateQuantity, useCart } from '@/lib/cart';
import { PriceHistoryModal, formatUpcomingWindow, formatValidUntil } from '@/components/price-history-modal';
import { getCampaignKind, isLikelyCampaignText } from '@/lib/campaigns';
import {
  loadCachedDeals,
  matchesDealSearch,
  saveCachedDeals,
  selectTopDeals,
} from '@/lib/deals';
import { toggleFavorite, useFavorites } from '@/lib/favorites';
import { toggleFollowedChain, useFollowedChains } from '@/lib/followed-chains';
import { getCachedCatalog, hasDataConfig, refreshCatalog } from '@/lib/catalog';
import { pricePresentation } from '@/lib/pricing';
import type { MenyProduct } from '@/lib/types';

const CHAIN_FILTER_KEY = 'deals.chainFilter.v1';
const DEALS_SCREEN_LIMIT = 5000;
const TABLET_BREAKPOINT = 760;
const NATIVE_GRID_MAX_WIDTH = 960;
const GRID_PADDING = 12;
const GRID_GAP = 8;
const WEB_MIN_CARD_WIDTH = 240;
const WEB_SCROLLBAR_SPACE = 16;

function useDealsGrid() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const gridWidth = isWeb ? width - WEB_SCROLLBAR_SPACE : Math.min(width, NATIVE_GRID_MAX_WIDTH);
  const contentWidth = gridWidth - 2 * GRID_PADDING;
  const baseColumns = width >= TABLET_BREAKPOINT ? 3 : 2;
  const webColumns = Math.floor((contentWidth + GRID_GAP) / (WEB_MIN_CARD_WIDTH + GRID_GAP));
  const numColumns = isWeb ? Math.max(baseColumns, webColumns) : baseColumns;
  const gridCardWidth = (contentWidth - GRID_GAP * (numColumns - 1)) / numColumns;
  return { numColumns, gridCardWidth };
}

// Datakilden regenereres nattlig av kassal-sync. Er den eldre enn dette, har
// syncen stoppet, og prisene kan ha endret seg for lengst – da sier vi det
// tydelig i stedet for å la «Oppdatert for N d siden» stå som liten gråtekst.
const STALE_AFTER_DAYS = 3;

function isCatalogStale(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
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

function shouldShowBrand(name: string, brand: string | null | undefined) {
  if (!brand) return false;

  const normalizedName = name.toLowerCase();
  const normalizedBrand = brand.toLowerCase().trim();
  if (!normalizedBrand) return false;

  return !normalizedName.includes(normalizedBrand);
}

export default function DealsScreen() {
  const { superDeals } = useLocalSearchParams<{ superDeals?: string }>();
  const router = useRouter();
  const showSuperDeals = superDeals === '1';
  const [superDealRows, setSuperDealRows] = useState<MenyProduct[]>([]);
  const { numColumns, gridCardWidth } = useDealsGrid();
  const [deals, setDeals] = useState<MenyProduct[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<MenyProduct | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chainFilter, setChainFilter] = useState<string>(ALL_CHAINS);
  const [chainSheetOpen, setChainSheetOpen] = useState(false);
  const followed = useFollowedChains();
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
    AsyncStorage.setItem(CHAIN_FILTER_KEY, chain).catch(() => {});
  }, []);

  const chainOptions = useMemo(() => chainOptionsFor(deals), [deals]);
  const followedOptions = useMemo(
    () => followedOptionsFor(chainOptions, followed),
    [chainOptions, followed],
  );
  const allFollowed = useMemo(() => allFollowedOption(followedOptions), [followedOptions]);
  // Et lagret filter på en kjede brukeren ikke lenger følger faller tilbake til «Alle mine».
  const selectedChain = useMemo(
    () => findChainOption(followedOptions, chainFilter) ?? allFollowed,
    [followedOptions, allFollowed, chainFilter],
  );

  const filteredDeals = useMemo(
    () =>
      (deals ?? []).filter(
        (deal) =>
          productMatchesChain(deal, selectedChain) && matchesDealSearch(deal, searchQuery),
      ),
    [deals, selectedChain, searchQuery],
  );
  const emptyMessage =
    followedOptions.length === 0
      ? 'Du følger ingen kjeder. Trykk «Kjeder» for å velge hvilke du vil se tilbud fra.'
      : selectedChain.id !== ALL_CHAINS
        ? `Ingen aktive kampanjer for ${selectedChain.label} akkurat nå.`
        : 'Ingen aktive kampanjer akkurat nå. Prøv igjen senere.';
  const listEmptyMessage = searchQuery.trim()
    ? `Ingen tilbud matcher «${searchQuery.trim()}».`
    : emptyMessage;

  const cartByEan = useMemo(() => {
    const map = new Map<string, { id: string; quantity: number }>();
    for (const item of cartItems) {
      if (!item.ean || item.checked) continue;
      map.set(item.ean, { id: item.id, quantity: item.quantity });
    }
    return map;
  }, [cartItems]);

  // Katalogen lista sist ble regnet ut fra. En uendret katalog (304) kommer
  // tilbake som samme liste, og da slipper vi å regne ut og lagre på nytt.
  const shownCatalog = useRef<MenyProduct[] | null>(null);

  const showCatalog = useCallback((catalog: MenyProduct[]) => {
    if (catalog === shownCatalog.current) return null;
    shownCatalog.current = catalog;
    setSuperDealRows(selectSuperDeals(catalog).map(({ product }) => product));
    const rows = selectTopDeals(catalog, 5, DEALS_SCREEN_LIMIT);
    setDeals(rows);
    setFromCache(false);
    setError(null);
    return rows;
  }, []);

  const load = useCallback(async () => {
    if (!hasDataConfig()) {
      setError('Tilbud er ikke tilgjengelig akkurat nå. Prøv igjen senere.');
      return;
    }
    // Vis siste katalog fra cachen med en gang, så oppstarten ikke venter på
    // nettet. Spørsmålet til serveren etterpå koster nesten ingenting når
    // katalogen er uendret.
    const cached = await getCachedCatalog();
    if (cached) showCatalog(cached);
    try {
      const rows = showCatalog(await refreshCatalog());
      if (rows) saveCachedDeals(rows);
    } catch {
      // Vi viser allerede katalogen fra cachen; den er bedre enn tilbudscachen.
      if (shownCatalog.current) return;
      const cachedDeals = await loadCachedDeals();
      if (cachedDeals && cachedDeals.length > 0) {
        setDeals(cachedDeals);
        setFromCache(true);
        setError(null);
      } else {
        setError('Ingen nettilgang og ingen lagrede tilbud.');
      }
    }
  }, [showCatalog]);

  useEffect(() => {
    load();
  }, [load]);

  const latestComputedAt = deals?.[0]?.computed_at ?? null;
  const catalogStale = latestComputedAt ? isCatalogStale(latestComputedAt) : false;

  async function onRefresh() {
    setRefreshing(true);
    await load();
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
          isGrid
          gridCardWidth={gridCardWidth}
        />
      );
    },
    [cartByEan, gridCardWidth, handleSelect],
  );

  if (deals === null && !error) {
    return <DealsSkeleton />;
  }

  return (
    <>
      <FlatList
        key={`deals-${numColumns}`}
        data={showSuperDeals ? selectSuperDeals(superDealRows).map(({ product }) => product) : filteredDeals}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        keyExtractor={(d) => JSON.stringify([d.ean, d.chain, d.valid_from, d.valid_until])}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        ListHeaderComponent={
          <View style={styles.stickyHeader}>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : showSuperDeals ? (
              <Pressable style={styles.searchBar} onPress={() => router.setParams({ superDeals: '0' })}>
                <Ionicons name="chevron-back" size={18} color="#888" />
                <Text>Kjempetilbud · Vis alle tilbud</Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={18} color="#888" />
                  <TextInput
                    accessibilityLabel="Søk i tilbudene"
                    autoCorrect={false}
                    onChangeText={setSearchQuery}
                    placeholder="Søk i tilbudene"
                    returnKeyType="search"
                    style={styles.searchInput}
                    value={searchQuery}
                  />
                  {searchQuery.length > 0 ? (
                    <Pressable
                      accessibilityLabel="Tøm søket"
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={() => setSearchQuery('')}
                    >
                      <Ionicons name="close-circle" size={18} color="#bbb" />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.headerBlock}>
                  <View style={styles.headerTitleRow}>
                    <Text style={styles.headerSub} numberOfLines={1}>
                      {selectedChain.id !== ALL_CHAINS
                        ? `Tilbud fra ${selectedChain.label}`
                        : followedOptions.length === 1
                          ? `Tilbud fra ${followedOptions[0].label}`
                          : 'Tilbud fra mine kjeder'}
                    </Text>
                    <Pressable
                      onPress={() => setChainSheetOpen(true)}
                      style={styles.chainsButton}
                      accessibilityRole="button"
                      accessibilityLabel="Velg kjeder"
                      hitSlop={8}
                    >
                      <Ionicons name="options-outline" size={16} color="#E10A0A" />
                      <Text style={styles.chainsButtonText}>Kjeder</Text>
                    </Pressable>
                  </View>
                  {fromCache ? (
                    <Text style={styles.cacheNotice}>
                      Viser sist hentede tilbud · ingen nettilgang
                    </Text>
                  ) : latestComputedAt ? (
                    <Text style={catalogStale ? styles.staleNotice : styles.headerMeta}>
                      {catalogStale
                        ? `Prisene kan være utdaterte · ${formatComputedAt(latestComputedAt)}`
                        : formatComputedAt(latestComputedAt)}
                    </Text>
                  ) : null}
                </View>
                {/* Med bare én fulgt kjede er det ingenting å velge mellom. */}
                {followedOptions.length > 1 ? (
                  <View style={styles.filterRow}>
                    {[allFollowed, ...followedOptions].map((option) => {
                      const active = option.id === selectedChain.id;
                      return (
                        <Pressable
                          key={option.id}
                          // Trykk på aktiv kjede igjen går tilbake til «Alle mine».
                          onPress={() => selectChain(active ? ALL_CHAINS : option.id)}
                          style={[styles.filterChip, active && styles.filterChipActive]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
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
        ListEmptyComponent={!error ? <Text style={styles.empty}>{showSuperDeals ? 'Ingen aktive kjempetilbud akkurat nå.' : listEmptyMessage}</Text> : null}
        renderItem={renderItem}
      />
      {selectedDeal && (
        <PriceHistoryModal deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
      )}
      {chainSheetOpen && (
        <ChainSheet
          options={chainOptions}
          followed={followed}
          onClose={() => setChainSheetOpen(false)}
        />
      )}
    </>
  );
}

function ChainSheet({
  options,
  followed,
  onClose,
}: {
  options: ChainOption[];
  followed: string[];
  onClose: () => void;
}) {
  const followedIds = useMemo(
    () => new Set(followedOptionsFor(options, followed).map((option) => option.id)),
    [options, followed],
  );
  const firstOtherIndex = options.findIndex((option) => !isFeaturedChainOption(option));

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.chainSheetHeader}>
          <Text style={styles.modalTitle}>Hvilke kjeder vil du følge?</Text>
          <Text style={styles.chainSheetCount}>{followedIds.size} valgt</Text>
        </View>
        <ScrollView contentContainerStyle={styles.chainSheetList}>
          {options.map((option, index) => {
            const on = followedIds.has(option.id);
            return (
              <View key={option.id}>
                {index === firstOtherIndex ? (
                  <Text style={styles.chainSheetSection}>Andre kjeder med tilbud nå</Text>
                ) : null}
                <Pressable
                  onPress={() => toggleFollowedChain(option.id).catch(() => {})}
                  style={styles.chainSheetRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={on ? '#E10A0A' : '#aaa'}
                  />
                  <Text style={styles.chainSheetLabel}>{option.label}</Text>
                  <Text style={styles.chainSheetMeta}>
                    {option.count === 0 ? 'Ingen tilbud nå' : `${option.count} tilbud`}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <Pressable onPress={onClose} style={styles.chainSheetDone} accessibilityRole="button">
          <Text style={styles.chainSheetDoneText}>Ferdig</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function DealsSkeleton() {
  const { numColumns, gridCardWidth } = useDealsGrid();

  return (
    <View style={styles.skeletonScreen}>
      <View style={styles.list}>
        {Array.from({ length: 3 }).map((_, row) => (
          <View key={row} style={styles.gridRow}>
            {Array.from({ length: numColumns }).map((__, column) => (
              <View
                key={column}
                style={[styles.gridCard, styles.skeletonCard, { width: gridCardWidth }]}
              >
                <View style={[styles.gridThumb, styles.skeletonBlock]} />
                <View style={styles.body}>
                  <View style={[styles.skeletonBlock, styles.skelPill]} />
                  <View style={[styles.skeletonBlock, styles.skelLineWide]} />
                  <View style={[styles.skeletonBlock, styles.skelLineNarrow]} />
                </View>
              </View>
            ))}
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
  isGrid = false,
  gridCardWidth,
}: {
  item: MenyProduct;
  cartItemId: string | null;
  cartQuantity: number;
  onSelect: (item: MenyProduct) => void;
  isGrid?: boolean;
  gridCardWidth?: number;
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
        price_measure: item.price_measure,
        unit_price: item.unit_price,
        drop_pct: item.drop_pct,
        campaign_text: item.campaign_text,
        multibuy: item.multibuy,
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
  const presentation = pricePresentation({ ...item, price: item.current_price });
  const approximate = presentation.approximate;
  const currentPriceLabel = presentation.primary;
  const beforePriceLabel = pricePresentation({
    ...item,
    price: item.median_30d,
    unit_price: null,
  }).primary;
  const beforePricePrefix = isWeekly ? 'før' : 'vanligvis';
  const upcomingLabel = isWeekly ? formatUpcomingWindow(item) : null;
  const validUntilLabel = isWeekly && !upcomingLabel ? formatValidUntil(item.valid_until) : null;
  const unitPriceLabel = presentation.secondary;
  const showBrand = shouldShowBrand(item.name, item.brand);

  const thumbnailImage = item.image_url ? (
    <Image
      source={item.image_url}
      style={[styles.thumb, isGrid && styles.gridThumb]}
      contentFit="contain"
    />
  ) : (
    <View
      style={[styles.thumb, isGrid && styles.gridThumb, styles.thumbPlaceholder]}
    >
      <Ionicons name="image-outline" size={24} color="#ccc" />
    </View>
  );
  const openHistory = () => onSelect(item);
  const thumbnail = (
    <Pressable
      onPress={openHistory}
      accessibilityRole="button"
      accessibilityLabel={`Vis prishistorikk for ${item.name}`}
    >
      {thumbnailImage}
    </Pressable>
  );
  const offerBadge = (
    <View style={styles.dropBadge}>
      {drop > 0 ? (
        <Text style={styles.dropText}>−{drop.toFixed(0)}%</Text>
      ) : (
        <Text style={styles.dropText}>Tilbud</Text>
      )}
    </View>
  );
  const cartControl = inCart ? (
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
    <Pressable
      onPress={onIncrement}
      style={styles.addBtn}
      accessibilityRole="button"
      accessibilityLabel="Legg til i handleliste"
    >
      <Ionicons name="add" size={20} color="#fff" />
    </Pressable>
  );
  const rightExtras = (
    <View style={styles.rightExtras}>
      <Pressable
        onPress={() =>
          toggleFavorite({
            ean: item.ean,
            name: item.name,
            image_url: item.image_url,
            price: item.current_price,
            price_measure: item.price_measure,
            unit_price: item.unit_price,
          })
        }
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={starred ? 'Fjern fra favoritter' : 'Legg til i favoritter'}
      >
        <Ionicons
          name={starred ? 'star' : 'star-outline'}
          size={16}
          color={starred ? '#F5A623' : '#bbb'}
        />
      </Pressable>
      <Pressable
        onPress={() => onSelect(item)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Vis prishistorikk"
      >
        <Ionicons name="stats-chart-outline" size={14} color="#aaa" />
      </Pressable>
    </View>
  );
  const actions = (
    <View style={styles.right}>
      {offerBadge}
      {cartControl}
      {rightExtras}
    </View>
  );

  return (
    <View
      style={[
        styles.row,
        isGrid && styles.gridCard,
        isGrid && { width: gridCardWidth, flexGrow: 0, flexShrink: 0 },
        inCart && styles.rowInCart,
      ]}
    >
      {isGrid ? (
        <View style={styles.gridMedia}>
          {thumbnail}
          <View style={styles.gridBadge}>{offerBadge}</View>
        </View>
      ) : (
        thumbnail
      )}
      <View style={[styles.body, isGrid && styles.gridBody]}>
        {item.chain ? (
          <View style={styles.chainPill}>
            <Text style={styles.chainPillText} numberOfLines={1}>
              {item.chain}
            </Text>
          </View>
        ) : null}
        <Pressable onPress={openHistory} accessibilityRole="button">
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
        </Pressable>
        {showBrand ? <Text style={styles.brand}>{item.brand}</Text> : null}
        {item.multibuy ? (
          <>
            <View style={styles.priceRow}>
              <Text style={styles.price}>
                {item.multibuy.quantity} for {item.multibuy.price} kr
              </Text>
            </View>
            <Text style={styles.unitPrice}>
              {(item.multibuy.price / item.multibuy.quantity).toFixed(2)} kr/stk · normalt{' '}
              {item.multibuy.single.toFixed(2)} kr
            </Text>
          </>
        ) : (
          <>
            <View style={styles.priceRow}>
              {currentPriceLabel ? <Text style={styles.price}>{currentPriceLabel}</Text> : null}
              {beforePriceLabel ? (
                <Text style={styles.median}>
                  {beforePricePrefix}
                  {beforePriceLabel}
                </Text>
              ) : null}
            </View>
            {isLikelyCampaignText(item.campaign_text) ? (
              <CampaignBadge text={item.campaign_text!} />
            ) : null}
            {unitPriceLabel ? <Text style={styles.unitPrice}>{unitPriceLabel}</Text> : null}
          </>
        )}
        {approximate && !presentation.loose ? (
          <Text style={styles.approximate}>Vektvare, pris kan variere litt</Text>
        ) : null}
        {upcomingLabel ? (
          <Text style={[styles.validUntil, styles.validUpcoming]}>{upcomingLabel}</Text>
        ) : validUntilLabel ? (
          <Text style={styles.validUntil}>Gjelder til {validUntilLabel}</Text>
        ) : null}
      </View>
      {isGrid ? (
        <View style={styles.gridFooter}>
          {rightExtras}
          {cartControl}
        </View>
      ) : (
        actions
      )}
    </View>
  );
});

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
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  skeletonScreen: { flex: 1 },
  skeletonBlock: { backgroundColor: '#ececef', borderRadius: 6 },
  skelPill: { width: 60, height: 14, borderRadius: 6, marginBottom: 6 },
  skelLineWide: { width: '80%', height: 14, marginBottom: 6 },
  skelLineNarrow: { width: '45%', height: 12 },
  // Sentrert innhold holder kortene lesbare på nettbrett og nett.
  list: {
    padding: GRID_PADDING,
    gap: GRID_GAP,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? undefined : NATIVE_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  stickyHeader: {
    backgroundColor: '#f5f5f7',
    paddingBottom: 8,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  headerBlock: { marginBottom: 8, paddingHorizontal: 4, gap: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 9, color: '#111' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerSub: { flex: 1, color: '#666' },
  chainsButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  chainsButtonText: { fontSize: 13, fontWeight: '700', color: '#E10A0A' },
  headerMeta: { fontSize: 12, color: '#888' },
  cacheNotice: { fontSize: 12, color: '#A85C00' },
  staleNotice: { fontSize: 12, color: '#A85C00', fontWeight: '600' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f3',
  },
  filterChipActive: { backgroundColor: '#E10A0A' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  filterChipTextActive: { color: '#fff' },
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
  gridCard: {
    minHeight: 270,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  skeletonCard: { justifyContent: 'flex-start' },
  gridMedia: {
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gridBadge: { position: 'absolute', top: 0, left: 0 },
  gridThumb: { width: 104, height: 104, borderRadius: 8, backgroundColor: '#f5f5f7' },
  gridBody: { flex: 1, width: '100%' },
  gridFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  rowInCart: { backgroundColor: '#F2FBF5', opacity: 0.92 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#f5f5f7' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  priceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 3,
  },
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
    maxWidth: '100%',
  },
  campaignBundle: { backgroundColor: '#0B6B3A' },
  campaignMember: { backgroundColor: '#005B99' },
  campaignBonus: { backgroundColor: '#7A4E00' },
  campaignClearance: { backgroundColor: '#A63D40' },
  campaignText: {
    flexShrink: 1,
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  approximate: { fontSize: 12, color: '#8b6b34', marginTop: 3 },
  unitPrice: { fontSize: 12, color: '#666', marginTop: 1 },
  validUntil: { fontSize: 12, color: '#005B99', marginTop: 2, fontWeight: '600' },
  validUpcoming: { color: '#A85C00' },
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
  chainSheetHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  chainSheetCount: { fontSize: 13, color: '#888' },
  chainSheetList: { paddingHorizontal: 20, paddingBottom: 8 },
  chainSheetSection: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    marginTop: 16,
    marginBottom: 2,
  },
  chainSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  chainSheetLabel: { flex: 1, fontSize: 15, color: '#222' },
  chainSheetMeta: { fontSize: 12, color: '#999' },
  chainSheetDone: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E10A0A',
    alignItems: 'center',
  },
  chainSheetDoneText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
