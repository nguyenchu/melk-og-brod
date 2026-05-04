import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  addToCart,
  clearChecked,
  removeFromCart,
  toggleChecked,
  updateQuantity,
  useCart,
} from '@/lib/cart';
import { getBundlePayForOffer, getCampaignKind, isLikelyCampaignText } from '@/lib/campaigns';
import { searchProducts } from '@/lib/deals';
import { toggleFavorite, useFavorites } from '@/lib/favorites';
import { hasSupabaseConfig } from '@/lib/supabase';
import { formatUnitPriceLabel } from '@/lib/pricing';
import type { CartItem, MenyProduct } from '@/lib/types';

function getCartItemTotal(item: Pick<CartItem, 'price' | 'quantity' | 'campaign_text'>) {
  if (item.price == null) return 0;

  const bundleOffer = getBundlePayForOffer(item.campaign_text);
  if (!bundleOffer) return item.price * item.quantity;

  const bundleCount = Math.floor(item.quantity / bundleOffer.buy);
  const remainder = item.quantity % bundleOffer.buy;
  const payableUnits = bundleCount * bundleOffer.payFor + remainder;
  return payableUnits * item.price;
}

export default function CartScreen() {
  const { items, loading } = useCart();
  const favorites = useFavorites();
  const [query, setQuery] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [results, setResults] = useState<MenyProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (!hasSupabaseConfig()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const rows = await searchProducts(q);
      setResults(rows);
    } catch (e: any) {
      Alert.alert('Søkefeil', e.message);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  async function onAddProduct(p: MenyProduct) {
    await addToCart({
      name: p.name,
      ean: p.ean,
      image_url: p.image_url,
      price: p.current_price,
      drop_pct: p.drop_pct,
      campaign_text: p.campaign_text,
    });
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  }

  async function onShare() {
    if (active.length === 0) return;
    const lines = active.map((i) => {
      const qty = i.quantity > 1 ? ` (${i.quantity}x)` : '';
      const price = i.price != null ? ` – ${i.price.toFixed(2)} kr` : '';
      return `• ${i.name}${qty}${price}`;
    });
    await Share.share({
      message: `Handleliste\n\n${lines.join('\n')}\n\nEstimert total: ${total.toFixed(2)} kr`,
    });
  }

  async function onAddManual() {
    const name = query.trim();
    if (!name) return;
    const normalizedPrice = manualPrice.trim().replace(',', '.');
    const parsedPrice = normalizedPrice ? Number(normalizedPrice) : null;
    await addToCart({
      name,
      price: parsedPrice != null && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
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
  const activeCartByEan = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of active) {
      if (item.ean) map.set(item.ean, (map.get(item.ean) ?? 0) + item.quantity);
    }
    return map;
  }, [active]);

  const total = useMemo(() => items.reduce((sum, i) => sum + getCartItemTotal(i), 0), [items]);
  const showStickyTotal = items.length > 0 && total > 0;

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
        <SearchResults
          query={query}
          manualPrice={manualPrice}
          onChangeManualPrice={setManualPrice}
          results={results}
          activeCartByEan={activeCartByEan}
          searching={searching}
          onPick={onAddProduct}
          onAddManual={onAddManual}
          bottomInset={showStickyTotal ? 92 : 24}
        />
      ) : (
        <FlatList
          data={active}
          keyExtractor={(i) => i.id}
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
                      <Pressable
                        key={fav.ean}
                        style={styles.favChip}
                        onPress={() => addToCart({ name: fav.name, ean: fav.ean, image_url: fav.image_url, price: fav.price })}
                      >
                        <Ionicons name="add" size={14} color="#E10A0A" />
                        <Text style={styles.favChipText} numberOfLines={1}>{fav.name}</Text>
                      </Pressable>
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
          renderItem={({ item }) => (
            <SwipeableCartRow
              item={item}
              onToggle={toggleChecked}
              onRemove={removeFromCart}
              onChangeQuantity={updateQuantity}
            />
          )}
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
                  {done.map((i) => (
                    <SwipeableCartRow
                      key={i.id}
                      item={i}
                      onToggle={toggleChecked}
                      onRemove={removeFromCart}
                      onChangeQuantity={updateQuantity}
                    />
                  ))}
                </View>
              )}
            </View>
          }
        />
      )}
      {showStickyTotal ? <StickyTotal total={total} searching={showSearchPanel} /> : null}
    </View>
  );
}

function SearchResults({
  query,
  manualPrice,
  onChangeManualPrice,
  results,
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
  activeCartByEan: Map<string, number>;
  searching: boolean;
  onPick: (p: MenyProduct) => void;
  onAddManual: () => void;
  bottomInset: number;
}) {
  const manualAddCard = (
    <View style={styles.manualAddCard}>
      <Pressable style={styles.manualAddAction} onPress={onAddManual}>
        <Ionicons name="add-circle" size={22} color="#E10A0A" />
        <Text style={styles.manualAddText}>
          Legg til “{query.trim()}” manuelt
        </Text>
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
      ListEmptyComponent={
        searching ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : query.trim().length < 2 ? null : (
          <View style={{ gap: 8 }}>
            <Text style={styles.empty}>Ingen treff på Meny.</Text>
            {manualAddCard}
          </View>
        )
      }
      renderItem={({ item }) => (
        <SearchResultRow
          item={item}
          cartQuantity={item.ean ? activeCartByEan.get(item.ean) ?? 0 : 0}
          onPick={onPick}
        />
      )}
      ListFooterComponent={
        results.length > 0 ? (
          manualAddCard
        ) : null
      }
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
  const unitPriceLabel = formatUnitPriceLabel({ name: item.name, price: item.current_price, ean: item.ean });

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
          <Text style={styles.dealBadge}>−{Math.round(item.drop_pct!)} %</Text>
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
        style={[styles.resultAddButton, inCart && styles.resultAddButtonDone]}>
        <Ionicons name={inCart ? 'checkmark' : 'add'} size={22} color={inCart ? '#fff' : '#E10A0A'} />
      </Pressable>
      {inCart ? <Text style={styles.resultCartCount}>{cartQuantity}</Text> : null}
      <Pressable
        hitSlop={8}
        onPress={() => toggleFavorite({ ean: item.ean, name: item.name, image_url: item.image_url, price: item.current_price })}>
        <Ionicons name={starred ? 'star' : 'star-outline'} size={18} color={starred ? '#F5A623' : '#ccc'} />
      </Pressable>
    </View>
  );
});

function StickyTotal({ total, searching }: { total: number; searching: boolean }) {
  return (
    <View style={styles.stickyTotalWrap}>
      <View style={styles.stickyTotal}>
        <View>
          <Text style={styles.totalLabel}>Estimert total</Text>
          <Text style={styles.totalHint}>{searching ? 'Oppdatert mens du søker' : 'Basert på varene i lista'}</Text>
        </View>
        <Text style={styles.totalValue}>{total.toFixed(2)} kr</Text>
      </View>
    </View>
  );
}

const CartRow = memo(function CartRow({
  item,
  onToggle,
  onRemove,
  onChangeQuantity,
}: {
  item: CartItem;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onChangeQuantity: (id: string, quantity: number) => void;
}) {
  const [draftQuantity, setDraftQuantity] = useState<string | null>(null);
  const value = draftQuantity ?? String(item.quantity);
  const lineTotal = getCartItemTotal(item);
  const bundleOffer = getBundlePayForOffer(item.campaign_text);
  const regularTotal = item.price != null ? item.price * item.quantity : null;
  const hasBundleSavings =
    bundleOffer != null && regularTotal != null && regularTotal - lineTotal > 0.001;
  const unitPriceLabel = formatUnitPriceLabel({ name: item.name, price: item.price, ean: item.ean });

  function commit() {
    if (draftQuantity == null) return;
    const parsed = parseInt(draftQuantity, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      if (parsed !== item.quantity) onChangeQuantity(item.id, parsed);
    }
    setDraftQuantity(null);
  }

  return (
    <View style={styles.cartRow}>
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
        <View style={styles.cartMetaRow}>
          <View style={styles.cartPriceBlock}>
            <View style={styles.cartPriceRow}>
              {item.price != null && (
                <Text style={styles.cartPrice} numberOfLines={1}>
                  <Text style={styles.cartPricePrimary}>{item.price.toFixed(2)} kr</Text>
                  {item.quantity > 1 ? <Text style={styles.cartPriceSecondary}> · {lineTotal.toFixed(2)} kr totalt</Text> : null}
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
                onPress={() => onChangeQuantity(item.id, Math.max(1, item.quantity - 1))}
                hitSlop={8}
                style={styles.quantityButton}>
                <Ionicons name="remove" size={16} color="#444" />
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
                style={styles.quantityButton}>
                <Ionicons name="add" size={16} color="#444" />
              </Pressable>
            </View>
            <Pressable onPress={() => onRemove(item.id)} hitSlop={10} style={styles.removeButton}>
              <Ionicons name="trash-outline" size={18} color="#999" />
            </Pressable>
          </View>
        </View>
        {hasBundleSavings ? (
          <Text style={styles.bundleHint}>
            Ordinært {regularTotal!.toFixed(2)} kr · kampanje trukket fra
          </Text>
        ) : null}
        {isLikelyCampaignText(item.campaign_text) ? (
          <CampaignBadge text={item.campaign_text!} />
        ) : null}
      </View>
    </View>
  );
});

function SwipeableCartRow({
  item,
  onToggle,
  onRemove,
  onChangeQuantity,
}: {
  item: CartItem;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onChangeQuantity: (id: string, quantity: number) => void;
}) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      renderRightActions={() => (
        <Pressable style={styles.swipeDelete} onPress={() => onRemove(item.id)}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
        </Pressable>
      )}
    >
      <CartRow item={item} onToggle={onToggle} onRemove={onRemove} onChangeQuantity={onChangeQuantity} />
    </ReanimatedSwipeable>
  );
}

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
  listContent: { paddingHorizontal: 12, paddingBottom: 32, gap: 6 },
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
  bundleHint: { fontSize: 11, color: '#2E8B57', marginTop: 1 },
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
  doneSection: { marginTop: 16, gap: 6 },
  doneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearLink: { color: '#E10A0A', fontSize: 13 },
  swipeDelete: {
    backgroundColor: '#E10A0A',
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: 10,
    marginBottom: 6,
  },
  favSection: { marginBottom: 8 },
  favChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  favChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e2e6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  favChipText: { fontSize: 13, color: '#333', maxWidth: 140 },
});
