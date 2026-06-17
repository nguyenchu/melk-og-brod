/**
 * Kassal-sync → Supabase.
 *
 * Henter dagligvarepriser på tvers av ALLE kjeder fra Kassal.app, regner ut
 * "ekte tilbud" (nåpris under normalpris/median), denormaliserer til én rad per
 * EAN med prissammenligning på tvers av butikker, og pusher til Supabase.
 *
 * Erstatter den gamle Meny-skraperen (scripts/deal-finder).
 *
 * Kjør:
 *   export KASSAL_API_TOKEN=...
 *   export SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx sync.ts            # full sync + push
 *   DRY_RUN=1 npx tsx sync.ts  # hent + regn, men ikke skriv til Supabase
 */
import './env.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchProducts, type KassalSearchProduct, type KassalPricePoint } from './kassal.js';
import { SEED_TERMS } from './seeds.js';

const OUT_DIR = process.env.OUT_DIR ?? './out'; // hvor products.json skrives
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const MAX_TERMS = Number(process.env.MAX_TERMS ?? 0); // 0 = alle søkeord (sett lavt for rask testkjøring)
const PAGES_PER_TERM = Number(process.env.PAGES_PER_TERM ?? 1);
const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 100);
const RATE_MS = Number(process.env.RATE_MS ?? 1100); // hold oss under 60/min
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 90); // vindu for normalpris (median)
const MIN_POINTS = Number(process.env.MIN_POINTS ?? 4); // minst antall punkter for å stole på median
const MAX_DROP_PCT = Number(process.env.MAX_DROP_PCT ?? 85); // kutt urealistiske fall (pr kg/stk-artefakter)
const HISTORY_KEEP = 20; // antall historikkpunkter vi lagrer (holder JSON-fila liten)

type StoreOffer = {
  chain: string | null;
  code: string | null;
  price: number;
  unit_price: number | null;
  url: string | null;
  logo: string | null;
  median: number | null; // butikkens egen normalpris (median i vinduet)
  drop_pct: number | null; // prisfall mot egen median
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function historyPoints(rows: KassalPricePoint[] | undefined, sinceMs: number): { date: string; price: number }[] {
  const out: { date: string; price: number }[] = [];
  for (const p of rows ?? []) {
    const price = num(p.price);
    if (price == null || !p.date) continue;
    if (new Date(p.date).getTime() < sinceMs) continue;
    out.push({ date: p.date, price });
  }
  return out;
}

function bestProductMeta(rows: KassalSearchProduct[]) {
  const withImage = rows.find((r) => r.image) ?? rows[0];
  const name = rows.map((r) => r.name).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? withImage.name;
  return {
    name,
    brand: rows.find((r) => r.brand)?.brand ?? null,
    image_url: withImage.image ?? null,
    category: rows.find((r) => Array.isArray(r.category) && r.category[0]?.name)?.category?.[0]?.name ?? null,
  };
}

type Row = {
  ean: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  vendor_url: string | null;
  chain: string | null;
  current_price: number;
  median_30d: number | null;
  original_price: number | null;
  price_source: 'median' | null;
  drop_pct: number | null;
  campaign_text: string | null;
  stores: StoreOffer[];
  price_history: { date: string; price: number }[] | null;
  computed_at: string;
  cheapest_price: number; // billigste nåpris på tvers av kjeder
  cheapest_chain: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildRow(ean: string, rows: KassalSearchProduct[]): Row | null {
  const sinceMs = Date.now() - WINDOW_DAYS * 86_400_000;

  // Ett tilbud per kjede – behold den billigste raden per butikk-kode.
  const byStore = new Map<string, { offer: StoreOffer; row: KassalSearchProduct }>();

  for (const r of rows) {
    const price = num(r.current_price);
    if (price == null || price <= 0) continue;
    const code = r.store?.code ?? r.store?.name ?? 'ukjent';
    const existing = byStore.get(code);
    if (existing && price >= existing.offer.price) continue;

    // Normalpris pr. butikk: median av DENNE butikkens egen historikk i vinduet
    // (+ nåpris). Slik unngår vi falske tilbud der en strukturelt billig kjede
    // ser ut som "tilbud" bare fordi dyrere kjeder drar en felles median opp.
    const ownPrices = historyPoints(r.price_history, sinceMs).map((p) => p.price);
    ownPrices.push(price);
    const med = ownPrices.length >= MIN_POINTS ? median(ownPrices) : null;
    let drop: number | null = null;
    if (med && med > price) {
      const pct = round2(((med - price) / med) * 100);
      if (pct < MAX_DROP_PCT) drop = pct;
    }

    byStore.set(code, {
      offer: {
        chain: r.store?.name ?? null,
        code: r.store?.code ?? null,
        price,
        unit_price: num(r.current_unit_price),
        url: r.url ?? null,
        logo: r.store?.logo ?? null,
        median: med != null ? round2(med) : null,
        drop_pct: drop,
      },
      row: r,
    });
  }

  const entries = [...byStore.values()];
  if (entries.length === 0) return null;

  const stores = entries.map((e) => e.offer).sort((a, b) => a.price - b.price);
  const cheapest = stores[0];

  // Overskrift = den butikken med størst ekte prisfall mot egen median (et reelt
  // lokketilbud). Finnes ingen, vis billigste butikk uten tilbudsmerking.
  const dealOffers = entries.filter((e) => e.offer.drop_pct != null);
  const headline = dealOffers.length
    ? dealOffers.sort((a, b) => (b.offer.drop_pct ?? 0) - (a.offer.drop_pct ?? 0))[0]
    : entries.sort((a, b) => a.offer.price - b.offer.price)[0];

  const current_price = headline.offer.price;
  if (current_price < 0.5 || current_price > 10_000) return null;

  const meta = bestProductMeta(rows);
  const history = historyPoints(headline.row.price_history, sinceMs)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_KEEP);

  return {
    ean,
    name: meta.name || '',
    brand: meta.brand,
    image_url: meta.image_url,
    vendor_url: headline.offer.url,
    chain: headline.offer.chain,
    current_price: round2(current_price),
    median_30d: headline.offer.median,
    original_price: null,
    price_source: headline.offer.drop_pct != null ? 'median' : null,
    drop_pct: headline.offer.drop_pct,
    campaign_text: null,
    stores,
    // Prishistorikk lagres bare for tilbud (kun de viser graf), så fila holdes liten
    // nok til at appen kan cache den (AsyncStorage/localStorage ~5–6 MB).
    price_history: headline.offer.drop_pct != null && history.length ? history : null,
    computed_at: new Date().toISOString(),
    cheapest_price: cheapest.price,
    cheapest_chain: cheapest.chain,
  };
}

async function collectRowsByEan(): Promise<Map<string, KassalSearchProduct[]>> {
  const byEan = new Map<string, KassalSearchProduct[]>();
  let requests = 0;
  const terms = MAX_TERMS > 0 ? SEED_TERMS.slice(0, MAX_TERMS) : SEED_TERMS;
  for (const term of terms) {
    for (let page = 1; page <= PAGES_PER_TERM; page++) {
      try {
        const { data } = await searchProducts(term, page, PAGE_SIZE);
        let added = 0;
        for (const p of data ?? []) {
          if (!p.ean) continue;
          const list = byEan.get(p.ean);
          if (list) list.push(p);
          else byEan.set(p.ean, [p]);
          added++;
        }
        console.log(`[sync] ${term} s.${page}: +${added} rader (${byEan.size} EAN totalt)`);
        if (!data || data.length < PAGE_SIZE) break; // ikke flere sider
      } catch (e) {
        console.error(`[sync] ${term} s.${page} feilet: ${(e as Error).message}`);
      }
      requests++;
      await sleep(RATE_MS);
    }
  }
  console.log(`[sync] hentet ferdig: ${requests} søk, ${byEan.size} unike EAN`);
  return byEan;
}

function writeOutput(rows: Row[]) {
  const dir = resolve(OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify({
    computed_at: new Date().toISOString(),
    count: rows.length,
    products: rows,
  });
  const file = resolve(dir, 'products.json');
  writeFileSync(file, json);
  const mb = (Buffer.byteLength(json) / 1e6).toFixed(2);
  console.log(`[sync] skrev ${rows.length} produkter til ${file} (${mb} MB)`);
}

async function main() {
  if (!process.env.KASSAL_API_TOKEN) {
    console.error(
      'KASSAL_API_TOKEN mangler. Lag scripts/kassal-sync/.env med KASSAL_API_TOKEN=... ' +
        '(se .env.example), eller eksporter den i miljøet.',
    );
    process.exit(1);
  }
  const byEan = await collectRowsByEan();

  const rows: Row[] = [];
  let deals = 0;
  for (const [ean, group] of byEan) {
    const row = buildRow(ean, group);
    if (!row) continue;
    rows.push(row);
    if (row.drop_pct != null) deals++;
  }
  console.log(`[sync] bygde ${rows.length} rader (${deals} med prisfall)`);

  // Vis et par eksempler så vi ser at transformen er riktig.
  for (const r of rows.filter((r) => r.drop_pct != null).sort((a, b) => (b.drop_pct ?? 0) - (a.drop_pct ?? 0)).slice(0, 8)) {
    const cheap = r.cheapest_chain && r.cheapest_price < r.current_price ? `, billigst ${r.cheapest_price}@${r.cheapest_chain}` : '';
    console.log(`  -${r.drop_pct}%  ${r.name}  ${r.current_price}kr @ ${r.chain}  (normal ${r.median_30d}, ${r.stores.length} butikker${cheap})`);
  }

  if (DRY_RUN) {
    console.log('[sync] DRY_RUN – hopper over filskriving');
    return;
  }
  writeOutput(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
