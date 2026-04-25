import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { addToCart } from '@/lib/cart';
import { fetchTopDeals } from '@/lib/deals';
import type { MenyProduct } from '@/lib/types';

export default function DealsScreen() {
  const [deals, setDeals] = useState<MenyProduct[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await fetchTopDeals(0.1, 100);
      setDeals(rows);
    } catch (e: any) {
      setError(e.message ?? 'Kunne ikke hente tilbud');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (deals === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={deals ?? []}
      keyExtractor={(d) => d.ean}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <Text style={styles.headerSub}>
            Beste prisfall på Meny mot 30-dagers median
          </Text>
        )
      }
      ListEmptyComponent={
        !error ? (
          <Text style={styles.empty}>
            Ingen tilbud funnet enda. Kjør `find_deals.py` for å fylle databasen.
          </Text>
        ) : null
      }
      renderItem={({ item }) => <DealRow item={item} />}
    />
  );
}

function DealRow({ item }: { item: MenyProduct }) {
  const [added, setAdded] = useState(false);

  async function onAdd() {
    try {
      await addToCart({
        name: item.name,
        ean: item.ean,
        price: item.current_price,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e: any) {
      Alert.alert('Kunne ikke legge til', e.message);
    }
  }

  const drop = item.drop_pct ?? 0;
  return (
    <View style={styles.row}>
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
        {item.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}
        <View style={styles.priceRow}>
          <Text style={styles.price}>
            {item.current_price?.toFixed(2)} kr
          </Text>
          {item.median_30d ? (
            <Text style={styles.median}>
              før {item.median_30d.toFixed(2)} kr
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        <View style={styles.dropBadge}>
          <Text style={styles.dropText}>−{drop.toFixed(0)}%</Text>
        </View>
        <Pressable onPress={onAdd} style={[styles.addBtn, added && styles.addBtnDone]}>
          <Ionicons
            name={added ? 'checkmark' : 'add'}
            size={20}
            color="#fff"
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 12, gap: 8 },
  headerSub: { color: '#666', marginBottom: 8, paddingHorizontal: 4 },
  errorBox: { backgroundColor: '#FFE5E5', padding: 12, borderRadius: 8, marginBottom: 8 },
  errorText: { color: '#C00' },
  empty: { color: '#999', textAlign: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 12,
  },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#f5f5f7' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111' },
  brand: { fontSize: 12, color: '#888', marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
  price: { fontSize: 16, fontWeight: '700', color: '#E10A0A' },
  median: { fontSize: 12, color: '#999', textDecorationLine: 'line-through' },
  right: { alignItems: 'center', gap: 8 },
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
  addBtnDone: { backgroundColor: '#2E8B57' },
});
