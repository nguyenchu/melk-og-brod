export type HistoryPoint = { date: string; price: number };

/**
 * Gjør Kassals prishistorikk liten nok til å følge med alle varer i
 * products.json (som appen cacher i AsyncStorage/localStorage, ~5–6 MB):
 *  - ett punkt per dag (siste måling vinner) og kun datoen (ÅÅÅÅ-MM-DD),
 *  - de `keep` siste dagene,
 *  - en serie uten prisendring slås sammen til første og siste punkt, siden
 *    en flat linje ikke trenger 20 like punkter.
 * Serier med prisendringer beholdes fullt ut, så grafen (som plasserer punkter
 * jevnt etter rekkefølge) fortsatt stemmer med tiden.
 * Gir null når det er under to punkter, siden en graf ikke kan tegnes.
 */
export function compactHistory(points: HistoryPoint[], keep: number): HistoryPoint[] | null {
  const byDay = new Map<string, HistoryPoint>();
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const day = p.date.slice(0, 10);
    byDay.set(day, { date: day, price: p.price });
  }
  const days = [...byDay.values()].slice(-keep);
  if (days.length < 2) return null;
  if (days.every((p) => p.price === days[0].price)) return [days[0], days[days.length - 1]];
  return days;
}
