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

import os
import sqlite3
import sys
import time
from pathlib import Path
from statistics import median

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

API_BASE = "https://kassal.app/api/v1"
API_KEY = os.environ.get("KASSALAPP_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

DB_PATH = Path(__file__).parent / "deals.db"

PRODUCT_SAMPLE_SIZE = int(os.environ.get("PRODUCT_SAMPLE_SIZE", "200"))
HISTORY_DAYS = 30
RATE_LIMIT_SLEEP = 1.1  # Hobby-tier: 60 req/min
MENY_MATCH = "meny"     # case-insensitive substring on store name

# Kassalapps /products paginerer alfabetisk og de første ~5000 er babymat.
# Vi sampler i stedet via søk på vanlige dagligvarer for å få et representativt
# utvalg. Hvert søk henter inntil PER_QUERY produkter; resultatet dedupliseres
# på EAN.
SEARCH_QUERIES = [
    # Meieri & egg
    "melk", "yoghurt", "fløte", "egg", "rømme", "kefir", "kvarg",
    # Brød & korn
    "brød", "knekkebrød", "rundstykker", "havregryn", "müsli", "frokostblanding",
    # Ost & pålegg
    "ost", "smør", "leverpostei", "kaviar", "majones", "syltetøy", "honning",
    "nugatti", "peanøttsmør",
    # Kjøtt & fisk
    "kjøtt", "kylling", "kjøttdeig", "biff", "svin", "lam", "fisk", "laks",
    "torsk", "reker", "pølse", "bacon", "skinke",
    # Frukt & grønt
    "frukt", "eple", "banan", "appelsin", "drue", "jordbær", "blåbær",
    "tomat", "agurk", "salat", "potet", "løk", "gulrot", "paprika", "brokkoli",
    # Drikke
    "brus", "cola", "kaffe", "kakao", "juice", "saft", "vann", "pils",
    # Tørrvarer
    "ris", "pasta", "spaghetti", "mel", "sukker", "salt", "olje", "krydder",
    # Frossen
    "frosset", "pizza", "lasagne", "taco", "iskrem", "tortillalefser",
    # Snacks & søtt
    "sjokolade", "kjeks", "godteri", "chips", "kake", "sjampinjong", "nøtter",
    # Husholdning
    "papir", "tørkerull", "vaskemiddel", "såpe", "tannkrem", "sjampo",
]
PER_QUERY = int(os.environ.get("PER_QUERY", "30"))


def kassal_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {API_KEY}"})
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


def fetch_products(s, target):
    out = []
    seen = set()
    for q in SEARCH_QUERIES:
        if len(out) >= target:
            break
        if len(q) < 3:
            continue  # Kassalapp krever min 3 tegn på search
        r = s.get(
            f"{API_BASE}/products",
            params={"search": q, "size": PER_QUERY, "page": 1},
        )
        if not r.ok:
            print(f"  [{q!r}] {r.status_code}: {r.text[:120]} — hopper over")
            time.sleep(RATE_LIMIT_SLEEP)
            continue
        batch = r.json().get("data") or []
        added = 0
        for p in batch:
            ean = p.get("ean")
            if not ean or ean in seen:
                continue
            seen.add(ean)
            out.append(p)
            added += 1
            if len(out) >= target:
                break
        print(f"  [{q!r}] +{added} (total {len(out)})")
        time.sleep(RATE_LIMIT_SLEEP)
    return out


def fetch_prices_bulk(s, eans):
    histories = {}
    for i in range(0, len(eans), 100):
        chunk = eans[i : i + 100]
        r = s.post(
            f"{API_BASE}/products/prices-bulk",
            json={"eans": chunk, "days": HISTORY_DAYS},
        )
        r.raise_for_status()
        payload = r.json().get("data") or {}
        if isinstance(payload, list):
            for item in payload:
                ean = item.get("ean")
                if ean:
                    histories[ean] = item
        elif isinstance(payload, dict):
            histories.update(payload)
        time.sleep(RATE_LIMIT_SLEEP)
    return histories


def meny_points(history):
    points = (
        history.get("price_history")
        or history.get("prices")
        or history.get("history")
        or []
    )
    return [
        p for p in points
        if MENY_MATCH in (p.get("store") or p.get("store_name") or "").lower()
    ]


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


def push_to_supabase(rows):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ikke satt — hopper over push.")
        return
    if not rows:
        print("Ingen rader å pushe.")
        return

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{SUPABASE_URL}/rest/v1/meny_products"
    pushed = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i : i + 500]
        r = requests.post(url, headers=headers, json=chunk, timeout=30)
        if not r.ok:
            print(f"Supabase-feil {r.status_code}: {r.text}")
            r.raise_for_status()
        pushed += len(chunk)
    print(f"Pushet {pushed} rader til Supabase.")


def build_supabase_rows(products, histories):
    by_ean = {p.get("ean"): p for p in products if p.get("ean")}
    rows = []
    for ean, history in histories.items():
        meny = meny_points(history)
        if not meny:
            continue
        latest = max(meny, key=lambda p: p.get("date", ""))
        latest_price = latest.get("price")
        if latest_price is None:
            continue
        score = score_deal(meny)
        product = by_ean.get(ean, {})
        rows.append(
            {
                "ean": ean,
                "name": product.get("name") or "",
                "brand": product.get("brand"),
                "image_url": product.get("image"),
                "vendor_url": product.get("url"),
                "current_price": latest_price,
                "median_30d": score["median"] if score else None,
                "drop_pct": round(score["drop_pct"], 2) if score else None,
            }
        )
    return rows


def main():
    if not API_KEY:
        sys.exit("Sett KASSALAPP_API_KEY i miljøet.")

    s = kassal_session()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    print(f"Henter opp til {PRODUCT_SAMPLE_SIZE} produkter...")
    products = fetch_products(s, PRODUCT_SAMPLE_SIZE)
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

    rows = build_supabase_rows(products, histories)

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
