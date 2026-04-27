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

load_dotenv(Path(__file__).parent / ".env")

API_BASE = "https://kassal.app/api/v1"
API_KEY = os.environ.get("KASSALAPP_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

DB_PATH = Path(__file__).parent / "deals.db"

PRODUCT_SAMPLE_SIZE = int(os.environ.get("PRODUCT_SAMPLE_SIZE", "1000"))
HISTORY_DAYS = 30
RATE_LIMIT_SLEEP = 1.1  # Hobby-tier: 60 req/min
MENY_HISTORY_STORE = "MENY_NO"
CATALOG_PAGE_SIZE = 100
MAX_CATALOG_PAGES = int(os.environ.get("MAX_CATALOG_PAGES", "250"))
PRODUCT_LIMIT = int(os.environ.get("PRODUCT_LIMIT", "0"))
PRICE_HISTORY_CHUNK_SIZE = int(os.environ.get("PRICE_HISTORY_CHUNK_SIZE", "100"))
PRICE_HISTORY_WORKERS = int(os.environ.get("PRICE_HISTORY_WORKERS", "4"))
MAX_EMPTY_PAGES_WITHOUT_NEW = int(os.environ.get("MAX_EMPTY_PAGES_WITHOUT_NEW", "5"))
SEARCH_SUPPLEMENTS = [
    "egg",
    "10pk egg",
    "12pk egg",
    "bakketun egg",
    "frittgaende egg",
    "prior egg",
    "frokostegg",
    "melk",
    "tinemelk",
    "lettmelk",
    "helmelk",
    "skummetmelk",
    "q melk",
    "smør",
    "meierismør",
    "lettsmør",
    "lurpak",
    "brelett",
    "bremykt",
    "soyasmør",
    "ost",
    "norvegia",
    "jarlsberg",
    "gulost",
    "hvitost",
    "cheddar",
    "mozzarella",
    "brød",
    "grovbrød",
    "kneippbrød",
    "toastbrød",
    "burgerbrød",
    "rundstykker",
    "yoghurt",
    "skyr",
    "banan",
    "eple",
    "appelsin",
    "tomat",
    "agurk",
    "potet",
    "gulrot",
    "løk",
    "paprika",
    "salat",
    "kjøttdeig",
    "kylling",
    "kyllingfilet",
    "laks",
    "torsk",
    "pasta",
    "spagetti",
    "ris",
    "havregryn",
    "müsli",
    "frokostblanding",
    "juice",
    "appelsinjuice",
    "eplejuice",
    "kaffe",
    "filterkaffe",
    "te",
    "sukker",
    "salt",
    "mel",
    "hvetemel",
    "olje",
    "olivenolje",
]
PROMO_KEYWORDS = (
    "trumf",
    "bonus",
    "kjøp",
    "kjop",
    "betal",
    "for",
    "spar",
    "medlemspris",
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
            fetched_at  INTEGER
        );
        CREATE TABLE IF NOT EXISTS prices (
            ean         TEXT,
            store       TEXT,
            date        TEXT,
            price       REAL,
            PRIMARY KEY (ean, store, date)
        );
        """
    )


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

    print("Supplerer katalog med målrettede søk...")
    for query in SEARCH_SUPPLEMENTS:
        response = s.get(
            f"{API_BASE}/products",
            params={"search": query, "size": 100, "page": 1},
        )
        if not response.ok:
            print(f"  [søk {query!r}] {response.status_code}: {response.text[:120]} — hopper over")
            time.sleep(RATE_LIMIT_SLEEP)
            continue
        batch = response.json().get("data") or []
        added = 0
        for product in batch:
            if merge_product(by_ean, product):
                added += 1
        print(f"  [søk {query!r}] +{added} Meny-varer (total {len(by_ean)})")
        time.sleep(RATE_LIMIT_SLEEP)
    return list(by_ean.values())


def fetch_prices_bulk(s, eans):
    def fetch_chunk(chunk):
        response = requests.post(
            f"{API_BASE}/products/prices-bulk",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"eans": chunk, "days": HISTORY_DAYS, "aggregation": "avg"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("data") or {}

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


def normalize_promo_text(value):
    text = compact_text(value)
    if not text:
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


def extract_campaign_text_from_offer(offer):
    if not isinstance(offer, dict):
        return None

    candidates = [
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


def extract_meny_live_data(html):
    match = re.search(
        r'<script id="jsonLD" type="application/ld\+json">(.+?)</script>',
        html,
        re.DOTALL,
    )
    if not match:
        return None
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
        return None
    return {
        "price": float(str(price).replace(",", ".")),
        "campaign_text": extract_campaign_text_from_offer(offer),
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
        return extract_meny_live_data(response.text)
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


def build_supabase_rows(products, histories, live_price_session):
    rows = []
    stats = {
        "total_products": len(products),
        "total_histories": len(histories),
        "missing_base_price": 0,
        "missing_store_match": 0,
        "missing_score": 0,
        "missing_live_price": 0,
        "rows_built": 0,
    }
    sample_store_names = []
    sample_missing_store = []
    sample_missing_live = []
    for product in products:
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
            live_data = fetch_live_meny_price(live_price_session, product.get("url"))
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

        drop_pct = None
        median_30d = None
        if score and live_price is not None:
            median_30d = score["median"]
            drop_pct = round((score["median"] - live_price) / score["median"] * 100, 2)
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
                "campaign_text": (live_data or {}).get("campaign_text"),
            }
        )
    stats["rows_built"] = len(rows)
    return rows, stats, sample_store_names, sample_missing_store, sample_missing_live


def main():
    if not API_KEY:
        sys.exit("Sett KASSALAPP_API_KEY i miljøet.")

    s = kassal_session()
    live_price_session = meny_session()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    print(f"Bruker historikkilde: {MENY_HISTORY_STORE}")
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
            "INSERT OR REPLACE INTO products(ean,name,brand,image_url,vendor_url,fetched_at) VALUES(?,?,?,?,?,?)",
            (ean, p.get("name"), p.get("brand"), p.get("image"), p.get("url"), now),
        )
    conn.commit()

    print(f"Henter {HISTORY_DAYS}-dagers prishistorikk for {len(eans)} EAN-er...")
    histories = fetch_prices_bulk(s, eans)

    for ean, history in histories.items():
        for p in meny_points(history):
            conn.execute(
                "INSERT OR REPLACE INTO prices(ean,store,date,price) VALUES(?,?,?,?)",
                (ean, p.get("store") or p.get("store_name"), p.get("date"), p.get("price")),
            )
    conn.commit()
    conn.close()

    rows, stats, sample_store_names, sample_missing_store, sample_missing_live = build_supabase_rows(
        products, histories, live_price_session
    )

    print("\nDebug:")
    print(f"  Produkter i katalogsync: {stats['total_products']}")
    print(f"  Historier mottatt: {stats['total_histories']}")
    print(f"  Mangler grunnpris: {stats['missing_base_price']}")
    print(f"  Ingen historikkmatch for {MENY_HISTORY_STORE}: {stats['missing_store_match']}")
    print(f"  For lite historikk / ingen score: {stats['missing_score']}")
    print(f"  Mangler live-pris fra Meny: {stats['missing_live_price']}")
    print(f"  Ferdige rader: {stats['rows_built']}")
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
