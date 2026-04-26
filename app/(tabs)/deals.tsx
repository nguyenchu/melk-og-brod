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

function isVariableWeightItem(item: MenyProduct) {
  const normalizedName = item.name.toLowerCase();
  return (
    item.ean.startsWith('2') ||
    /ca[\s.]*\d+[,.]?\d*\s*kg/.test(normalizedName) ||
    /ca[\s.]*\d+[,.]?\d*\s*g/.test(normalizedName) ||
    normalizedName.includes('ca ')
  );
}

function extractWeightKg(name: string) {
  const normalized = name.toLowerCase().replace(/\s+/g, ' ');
  const kgMatch = normalized.match(/(?:ca[\s.]*)?(\d+[.,]?\d*)\s*kg\b/);
  if (kgMatch) return Number(kgMatch[1].replace(',', '.'));

  const gramMatch = normalized.match(/(?:ca[\s.]*)?(\d+[.,]?\d*)\s*g\b/);
  if (gramMatch) return Number(gramMatch[1].replace(',', '.')) / 1000;

  return null;
}

function formatPrice(value: number | null | undefined, approximate: boolean) {
  if (value == null) return null;
  return approximate ? `${Math.round(value)} kr` : `${value.toFixed(2)} kr`;
}

function formatUnitPrice(totalPrice: number | null | undefined, weightKg: number | null, approximate: boolean) {
  if (totalPrice == null || !weightKg || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  const unitPrice = totalPrice / weightKg;
  return approximate ? `ca. ${Math.round(unitPrice)} kr/kg` : `${unitPrice.toFixed(2)} kr/kg`;
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

function isLikelyCampaignText(value: string | null | undefined) {
  if (!value) return false;
  const text = value.trim();
  const normalized = text.toLowerCase();

  if (
    text.length > 60 ||
    /[{}[\]":]/.test(text) ||
    /next_public_|window\.env|trumfid|chainid|token|provider|login/.test(normalized)
  ) {
    return false;
  }

  return (
    /\b\d+\s*for\s*\d+\b/.test(normalized) ||
    /\bkj[øo]p\s*\d+.*betal/.test(normalized) ||
    /\bmedlemspris\b/.test(normalized) ||
    /\btrumf(?:-bonus)?\b/.test(normalized)
  );
}

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
            Ingen ferske tilbud akkurat nå. Kjør `find_deals.py` på nytt for å hente oppdaterte priser.
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
        image_url: item.image_url,
        price: item.current_price,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e: any) {
      Alert.alert('Kunne ikke legge til', e.message);
    }
  }

  const drop = item.drop_pct ?? 0;
  const approximate = isVariableWeightItem(item);
  const weightKg = extractWeightKg(item.name);
  const currentPriceLabel = formatPrice(item.current_price, approximate);
  const beforePriceLabel = formatPrice(item.median_30d, approximate);
  const unitPriceLabel = formatUnitPrice(item.current_price, weightKg, approximate);

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
          {currentPriceLabel ? (
            <Text style={styles.price}>
              {approximate ? 'ca. ' : ''}
              {currentPriceLabel}
            </Text>
          ) : null}
          {beforePriceLabel ? (
            <Text style={styles.median}>
              før {approximate ? 'ca. ' : ''}
              {beforePriceLabel}
            </Text>
          ) : null}
        </View>
        {isLikelyCampaignText(item.campaign_text) ? <Text style={styles.campaign}>{item.campaign_text}</Text> : null}
        {approximate ? <Text style={styles.approximate}>Vektvare, pris kan variere litt</Text> : null}
        {unitPriceLabel ? <Text style={styles.unitPrice}>{unitPriceLabel}</Text> : null}
        <Text style={styles.computedAt}>{formatComputedAt(item.computed_at)}</Text>
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
  campaign: {
    fontSize: 12,
    color: '#0B6B3A',
    backgroundColor: '#E9F7EF',
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '600',
  },
  approximate: { fontSize: 12, color: '#8b6b34', marginTop: 4 },
  unitPrice: { fontSize: 12, color: '#666', marginTop: 2 },
  computedAt: { fontSize: 12, color: '#777', marginTop: 6 },
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
