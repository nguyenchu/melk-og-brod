import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { searchProducts } from '@/lib/deals';
import type { CartItem, MenyProduct } from '@/lib/types';

export default function CartScreen() {
  const { items, loading } = useCart();
  const [query, setQuery] = useState('');
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
    await addToCart({ name: p.name, ean: p.ean, price: p.current_price });
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  }

  async function onAddManual() {
    const name = query.trim();
    if (!name) return;
    await addToCart({ name });
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  }

  const { active, done } = useMemo(() => {
    return {
      active: items.filter((i) => !i.checked),
      done: items.filter((i) => i.checked),
    };
  }, [items]);

  const total = useMemo(
    () => active.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0),
    [active],
  );

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
          results={results}
          searching={searching}
          onPick={onAddProduct}
          onAddManual={onAddManual}
        />
      ) : (
        <FlatList
          data={active}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listContent}
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
              {active.length > 0 && total > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Estimert sum</Text>
                  <Text style={styles.totalValue}>{total.toFixed(2)} kr</Text>
                </View>
              )}
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
    </View>
  );
}

function SearchResults({
  query,
  results,
  searching,
  onPick,
  onAddManual,
}: {
  query: string;
  results: MenyProduct[];
  searching: boolean;
  onPick: (p: MenyProduct) => void;
  onAddManual: () => void;
}) {
  return (
    <FlatList
      data={results}
      keyExtractor={(p) => p.ean}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        searching ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : query.trim().length < 2 ? null : (
          <View style={{ gap: 8 }}>
            <Text style={styles.empty}>Ingen treff på Meny.</Text>
            <Pressable style={styles.manualAdd} onPress={onAddManual}>
              <Ionicons name="add-circle" size={22} color="#E10A0A" />
              <Text style={styles.manualAddText}>
                Legg til “{query.trim()}”
              </Text>
            </Pressable>
          </View>
        )
      }
      renderItem={({ item }) => (
        <Pressable style={styles.resultRow} onPress={() => onPick(item)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.resultName} numberOfLines={2}>
              {item.name}
            </Text>
            {item.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}
          </View>
          {item.current_price != null && (
            <Text style={styles.resultPrice}>{item.current_price.toFixed(2)} kr</Text>
          )}
          <Ionicons name="add" size={22} color="#E10A0A" />
        </Pressable>
      )}
      ListFooterComponent={
        results.length > 0 ? (
          <Pressable style={styles.manualAdd} onPress={onAddManual}>
            <Ionicons name="add-circle" size={22} color="#E10A0A" />
            <Text style={styles.manualAddText}>
              Legg til “{query.trim()}” manuelt
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function CartRow({
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
    <View style={styles.cartRow}>
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
        <View style={styles.cartMetaRow}>
          {item.price != null && (
            <Text style={styles.cartPrice}>
              {item.price.toFixed(2)} kr
              {item.quantity > 1 ? ` · ${(item.price * item.quantity).toFixed(2)} kr totalt` : ''}
            </Text>
          )}
          <View style={styles.quantityControl}>
            <Pressable
              onPress={() => onChangeQuantity(item.id, item.quantity - 1)}
              hitSlop={8}
              style={styles.quantityButton}>
              <Ionicons name="remove" size={16} color="#444" />
            </Pressable>
            <Text style={styles.quantityValue}>{item.quantity}</Text>
            <Pressable
              onPress={() => onChangeQuantity(item.id, item.quantity + 1)}
              hitSlop={8}
              style={styles.quantityButton}>
              <Ionicons name="add" size={16} color="#444" />
            </Pressable>
          </View>
        </View>
      </View>
      <Pressable onPress={() => onRemove(item.id)} hitSlop={8}>
        <Ionicons name="trash-outline" size={20} color="#999" />
      </Pressable>
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
  manualAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  manualAddText: { fontSize: 15, fontWeight: '500' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
  },
  resultName: { fontSize: 14, fontWeight: '500' },
  resultPrice: { fontSize: 14, color: '#E10A0A', fontWeight: '600' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
  },
  cartName: { fontSize: 15, fontWeight: '500' },
  cartNameDone: { color: '#aaa', textDecorationLine: 'line-through' },
  cartPrice: { fontSize: 13, color: '#666', marginTop: 2 },
  cartMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 2,
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quantityButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f0f0f2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityValue: { minWidth: 18, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginTop: 8,
  },
  totalLabel: { color: '#666' },
  totalValue: { fontWeight: '700' },
  doneSection: { marginTop: 16, gap: 6 },
  doneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearLink: { color: '#E10A0A', fontSize: 13 },
});
