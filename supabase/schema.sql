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
