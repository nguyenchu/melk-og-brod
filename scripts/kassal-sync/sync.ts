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
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './env.js';
import { searchProducts, type KassalPricePoint, type KassalSearchProduct } from './kassal.js';
import { SEED_TERMS } from './seeds.js';
import {
  catalogChain,
  fetchCatalogOffers,
  fetchNorwegianCatalogs,
  type TjekOffer,
} from './tjek.js';

const OUT_DIR = process.env.OUT_DIR ?? './out'; // hvor products.json skrives
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const MAX_TERMS = Number(process.env.MAX_TERMS ?? 0); // 0 = alle søkeord (sett lavt for rask testkjøring)
const PAGES_PER_TERM = Number(process.env.PAGES_PER_TERM ?? 1);
const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 100);
const RATE_MS = Number(process.env.RATE_MS ?? 1100); // hold oss under 60/min
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 90); // vindu for normalpris (median)
const MIN_POINTS = Number(process.env.MIN_POINTS ?? 4); // minst antall punkter for å stole på median
const MAX_DROP_PCT = Number(process.env.MAX_DROP_PCT ?? 85); // kutt urealistiske fall (pr kg/stk-artefakter)
const MAX_PRICE_AGE_DAYS = Number(process.env.MAX_PRICE_AGE_DAYS ?? 60); // dropp butikkpriser Kassal har sluttet å oppdatere (Coop/KIWI/REMA = frosset på ~2023-priser)
const HISTORY_KEEP = 20; // antall historikkpunkter vi lagrer (holder JSON-fila liten)

// Kjeder vi IKKE tar med – vi viser kun rene fysiske MATBUTIKK-kjeder.
// Utelater (a) rene nettbutikker/priskilder som ikke er i Kassals /physical-stores
// (Oda, Engrosnett, Holdbart, godterinett) og (b) fysiske, men ikke-dagligvare
// varehus (Europris = vari-/lavprisvarehus). Overstyr via env EXCLUDED_CHAINS.
const DEFAULT_EXCLUDED =
  'Oda,Engrosnett,Holdbart,Slowly.no,FastCandy.no,Leske.no,Europris,Havaristen';
const EXCLUDED_CHAINS = new Set(
  (process.env.EXCLUDED_CHAINS ?? DEFAULT_EXCLUDED)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Telles opp av ferskhetsvakten i buildRow, logges til slutt i main().
let staleOffersSkipped = 0;

// Internt regneobjekt per butikk. url + median trengs kun for overskriften
// (vendor_url / median_30d) og skrives IKKE ut per butikk – se OutOffer.
type StoreOffer = {
  chain: string | null;
  code: string | null;
  price: number;
  url: string | null;
  median: number | null; // butikkens egen normalpris (median i vinduet)
  drop_pct: number | null; // prisfall mot egen median
};

// Det slanke butikk-tilbudet som faktisk lagres i products.json (det appen rendrer).
// url/logo/unit_price/median droppes – de var ubrukt og veide ~1,2 MB.
type OutOffer = {
  chain: string | null;
  code: string | null;
  price: number;
  drop_pct: number | null;
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

function historyPoints(
  rows: KassalPricePoint[] | undefined,
  sinceMs: number,
): { date: string; price: number }[] {
  const out: { date: string; price: number }[] = [];
  for (const p of rows ?? []) {
    const price = num(p.price);
    if (price == null || !p.date) continue;
    if (new Date(p.date).getTime() < sinceMs) continue;
    out.push({ date: p.date, price });
  }
  return out;
}

/**
 * Nyeste prispunkt-dato (ms) i historikken, eller null hvis vi ikke har noen.
 * Brukes som «sist sett»-signal: Kassal slutter å oppdatere enkelte kjeder, og
 * lar `current_price` stå frosset på en gammel verdi (Coop/KIWI = 2023). Et
 * nyeste punkt langt tilbake i tid betyr at prisen ikke kan stoles på lenger.
 */
function newestPriceMs(rows: KassalPricePoint[] | undefined): number | null {
  let newest: number | null = null;
  for (const p of rows ?? []) {
    if (!p.date) continue;
    const t = new Date(p.date).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

function bestProductMeta(rows: KassalSearchProduct[]) {
  const withImage = rows.find((r) => r.image) ?? rows[0];
  const name =
    rows
      .map((r) => r.name)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] ?? withImage.name;
  return {
    name,
    brand: rows.find((r) => r.brand)?.brand ?? null,
    image_url: withImage.image ?? null,
    category:
      rows.find((r) => Array.isArray(r.category) && r.category[0]?.name)?.category?.[0]?.name ??
      null,
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
  price_source: 'median' | 'tjek' | null;
  drop_pct: number | null;
  campaign_text: string | null;
  stores: OutOffer[];
  price_history: { date: string; price: number }[] | null;
  computed_at: string;
  cheapest_price: number; // billigste nåpris på tvers av kjeder
  cheapest_chain: string | null;
  valid_until: string | null; // kun tjek: når ukestilbudet utløper (run_till)
  multibuy: { quantity: number; price: number; single: number } | null; // fastpris-multibuy, f.eks. «3 for 100»
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildRow(ean: string, rows: KassalSearchProduct[]): Row | null {
  const sinceMs = Date.now() - WINDOW_DAYS * 86_400_000;

  // Ett tilbud per kjede – behold den billigste raden per butikk-kode.
  const byStore = new Map<string, { offer: StoreOffer; row: KassalSearchProduct }>();

  for (const r of rows) {
    const price = num(r.current_price);
    if (price == null || price <= 0) continue;
    if (r.store?.name && EXCLUDED_CHAINS.has(r.store.name)) continue; // kun fysiske kjeder
    // Ferskhetsvakt: har butikken et nyeste prispunkt eldre enn grensa, har
    // Kassal sluttet å oppdatere kjeden – prisen er foreldet og ville forurenset
    // både overskrift og «billigst»-sammenligning. Mangler all historikk gir vi
    // tvilen fordel og beholder raden (kan ikke bevises foreldet).
    const lastSeenMs = newestPriceMs(r.price_history);
    if (lastSeenMs != null && Date.now() - lastSeenMs > MAX_PRICE_AGE_DAYS * 86_400_000) {
      staleOffersSkipped++;
      continue;
    }
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
        url: r.url ?? null,
        median: med != null ? round2(med) : null,
        drop_pct: drop,
      },
      row: r,
    });
  }

  const entries = [...byStore.values()];
  if (entries.length === 0) return null;

  const sortedOffers = entries.map((e) => e.offer).sort((a, b) => a.price - b.price);
  const cheapest = sortedOffers[0];

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
    stores: sortedOffers.map((o) => ({
      chain: o.chain,
      code: o.code,
      price: o.price,
      drop_pct: o.drop_pct,
    })),
    // Prishistorikk lagres bare for tilbud (kun de viser graf), så fila holdes liten
    // nok til at appen kan cache den (AsyncStorage/localStorage ~5–6 MB).
    price_history: headline.offer.drop_pct != null && history.length ? history : null,
    computed_at: new Date().toISOString(),
    cheapest_price: cheapest.price,
    cheapest_chain: cheapest.chain,
    valid_until: null,
    multibuy: null,
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

// ---- Tjek / eTilbudsavis: ukentlige kundeavis-tilbud for kjedene Kassal mangler ----

const SKIP_TJEK = process.env.SKIP_TJEK === '1' || process.env.SKIP_TJEK === 'true';

// Kun rene dagligvare-kjeder. Eksakt match holder bygg/møbel/elektro ute
// (f.eks. «Obs» = hypermarked tas med, «Obs! Bygg» ikke). Europris er bevisst
// utelatt (vari-/lavprisvarehus, ikke dagligvare).
const TJEK_GROCERY = new Set([
  'kiwi',
  'rema 1000',
  'meny',
  'spar',
  'eurospar',
  'joker',
  'bunnpris',
  'extra',
  'obs',
  'coop mega',
  'coop prix',
  'coop marked',
  'coop extra',
  'matkroken',
  'jacobs',
  'nærbutikken',
  'gigaboks',
]);

// Tjek-overskrifter er ofte i VERSALER. Gjør dem til normal kasus så de ikke
// roper i en liste der Kassal-navn er blandet kasus. Allerede blandede navn røres ikke.
function prettyHeading(raw: string): string {
  const letters = raw.replace(/[^a-zæøåA-ZÆØÅ]/g, '');
  const uppers = (raw.match(/[A-ZÆØÅ]/g) ?? []).length;
  const shouty = letters.length >= 4 && uppers / letters.length > 0.8;
  const text = shouty
    ? raw.toLowerCase().replace(/(^|[\s\-/(.])([a-zæøå])/g, (_, sep, ch) => sep + ch.toUpperCase())
    : raw;
  return text.replace(/\s{2,}/g, ' ').trim();
}

function tjekOfferToRow(offer: TjekOffer, chain: string, now: number): Row | null {
  let price = num(offer.pricing?.price);
  if (price == null || price <= 0 || price > 10_000) return null;
  // Dropp utløpte tilbud ved bygging, så appen slipper utløpslogikk.
  if (offer.run_till && new Date(offer.run_till).getTime() < now) return null;

  let pre = num(offer.pricing?.pre_price);

  // Multibuy: «3 for 100» har price = total for HELE pakka (pieces.from = 3),
  // ikke per stk. Lagre per-stk-pris så handlekurven regner riktig (3 × 33,33 =
  // 100), og behold framingen som et campaign_text-merke.
  const pieces = offer.quantity?.pieces;
  const bundleQty =
    pieces?.from && pieces.from > 1 ? pieces.from : pieces?.min && pieces.min > 1 ? pieces.min : 1;
  let campaignText: string | null = null;
  let multibuy: { quantity: number; price: number; single: number } | null = null;
  if (bundleQty > 1) {
    const bundleTotal = round2(price); // pris for HELE pakka, f.eks. 100 for 3
    // Enkeltpris (det 1 stk koster): vanlig per-stk-pris fra før-prisen, ellers
    // fall tilbake på pakkeprisen delt på antall.
    const single = pre != null ? round2(pre / bundleQty) : round2(bundleTotal / bundleQty);
    multibuy = { quantity: bundleQty, price: bundleTotal, single };
    campaignText = `${bundleQty} for ${bundleTotal} kr`;
    // Tilbudslista viser per-stk-pris i tilbudet (33,33) + «før» enkeltpris (69,60);
    // selve bundle-matten (3 → 100) gjøres i handlekurven via multibuy-feltet.
    price = round2(bundleTotal / bundleQty);
    if (pre != null) pre = round2(pre / bundleQty);
  }

  let drop: number | null = null;
  if (pre != null && pre > price) {
    const pct = round2(((pre - price) / pre) * 100);
    if (pct > 0 && pct < MAX_DROP_PCT) drop = pct;
  }

  // Bygg visningsnavn med størrelse, så enhetspris-parseren i appen får tall å gå på.
  const size = offer.quantity?.size?.from;
  const sym = offer.quantity?.unit?.symbol;
  const sizePart = size && sym ? ` ${size} ${sym}` : '';
  const name = (prettyHeading(offer.heading ?? '') + sizePart).trim();
  if (!name) return null;

  return {
    ean: `tjek:${offer.id}`, // syntetisk id – tilbudsavis-tilbud har ingen EAN
    name,
    brand: null,
    image_url: offer.images?.view ?? offer.images?.thumb ?? null,
    vendor_url: null,
    chain,
    current_price: round2(price),
    median_30d: pre != null ? round2(pre) : null,
    original_price: pre != null ? round2(pre) : null,
    price_source: 'tjek',
    drop_pct: drop,
    campaign_text: campaignText,
    stores: [],
    price_history: null,
    computed_at: new Date().toISOString(),
    cheapest_price: round2(price),
    cheapest_chain: chain,
    valid_until: offer.run_till ?? null,
    multibuy,
  };
}

async function collectTjekRows(): Promise<Row[]> {
  const catalogs = await fetchNorwegianCatalogs();
  // Én katalog per kjede – den med flest tilbud. Flere byer gir regionale
  // duplikat-kataloger for samme kjede; uten dette flommer lista av dubletter.
  const bestByChain = new Map<string, { id: string; chain: string; count: number }>();
  for (const c of catalogs) {
    const chain = catalogChain(c);
    if (!chain || !TJEK_GROCERY.has(chain.toLowerCase())) continue;
    const count = c.offer_count ?? 0;
    const prev = bestByChain.get(chain);
    if (!prev || count > prev.count) bestByChain.set(chain, { id: c.id, chain, count });
  }
  console.log(`[tjek] ${catalogs.length} kataloger, ${bestByChain.size} dagligvare-kjeder`);

  const now = Date.now();
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const { id, chain } of bestByChain.values()) {
    try {
      const offers = await fetchCatalogOffers(id);
      let added = 0;
      for (const offer of offers) {
        const row = tjekOfferToRow(offer, chain, now);
        if (!row || seen.has(row.ean)) continue;
        seen.add(row.ean);
        rows.push(row);
        added++;
      }
      console.log(`[tjek] ${chain}: ${added} tilbud (av ${offers.length})`);
    } catch (e) {
      console.error(`[tjek] ${chain} feilet: ${(e as Error).message}`);
    }
  }
  const withDrop = rows.filter((r) => r.drop_pct != null).length;
  console.log(`[tjek] ferdig: ${rows.length} tilbud (${withDrop} med før→nå-pris)`);
  return rows;
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
  console.log(
    `[sync] bygde ${rows.length} rader (${deals} med prisfall, ${staleOffersSkipped} butikkpriser droppet som foreldet > ${MAX_PRICE_AGE_DAYS} d)`,
  );

  // Vis et par eksempler så vi ser at transformen er riktig.
  for (const r of rows
    .filter((r) => r.drop_pct != null)
    .sort((a, b) => (b.drop_pct ?? 0) - (a.drop_pct ?? 0))
    .slice(0, 8)) {
    const cheap =
      r.cheapest_chain && r.cheapest_price < r.current_price
        ? `, billigst ${r.cheapest_price}@${r.cheapest_chain}`
        : '';
    console.log(
      `  -${r.drop_pct}%  ${r.name}  ${r.current_price}kr @ ${r.chain}  (normal ${r.median_30d}, ${r.stores.length} butikker${cheap})`,
    );
  }

  // Tjek-tilbud (KIWI/REMA/Coop m.fl.) legges til på slutten – egen modell, uten EAN.
  if (!SKIP_TJEK) {
    try {
      const tjekRows = await collectTjekRows();
      rows.push(...tjekRows);
    } catch (e) {
      console.error(`[tjek] hopper over (feilet): ${(e as Error).message}`);
    }
  }
  console.log(`[sync] totalt ${rows.length} rader (Kassal + Tjek)`);

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
