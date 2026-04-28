#!/usr/bin/env python3
"""
Henter Meny-priser via Kassalapp, regner ut prisfall mot 30-dagers median,
og dytter resultatet til Supabase-tabellen `meny_products`.

Bruk:
    export KASSALAPP_API_KEY=...
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
from concurrent.futures import ThreadPoolExecutor, as_completed
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

API_BASE = "https://kassal.app/api/v1"
API_KEY = os.environ.get("KASSALAPP_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

DB_PATH = SCRIPT_DIR / "deals.db"

PRODUCT_SAMPLE_SIZE = int(os.environ.get("PRODUCT_SAMPLE_SIZE", "1000"))
HISTORY_DAYS = 30
RATE_LIMIT_SLEEP = 1.1  # Hobby-tier: 60 req/min
MENY_HISTORY_STORE = "MENY_NO"
CATALOG_PAGE_SIZE = 100
MAX_CATALOG_PAGES = int(os.environ.get("MAX_CATALOG_PAGES", "250"))
PRODUCT_LIMIT = int(os.environ.get("PRODUCT_LIMIT", "0"))
PRICE_HISTORY_CHUNK_SIZE = int(os.environ.get("PRICE_HISTORY_CHUNK_SIZE", "100"))
PRICE_HISTORY_WORKERS = int(os.environ.get("PRICE_HISTORY_WORKERS", "2"))
MAX_EMPTY_PAGES_WITHOUT_NEW = int(os.environ.get("MAX_EMPTY_PAGES_WITHOUT_NEW", "20"))
SEARCH_SUPPLEMENTS = flattened_search_supplements()
PRODUCT_CACHE_MAX_AGE_HOURS = int(os.environ.get("PRODUCT_CACHE_MAX_AGE_HOURS", "12"))
LIVE_CACHE_TTL_HOURS = int(os.environ.get("LIVE_CACHE_TTL_HOURS", "6"))
INCREMENTAL_MODE = os.environ.get("FIND_DEALS_MODE", "incremental").lower() != "full"
PRICE_HISTORY_MAX_RETRIES = int(os.environ.get("PRICE_HISTORY_MAX_RETRIES", "6"))
PRICE_HISTORY_RETRY_BASE_SECONDS = float(os.environ.get("PRICE_HISTORY_RETRY_BASE_SECONDS", "3"))
MIN_EXPECTED_ROWS = int(os.environ.get("MIN_EXPECTED_ROWS", "2000"))
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


def kassal_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {API_KEY}"})
    return s


def meny_session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; MelkOgBrod/1.0; +https://meny.no)",
            "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
        }
    )
    return s


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
            fetched_at    INTEGER
        );
        """
    )
    try:
        conn.execute("ALTER TABLE products ADD COLUMN current_price REAL")
    except sqlite3.OperationalError:
        pass


def load_cached_products(conn, max_age_hours):
    freshest_allowed = int(time.time() - max_age_hours * 60 * 60)
    rows = conn.execute(
        """
        SELECT ean, name, brand, image_url, vendor_url, current_price, fetched_at
        FROM products
        WHERE fetched_at >= ?
        """,
        (freshest_allowed,),
    ).fetchall()
    products = []
    for ean, name, brand, image_url, vendor_url, current_price, fetched_at in rows:
        products.append(
            {
                "ean": ean,
                "name": name,
                "brand": brand,
                "image": image_url,
                "url": vendor_url,
                "current_price": current_price,
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
        SELECT ean, current_price, campaign_text, fetched_at
        FROM live_cache
        WHERE fetched_at >= ?
        """,
        (freshest_allowed,),
    ).fetchall()
    return {
        ean: {
            "price": current_price,
            "campaign_text": campaign_text,
            "fetched_at": fetched_at,
        }
        for ean, current_price, campaign_text, fetched_at in rows
    }


def persist_live_cache(conn, live_rows):
    if not live_rows:
        return
    conn.executemany(
        """
        INSERT OR REPLACE INTO live_cache (ean, current_price, campaign_text, fetched_at)
        VALUES (?, ?, ?, ?)
        """,
        live_rows,
    )
    conn.commit()


def product_priority(product):
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
    store = (product.get("store") or {}).get("code")
    ean = product.get("ean")
    return bool(ean) and ("meny.no" in url or store == MENY_HISTORY_STORE)


def merge_product(by_ean, product):
    ean = product.get("ean")
    if not ean or not is_meny_product(product):
        return False
    current = by_ean.get(ean)
    if current is None:
        by_ean[ean] = product
        return True
    if product_priority(product) > product_priority(current):
        by_ean[ean] = product
    return False


def fetch_products(s):
    by_ean = {}
    pages_with_no_new = 0
    for page in range(1, MAX_CATALOG_PAGES + 1):
        r = s.get(
            f"{API_BASE}/products",
            params={"page": page, "size": CATALOG_PAGE_SIZE},
        )
        if not r.ok:
            print(f"  [page {page}] {r.status_code}: {r.text[:120]} — stopper")
            break
        payload = r.json()
        batch = payload.get("data") or []
        if not batch:
            print(f"  [page {page}] tom side — ferdig")
            break

        added = 0
        for p in batch:
            if merge_product(by_ean, p):
                added += 1

        if added == 0:
            pages_with_no_new += 1
        else:
            pages_with_no_new = 0

        print(f"  [page {page}] +{added} Meny-varer (total {len(by_ean)})")

        if PRODUCT_LIMIT > 0 and len(by_ean) >= PRODUCT_LIMIT:
            print(f"  nådde PRODUCT_LIMIT={PRODUCT_LIMIT}")
            break
        if len(batch) < CATALOG_PAGE_SIZE:
            print(f"  [page {page}] siste side")
            break
        if pages_with_no_new >= MAX_EMPTY_PAGES_WITHOUT_NEW:
            print(
                f"  [page {page}] {MAX_EMPTY_PAGES_WITHOUT_NEW} sider uten nye Meny-varer — stopper"
            )
            time.sleep(RATE_LIMIT_SLEEP)
            break
        time.sleep(RATE_LIMIT_SLEEP)

    total_queries = sum(len(items) for items in SEARCH_SUPPLEMENT_GROUPS.values())
    query_index = 0
    print("Supplerer katalog med målrettede søk...")
    for group_name, queries in SEARCH_SUPPLEMENT_GROUPS.items():
        print(f"  Gruppe {group_name}: {len(queries)} søk")
        group_added = 0
        for query in queries:
            query_index += 1
            response = s.get(
                f"{API_BASE}/products",
                params={"search": query, "size": 100, "page": 1},
            )
            if not response.ok:
                print(f"    [{query_index}/{total_queries} {query!r}] {response.status_code}: {response.text[:120]} — hopper over")
                time.sleep(RATE_LIMIT_SLEEP)
                continue
            batch = response.json().get("data") or []
            added = 0
            for product in batch:
                if merge_product(by_ean, product):
                    added += 1
            group_added += added
            print(f"    [{query_index}/{total_queries} {query!r}] +{added} Meny-varer (total {len(by_ean)})")
            time.sleep(RATE_LIMIT_SLEEP)
        print(f"  Ferdig med {group_name}: +{group_added} nye varer")
    return list(by_ean.values())


def fetch_prices_bulk(s, eans):
    if not eans:
        return {}

    def fetch_chunk(chunk):
        attempt = 0
        while True:
            attempt += 1
            response = requests.post(
                f"{API_BASE}/products/prices-bulk",
                headers={"Authorization": f"Bearer {API_KEY}"},
                json={"eans": chunk, "days": HISTORY_DAYS, "aggregation": "avg"},
                timeout=30,
            )
            if response.ok:
                return response.json().get("data") or {}

            if response.status_code == 429 and attempt < PRICE_HISTORY_MAX_RETRIES:
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        wait_seconds = max(float(retry_after), PRICE_HISTORY_RETRY_BASE_SECONDS)
                    except ValueError:
                        wait_seconds = PRICE_HISTORY_RETRY_BASE_SECONDS * attempt
                else:
                    wait_seconds = PRICE_HISTORY_RETRY_BASE_SECONDS * attempt
                print(
                    f"  historikk 429 for chunk på {len(chunk)} EAN-er, venter {wait_seconds:.1f}s (forsøk {attempt}/{PRICE_HISTORY_MAX_RETRIES})"
                )
                time.sleep(wait_seconds)
                continue

            response.raise_for_status()

    chunks = [eans[i : i + PRICE_HISTORY_CHUNK_SIZE] for i in range(0, len(eans), PRICE_HISTORY_CHUNK_SIZE)]
    histories = {}
    with ThreadPoolExecutor(max_workers=max(1, PRICE_HISTORY_WORKERS)) as executor:
        futures = {executor.submit(fetch_chunk, chunk): chunk for chunk in chunks}
        for future in as_completed(futures):
            payload = future.result()
            chunk = futures[future]
            if isinstance(payload, list):
                for item in payload:
                    ean = item.get("ean")
                    if ean:
                        histories[ean] = item
            elif isinstance(payload, dict):
                histories.update(payload)
            print(f"  historikk {min(len(histories), len(eans))}/{len(eans)}", end="\r")
            sys.stdout.flush()
    print(" " * 40, end="\r")
    return histories


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
        if store_name != MENY_HISTORY_STORE:
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


def score_deal(meny_history):
    if len(meny_history) < 3:
        return None
    sorted_by_date = sorted(meny_history, key=lambda p: p.get("date", ""))
    today = sorted_by_date[-1]
    today_price = today.get("price")
    baseline = median(p["price"] for p in sorted_by_date[:-1] if p.get("price"))
    if not today_price or not baseline or baseline == 0:
        return None
    return {
        "today_price": today_price,
        "median": baseline,
        "drop_pct": (baseline - today_price) / baseline * 100,
    }


def compact_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


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
        ctx = re.match(r"\s*p[åa]\s+([a-zæøå]+(?:\s+[a-zæøå]+)?)", rest, re.IGNORECASE)
        if ctx:
            return f"{n} for {k} på {ctx.group(1).strip().lower()}"
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
        )
    ):
        return None
    if len(text) > 80:
        return None
    text = re.sub(r"\s*[,;|]\s*", " · ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text[:120]


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
    return {
        "price": float(str(price).replace(",", ".")),
        "campaign_text": extract_campaign_text_from_offer(offer)
        or extract_campaign_text_from_page_state(html, url),
    }


def normalize_meny_product_url(url):
    if not url:
        return None
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
            print(f"  live-pris mangler på Meny (utgått slug): {normalized_url}")
            return None
        print(f"  live-pris feilet for {normalized_url}: {exc}")
        return None
    except Exception as exc:
        print(f"  live-pris feilet for {normalized_url}: {exc}")
        return None


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

    delete_headers = {
        **base_headers,
        "Prefer": "return=minimal",
    }
    delete_response = requests.delete(
        url,
        headers=delete_headers,
        params={"ean": "not.is.null"},
        timeout=30,
    )
    if not delete_response.ok:
        print(f"Supabase-slettefeil {delete_response.status_code}: {delete_response.text}")
        delete_response.raise_for_status()

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


def build_supabase_rows(products, histories, live_price_session, live_cache_by_ean=None, live_cache_rows=None):
    rows = []
    live_cache_by_ean = live_cache_by_ean or {}
    live_cache_rows = live_cache_rows if live_cache_rows is not None else []
    stats = {
        "total_products": len(products),
        "total_histories": len(histories),
        "missing_base_price": 0,
        "missing_store_match": 0,
        "missing_score": 0,
        "missing_live_price": 0,
        "rows_built": 0,
        "live_cache_hits": 0,
        "live_fetches": 0,
    }
    sample_store_names = []
    sample_missing_store = []
    sample_missing_live = []
    total_products = len(products)
    for index, product in enumerate(products, start=1):
        ean = product.get("ean")
        if not ean:
            continue
        history = histories.get(ean) or {}
        base_price = product.get("current_price")
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

        live_data = None
        if score:
            live_data = live_cache_by_ean.get(ean)
            if live_data is not None:
                stats["live_cache_hits"] += 1
            else:
                live_data = fetch_live_meny_price(live_price_session, product.get("url"))
                stats["live_fetches"] += 1
                if live_data is not None:
                    live_cache_rows.append(
                        (
                            ean,
                            float(live_data["price"]),
                            live_data.get("campaign_text"),
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

        current_price = live_price if live_price is not None else base_price
        if current_price is None:
            continue

        campaign_text = merge_promo_labels(
            (live_data or {}).get("campaign_text"),
            extract_campaign_text_from_product(product),
        )
        drop_pct = None
        median_30d = None
        if score and current_price is not None:
            median_30d = score["median"]
            drop_pct = round((score["median"] - float(current_price)) / score["median"] * 100, 2)
        rows.append(
            {
                "ean": ean,
                "name": product.get("name") or "",
                "brand": product.get("brand"),
                "image_url": product.get("image"),
                "vendor_url": product.get("url"),
                "current_price": round(float(current_price), 2),
                "median_30d": median_30d,
                "drop_pct": drop_pct,
                "campaign_text": campaign_text,
            }
        )
        if index % 100 == 0 or index == total_products:
            print(f"  bygger rader {index}/{total_products}", end="\r")
    stats["rows_built"] = len(rows)
    print(" " * 60, end="\r")
    return rows, stats, sample_store_names, sample_missing_store, sample_missing_live


def main():
    if not API_KEY:
        sys.exit("Sett KASSALAPP_API_KEY i miljøet.")

    s = kassal_session()
    live_price_session = meny_session()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    print(f"Bruker historikkilde: {MENY_HISTORY_STORE}")
    print(f"Kjører modus: {'inkrementell' if INCREMENTAL_MODE else 'full'}")
    if INCREMENTAL_MODE:
        products = load_cached_products(conn, PRODUCT_CACHE_MAX_AGE_HOURS)
        if products:
            products_with_base_price = sum(1 for product in products if product.get("current_price") is not None)
            if products_with_base_price == 0:
                print("Produktcache mangler current_price — gjør full katalogsync for å bygge opp ny cache")
                products = fetch_products(s)
            else:
                print(
                    f"Bruker lokal produktcache ({len(products)} varer, {products_with_base_price} med grunnpris, maks {PRODUCT_CACHE_MAX_AGE_HOURS} t gammel)"
                )
        else:
            print("Ingen fersk produktcache funnet — gjør full katalogsync")
            products = fetch_products(s)
    else:
        print("Synker Meny-katalog fra Kassalapp...")
        products = fetch_products(s)
    print(f"  fikk {len(products)}")

    eans = []
    now = int(time.time())
    for p in products:
        ean = p.get("ean")
        if not ean:
            continue
        eans.append(ean)
        conn.execute(
            "INSERT OR REPLACE INTO products(ean,name,brand,image_url,vendor_url,current_price,fetched_at) VALUES(?,?,?,?,?,?,?)",
            (ean, p.get("name"), p.get("brand"), p.get("image"), p.get("url"), p.get("current_price"), now),
        )
    conn.commit()

    today = time.strftime("%Y-%m-%d")
    cached_histories, fresh_history_eans = load_cached_histories(conn, eans, today)
    histories = dict(cached_histories)
    eans_needing_history = [ean for ean in eans if (not INCREMENTAL_MODE) or ean not in fresh_history_eans]

    print(
        f"Henter {HISTORY_DAYS}-dagers prishistorikk for {len(eans_needing_history)}/{len(eans)} EAN-er..."
    )
    if cached_histories:
        print(f"  gjenbruker lokal historikk for {len(fresh_history_eans)} EAN-er med dagens data")
    fetched_histories = fetch_prices_bulk(s, eans_needing_history) if eans_needing_history else {}
    histories.update(fetched_histories)

    for ean, history in fetched_histories.items():
        for p in meny_points(history):
            conn.execute(
                "INSERT OR REPLACE INTO prices(ean,store,date,price) VALUES(?,?,?,?)",
                (ean, p.get("store") or p.get("store_name"), p.get("date"), p.get("price")),
            )
    conn.commit()
    live_cache_by_ean = load_live_cache(conn, LIVE_CACHE_TTL_HOURS) if INCREMENTAL_MODE else {}
    live_cache_rows = []

    rows, stats, sample_store_names, sample_missing_store, sample_missing_live = build_supabase_rows(
        products,
        histories,
        live_price_session,
        live_cache_by_ean=live_cache_by_ean,
        live_cache_rows=live_cache_rows,
    )
    persist_live_cache(conn, live_cache_rows)
    conn.close()

    print("\nDebug:")
    print(f"  Produkter i katalogsync: {stats['total_products']}")
    print(f"  Historier mottatt: {stats['total_histories']}")
    print(f"  Live-cache treff: {stats['live_cache_hits']}")
    print(f"  Live-priser hentet fra Meny: {stats['live_fetches']}")
    print(f"  Mangler grunnpris: {stats['missing_base_price']}")
    print(f"  Ingen historikkmatch for {MENY_HISTORY_STORE}: {stats['missing_store_match']}")
    print(f"  For lite historikk / ingen score: {stats['missing_score']}")
    print(f"  Mangler live-pris fra Meny: {stats['missing_live_price']}")
    print(f"  Ferdige rader: {stats['rows_built']}")
    if stats["rows_built"] < MIN_EXPECTED_ROWS:
        print(
            f"  ADVARSEL: Bare {stats['rows_built']} rader ble bygget, som er lavere enn forventet minimum {MIN_EXPECTED_ROWS}."
        )
        print(
            "  Dette tyder ofte på svak katalogcache, manglende grunnpriser eller for få varer med Meny-historikk."
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
    print(f"\nTopp tilbud (i dag vs {HISTORY_DAYS}-dagers median på Meny):")
    for r in deals[:20]:
        print(
            f"  -{r['drop_pct']:5.1f}%  {r['current_price']:>7.2f} kr  "
            f"(median {r['median_30d']:>7.2f})  {r['name']}"
        )
    if not deals:
        print("  (ingen — utvid sample, eller sjekk API-respons)")

    push_to_supabase(rows)


if __name__ == "__main__":
    main()
