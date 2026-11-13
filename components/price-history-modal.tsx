import { Ionicons } from '@expo/vector-icons';
import { openBrowserAsync } from 'expo-web-browser';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Line, Path, Svg, Circle as SvgCircle, Text as SvgText } from 'react-native-svg';
import { isUpcomingOffer } from '@/lib/deals';
import { pricePresentation } from '@/lib/pricing';
import type { MenyProduct, PricePoint } from '@/lib/types';

export function formatValidUntil(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(date);
}

// «Gjelder fre. 25.–lør. 26. sep.» for tilbud som ikke har startet ennå, så en
// fredagspris ikke ser ut som dagens pris.
export function formatUpcomingWindow(deal: Pick<MenyProduct, 'valid_from' | 'valid_until'>) {
  if (!isUpcomingOffer(deal) || !deal.valid_from) return null;
  const toDate = (value: string | null | undefined) => {
    const date = value ? new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const format = (date: Date, withMonth: boolean) =>
    new Intl.DateTimeFormat('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    }).format(date);
  const from = toDate(deal.valid_from);
  const until = toDate(deal.valid_until);
  if (!from) return null;
  if (!until || until.toDateString() === from.toDateString()) {
    return `Gjelder ${format(from, true)}`;
  }
  return `Gjelder ${format(from, false)}–${format(until, true)}`;
}

export function PriceHistoryModal({ deal, onClose }: { deal: MenyProduct; onClose: () => void }) {
  const presentation = pricePresentation({ ...deal, price: deal.current_price });
  const measure = deal.price_measure;
  const scale =
    measure?.loose && measure.unit === 'kg' && measure.amount > 0 ? 1 / measure.amount : 1;
  const history = (deal.price_history ?? []).map((p) => ({ ...p, price: p.price * scale }));
  const stores = (deal.stores ?? []).filter((s) => s.price != null);
  const usualPrice =
    deal.median_30d != null && deal.median_30d !== deal.current_price
      ? pricePresentation({
          name: deal.name,
          ean: deal.ean,
          price: deal.median_30d,
          price_measure: deal.price_measure,
          unit_price: null,
        }).primary
      : null;
  // Kun https-lenker åpnes, så en ugyldig katalogverdi aldri blir en lenke.
  const vendorUrl =
    deal.vendor_url && /^https:\/\//i.test(deal.vendor_url) ? deal.vendor_url : null;
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
              {deal.multibuy
                ? `${deal.multibuy.quantity} for ${deal.multibuy.price} kr`
                : (presentation.primary ?? '—')}
            </Text>
            {deal.chain ? <Text style={styles.modalChain}>@ {deal.chain}</Text> : null}
            {deal.drop_pct != null ? (
              <View style={styles.dropBadge}>
                <Text style={styles.dropText}>−{deal.drop_pct.toFixed(0)}%</Text>
              </View>
            ) : null}
          </View>
          {presentation.secondary ? (
            <Text style={styles.unitPrice}>{presentation.secondary}</Text>
          ) : null}
          {usualPrice ? (
            <Text style={styles.unitPrice}>
              {deal.price_source === 'tjek' ? 'Før' : 'Vanligvis'} {usualPrice}
            </Text>
          ) : null}
          {vendorUrl ? (
            <Pressable
              style={styles.vendorLink}
              onPress={() => openBrowserAsync(vendorUrl).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={`Åpne ${deal.name} hos ${deal.chain ?? 'butikken'}`}
            >
              <Ionicons name="open-outline" size={14} color="#005B99" />
              <Text style={styles.vendorLinkText}>Åpne hos {deal.chain ?? 'butikken'}</Text>
            </Pressable>
          ) : null}
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
                    {
                      pricePresentation({
                        name: deal.name,
                        ean: deal.ean,
                        price: s.price,
                        price_measure: s.price_measure,
                        unit_price: s.unit_price,
                      }).primary
                    }
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {deal.price_source === 'tjek' ? (
            <Text style={styles.validUntilModal}>
              Ukestilbud fra kundeavisen
              {formatUpcomingWindow(deal)
                ? ` · ${formatUpcomingWindow(deal)!.toLowerCase()}`
                : formatValidUntil(deal.valid_until)
                  ? ` · gjelder til ${formatValidUntil(deal.valid_until)}`
                  : ''}
            </Text>
          ) : history.length >= 2 ? (
            <>
              {scale !== 1 ? <Text style={styles.unitPrice}>Prishistorikk i kr/kg</Text> : null}
              <PriceChart
                points={history}
                currentPrice={deal.current_price == null ? null : deal.current_price * scale}
                unit={scale !== 1 ? 'kr/kg' : 'kr'}
              />
            </>
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
  unit = 'kr',
}: {
  points: PricePoint[];
  currentPrice: number | null;
  unit?: string;
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
    const match = d.match(/^\d{4}-(\d{2})-(\d{2})/);
    return match ? `${match[2]}.${match[1]}` : '';
  };
  // Tittel etter tidsrommet grafen dekker, ikke antall punkter: en flat serie
  // er slått sammen til to punkter, men dekker like mange dager.
  const spanDays = Math.round(
    (new Date(points[points.length - 1].date).getTime() - new Date(points[0].date).getTime()) /
      86_400_000,
  );
  const chartLabel =
    Number.isFinite(spanDays) && spanDays >= 1
      ? `Prishistorikk (siste ${spanDays} dager)`
      : `Prishistorikk (siste ${points.length} målinger)`;
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
      <Text style={styles.chartLabel}>{chartLabel}</Text>
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
            {tick.toFixed(tick < 10 || range < 5 ? 1 : 0)}
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
        <Text style={styles.chartLegendText}>Historisk pris ({unit})</Text>
        <View style={[styles.chartLegendDot, { backgroundColor: '#2E8B57' }]} />
        <Text style={styles.chartLegendText}>Nå</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartLabel: { fontSize: 12, color: '#888', marginBottom: 6 },
  chartLegend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  chartLegendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E10A0A' },
  chartLegendText: { fontSize: 11, color: '#888' },
  chartWrap: { marginTop: 12 },
  dropBadge: {
    backgroundColor: '#FFF1D6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dropText: { color: '#A85C00', fontWeight: '700', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  modalBrand: { fontSize: 13, color: '#888' },
  modalChain: { fontSize: 14, fontWeight: '600', color: '#2B6A57' },
  modalContent: { padding: 20, gap: 6 },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalPrice: { fontSize: 22, fontWeight: '700', color: '#E10A0A' },
  modalPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  noChartText: { color: '#aaa', fontSize: 13, padding: 24, textAlign: 'center' },
  storeBlock: { marginTop: 16, gap: 2 },
  storeBlockTitle: { fontSize: 13, fontWeight: '700', color: '#444', marginBottom: 4 },
  storeDrop: { fontSize: 12, fontWeight: '700', color: '#A85C00' },
  storeName: { flex: 1, fontSize: 14, color: '#222' },
  storePrice: { fontSize: 14, fontWeight: '600', color: '#333', minWidth: 64, textAlign: 'right' },
  storePriceBest: { color: '#0B6B3A', fontWeight: '800' },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  unitPrice: { fontSize: 12, color: '#666', marginTop: 1 },
  vendorLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  vendorLinkText: { fontSize: 13, color: '#005B99', fontWeight: '600' },
  validUntilModal: { fontSize: 13, color: '#005B99', fontWeight: '600', marginTop: 16 },
});
