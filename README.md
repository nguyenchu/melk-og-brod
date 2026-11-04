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

## Pushvarsler for kjempetilbud

- Kopier `scripts/super-deal-push.mts` og `lib/super-deals.ts` til tilsvarende
  stier under `/opt/matkupp` på serveren. Tjenestene bruker Node 22.23 eller nyere på
  `/usr/bin/node` og systembrukeren `matkupp-push`.
- Installer systemd-enhetene fra `deploy/`, kjør `systemctl daemon-reload`
  og `systemctl enable --now matkupp-push.service`. Legg til
  `/api/push/subscription` fra nginx-eksempelet i det aktive HTTPS-oppsettet.
- Aktiver `matkupp-push.timer` for å sjekke den publiserte katalogen hvert
  kvarter. Som alternativ kan GitHub Actions starte tjenesten etter prissynk.
  Gi da deploy-brukeren sudo-tilgang til akkurat
  `/usr/bin/systemctl start matkupp-push-send.service` uten passord. Sett
  GitHub Actions-variabelen `MATKUPP_PUSH_ENABLED=true` når serveren er klar.
- Sett `EXPO_PUBLIC_PUSH_URL` til den fullstendige HTTPS-adressen til
  abonnement-endepunktet i EAS. Konfigurer Android FCM v1 og iOS APNs
  for Expo-prosjektet før ny appbygging. Test på en enhet før aktivering.
- SQLite-fila i `/var/lib/matkupp-push` lagrer enhets-ID-er og utsendinger.
  Behold den ved utrulling slik at ukesgrensen og kampanjehistorikken består.

### Chrome

- Kopier også `scripts/super-deal-web-push.mts` til `/opt/matkupp/scripts/`.
  Installer den låste `web-push`-versjonen fra package.json i `/opt/matkupp`.
- Lag ett VAPID-nøkkelpar med `npx web-push generate-vapid-keys`. Lagre
  `MATKUPP_VAPID_PUBLIC_KEY`, `MATKUPP_VAPID_PRIVATE_KEY`,
  `MATKUPP_VAPID_SUBJECT` (kontaktadresse med `mailto:`) og
  `MATKUPP_WEB_ORIGIN=https://matkupp.nguyenchu.com` i
  `/etc/matkupp-push.env` med tilgang bare for root. Behold nøkkelparet ved
  oppgraderinger. Systemd leser fila for begge tjenestene.
- Legg til `/api/push/web` i aktivt nginx-oppsett og publiser webappen.
  Åpne Matkupp i Chrome og velg **Innstillinger → Varsle om kjempetilbud**.
