#!/usr/bin/env python3
"""
Henter Meny-priser direkte fra Meny, regner ut prisfall mot lokal historikk
og dytter resultatet til Supabase-tabellen `meny_products`.

Bruk:
    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    pip install -r requirements.txt
    python find_deals.py
"""

import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from urllib.parse import urlsplit, urlunsplit

import requests
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from search_supplements import SEARCH_SUPPLEMENT_GROUPS, flattened_search_supplements

load_dotenv(SCRIPT_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
MENY_CAMPAIGNS_URL = "https://meny.no/kampanjer"
PLATFORM_REST_BASE_URL = os.environ.get(
    "MENY_PLATFORM_REST_BASE_URL", "https://platform-rest-prod.ngdata.no"
)
PLATFORM_CHAIN_ID = os.environ.get("MENY_PLATFORM_CHAIN_ID", "1300")
PLATFORM_GLN = os.environ.get("MENY_PLATFORM_GLN", "0")

DB_PATH = SCRIPT_DIR / "deals.db"

PRODUCT_SAMPLE_SIZE = int(os.environ.get("PRODUCT_SAMPLE_SIZE", "1000"))
HISTORY_DAYS = 30
# Once today's price has held unchanged for longer than this, the median-based
# "silent price drop" logic treats it as the new regular price rather than a
# deal — otherwise a permanent price change keeps reporting a stale drop for
# weeks until the old price level ages out of the 30-day window.
MEDIAN_DEAL_MAX_FLAT_DAYS = int(os.environ.get("MEDIAN_DEAL_MAX_FLAT_DAYS", "7"))
RATE_LIMIT_SLEEP = 1.1  # Hobby-tier: 60 req/min
MENY_HISTORY_STORE = "MENY_NO"
LOCAL_HISTORY_STORE = "MENY_DIRECT"
CATALOG_PAGE_SIZE = 100
MAX_CATALOG_PAGES = int(os.environ.get("MAX_CATALOG_PAGES", "250"))
PRODUCT_LIMIT = int(os.environ.get("PRODUCT_LIMIT", "0"))
MAX_EMPTY_PAGES_WITHOUT_NEW = int(os.environ.get("MAX_EMPTY_PAGES_WITHOUT_NEW", "80"))
SEARCH_SUPPLEMENTS = flattened_search_supplements()
PRODUCT_CACHE_MAX_AGE_HOURS = int(os.environ.get("PRODUCT_CACHE_MAX_AGE_HOURS", "12"))
LIVE_CACHE_TTL_HOURS = int(os.environ.get("LIVE_CACHE_TTL_HOURS", "6"))
DEAD_SLUG_TTL_DAYS = int(os.environ.get("DEAD_SLUG_TTL_DAYS", "7"))
INCREMENTAL_MODE = os.environ.get("FIND_DEALS_MODE", "incremental").lower() != "full"
MIN_EXPECTED_ROWS = int(os.environ.get("MIN_EXPECTED_ROWS", "2000"))
MAX_NO_SCORE_LIVE_FETCHES = int(os.environ.get("MAX_NO_SCORE_LIVE_FETCHES", "250"))
MAX_TOTAL_LIVE_FETCHES = int(os.environ.get("MAX_TOTAL_LIVE_FETCHES", "0"))  # 0 = ubegrenset
NO_SCORE_LIVE_KEYWORDS = tuple(
    keyword.strip().lower()
    for keyword in os.environ.get(
        "NO_SCORE_LIVE_KEYWORDS",
        "cotw,coffee of the world,kaffe,kapsel,espresso,lungo,filterkaffe,burn,energidrikk,jacobs,burgerbrød,skyr,oatly,tannkrem,toalettpapir,ketchup,pannekake,spaghetti,kotelett,iskrem,salat,frukt,grønnsak",
    ).split(",")
    if keyword.strip()
)
PROMO_KEYWORDS = (
    "trumf",
    "bonus",
    "kjøp",
    "kjop",
    "betal",
    "for",
    "spar",
    "medlemspris",
    "plukk",
    "miks",
    "tilbud",
    "kampanje",
    "rabatt",
    "sommerpris",
)

# Known Meny product-page migrations where an older linked page is 404,
# but Meny still has a live replacement page with updated price/campaign info.
DEAD_SLUG = object()  # sentinel: 404 from meny.no — cache and exclude from deals

MENY_URL_OVERRIDES_BY_EAN = {
    "8718951312531": "https://meny.no/varer/personlige-artikler/tannpleie/tannkrem/colgate-tannkrem-8718951553224",
}

def meny_session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; MelkOgBrod/1.0; +https://meny.no)",
            "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
        }
    )
    return s


def platform_rest_session():
    return meny_session()


def init_db(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS products (
            ean         TEXT PRIMARY KEY,
            name        TEXT,
            brand       TEXT,
            image_url   TEXT,
            vendor_url  TEXT,
            current_price REAL,
            fetched_at  INTEGER
        );
        CREATE TABLE IF NOT EXISTS prices (
            ean         TEXT,
            store       TEXT,
            date        TEXT,
            price       REAL,
            PRIMARY KEY (ean, store, date)
        );
        CREATE TABLE IF NOT EXISTS live_cache (
            ean           TEXT PRIMARY KEY,
            current_price REAL,
            campaign_text TEXT,
            fallback_campaign_text TEXT,
            fetched_at    INTEGER
        );
        CREATE TABLE IF NOT EXISTS dead_slugs (
            ean         TEXT PRIMARY KEY,
            url         TEXT,
            recorded_at INTEGER
        );
        """
    )
    try:
        conn.execute("ALTER TABLE products ADD COLUMN current_price REAL")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE products ADD COLUMN original_price REAL")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE products ADD COLUMN uses_promotion INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE live_cache ADD COLUMN fallback_campaign_text TEXT")
    except sqlite3.OperationalError:
        pass


def load_cached_products(conn, max_age_hours):
    freshest_allowed = int(time.time() - max_age_hours * 60 * 60)
    rows = conn.execute(
        """
        SELECT ean, name, brand, image_url, vendor_url, current_price,
               original_price, uses_promotion, fetched_at
        FROM products
        WHERE fetched_at >= ?
        """,
        (freshest_allowed,),
    ).fetchall()
    products = []
    for ean, name, brand, image_url, vendor_url, current_price, original_price, uses_promotion, fetched_at in rows:
        products.append(
            {
                "ean": ean,
                "name": name,
                "brand": brand,
                "image": image_url,
                "url": vendor_url,
                "current_price": current_price,
                "original_price": original_price,
                "uses_promotion": bool(uses_promotion) if uses_promotion is not None else False,
                "fetched_at": fetched_at,
            }
        )
    return products


def load_cached_histories(conn, eans, today):
    if not eans:
        return {}, set()
    placeholders = ",".join("?" for _ in eans)
    rows = conn.execute(
        f"""
        SELECT ean, store, date, price
        FROM prices
        WHERE ean IN ({placeholders})
        """,
        eans,
    ).fetchall()

    points_by_ean = {}
    for ean, store, date, price in rows:
        points_by_ean.setdefault(ean, []).append(
            {
                "store": store,
                "store_name": store,
                "date": date,
                "price": price,
            }
        )

    histories = {}
    fresh_eans = set()
    for ean, points in points_by_ean.items():
        histories[ean] = {"price_history": points}
        if any((point.get("date") or "") == today for point in points):
            fresh_eans.add(ean)
    return histories, fresh_eans


def load_live_cache(conn, ttl_hours):
    freshest_allowed = int(time.time() - ttl_hours * 60 * 60)
    rows = conn.execute(
        """
        SELECT ean, current_price, campaign_text, fallback_campaign_text, fetched_at
        FROM live_cache
        WHERE fetched_at >= ?
        """,
        (freshest_allowed,),
    ).fetchall()
    return {
        ean: {
            "price": current_price,
            "campaign_text": campaign_text,
            "fallback_campaign_text": fallback_campaign_text,
            "fetched_at": fetched_at,
        }
        for ean, current_price, campaign_text, fallback_campaign_text, fetched_at in rows
    }


def persist_live_cache(conn, live_rows):
    if not live_rows:
        return
    conn.executemany(
        """
        INSERT OR REPLACE INTO live_cache (ean, current_price, campaign_text, fallback_campaign_text, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        live_rows,
    )
    conn.commit()


def load_dead_slugs(conn, ttl_days):
    cutoff = int(time.time() - ttl_days * 86400)
    rows = conn.execute(
        "SELECT ean FROM dead_slugs WHERE recorded_at >= ?", (cutoff,)
    ).fetchall()
    return {row[0] for row in rows}


def persist_dead_slugs(conn, records):
    if not records:
        return
    conn.executemany(
        "INSERT OR REPLACE INTO dead_slugs (ean, url, recorded_at) VALUES (?, ?, ?)",
        records,
    )
    conn.commit()


def product_priority(product):
    explicit = product.get("source_priority")
    if explicit is not None:
        return explicit
    url = (product.get("url") or "").lower()
    image = (product.get("image") or "").lower()
    score = 0
    if "meny.no" in url:
        score += 10
    if "/meny/" in image:
        score += 2
    return score


def is_meny_product(product):
    url = (product.get("url") or "").lower()
    ean = product.get("ean")
    return bool(ean) and "meny.no" in url


def merge_product(by_ean, product):
    ean = product.get("ean")
    if not ean or not is_meny_product(product):
        return False
    current = by_ean.get(ean)
    if current is None:
        by_ean[ean] = product
        return True

    preferred = product if product_priority(product) > product_priority(current) else current
    other = current if preferred is product else product

    merged = dict(preferred)
    for key in (
        "name",
        "brand",
        "image",
        "url",
        "current_price",
        "original_price",
        "description",
        "slugifiedUrl",
    ):
        if not merged.get(key) and other.get(key):
            merged[key] = other.get(key)

    merged["uses_promotion"] = bool(preferred.get("uses_promotion") or other.get("uses_promotion"))
    merged["campaign_text"] = merge_promo_labels(
        preferred.get("campaign_text"),
        preferred.get("promotionDisplayName"),
        other.get("campaign_text"),
        other.get("promotionDisplayName"),
    )

    if not merged.get("promotions") and other.get("promotions"):
        merged["promotions"] = other.get("promotions")

    merged["seen_in_catalog"] = bool(
        preferred.get("seen_in_catalog") or other.get("seen_in_catalog")
    )

    by_ean[ean] = merged
    return False


def fetch_campaign_eans():
    try:
        response = requests.get(
            MENY_CAMPAIGNS_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; MelkOgBrod/1.0; +https://meny.no)",
                "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
            },
            timeout=30,
        )
        response.raise_for_status()
    except Exception as exc:
        print(f"  kampanjeside feilet: {exc}")
        return []

    html = response.text
    eans = []
    seen = set()
    for match in re.findall(r'productIds\\?":\[(.*?)\]', html):
        for ean in re.findall(r'\\"(\d{4,14})\\"', match):
            if ean in seen:
                continue
            seen.add(ean)
            eans.append(ean)
    return eans


def fetch_campaign_products(platform, by_ean):
    campaign_eans = fetch_campaign_eans()
    if not campaign_eans:
        print("Klarte ikke hente kampanje-EAN-er fra Meny.")
        return 0

    print(f"Henter produkter fra Meny kampanjeside ({len(campaign_eans)} EAN-er)...")
    added = 0
    chunk_size = 25
    total_chunks = max(1, (len(campaign_eans) + chunk_size - 1) // chunk_size)
    for chunk_index, start in enumerate(range(0, len(campaign_eans), chunk_size), start=1):
        chunk = campaign_eans[start : start + chunk_size]
        response = platform.get(
            f"{PLATFORM_REST_BASE_URL}/api/products/{PLATFORM_CHAIN_ID}/{PLATFORM_GLN}/multipleProducts",
            params={
                "product_ids": ",".join(chunk),
                "fieldset": "maximal",
                "showNotForSale": "false",
            },
            timeout=30,
        )
        if not response.ok:
            print(f"  kampanje-chunk {chunk_index}/{total_chunks} feilet med {response.status_code}")
            time.sleep(RATE_LIMIT_SLEEP)
            continue
        batch = response.json() or []
        for raw_product in batch:
            product = platform_product_to_catalog_product(raw_product)
            if not product:
                continue
            if merge_product(by_ean, product):
                added += 1
        print(f"  kampanjevarer {chunk_index}/{total_chunks} (total {len(by_ean)})", end="\r")
        time.sleep(RATE_LIMIT_SLEEP)
    print(" " * 60, end="\r")
    print(f"  La til {added} varer fra Meny kampanjeside")
    return added


def build_platform_product_name(product):
    title = compact_text(product.get("title"))
    subtitle = compact_text(product.get("subtitle"))
    if title and subtitle:
        return f"{title} {subtitle}"
    return title or subtitle


def platform_product_to_catalog_product(product):
    ean = str(product.get("ean") or "").strip()
    if not ean:
        return None

    slug = compact_text(product.get("slugifiedUrl"))
    image_path = compact_text(product.get("imagePath"))
    campaign_text = merge_promo_labels(
        product.get("promotionDisplayName"),
        product.get("promotionPriceFromPromotionId"),
    )
    for promo in product.get("promotions") or []:
        campaign_text = merge_promo_labels(campaign_text, extract_campaign_text_from_offer(promo))

    current_price = product.get("pricePerUnit")
    original_price = product.get("pricePerUnitOriginal")
    uses_promo = bool(product.get("usesPromotionPrice"))
    url = f"https://meny.no/varer{slug}" if slug else ""

    return {
        "ean": ean,
        "name": build_platform_product_name(product),
        "brand": compact_text(product.get("brand") or product.get("vendor")),
        "image": f"https://bilder.ngdata.no/{image_path}/medium.jpg" if image_path else None,
        "url": url,
        "current_price": current_price,
        "original_price": original_price,
        "uses_promotion": uses_promo,
        "campaign_text": campaign_text,
        "promotionDisplayName": product.get("promotionDisplayName"),
        "promotions": product.get("promotions"),
        "description": product.get("description"),
        "slugifiedUrl": slug or None,
        "source_priority": 20,
        # Marks a product that came from a live Meny response this run (catalog,
        # search or campaign). Seed products loaded from the local cache lack it,
        # so a full run can tell "still on Meny" from "stale leftover".
        "seen_in_catalog": True,
    }


def fetch_platform_search_products(platform, query, page=1, page_size=100):
    response = platform.get(
        f"{PLATFORM_REST_BASE_URL}/api/products/{PLATFORM_CHAIN_ID}/{PLATFORM_GLN}/",
        params={
            "search": query,
            "page": page,
            "page_size": page_size,
            "full_response": "true",
            "fieldset": "maximal",
            "showNotForSale": "false",
        },
        timeout=30,
    )
    if not response.ok:
        return response, [], None

    payload = response.json() or {}
    hits = payload.get("hits", {}).get("hits", [])
    products = []
    for hit in hits:
        source = hit.get("_source") if isinstance(hit, dict) else None
        if not isinstance(source, dict):
            continue
        product = platform_product_to_catalog_product(source)
        if product:
            products.append(product)
    total = payload.get("hits", {}).get("total")
    return response, products, total


def fetch_platform_catalog_products(platform, by_ean):
    pages_with_no_new = 0
    total_seen = None
    for page in range(1, MAX_CATALOG_PAGES + 1):
        response, batch, total = fetch_platform_search_products(
            platform,
            "",
            page=page,
            page_size=CATALOG_PAGE_SIZE,
        )
        if not response.ok:
            print(f"  [catalog page {page}] {response.status_code}: {response.text[:120]} — stopper")
            break
        if total_seen is None:
            total_seen = total
            print(f"Tomt Meny-søk rapporterer totalt {total_seen} treff")
        if not batch:
            print(f"  [catalog page {page}] tom side — ferdig")
            break

        added = 0
        for product in batch:
            if merge_product(by_ean, product):
                added += 1

        if added == 0:
            pages_with_no_new += 1
        else:
            pages_with_no_new = 0

        print(f"  [catalog page {page}] +{added} Meny-varer (total {len(by_ean)})")

        if PRODUCT_LIMIT > 0 and len(by_ean) >= PRODUCT_LIMIT:
            print(f"  nådde PRODUCT_LIMIT={PRODUCT_LIMIT}")
            break
        if len(batch) < CATALOG_PAGE_SIZE:
            print(f"  [catalog page {page}] siste side")
            break
        if pages_with_no_new >= MAX_EMPTY_PAGES_WITHOUT_NEW:
            print(
                f"  [catalog page {page}] {MAX_EMPTY_PAGES_WITHOUT_NEW} sider uten nye Meny-varer — stopper"
            )
            break
        time.sleep(RATE_LIMIT_SLEEP)


def fetch_products(seed_products=None):
    by_ean = {}
    for product in seed_products or []:
        merge_product(by_ean, product)
    platform = platform_rest_session()
    print("Bygger Meny-katalog fra Meny-plattformen, kampanjer og målrettede søk...")
    fetch_platform_catalog_products(platform, by_ean)
    fetch_campaign_products(platform, by_ean)

    total_queries = sum(len(items) for items in SEARCH_SUPPLEMENT_GROUPS.values())
    query_index = 0
    consecutive_empty = 0
    max_consecutive_empty = int(os.environ.get("SUPPLEMENT_CONSECUTIVE_EMPTY_MAX", "20"))
    print("Supplerer katalog med målrettede søk...")
    for group_name, queries in SEARCH_SUPPLEMENT_GROUPS.items():
        print(f"  Gruppe {group_name}: {len(queries)} søk")
        group_added = 0
        consecutive_empty = 0
        for query in queries:
            query_index += 1
            response, batch, _total = fetch_platform_search_products(platform, query)
            if not response.ok:
                print(f"    [{query_index}/{total_queries} {query!r}] {response.status_code}: {response.text[:120]} — hopper over")
                time.sleep(RATE_LIMIT_SLEEP)
                continue
            added = 0
            for product in batch:
                if merge_product(by_ean, product):
                    added += 1
            group_added += added
            print(f"    [{query_index}/{total_queries} {query!r}] +{added} Meny-varer (total {len(by_ean)})")
            if added == 0:
                consecutive_empty += 1
            else:
                consecutive_empty = 0
            if consecutive_empty >= max_consecutive_empty:
                print(f"    {max_consecutive_empty} sammenhengende søk uten nye varer i {group_name} — hopper til neste gruppe")
                break
            if PRODUCT_LIMIT > 0 and len(by_ean) >= PRODUCT_LIMIT:
                print(f"    nådde PRODUCT_LIMIT={PRODUCT_LIMIT}")
                return list(by_ean.values())
            time.sleep(RATE_LIMIT_SLEEP)
        print(f"  Ferdig med {group_name}: +{group_added} nye varer")
    return list(by_ean.values())


def meny_points(history):
    points = (
        history.get("price_history")
        or history.get("prices")
        or history.get("history")
        or []
    )
    matching = []
    for point in points:
        store_name = (point.get("store_name") or point.get("store") or "").strip()
        if store_name not in {MENY_HISTORY_STORE, LOCAL_HISTORY_STORE}:
            continue
        matching.append(point)
    return matching


def all_meny_store_names(history):
    points = (
        history.get("price_history")
        or history.get("prices")
        or history.get("history")
        or []
    )
    names = []
    seen = set()
    for point in points:
        store_name = point.get("store_name") or point.get("store") or ""
        normalized_store = store_name.strip()
        if not normalized_store or normalized_store in seen:
            continue
        seen.add(normalized_store)
        names.append(store_name)
    return names


def persist_local_price_history(conn, rows, today):
    for row in rows:
        current_price = row.get("current_price")
        ean = row.get("ean")
        if not ean or current_price is None:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO prices(ean,store,date,price) VALUES(?,?,?,?)",
            (ean, LOCAL_HISTORY_STORE, today, current_price),
        )
    conn.commit()


def score_deal(meny_history):
    points = sorted(
        (p for p in meny_history if p.get("price") and p.get("date")),
        key=lambda p: p["date"],
    )
    if len(points) < 3:
        return None
    today = points[-1]
    today_price = today["price"]

    # Walk back over the most recent contiguous run of today's price. If that
    # price has held for longer than MEDIAN_DEAL_MAX_FLAT_DAYS it's the new
    # regular price, not a temporary drop — don't score it as a deal.
    run_start = len(points) - 1
    while run_start > 0 and points[run_start - 1]["price"] == today_price:
        run_start -= 1
    try:
        run_days = (
            datetime.fromisoformat(today["date"])
            - datetime.fromisoformat(points[run_start]["date"])
        ).days
    except ValueError:
        return None
    if run_days > MEDIAN_DEAL_MAX_FLAT_DAYS:
        return None

    # Baseline is the price level from before the current run only, so a
    # permanent step-down isn't averaged against its own new price.
    prev_prices = [p["price"] for p in points[:run_start]]
    if not prev_prices:
        return None
    baseline = median(prev_prices)
    if not baseline or baseline == 0:
        return None
    return {
        "today_price": today_price,
        "median": baseline,
        "drop_pct": (baseline - today_price) / baseline * 100,
    }


def compact_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def extract_ean(value):
    match = re.search(r"(\d{8,14})(?:/?$)", value or "")
    return match.group(1) if match else None


def normalize_identity_text(value):
    return re.sub(r"[^a-z0-9]+", " ", compact_text(value).lower()).strip()


def product_string_candidates(value):
    if isinstance(value, str):
        text = compact_text(value)
        return [text] if text else []
    if isinstance(value, dict):
        strings = []
        for item in value.values():
            strings.extend(product_string_candidates(item))
        return strings
    if isinstance(value, list):
        strings = []
        for item in value:
            strings.extend(product_string_candidates(item))
        return strings
    return []


def decode_json_string(value):
    try:
        return json.loads(f'"{value}"')
    except Exception:
        return value


def canonicalize_promo(text):
    """Return a clean human-readable promo label, or None.

    Handles raw scraped text that may contain trailing JSON/URL junk by
    extracting only the canonical phrase ("3 for 2", "Kjøp 3 betal 2", etc.)
    plus a short context word like "på barnemat" when present.
    """
    if not text:
        return None

    m = re.search(r"\b(\d+)\s*[\-_]?\s*for\s*[\-_]?\s*(\d+)\b", text, re.IGNORECASE)
    if m:
        n, k = m.group(1), m.group(2)
        rest = text[m.end() : m.end() + 60]
        ctx = re.match(r"\s*p[åa]\s+([a-zæøå]+(?:\s+[a-zæøå]+){0,5})", rest, re.IGNORECASE)
        if ctx:
            context = re.sub(r"\s{2,}", " ", ctx.group(1).strip().lower())
            return f"{n} for {k} på {context}"
        return f"{n} for {k}"

    m = re.search(r"kj[øo]p\s*(\d+)[,\s]+betal\s*(?:for\s*)?(\d+)", text, re.IGNORECASE)
    if m:
        return f"Kjøp {m.group(1)} betal {m.group(2)}"

    m = re.search(
        r"plukk\s*(?:&|og)\s*miks(?:\s+([a-zæøå]{2,20}))?", text, re.IGNORECASE
    )
    if m:
        cat = m.group(1)
        return f"Plukk & miks {cat.lower()}" if cat else "Plukk & miks"

    m = re.search(r"\+?\s*(\d+)\s*%\s*trumf(?:-?\s*bonus)?", text, re.IGNORECASE)
    if m:
        return f"+{m.group(1)}% Trumf-bonus"

    if re.search(r"\bmedlemspris\b", text, re.IGNORECASE):
        return "Medlemspris"

    m = re.search(r"([+\-−]?\d+)\s*%\s*rabatt", text, re.IGNORECASE)
    if m:
        pct = m.group(1).replace("-", "−")
        if not pct.startswith(("−", "+")):
            pct = f"−{pct}"
        return f"{pct}% rabatt"

    if re.search(r"\bfast\s+sommerpris\b", text, re.IGNORECASE):
        return "Fast sommerpris"

    if re.search(r"\btilbud\b", text, re.IGNORECASE):
        return "Tilbud"

    m = re.search(r"ryddesalg[^%]{0,40}?[\-–−]\s*(\d+)\s*%", text, re.IGNORECASE)
    if m:
        return f"Ryddesalg −{m.group(1)}%"
    if re.search(r"\bryddesalg\b", text, re.IGNORECASE):
        return "Ryddesalg"

    return None


def normalize_promo_text(value):
    text = compact_text(value)
    if not text:
        return None

    canonical = canonicalize_promo(text)
    if canonical:
        return canonical

    if re.search(r'[\\"{}\[\]/]', text):
        return None

    lowered = text.lower()
    if not any(keyword in lowered for keyword in PROMO_KEYWORDS):
        return None
    if any(
        blocked in lowered
        for blocked in (
            "next_public_",
            "trumfid",
            "window.env",
            "chainid",
            "provider",
            "screen9",
            "api/auth",
            "login",
            "token",
            "rainforest_alliance",
            "fairtrade",
            "utz",
        )
    ):
        return None
    if len(text) > 80:
        return None
    text = re.sub(r"\s*[,;|]\s*", " · ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text[:120]


def has_active_promotion(product):
    """True if the product has at least one promotion whose date range covers today."""
    promotions = product.get("promotions") or []
    if not isinstance(promotions, list) or not promotions:
        return False
    now = datetime.now(timezone.utc)
    for promo in promotions:
        if not isinstance(promo, dict):
            continue
        from_str = promo.get("from") or promo.get("validFrom")
        to_str = promo.get("to") or promo.get("validTo")
        try:
            start = datetime.fromisoformat(from_str) if from_str else None
            end = datetime.fromisoformat(to_str) if to_str else None
        except (TypeError, ValueError):
            continue
        if start and end and start <= now <= end:
            return True
    return False


def merge_promo_labels(*parts):
    merged = []
    seen = set()
    for part in parts:
        normalized = normalize_promo_text(part)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(normalized)
    if not merged:
        return None
    return " · ".join(merged[:2])


def is_unscoped_bundle_campaign(text):
    normalized = normalize_promo_text(text)
    if not normalized:
        return False
    lowered = normalized.lower()
    return lowered in {"3 for 2", "2 for 1"} or bool(re.fullmatch(r"\d+\s+for\s+\d+", lowered))


def pagewide_promo_aliases(title, brand, url=None):
    slug = normalize_identity_text(url or "")
    title_norm = normalize_identity_text(title)
    brand_norm = normalize_identity_text(brand)
    aliases = set()

    if "cotw" in slug or "cotw" in title_norm or "cotw" in brand_norm:
        aliases.update({"cotw", "coffee of the world"})
    if "jacobs" in slug or "jacobs" in title_norm or "jacobs" in brand_norm:
        aliases.update({"jacobs", "jacobs utvalgte"})
    if "burn" in slug or "burn" in title_norm or "burn" in brand_norm:
        aliases.add("burn")

    return aliases


def should_fetch_live_without_score(product):
    haystack = " ".join(
        compact_text(value).lower()
        for value in (
            product.get("name"),
            product.get("brand"),
            product.get("url"),
        )
        if value
    )
    if not haystack:
        return False
    return any(keyword in haystack for keyword in NO_SCORE_LIVE_KEYWORDS)


def extract_campaign_text_from_offer(offer):
    if not isinstance(offer, dict):
        return None

    candidates = [
        offer.get("promoMarketTextLong"),
        offer.get("marketTextLong"),
        offer.get("promoMarketText"),
        offer.get("marketText"),
        offer.get("promotionDisplayName"),
        offer.get("name"),
        offer.get("description"),
        offer.get("category"),
    ]

    price_spec = offer.get("priceSpecification")
    if isinstance(price_spec, dict):
        candidates.extend(
            [
                price_spec.get("name"),
                price_spec.get("description"),
            ]
        )
    elif isinstance(price_spec, list):
        for spec in price_spec:
            if isinstance(spec, dict):
                candidates.extend(
                    [
                        spec.get("name"),
                        spec.get("description"),
                    ]
                )

    for candidate in candidates:
        promo = normalize_promo_text(candidate)
        if promo:
            return promo
    return None


def extract_campaign_text_from_product(product):
    if not isinstance(product, dict):
        return None

    priority_candidates = [
        product.get("campaign_text"),
        product.get("campaignText"),
        product.get("promoMarketTextLong"),
        product.get("marketTextLong"),
        product.get("promotionDisplayName"),
        product.get("promoMarketText"),
        product.get("marketText"),
        product.get("promoName"),
        product.get("offerDescription"),
        product.get("description"),
        product.get("name"),
    ]
    for candidate in priority_candidates:
        promo = normalize_promo_text(candidate)
        if promo:
            return promo

    for candidate in product_string_candidates(product):
        promo = normalize_promo_text(candidate)
        if promo:
            return promo
    return None


def extract_campaign_text_from_page_state(html, url=None):
    """Pull the promo label associated with our EAN from the Next.js page state.

    Meny embeds product data as escaped JSON inside __next_f streaming chunks,
    so the field name appears as ``\\"promoMarketTextLong\\"`` rather than
    ``"promoMarketTextLong"``. We try EAN-anchored matches first to avoid
    picking up an unrelated promo from a sidebar/menu.
    """
    ean = None
    if url:
        match = re.search(r"(\d{8,14})(?:/?$)", url)
        if match:
            ean = match.group(1)

    search_scopes = [html]
    if ean:
        scoped = []
        for pattern in [rf'\\"ean\\":\\"{re.escape(ean)}\\"', rf'"ean":"{re.escape(ean)}"']:
            for match in re.finditer(pattern, html):
                start = max(0, match.start() - 1500)
                end = min(len(html), match.end() + 6000)
                scoped.append(html[start:end])
        if scoped:
            search_scopes = scoped

    promo_fields = (
        "promoMarketTextLong",
        "marketTextLong",
        "promoMarketText",
        "marketText",
        "promotionDisplayName",
        "campaignText",
        "campaign_text",
        "offerDescription",
        "offerText",
        "promoName",
    )

    local_patterns = []
    for field in promo_fields:
        local_patterns.extend(
            [
                rf'\\"{field}\\":\\"([^\\]+)\\"',
                rf'"{field}":"([^"]+)"',
            ]
        )

    for scope in search_scopes:
        for pattern in local_patterns:
            for raw_value in re.findall(pattern, scope, re.IGNORECASE | re.DOTALL):
                promo = normalize_promo_text(decode_json_string(raw_value))
                if promo:
                    return promo

    return None


def extract_pagewide_campaign_text(html, title, brand, url=None):
    aliases = pagewide_promo_aliases(title, brand, url)
    if not aliases:
        return None

    promo_fields = (
        "promoMarketTextLong",
        "marketTextLong",
        "promoMarketText",
        "marketText",
        "promotionDisplayName",
        "promoName",
    )

    found = []
    for field in promo_fields:
        for pattern in [rf'\\"{field}\\":\\"([^\\]+)\\"', rf'"{field}":"([^"]+)"']:
            for raw_value in re.findall(pattern, html, re.IGNORECASE | re.DOTALL):
                decoded = decode_json_string(raw_value)
                normalized = normalize_identity_text(decoded)
                if not normalized:
                    continue
                if any(alias and alias in normalized for alias in aliases):
                    found.append(decoded)

    cleaned = []
    seen = set()
    for value in found:
        promo = normalize_promo_text(value)
        if not promo:
            continue
        key = promo.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(promo)

    if not cleaned:
        return None

    cleaned.sort(key=lambda value: (len(value), "plukk" in value.lower(), "for 2" in value.lower()), reverse=True)
    return cleaned[0]


def extract_price_from_page_state(html, url=None):
    ean = None
    if url:
        match = re.search(r"(\d{8,14})(?:/?$)", url)
        if match:
            ean = match.group(1)

    price_fields = ("pricePerUnit", "calcPricePerUnit", "promoCalcPricePerUnit")
    patterns = []
    if ean:
        for field in price_fields:
            patterns.extend(
                [
                    rf'\\"ean\\":\\"{re.escape(ean)}\\".{{0,15000}}?\\"{field}\\":([0-9]+(?:\.[0-9]+)?)',
                    rf'\\"{field}\\":([0-9]+(?:\.[0-9]+)?).{{0,15000}}?\\"ean\\":\\"{re.escape(ean)}\\"',
                    rf'"ean":"{re.escape(ean)}".{{0,15000}}?"{field}":([0-9]+(?:\.[0-9]+)?)',
                    rf'"{field}":([0-9]+(?:\.[0-9]+)?).{{0,15000}}?"ean":"{re.escape(ean)}"',
                ]
            )

    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                pass

    meta_patterns = [
        r"hos MENY -\s*([0-9]+(?:[,.][0-9]+)?)\s*kr",
        r'"price"\s*:\s*"([0-9]+(?:[,.][0-9]+)?)"',
    ]
    for pattern in meta_patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1).replace(",", "."))
            except ValueError:
                pass
    return None


def extract_meny_live_data(html, url=None):
    match = re.search(
        r'<script id="jsonLD" type="application/ld\+json">(.+?)</script>',
        html,
        re.DOTALL,
    )
    offer = {}
    price = None
    if match:
        payload = json.loads(match.group(1))
        offers = payload.get("offers") or {}
        if isinstance(offers, list):
          offer_list = [offer for offer in offers if isinstance(offer, dict)]
        elif isinstance(offers, dict):
          offer_list = [offers]
        else:
          offer_list = []
        offer = offer_list[0] if offer_list else {}
        price = offer.get("price")

    if price in (None, ""):
        price = extract_price_from_page_state(html, url)
    if price in (None, ""):
        return None

    title = offer.get("name") or ""
    brand = ""
    if not title and match:
        try:
            payload = json.loads(match.group(1))
            title = payload.get("name") or ""
            brand = ((payload.get("brand") or {}).get("name") if isinstance(payload.get("brand"), dict) else "") or ""
        except Exception:
            pass

    return {
        "price": float(str(price).replace(",", ".")),
        "campaign_text": extract_campaign_text_from_offer(offer)
        or extract_campaign_text_from_page_state(html, url),
        "fallback_campaign_text": extract_pagewide_campaign_text(html, title, brand, url),
    }


def normalize_meny_product_url(url):
    if not url:
        return None
    override = MENY_URL_OVERRIDES_BY_EAN.get(extract_ean(url))
    if override:
        return override
    parts = urlsplit(url)
    path = parts.path or ""
    if "/Varer/" in path:
        path = path.replace("/Varer/", "/varer/")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def fetch_live_meny_price(session, url):
    if not url or "meny.no" not in url.lower():
        return None
    normalized_url = normalize_meny_product_url(url)
    try:
        response = session.get(normalized_url, timeout=30)
        response.raise_for_status()
        return extract_meny_live_data(response.text, normalized_url)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 404:
            return DEAD_SLUG
        print(f"  live-pris feilet for {normalized_url}: {exc}")
        return None
    except Exception as exc:
        print(f"  live-pris feilet for {normalized_url}: {exc}")
        return None


def delete_dead_slugs_from_supabase(eans):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return
    if not eans:
        return
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    ean_list = list(eans)
    deleted = 0
    BATCH = 200
    for i in range(0, len(ean_list), BATCH):
        chunk = ean_list[i : i + BATCH]
        url = f"{SUPABASE_URL}/rest/v1/meny_products?ean=in.({','.join(chunk)})"
        r = requests.delete(url, headers=headers, timeout=30)
        if r.ok:
            deleted += len(chunk)
        else:
            print(f"Feil ved sletting av dead slugs (batch {i}-{i+len(chunk)}): {r.status_code}: {r.text}")
            return
    print(f"Slettet {deleted} dead-slug-rad(er) fra Supabase.")


def prune_stale_rows_from_supabase(keep_eans):
    """Delete Supabase rows whose EAN is not in keep_eans (no longer in fresh push)."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    existing = []
    offset = 0
    PAGE = 1000
    while True:
        url = f"{SUPABASE_URL}/rest/v1/meny_products?select=ean&offset={offset}&limit={PAGE}"
        r = requests.get(url, headers=headers, timeout=30)
        if not r.ok:
            print(f"Klarte ikke hente eksisterende EAN-er fra Supabase: {r.status_code}: {r.text}")
            return
        page = r.json()
        existing.extend(row["ean"] for row in page if row.get("ean"))
        if len(page) < PAGE:
            break
        offset += PAGE
    keep_set = set(keep_eans)
    stale = [e for e in existing if e not in keep_set]
    if not stale:
        print("Ingen stale Supabase-rader å rydde.")
        return
    deleted = 0
    BATCH = 200
    for i in range(0, len(stale), BATCH):
        chunk = stale[i : i + BATCH]
        url = f"{SUPABASE_URL}/rest/v1/meny_products?ean=in.({','.join(chunk)})"
        r = requests.delete(url, headers=headers, timeout=30)
        if r.ok:
            deleted += len(chunk)
        else:
            print(f"Feil ved pruning av stale rader (batch {i}-{i+len(chunk)}): {r.status_code}: {r.text}")
            return
    print(f"Ryddet {deleted} stale rad(er) fra Supabase (EAN ikke lenger i katalog/dealsett).")


def push_to_supabase(rows):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ikke satt — hopper over push.")
        return

    base_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{SUPABASE_URL}/rest/v1/meny_products"

    if not rows:
        print("Ingen verifiserbare rader å pushe. Tabellen ble tømt.")
        return

    headers = {
        **base_headers,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    pushed = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i : i + 500]
        r = requests.post(url, headers=headers, json=chunk, timeout=30)
        if not r.ok:
            print(f"Supabase-feil {r.status_code}: {r.text}")
            r.raise_for_status()
        pushed += len(chunk)
    print(f"Pushet {pushed} rader til Supabase.")


def build_supabase_rows(products, histories, live_price_session, live_cache_by_ean=None, live_cache_rows=None, dead_slug_eans=None, dead_slug_records=None):
    rows = []
    live_cache_by_ean = live_cache_by_ean or {}
    live_cache_rows = live_cache_rows if live_cache_rows is not None else []
    dead_slug_eans = dead_slug_eans or set()
    dead_slug_records = dead_slug_records if dead_slug_records is not None else []
    stats = {
        "total_products": len(products),
        "total_histories": len(histories),
        "missing_base_price": 0,
        "missing_store_match": 0,
        "missing_score": 0,
        "missing_live_price": 0,
        "stale_meny_rows_skipped": 0,
        "pruned_not_on_meny": 0,
        "rows_built": 0,
        "live_cache_hits": 0,
        "live_fetches": 0,
        "no_score_live_fetches": 0,
        "no_score_live_skipped": 0,
        "dead_slug_skipped": 0,
        "dead_slug_new": 0,
    }
    total_live_fetches = 0
    sample_store_names = []
    sample_missing_store = []
    sample_missing_live = []
    total_products = len(products)
    no_score_live_fetches = 0
    # True when this run pulled a real Meny catalog/search/campaign response, so
    # absence from it is meaningful. False for pure incremental cache runs.
    catalog_enumerated = any(p.get("seen_in_catalog") for p in products)
    for index, product in enumerate(products, start=1):
        ean = product.get("ean")
        if not ean:
            continue
        history = histories.get(ean) or {}
        product_campaign_text = extract_campaign_text_from_product(product)
        base_price = product.get("current_price")
        product_url = product.get("url") or ""
        is_meny_url = "meny.no" in product_url.lower()
        if base_price is None:
            stats["missing_base_price"] += 1

        store_names = all_meny_store_names(history)
        for name in store_names:
            if len(sample_store_names) >= 5:
                break
            if name not in sample_store_names:
                sample_store_names.append(name)

        meny = meny_points(history)
        if not meny:
            stats["missing_store_match"] += 1
            if len(sample_missing_store) < 5:
                sample_missing_store.append(
                    {
                        "ean": ean,
                        "name": product.get("name") or "",
                        "stores": store_names[:5],
                    }
                )
        score = score_deal(meny) if meny else None
        if meny and not score:
            stats["missing_score"] += 1

        is_promo_candidate = bool(product.get("uses_promotion") or product_campaign_text)
        # Promo products need a fresh live fetch every run: the live cache may hold a stale
        # sale price from when the campaign was active, causing fake deals after the sale ends.
        live_data = None if is_promo_candidate else live_cache_by_ean.get(ean)
        attempted_live_fetch = False
        raw_live = None
        wants_live_without_score = (
            not score
            and not product_campaign_text
            and no_score_live_fetches < MAX_NO_SCORE_LIVE_FETCHES
            and should_fetch_live_without_score(product)
        )
        # Verify deal candidates with no price history so we catch dead Meny slugs
        # (e.g. seasonal promos like Påskeskum that vanish after the campaign ends).
        wants_live_for_promo = (
            not score
            and is_meny_url
            and is_promo_candidate
            and no_score_live_fetches < MAX_NO_SCORE_LIVE_FETCHES
        )
        needs_live_data = bool(score) or wants_live_without_score or wants_live_for_promo
        if live_data is not None:
            cached_campaign = merge_promo_labels(
                live_data.get("campaign_text"),
                live_data.get("fallback_campaign_text"),
            )
            if not cached_campaign:
                live_data = None
            elif is_unscoped_bundle_campaign(live_data.get("fallback_campaign_text")):
                live_data = None
        if not score and not product_campaign_text and not needs_live_data:
            stats["no_score_live_skipped"] += 1

        if needs_live_data:
            if live_data is not None:
                stats["live_cache_hits"] += 1
            elif ean in dead_slug_eans:
                stats["dead_slug_skipped"] += 1
                continue
            else:
                if MAX_TOTAL_LIVE_FETCHES > 0 and total_live_fetches >= MAX_TOTAL_LIVE_FETCHES:
                    needs_live_data = False
                    live_data = None
                else:
                    attempted_live_fetch = True
                    raw_live = fetch_live_meny_price(live_price_session, product.get("url"))
                    total_live_fetches += 1
                    stats["live_fetches"] += 1
                    if not score:
                        no_score_live_fetches += 1
                        stats["no_score_live_fetches"] += 1
                if raw_live is DEAD_SLUG:
                    stats["dead_slug_new"] += 1
                    dead_slug_records.append((ean, product.get("url"), int(time.time())))
                    continue
                live_data = raw_live
                if live_data is not None:
                    live_cache_rows.append(
                        (
                            ean,
                            float(live_data["price"]),
                            live_data.get("campaign_text"),
                            live_data.get("fallback_campaign_text"),
                            int(time.time()),
                        )
                    )
            live_price = live_data["price"] if live_data else None
            if live_price is None:
                stats["missing_live_price"] += 1
                if len(sample_missing_live) < 5:
                    sample_missing_live.append(
                        {
                            "ean": ean,
                            "name": product.get("name") or "",
                            "url": product.get("url"),
                        }
                    )

        else:
            live_price = None

        if attempted_live_fetch and live_data is None and is_meny_url:
            stats["stale_meny_rows_skipped"] += 1
            continue

        # When this run actually swept the Meny catalog, a product that the sweep
        # never returned — and that no live fetch confirmed alive — is a stale
        # leftover from the local cache. Drop it so prune_stale_rows_from_supabase
        # deletes its row instead of serving a frozen, long-dead price.
        if catalog_enumerated and not product.get("seen_in_catalog") and live_data is None:
            stats["pruned_not_on_meny"] = stats.get("pruned_not_on_meny", 0) + 1
            continue

        # Promo candidates without live verification can't be trusted as deals.
        # Keep the product (so it stays searchable / cart-addable), but strip the
        # catalog's potentially stale promo signals so it doesn't appear as a fake deal.
        # Exception: if the catalog promotion has explicit from/to dates that cover
        # today, the label is fresh enough to trust without a live fetch.
        if is_promo_candidate and live_data is None:
            if has_active_promotion(product):
                stats["unverified_promo_kept_by_dates"] = (
                    stats.get("unverified_promo_kept_by_dates", 0) + 1
                )
            else:
                stats["unverified_promo_skipped"] = stats.get("unverified_promo_skipped", 0) + 1
                product_campaign_text = None

        current_price = live_price if live_price is not None else base_price
        if current_price is None:
            continue
        price_f = float(current_price)
        if not (0.01 <= price_f <= 10_000):
            print(f"  hopper over {ean} ({product.get('name', '')!r}): urealistisk pris {current_price}")
            stats["rows_skipped_bad_price"] = stats.get("rows_skipped_bad_price", 0) + 1
            continue

        # Trust the live page as source of truth for the campaign label. Falling back to
        # product_campaign_text from the (possibly stale) catalog re-introduces fake deals
        # whenever a sale has ended but the catalog hasn't refreshed yet.
        if live_data is not None:
            campaign_text = merge_promo_labels(
                live_data.get("campaign_text"),
                live_data.get("fallback_campaign_text"),
            )
        else:
            campaign_text = product_campaign_text
        median_30d = score["median"] if score else None
        meny_original = product.get("original_price")
        # Only trust uses_promotion when a fresh live fetch confirmed today's price.
        # Otherwise the cached flag may reflect a sale that already ended.
        uses_promo = bool(product.get("uses_promotion")) and live_data is not None

        # Meny-first: bruk regulert førpris hvis kampanjeflagget og prisen faktisk er nede.
        # Ellers fall tilbake til 30-d median for stille prisreduksjoner.
        drop_pct = None
        original_price = None
        price_source = None
        if (
            uses_promo
            and meny_original is not None
            and meny_original > float(current_price)
        ):
            original_price = round(float(meny_original), 2)
            drop_pct = round((meny_original - float(current_price)) / meny_original * 100, 2)
            price_source = "meny"
        elif median_30d and median_30d > float(current_price):
            drop_pct = round((median_30d - float(current_price)) / median_30d * 100, 2)
            price_source = "median"

        history_points = sorted(
            [{"date": p["date"], "price": p["price"]} for p in meny_points(history) if p.get("date") and p.get("price") is not None],
            key=lambda p: p["date"],
        )[-30:]

        rows.append(
            {
                "ean": ean,
                "name": product.get("name") or "",
                "brand": product.get("brand"),
                "image_url": product.get("image"),
                "vendor_url": product.get("url"),
                "current_price": round(float(current_price), 2),
                "median_30d": median_30d,
                "original_price": original_price,
                "price_source": price_source,
                "drop_pct": drop_pct,
                "campaign_text": campaign_text,
                "price_history": history_points if history_points else None,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if index % 100 == 0 or index == total_products:
            print(f"  bygger rader {index}/{total_products}", end="\r")
    stats["rows_built"] = len(rows)
    print(" " * 60, end="\r")
    return rows, stats, sample_store_names, sample_missing_store, sample_missing_live


def main():
    live_price_session = meny_session()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    print("Bruker historikkilde: lokal Meny-historikk")
    print(f"Kjører modus: {'inkrementell' if INCREMENTAL_MODE else 'full'}")
    if INCREMENTAL_MODE:
        products = load_cached_products(conn, PRODUCT_CACHE_MAX_AGE_HOURS)
        if products:
            products_with_base_price = sum(1 for product in products if product.get("current_price") is not None)
            if products_with_base_price == 0:
                print("Produktcache mangler current_price — bygger Meny-katalog på nytt")
                products = fetch_products()
            else:
                print(
                    f"Bruker lokal produktcache ({len(products)} varer, {products_with_base_price} med grunnpris, maks {PRODUCT_CACHE_MAX_AGE_HOURS} t gammel)"
                )
        else:
            stale_products = load_cached_products(conn, 24 * 365 * 10)
            if stale_products:
                print(
                    f"Ingen fersk produktcache funnet — gjenbruker {len(stale_products)} eldre varer som seed og oppdaterer fra Meny"
                )
            else:
                print("Ingen lokal produktcache funnet — bygger Meny-katalog fra søk og kampanjer")
            products = fetch_products(seed_products=stale_products)
    else:
        print("Bygger Meny-katalog fra søk og kampanjer...")
        products = fetch_products(seed_products=load_cached_products(conn, 24 * 365 * 10))
    print(f"  fikk {len(products)}")

    eans = []
    now = int(time.time())
    for p in products:
        ean = p.get("ean")
        if not ean:
            continue
        eans.append(ean)
        conn.execute(
            "INSERT OR REPLACE INTO products(ean,name,brand,image_url,vendor_url,current_price,original_price,uses_promotion,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                ean,
                p.get("name"),
                p.get("brand"),
                p.get("image"),
                p.get("url"),
                p.get("current_price"),
                p.get("original_price"),
                1 if p.get("uses_promotion") else 0,
                now,
            ),
        )
    conn.commit()

    today = time.strftime("%Y-%m-%d")
    cached_histories, _fresh_history_eans = load_cached_histories(conn, eans, today)
    histories = dict(cached_histories)
    if cached_histories:
        print(f"Gjenbruker lokal historikk for {len(cached_histories)}/{len(eans)} varer")
    else:
        print("Ingen lokal historikk funnet ennå — bygger opp baseline fra dagens og fremtidige kjøringer")
    live_cache_by_ean = load_live_cache(conn, LIVE_CACHE_TTL_HOURS) if INCREMENTAL_MODE else {}
    live_cache_rows = []
    dead_slug_eans = load_dead_slugs(conn, DEAD_SLUG_TTL_DAYS)
    dead_slug_records = []

    rows, stats, sample_store_names, sample_missing_store, sample_missing_live = build_supabase_rows(
        products,
        histories,
        live_price_session,
        live_cache_by_ean=live_cache_by_ean,
        live_cache_rows=live_cache_rows,
        dead_slug_eans=dead_slug_eans,
        dead_slug_records=dead_slug_records,
    )
    persist_live_cache(conn, live_cache_rows)
    persist_dead_slugs(conn, dead_slug_records)
    persist_local_price_history(conn, rows, today)
    conn.close()

    all_dead_eans = {ean for ean, _, _ in dead_slug_records} | dead_slug_eans

    print("\nDebug:")
    print(f"  Produkter i katalogsync: {stats['total_products']}")
    print(f"  Historier mottatt: {stats['total_histories']}")
    print(f"  Live-cache treff: {stats['live_cache_hits']}")
    print(f"  Live-priser hentet fra Meny: {stats['live_fetches']}")
    print(f"  Live-hentinger uten historikkscore: {stats['no_score_live_fetches']}")
    print(f"  Varer uten score hoppet over for live-oppslag: {stats['no_score_live_skipped']}")
    print(f"  Mangler grunnpris: {stats['missing_base_price']}")
    print(f"  Ingen historikkmatch for Meny-historikk: {stats['missing_store_match']}")
    print(f"  For lite historikk / ingen score: {stats['missing_score']}")
    print(f"  Mangler live-pris fra Meny: {stats['missing_live_price']}")
    print(f"  Skippet stale Meny-rader med død produktside: {stats['stale_meny_rows_skipped']}")
    print(f"  Droppet (ikke funnet i Meny-katalogsweep): {stats['pruned_not_on_meny']}")
    print(f"  Promo-kandidater uten live-verifisering (hoppet over): {stats.get('unverified_promo_skipped', 0)}")
    print(f"  Utgåtte slugger funnet (ny 404, cachet {DEAD_SLUG_TTL_DAYS}d): {stats['dead_slug_new']}")
    print(f"  Utgåtte slugger hoppet over (fra cache): {stats['dead_slug_skipped']}")
    print(f"  Ferdige rader: {stats['rows_built']}")
    if stats["rows_built"] < MIN_EXPECTED_ROWS:
        print(
            f"  ADVARSEL: Bare {stats['rows_built']} rader ble bygget, som er lavere enn forventet minimum {MIN_EXPECTED_ROWS}."
        )
        print(
            "  Dette tyder ofte på svak katalogcache, manglende grunnpriser eller for lite lokal historikk ennå."
        )
    if sample_store_names:
        print("  Eksempel på Meny-butikknavn i historikken:")
        for name in sample_store_names:
            print(f"    - {name}")
    if sample_missing_store:
        print("  Eksempler uten butikkmatch:")
        for item in sample_missing_store:
            stores = ", ".join(item["stores"]) if item["stores"] else "ingen Meny-butikker i historikk"
            print(f"    - {item['name']} ({item['ean']}): {stores}")
    if sample_missing_live:
        print("  Eksempler uten live-pris:")
        for item in sample_missing_live:
            print(f"    - {item['name']} ({item['ean']}): {item['url']}")

    deals = sorted(
        (r for r in rows if r["drop_pct"] is not None),
        key=lambda r: r["drop_pct"],
        reverse=True,
    )
    print(f"\nTopp tilbud (Meny førpris > median fallback):")
    for r in deals[:20]:
        if r.get("price_source") == "meny":
            baseline = f"førpris {r['original_price']:>7.2f}"
        elif r["median_30d"] is not None:
            baseline = f"median  {r['median_30d']:>7.2f}"
        else:
            baseline = "uten baseline"
        print(
            f"  -{r['drop_pct']:5.1f}%  {r['current_price']:>7.2f} kr  "
            f"({baseline})  {r['name']}"
        )
    if not deals:
        print("  (ingen — utvid sample, eller sjekk API-respons)")

    push_to_supabase(rows)
    delete_dead_slugs_from_supabase(all_dead_eans)
    prune_stale_rows_from_supabase({r["ean"] for r in rows})


if __name__ == "__main__":
    main()
