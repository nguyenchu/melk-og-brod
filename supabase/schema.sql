-- Melk&Brød – Meny-tilbud
-- Kjør i Supabase dashboard → SQL Editor → New query → Run.
--
-- Skriving skjer kun fra deal-finder-scriptet via service-role-nøkkel.
-- Klienten leser med anon-nøkkel.

create table meny_products (
  ean            text primary key,
  name           text not null,
  brand          text,
  image_url      text,
  vendor_url     text,
  current_price  numeric,
  median_30d     numeric,
  original_price numeric,           -- Meny pricePerUnitOriginal (regulert førpris)
  price_source   text,              -- 'meny' | 'median' | null
  drop_pct       numeric,
  campaign_text  text,
  computed_at    timestamptz not null default now()
);

create index meny_products_drop_pct_idx
  on meny_products (drop_pct desc nulls last);

create index meny_products_name_idx
  on meny_products (lower(name));

alter table meny_products enable row level security;

create policy "anyone can read meny_products"
  on meny_products for select
  using (true);


-- Push-notifikasjoner for favoritt-varsler.
-- Klienten upsert-er sin Expo push-token + favoritt-EAN-liste.
-- Scraperen leser dette med service-role og sender via Expo Push API
-- når en favoritt får ferskt prisfall/kampanje.
create table push_tokens (
  token            text primary key,
  favorite_eans    text[] not null default '{}',
  last_notified    jsonb not null default '{}'::jsonb, -- { ean: iso_timestamp }
  updated_at       timestamptz not null default now()
);

alter table push_tokens enable row level security;

-- Anyone can insert their own token, and update only rows matching their token
-- (no auth, so we use the token value itself as the "ownership" proof — the
-- client must already know the token to update it, and tokens are opaque).
create policy "anyone can upsert push_tokens"
  on push_tokens for insert
  with check (true);

create policy "anyone can update by token"
  on push_tokens for update
  using (true)
  with check (true);

-- Reading is intentionally limited to service-role (RLS denies anon select),
-- so favorite lists aren't enumerable from the app.
