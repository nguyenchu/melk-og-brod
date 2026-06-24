import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addToCart,
  clearChecked,
  toggleChecked,
  updateQuantity,
  useCart,
} from '@/lib/cart';
import {
  computeCartTotals,
  getCampaignKind,
  isLikelyCampaignText,
  multibuyLineTotal,
} from '@/lib/campaigns';
import { fetchDiscontinuedEans, searchProducts } from '@/lib/deals';
import { toggleFavorite, useFavorites } from '@/lib/favorites';
import { hasDataConfig } from '@/lib/catalog';
import { formatUnitPriceLabel } from '@/lib/pricing';
import type { CartItem, MenyProduct } from '@/lib/types';

type SearchMode = 'all' | 'deals';

// Rader i den grupperte handlelista: enten en kjede-overskrift eller en vare.
type CartListRow =
  | { kind: 'group'; chain: string; subtotal: number; savings: number }
  | { kind: 'item'; item: CartItem };

function getLineTotal(item: Pick<CartItem, 'price' | 'quantity' | 'multibuy'>) {
  if (item.price == null) return 0;
  if (item.multibuy && item.multibuy.quantity > 1) {
    return multibuyLineTotal(item.quantity, item.multibuy);
  }
  return item.price * item.quantity;
}

export default function CartScreen() {
  const { items, loading, sync } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await sync();
    } finally {
      setRefreshing(false);
    }
  }, [sync]);
  const favorites = useFavorites();
  const [query, setQuery] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [results, setResults] = useState<MenyProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string, mode: SearchMode) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (!hasDataConfig()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const rows = await searchProducts(q, { dealsOnly: mode === 'deals' });
      setResults(rows);
    } catch (e: any) {
      Alert.alert('Søkefeil', e.message);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, searchMode), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, searchMode]);

  // onAddProduct is passed to every SearchResultRow; useCallback keeps the
  // reference stable so memoized rows don't re-render on every parent update.
  const onAddProduct = useCallback(async (p: MenyProduct) => {
    await addToCart({
      name: p.name,
      ean: p.ean,
      chain: p.chain,
      image_url: p.image_url,
      price: p.current_price,
      drop_pct: p.drop_pct,
      campaign_text: p.campaign_text,
      multibuy: p.multibuy,
    });
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  }, []);

  async function onShare() {
    if (active.length === 0) return;
    const blocks = groups.map((g) => {
      const header = `${g.chain || 'Andre varer'} (${g.subtotal.toFixed(2)} kr):`;
      const lines = g.items.map((i) => {
        const qty = i.quantity > 1 ? ` (${i.quantity}x)` : '';
        const price = i.price != null ? ` – ${i.price.toFixed(2)} kr` : '';
        return `• ${i.name}${qty}${price}`;
      });
      return `${header}\n${lines.join('\n')}`;
    });
    const savingsLine =
      totalSavings > 0.005 ? `\n\nDu sparer ${totalSavings.toFixed(2)} kr på kampanjer` : '';
    await Share.share({
      message: `Handleliste\n\n${blocks.join('\n\n')}${savingsLine}`,
    });
  }

  async function onAddManual() {
    const name = query.trim();
    if (!name) return;
    const normalizedPrice = manualPrice.trim().replace(',', '.');
    const parsedPrice = normalizedPrice ? Number(normalizedPrice) : null;
    await addToCart({
      name,
      price:
        parsedPrice != null && Number.isFinite(parsedPrice) && parsedPrice >= 0
          ? parsedPrice
          : null,
    });
    setQuery('');
    setManualPrice('');
    setResults([]);
    Keyboard.dismiss();
  }

  const { active, done } = useMemo(() => {
    return {
      active: items.filter((i) => !i.checked),
      done: items.filter((i) => i.checked),
    };
  }, [items]);

  const [discontinuedEans, setDiscontinuedEans] = useState<Set<string>>(new Set());
  const cartEansKey = useMemo(
    () =>
      items
        .map((i) => i.ean)
        .filter((e): e is string => !!e)
        .sort()
        .join(','),
    [items],
  );
  useEffect(() => {
    if (!hasDataConfig() || cartEansKey.length === 0) {
      setDiscontinuedEans(new Set());
      return;
    }
    let cancelled = false;
    fetchDiscontinuedEans(cartEansKey.split(','))
      .then((set: Set<string>) => {
        if (!cancelled) setDiscontinuedEans(set);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cartEansKey]);
  const activeCartByEan = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of active) {
      if (item.ean) map.set(item.ean, (map.get(item.ean) ?? 0) + item.quantity);
    }
    return map;
  }, [active]);

  // Grupper aktive varer per kjede – en handleliste på tvers av kjeder gir bare
  // mening som «hva kjøper jeg hvor». Delsum per butikk er det du faktisk betaler;
  // en sum på tvers av butikker betaler du aldri. Derfor: delsum per gruppe +
  // samlet besparelse (som ER meningsfull på tvers).
  const groups = useMemo(() => {
    const byChain = new Map<string, CartItem[]>();
    for (const item of active) {
      const key = item.chain ?? '';
      const arr = byChain.get(key) ?? [];
      arr.push(item);
      byChain.set(key, arr);
    }
    return [...byChain.entries()]
      .map(([chain, groupItems]) => {
        const totals = computeCartTotals(groupItems);
        return { chain, items: groupItems, subtotal: totals.total, savings: totals.savings };
      })
      .sort((a, b) => {
        if (!a.chain) return 1; // varer uten kjede (manuelle/favoritter) nederst
        if (!b.chain) return -1;
        return a.chain.localeCompare(b.chain, 'nb');
      });
  }, [active]);

  const cartRows = useMemo<CartListRow[]>(() => {
    const out: CartListRow[] = [];
    for (const g of groups) {
      out.push({ kind: 'group', chain: g.chain, subtotal: g.subtotal, savings: g.savings });
      for (const item of g.items) out.push({ kind: 'item', item });
    }
    return out;
  }, [groups]);

  const totalSavings = useMemo(() => groups.reduce((s, g) => s + g.savings, 0), [groups]);
  const activeItemCount = useMemo(
    () => active.reduce((sum, item) => sum + item.quantity, 0),
    [active],
  );
  const showStickyTotal = active.length > 0;

  // «I kurven» grupperes også per kjede. computeCartTotals hopper over avhukede
  // varer, så delsummen her summeres direkte (price * antall).
  const doneGroups = useMemo(() => {
    const byChain = new Map<string, CartItem[]>();
    for (const item of done) {
      const key = item.chain ?? '';
      const arr = byChain.get(key) ?? [];
      arr.push(item);
      byChain.set(key, arr);
    }
    return [...byChain.entries()]
      .map(([chain, groupItems]) => ({
        chain,
        items: groupItems,
        subtotal: groupItems.reduce((s, i) => s + getLineTotal(i), 0),
      }))
      .sort((a, b) => {
        if (!a.chain) return 1;
        if (!b.chain) return -1;
        return a.chain.localeCompare(b.chain, 'nb');
      });
  }, [done]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const showSearchPanel = query.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#888" />
        <TextInput
          style={styles.searchInput}
          placeholder="Søk etter vare eller skriv egen..."
          value={query}
          onChangeText={setQuery}
          returnKeyType="done"
          onSubmitEditing={onAddManual}
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color="#bbb" />
          </Pressable>
        ) : active.length > 0 ? (
          <Pressable onPress={onShare} hitSlop={10}>
            <Ionicons name="share-outline" size={20} color="#888" />
          </Pressable>
        ) : null}
      </View>
      {showSearchPanel ? (
        <View style={styles.searchModeRow}>
          <Pressable
            onPress={() => setSearchMode('all')}
            style={[styles.searchModeChip, searchMode === 'all' && styles.searchModeChipActive]}
          >
            <Text
              style={[styles.searchModeText, searchMode === 'all' && styles.searchModeTextActive]}
            >
              Alle varer
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSearchMode('deals')}
            style={[styles.searchModeChip, searchMode === 'deals' && styles.searchModeChipActive]}
          >
            <Text
              style={[styles.searchModeText, searchMode === 'deals' && styles.searchModeTextActive]}
            >
              Bare tilbud
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showSearchPanel ? (
        <SearchResults
          query={query}
          manualPrice={manualPrice}
          onChangeManualPrice={setManualPrice}
          results={results}
          searchMode={searchMode}
          activeCartByEan={activeCartByEan}
          searching={searching}
          onPick={onAddProduct}
          onAddManual={onAddManual}
          bottomInset={showStickyTotal ? 92 : 24}
        />
      ) : (
        <FlatList
          data={cartRows}
          keyExtractor={(r) => (r.kind === 'group' ? `g:${r.chain}` : r.item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: showStickyTotal ? 108 : 32 },
          ]}
          ListHeaderComponent={
            <>
              {favorites.length > 0 && (
                <View style={styles.favSection}>
                  <Text style={styles.sectionTitle}>Favoritter</Text>
                  <View style={styles.favChips}>
                    {favorites.map((fav) => (
                      <View key={fav.ean} style={styles.favChip}>
                        <Pressable
                          style={styles.favChipAdd}
                          hitSlop={6}
                          onPress={() =>
                            addToCart({
                              name: fav.name,
                              ean: fav.ean,
                              image_url: fav.image_url,
                              price: fav.price,
                            })
                          }
                        >
                          <Ionicons name="add" size={14} color="#E10A0A" />
                          <Text style={styles.favChipText} numberOfLines={1}>
                            {fav.name}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.favChipRemove}
                          hitSlop={8}
                          onPress={() => toggleFavorite(fav)}
                        >
                          <Ionicons name="close" size={14} color="#bbb" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {active.length > 0 && (
                <Text style={styles.sectionTitle}>
                  Å handle ({active.reduce((sum, item) => sum + item.quantity, 0)})
                </Text>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="cart-outline" size={48} color="#ccc" />
              <Text style={styles.empty}>
                Tom liste. Søk eller legg til over, eller hopp til Tilbud-fanen.
              </Text>
            </View>
          }
          renderItem={({ item: row }) =>
            row.kind === 'group' ? (
              <CartGroupHeader chain={row.chain} subtotal={row.subtotal} savings={row.savings} />
            ) : (
              <CartRow
                item={row.item}
                discontinued={!!row.item.ean && discontinuedEans.has(row.item.ean)}
                onToggle={toggleChecked}
                onChangeQuantity={updateQuantity}
              />
            )
          }
          ListFooterComponent={
            <View>
              {done.length > 0 && (
                <View style={styles.doneSection}>
                  <View style={styles.doneHeader}>
                    <Text style={styles.sectionTitle}>
                      I kurven ({done.reduce((sum, item) => sum + item.quantity, 0)})
                    </Text>
                    <Pressable onPress={() => clearChecked()} hitSlop={8}>
                      <Text style={styles.clearLink}>Fjern alle</Text>
                    </Pressable>
                  </View>
                  {doneGroups.map((g) => (
                    <View key={`done:${g.chain}`}>
                      <CartGroupHeader chain={g.chain} subtotal={g.subtotal} />
                      {g.items.map((i) => (
                        <CartRow
                          key={i.id}
                          item={i}
                          discontinued={!!i.ean && discontinuedEans.has(i.ean)}
                          onToggle={toggleChecked}
                          onChangeQuantity={updateQuantity}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </View>
          }
        />
      )}
      {showStickyTotal ? (
        <StickyTotal
          savings={totalSavings}
          itemCount={activeItemCount}
          storeCount={groups.length}
          searching={showSearchPanel}
        />
      ) : null}
    </View>
  );
}

function SearchResults({
  query,
  manualPrice,
  onChangeManualPrice,
  results,
  searchMode,
  activeCartByEan,
  searching,
  onPick,
  onAddManual,
  bottomInset,
}: {
  query: string;
  manualPrice: string;
  onChangeManualPrice: (value: string) => void;
  results: MenyProduct[];
  searchMode: SearchMode;
  activeCartByEan: Map<string, number>;
  searching: boolean;
  onPick: (p: MenyProduct) => void;
  onAddManual: () => void;
  bottomInset: number;
}) {
  const manualAddCard = useMemo(
    () => (
      <View style={styles.manualAddCard}>
        <Pressable style={styles.manualAddAction} onPress={onAddManual}>
          <Ionicons name="add-circle" size={22} color="#E10A0A" />
          <Text style={styles.manualAddText}>Legg til “{query.trim()}” manuelt</Text>
        </Pressable>
        <View style={styles.manualPriceRow}>
          <Text style={styles.manualPriceLabel}>Ca. pris</Text>
          <TextInput
            style={styles.manualPriceInput}
            value={manualPrice}
            onChangeText={onChangeManualPrice}
            placeholder="valgfri"
            keyboardType="decimal-pad"
          />
          <Text style={styles.manualPriceSuffix}>kr</Text>
        </View>
      </View>
    ),
    [query, manualPrice, onAddManual, onChangeManualPrice],
  );

  const renderItem = useCallback(
    ({ item }: { item: MenyProduct }) => (
      <SearchResultRow
        item={item}
        cartQuantity={item.ean ? (activeCartByEan.get(item.ean) ?? 0) : 0}
        onPick={onPick}
      />
    ),
    [activeCartByEan, onPick],
  );

  return (
    <FlatList
      data={results}
      keyExtractor={(p) => p.ean}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset }]}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      removeClippedSubviews
      ListHeaderComponent={
        searchMode === 'deals' ? (
          <Text style={styles.searchHint}>Viser bare varer med aktiv kampanje eller prisfall</Text>
        ) : null
      }
      ListEmptyComponent={
        searching ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : query.trim().length < 2 ? null : (
          <View style={{ gap: 8 }}>
            <Text style={styles.empty}>
              Ingen treff i appen ennå — varen kan likevel finnes i butikkene.
            </Text>
            {manualAddCard}
          </View>
        )
      }
      renderItem={renderItem}
      ListFooterComponent={results.length > 0 ? manualAddCard : null}
    />
  );
}

const SearchResultRow = memo(function SearchResultRow({
  item,
  cartQuantity,
  onPick,
}: {
  item: MenyProduct;
  cartQuantity: number;
  onPick: (p: MenyProduct) => void;
}) {
  const inCart = cartQuantity > 0;
  const favorites = useFavorites();
  const starred = favorites.some((f) => f.ean === item.ean);
  const isMenyPromo = item.price_source === 'meny';
  const beforePrice = isMenyPromo ? item.original_price : item.median_30d;
  const beforePrefix = isMenyPromo ? 'førpris' : 'vanligvis';
  const showDeal = item.drop_pct != null && item.drop_pct >= 5;
  const unitPriceLabel = formatUnitPriceLabel({
    name: item.name,
    price: item.current_price,
    ean: item.ean,
  });

  return (
    <View style={[styles.resultRow, inCart && styles.resultRowInCart]}>
      {item.image_url ? (
        <Image source={item.image_url} style={styles.resultThumb} contentFit="contain" />
      ) : (
        <View style={[styles.resultThumb, styles.resultThumbPlaceholder]}>
          <Ionicons name="image-outline" size={18} color="#ccc" />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.resultName} numberOfLines={2}>
          {item.name}
        </Text>
        {item.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}
        {isLikelyCampaignText(item.campaign_text) ? (
          <CampaignBadge text={item.campaign_text!} />
        ) : null}
      </View>
      <View style={styles.resultPriceColumn}>
        {showDeal ? (
          <>
            <Text style={[styles.dealBadge, !isMenyPromo && styles.dealBadgeMedian]}>
              −{Math.round(item.drop_pct!)} %
            </Text>
            <Text
              style={[
                styles.resultSourceLabel,
                isMenyPromo ? styles.resultSourceLabelMeny : styles.resultSourceLabelMedian,
              ]}
            >
              {isMenyPromo ? 'Kampanje' : 'Prisfall'}
            </Text>
          </>
        ) : null}
        {item.current_price != null ? (
          <Text style={styles.resultPrice}>{item.current_price.toFixed(2)} kr</Text>
        ) : null}
        {unitPriceLabel ? <Text style={styles.resultUnitPrice}>{unitPriceLabel}</Text> : null}
        {beforePrice != null && showDeal ? (
          <Text style={styles.resultBeforePrice}>
            {beforePrefix} {beforePrice.toFixed(2)}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => onPick(item)}
        hitSlop={8}
        style={[styles.resultAddButton, inCart && styles.resultAddButtonDone]}
      >
        <Ionicons
          name={inCart ? 'checkmark' : 'add'}
          size={22}
          color={inCart ? '#fff' : '#E10A0A'}
        />
      </Pressable>
      {inCart ? <Text style={styles.resultCartCount}>{cartQuantity}</Text> : null}
      <Pressable
        hitSlop={8}
        onPress={() =>
          toggleFavorite({
            ean: item.ean,
            name: item.name,
            image_url: item.image_url,
            price: item.current_price,
          })
        }
      >
        <Ionicons
          name={starred ? 'star' : 'star-outline'}
          size={18}
          color={starred ? '#F5A623' : '#ccc'}
        />
      </Pressable>
    </View>
  );
});

function StickyTotal({
  savings,
  itemCount,
  storeCount,
  searching,
}: {
  savings: number;
  itemCount: number;
  storeCount: number;
  searching: boolean;
}) {
  const showSavings = savings > 0.005;
  const countHint = `${itemCount} ${itemCount === 1 ? 'vare' : 'varer'} i ${storeCount} ${
    storeCount === 1 ? 'butikk' : 'butikker'
  }`;
  return (
    <View style={styles.stickyTotalWrap}>
      <View style={styles.stickyTotal}>
        <View style={{ flex: 1 }}>
          <Text style={styles.totalLabel}>{showSavings ? 'Samlet besparelse' : 'Handleliste'}</Text>
          <Text style={styles.totalHint}>{searching ? 'Oppdatert mens du søker' : countHint}</Text>
        </View>
        {showSavings ? <Text style={styles.totalSavingsValue}>−{savings.toFixed(2)} kr</Text> : null}
      </View>
    </View>
  );
}

function CartGroupHeader({
  chain,
  subtotal,
  savings = 0,
}: {
  chain: string;
  subtotal: number;
  savings?: number;
}) {
  return (
    <View style={styles.groupHeader}>
      <Text style={styles.groupChain} numberOfLines={1}>
        {chain || 'Andre varer'}
      </Text>
      <View style={styles.groupRight}>
        {savings > 0.005 ? <Text style={styles.groupSavings}>−{savings.toFixed(0)} kr</Text> : null}
        <Text style={styles.groupSubtotal}>{subtotal.toFixed(2)} kr</Text>
      </View>
    </View>
  );
}

const CartRow = memo(function CartRow({
  item,
  discontinued,
  onToggle,
  onChangeQuantity,
}: {
  item: CartItem;
  discontinued: boolean;
  onToggle: (id: string) => void;
  onChangeQuantity: (id: string, quantity: number) => void;
}) {
  const [draftQuantity, setDraftQuantity] = useState<string | null>(null);
  const value = draftQuantity ?? String(item.quantity);
  const lineTotal = getLineTotal(item);
  const unitPriceLabel = formatUnitPriceLabel({
    name: item.name,
    price: item.price,
    ean: item.ean,
  });
  const favorites = useFavorites();
  const starred = !!item.ean && favorites.some((f) => f.ean === item.ean);

  function commit() {
    if (draftQuantity == null) return;
    const parsed = parseInt(draftQuantity, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      if (parsed !== item.quantity) onChangeQuantity(item.id, parsed);
    }
    setDraftQuantity(null);
  }

  return (
    <View style={[styles.cartRow, discontinued && styles.cartRowDiscontinued]}>
      <Pressable onPress={() => onToggle(item.id)} hitSlop={8}>
        <Ionicons
          name={item.checked ? 'checkbox' : 'square-outline'}
          size={26}
          color={item.checked ? '#2E8B57' : '#bbb'}
        />
      </Pressable>
      {item.image_url ? (
        <Image source={item.image_url} style={styles.cartThumb} contentFit="contain" />
      ) : (
        <View style={[styles.cartThumb, styles.cartThumbPlaceholder]}>
          <Ionicons name="image-outline" size={18} color="#ccc" />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.cartName, item.checked && styles.cartNameDone]}>{item.name}</Text>
        {discontinued ? (
          <View style={styles.discontinuedBadge}>
            <Ionicons name="alert-circle" size={12} color="#fff" />
            <Text style={styles.discontinuedBadgeText}>Ikke i salg</Text>
          </View>
        ) : item.deal_expired ? (
          <View style={styles.expiredBadge}>
            <Ionicons name="time-outline" size={12} color="#fff" />
            <Text style={styles.expiredBadgeText}>Tilbud utløpt</Text>
          </View>
        ) : null}
        <View style={styles.cartMetaRow}>
          <View style={styles.cartPriceBlock}>
            <View style={styles.cartPriceRow}>
              {item.price != null && (
                <Text style={styles.cartPrice} numberOfLines={1}>
                  <Text style={styles.cartPricePrimary}>{item.price.toFixed(2)} kr</Text>
                  {item.quantity > 1 ? (
                    <Text style={styles.cartPriceSecondary}>
                      {' '}
                      · {lineTotal.toFixed(2)} kr totalt
                    </Text>
                  ) : null}
                </Text>
              )}
              {item.drop_pct != null && item.drop_pct >= 5 ? (
                <Text style={styles.dealBadge}>−{Math.round(item.drop_pct)} %</Text>
              ) : null}
            </View>
            {unitPriceLabel ? <Text style={styles.cartUnitPrice}>{unitPriceLabel}</Text> : null}
          </View>
          <View style={styles.cartActionsRow}>
            <View style={styles.quantityControl}>
              <Pressable
                onPress={() => onChangeQuantity(item.id, item.quantity - 1)}
                hitSlop={8}
                style={styles.quantityButton}
              >
                <Ionicons
                  name={item.quantity <= 1 ? 'trash-outline' : 'remove'}
                  size={16}
                  color={item.quantity <= 1 ? '#C0392B' : '#444'}
                />
              </Pressable>
              <TextInput
                value={value}
                onChangeText={(text) => setDraftQuantity(text.replace(/[^0-9]/g, ''))}
                onFocus={() => setDraftQuantity(String(item.quantity))}
                onBlur={commit}
                onSubmitEditing={commit}
                keyboardType="number-pad"
                returnKeyType="done"
                selectTextOnFocus
                maxLength={3}
                style={styles.quantityValue}
              />
              <Pressable
                onPress={() => onChangeQuantity(item.id, item.quantity + 1)}
                hitSlop={8}
                style={styles.quantityButton}
              >
                <Ionicons name="add" size={16} color="#444" />
              </Pressable>
            </View>
            {item.ean ? (
              <Pressable
                onPress={() =>
                  toggleFavorite({
                    ean: item.ean!,
                    name: item.name,
                    image_url: item.image_url,
                    price: item.price,
                  })
                }
                hitSlop={8}
                style={styles.removeButton}
              >
                <Ionicons
                  name={starred ? 'star' : 'star-outline'}
                  size={18}
                  color={starred ? '#F5A623' : '#bbb'}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
        {isLikelyCampaignText(item.campaign_text) ? (
          <CampaignBadge text={item.campaign_text!} />
        ) : null}
      </View>
    </View>
  );
});

function CampaignBadge({ text }: { text: string }) {
  const kind = getCampaignKind(text);
  const badgeStyle = [
    styles.campaignBadge,
    kind === 'bundle' && styles.campaignBadgeBundle,
    kind === 'member' && styles.campaignBadgeMember,
    kind === 'bonus' && styles.campaignBadgeBonus,
    kind === 'clearance' && styles.campaignBadgeClearance,
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
      <Text style={styles.campaignBadgeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 16 },
  searchModeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: -2,
    marginBottom: 8,
  },
  searchModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e2e6',
  },
  searchModeChipActive: {
    backgroundColor: '#E10A0A',
    borderColor: '#E10A0A',
  },
  searchModeText: { fontSize: 12, fontWeight: '600', color: '#666' },
  searchModeTextActive: { color: '#fff' },
  searchHint: { color: '#666', fontSize: 12, paddingTop: 4, paddingBottom: 2 },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 32,
    gap: 6,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 8, marginBottom: 4 },
  emptyBox: { alignItems: 'center', padding: 48, gap: 12 },
  empty: { color: '#999', textAlign: 'center', paddingHorizontal: 24 },
  manualAddCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  manualAddAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualAddText: { fontSize: 15, fontWeight: '500' },
  manualPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  manualPriceLabel: { fontSize: 13, color: '#666', minWidth: 52 },
  manualPriceInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e2e6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fafafb',
  },
  manualPriceSuffix: { fontSize: 13, color: '#666' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    padding: 9,
    borderRadius: 10,
  },
  resultRowInCart: {
    backgroundColor: '#F2FBF5',
  },
  resultAddButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultAddButtonDone: {
    backgroundColor: '#2E8B57',
  },
  resultCartCount: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#2E8B57',
  },
  resultThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
  },
  resultThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultName: { fontSize: 13, fontWeight: '500' },
  resultPriceColumn: { alignItems: 'flex-end', gap: 2 },
  resultPrice: { fontSize: 14, color: '#E10A0A', fontWeight: '600' },
  resultUnitPrice: { fontSize: 11, color: '#777' },
  resultBeforePrice: { fontSize: 11, color: '#999' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  campaignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#2B6A57',
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  campaignBadgeBundle: { backgroundColor: '#0B6B3A' },
  campaignBadgeMember: { backgroundColor: '#005B99' },
  campaignBadgeBonus: { backgroundColor: '#7A4E00' },
  campaignBadgeClearance: { backgroundColor: '#A63D40' },
  campaignBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 10,
  },
  cartRowDiscontinued: {
    backgroundColor: '#FFF6F0',
    borderWidth: 1,
    borderColor: '#F2C2A8',
  },
  discontinuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#C44A1A',
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  discontinuedBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  expiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#8A8A8E',
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  expiredBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cartThumb: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
  },
  cartThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartName: { fontSize: 13, fontWeight: '500' },
  cartNameDone: { color: '#aaa', textDecorationLine: 'line-through' },
  cartMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  cartPriceBlock: { flex: 1, minWidth: 0 },
  cartPrice: { fontSize: 12, color: '#666' },
  cartPricePrimary: { color: '#222', fontWeight: '700' },
  cartPriceSecondary: { color: '#777', fontWeight: '500' },
  cartPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cartUnitPrice: { fontSize: 11, color: '#777', marginTop: 1 },
  cartActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  dealBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A85C00',
    backgroundColor: '#FFF1D6',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  dealBadgeMedian: {
    color: '#666',
    backgroundColor: '#F0F0F3',
  },
  resultSourceLabel: { fontSize: 9, fontWeight: '600' },
  resultSourceLabelMeny: { color: '#2B6A57' },
  resultSourceLabelMedian: { color: '#999' },
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
    minWidth: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#2E8B57',
    paddingVertical: 0,
  },
  removeButton: { padding: 2 },
  stickyTotalWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  stickyTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: 616,
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e6e6ea',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  totalLabel: { color: '#666' },
  totalHint: { color: '#999', fontSize: 12, marginTop: 2 },
  totalValue: { fontWeight: '700' },
  totalSavingsValue: { fontWeight: '800', fontSize: 16, color: '#0B6B3A' },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  groupChain: { fontSize: 14, fontWeight: '800', color: '#222', flex: 1 },
  groupRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupSavings: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0B6B3A',
    backgroundColor: '#E6F4EC',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  groupSubtotal: { fontSize: 14, fontWeight: '700', color: '#222' },
  doneSection: { marginTop: 16, gap: 6 },
  doneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearLink: { color: '#E10A0A', fontSize: 13 },
  favSection: { marginBottom: 8 },
  favChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  favChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e2e6',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 5,
    borderRadius: 999,
  },
  favChipAdd: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  favChipRemove: {
    paddingLeft: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e2e2e6',
  },
  favChipText: { fontSize: 13, color: '#333', maxWidth: 140 },
});
