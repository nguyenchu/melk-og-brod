# Matkupp 🛒

Finn **ekte** dagligvaretilbud på tvers av alle norske kjeder — med en lokketilbud-detektor
basert på prishistorikk fra [Kassal.app](https://kassal.app). Expo (Android + iOS + web).

## Slik henger det sammen
- **Datakilde:** Kassal.app gir pris + prishistorikk per butikk for alle kjeder (Kiwi, Meny,
  Coop, SPAR, Oda, Joker, Bunnpris …). Ett søk dekker samme vare i alle kjeder.
- **Sync-jobb** ([scripts/kassal-sync](scripts/kassal-sync)): henter Kassal nattlig, regner ut
  ekte prisfall (nåpris under butikkens **egen** 90-dagers median), og skriver én statisk
  `products.json` med pris i alle butikker per vare.
- **App:** henter `products.json` (env `EXPO_PUBLIC_DATA_URL`), cacher den lokalt, og
  rangerer/søker/filtrerer klient-side. Ingen database, og API-tokenet er aldri i app-bundelen.

## Kjør syncen
```bash
cd scripts/kassal-sync
npm install
KASSAL_API_TOKEN=... OUT_DIR=./out npx tsx sync.ts   # → out/products.json
# DRY_RUN=1 henter+regner uten å skrive · MAX_TERMS=8 for rask test
```
Last `out/products.json` opp dit appen leser den.

**Nattlig kjøring – anbefalt som cron på egen server** (null GitHub Actions-kostnad). Skriv
rett til web-roten, så slipper du opplasting:
```cron
# /etc/cron.d/matkupp  (token i scripts/kassal-sync/.env på serveren)
5 4 * * *  www-data  cd /srv/melk-og-brod/scripts/kassal-sync && OUT_DIR=/var/www/matkupp /usr/bin/npm run sync >> /var/log/matkupp-sync.log 2>&1
```
`.github/workflows/kassal-sync.yml` finnes også, men kjører **kun manuelt** (workflow_dispatch)
for å unngå daglig Actions-forbruk.

## Kjør appen
```bash
npm install
EXPO_PUBLIC_DATA_URL=https://din-server/products.json npx expo start
```

## Lokketilbud-logikk
For hver butikk sammenlignes nåprisen mot **samme butikks** median siste 90 dager. Er prisen
mer enn terskelen under medianen, er det et ekte prisfall — ikke bare normalpris med tilbudsmerke.
Overskriften per vare er butikken med størst ekte fall; `stores` viser pris i alle kjeder, og
`cheapest_*` hvem som er billigst akkurat nå.
