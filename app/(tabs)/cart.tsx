import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addToCart,
  clearChecked,
  removeFromCart,
  toggleChecked,
  updateQuantity,
  useCart,
} from '@/lib/cart';
import { getCampaignKind, isLikelyCampaignText } from '@/lib/campaigns';
import { searchProducts } from '@/lib/deals';
import type { CartItem, MenyProduct } from '@/lib/types';

export default function CartScreen() {
  const { items, loading } = useCart();
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

  const total = useMemo(
    () => items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0),
    [items],
  );
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
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color="#bbb" />
          </Pressable>
        )}
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
            active.length === 0 ? null : (
              <Text style={styles.sectionTitle}>
                Å handle ({active.reduce((sum, item) => sum + item.quantity, 0)})
              </Text>
            )
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
            <CartRow
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
                    <CartRow
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
      {item.current_price != null ? (
        <Text style={styles.resultPrice}>{item.current_price.toFixed(2)} kr</Text>
      ) : null}
      <Pressable
        onPress={() => onPick(item)}
        hitSlop={8}
        style={[styles.resultAddButton, inCart && styles.resultAddButtonDone]}>
        <Ionicons name={inCart ? 'checkmark' : 'add'} size={22} color={inCart ? '#fff' : '#E10A0A'} />
      </Pressable>
      {inCart ? <Text style={styles.resultCartCount}>{cartQuantity}</Text> : null}
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
      {item.image_url ? (
        <Image source={item.image_url} style={styles.cartThumb} contentFit="contain" />
      ) : (
        <View style={[styles.cartThumb, styles.cartThumbPlaceholder]}>
          <Ionicons name="image-outline" size={18} color="#ccc" />
        </View>
      )}
      <Pressable onPress={() => onToggle(item.id)} hitSlop={8}>
        <Ionicons
          name={item.checked ? 'checkbox' : 'square-outline'}
          size={26}
          color={item.checked ? '#2E8B57' : '#bbb'}
        />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cartName, item.checked && styles.cartNameDone]}>
          {item.name}
        </Text>
        <View style={styles.cartPriceRow}>
          {item.price != null && (
            <Text style={styles.cartPrice}>
              {item.price.toFixed(2)} kr
              {item.quantity > 1 ? ` · ${(item.price * item.quantity).toFixed(2)} kr totalt` : ''}
            </Text>
          )}
          {item.drop_pct != null && item.drop_pct >= 5 ? (
            <Text style={styles.dealBadge}>−{Math.round(item.drop_pct)} %</Text>
          ) : null}
        </View>
        {isLikelyCampaignText(item.campaign_text) ? (
          <CampaignBadge text={item.campaign_text!} />
        ) : null}
      </View>
      <View style={styles.quantityControl}>
        <Pressable
          onPress={() => onChangeQuantity(item.id, Math.max(1, item.quantity - 1))}
          hitSlop={8}
          style={styles.quantityButton}>
          <Ionicons name="remove" size={18} color="#444" />
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
          <Ionicons name="add" size={18} color="#444" />
        </Pressable>
      </View>
      <Pressable onPress={() => onRemove(item.id)} hitSlop={10} style={styles.removeButton}>
        <Ionicons name="trash-outline" size={20} color="#999" />
      </Pressable>
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
  listContent: { paddingHorizontal: 12, paddingBottom: 32, gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 8, marginBottom: 4 },
  emptyBox: { alignItems: 'center', padding: 48, gap: 12 },
  empty: { color: '#999', textAlign: 'center', paddingHorizontal: 24 },
  manualAddCard: {
    backgroundColor: '#fff',
    padding: 14,
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
    gap: 12,
    backgroundColor: '#fff',
    padding: 12,
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
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
  },
  resultThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultName: { fontSize: 14, fontWeight: '500' },
  resultPrice: { fontSize: 14, color: '#E10A0A', fontWeight: '600' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  campaignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#2B6A57',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  campaignBadgeBundle: { backgroundColor: '#0B6B3A' },
  campaignBadgeMember: { backgroundColor: '#005B99' },
  campaignBadgeBonus: { backgroundColor: '#7A4E00' },
  campaignBadgeClearance: { backgroundColor: '#A63D40' },
  campaignBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
  },
  cartThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
  },
  cartThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartName: { fontSize: 15, fontWeight: '500' },
  cartNameDone: { color: '#aaa', textDecorationLine: 'line-through' },
  cartPrice: { fontSize: 13, color: '#666' },
  cartPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  dealBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A85C00',
    backgroundColor: '#FFF1D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityValue: {
    minWidth: 30,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    paddingVertical: 0,
  },
  removeButton: { padding: 4 },
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
});
