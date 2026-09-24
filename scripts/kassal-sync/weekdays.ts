// Tjek gir hvert tilbud katalogens gyldighet (run_from–run_till), men noen
// tilbud gjelder bare enkelte dager i den perioden – og det står bare i teksten:
//   «KUPP! FREDAG-LØRDAG», «KUN FREDAGER!», «Tilbudet gjelder hver torsdag»,
//   «FAST HELGETILBUD» (MENY: fredag og lørdag).
// offerWindow snevrer inn perioden til de dagene teksten nevner, så appen ikke
// viser en fredagspris som om den gjelder på torsdag.

const TZ = 'Europe/Oslo';

// getUTCDay()-nummer (søndag = 0) per ukedag.
const DAY_NUMBERS: Record<string, number> = {
  mandag: 1,
  tirsdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lørdag: 6,
  søndag: 0,
};
const DAY = '(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)(?:er)?';
// «FREDAG-LØRDAG», «torsdag – lørdag», «fredag til søndag»
const RANGE = new RegExp(`${DAY}\\s*(?:-|–|til)\\s*${DAY}`, 'gi');
// «KUN FREDAGER», «hver torsdag», «kun fredag og lørdag»
const LIST = new RegExp(`(?:kun|hver)\\s+${DAY}((?:\\s*(?:,|og|&)\\s*${DAY})*)`, 'gi');
const DAY_ANY = new RegExp(DAY, 'gi');
// «FAST HELGETILBUD» uten dager (MENY) = fredag og lørdag. Tilbud som skriver
// dagene selv («HELGE-TILBUD TORSDAG-LØRDAG») bruker dagene i stedet.
const WEEKEND = /helge-?tilbud/i;

const dayNumber = (word: string) => DAY_NUMBERS[word.toLowerCase().replace(/er$/, '')];

/** Ukedagene teksten begrenser tilbudet til, eller null hvis ingen. */
export function restrictedWeekdays(text: string): Set<number> | null {
  const days = new Set<number>();
  for (const m of text.matchAll(RANGE)) {
    const from = dayNumber(m[1]);
    const to = dayNumber(m[2]);
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  for (const m of text.matchAll(LIST)) {
    days.add(dayNumber(m[1]));
    for (const extra of (m[2] ?? '').matchAll(DAY_ANY)) days.add(dayNumber(extra[1]));
  }
  if (days.size === 0 && WEEKEND.test(text)) {
    days.add(5);
    days.add(6);
  }
  return days.size > 0 ? days : null;
}

// Oslo-dato (år, måned 0-basert, dag) for et tidspunkt.
function osloDate(ms: number): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return [get('year'), get('month') - 1, get('day')];
}

// Hvor mange minutter Oslo ligger foran UTC på et gitt tidspunkt (60 eller 120).
function osloOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

function osloMidnight(y: number, m: number, d: number): number {
  const utcMidnight = Date.UTC(y, m, d);
  return utcMidnight - osloOffsetMinutes(utcMidnight) * 60_000;
}

// Tjek-datoer kommer som «2026-09-23T22:00:00+0000»; legg inn kolon i
// tidssonen så de er gyldig ISO.
export const parseTjekDate = (iso: string) =>
  Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

/**
 * Perioden tilbudet faktisk gjelder: Tjeks run_from–run_till, snevret inn til
 * ukedagene teksten nevner. Uten begrensning i teksten – eller hvis ingen av
 * dagene faller innenfor perioden – returneres Tjeks datoer uendret.
 */
export function offerWindow(
  runFrom: string | null | undefined,
  runTill: string | null | undefined,
  text: string,
): { valid_from: string | null; valid_until: string | null } {
  const unchanged = { valid_from: runFrom ?? null, valid_until: runTill ?? null };
  const days = restrictedWeekdays(text);
  if (!days || !runFrom || !runTill) return unchanged;
  const fromMs = parseTjekDate(runFrom);
  const tillMs = parseTjekDate(runTill);
  if (!Number.isFinite(fromMs) || !Number.isFinite(tillMs) || tillMs < fromMs) return unchanged;

  let first: number | null = null;
  let lastEnd: number | null = null;
  const [y, m, d] = osloDate(fromMs);
  for (let i = 0; i < 31; i++) {
    const start = osloMidnight(y, m, d + i);
    if (start > tillMs) break;
    const weekday = new Date(Date.UTC(y, m, d + i)).getUTCDay();
    if (!days.has(weekday)) continue;
    const end = osloMidnight(y, m, d + i + 1) - 1000;
    if (end < fromMs) continue;
    if (first === null) first = Math.max(start, fromMs);
    lastEnd = Math.min(end, tillMs);
  }
  if (first === null || lastEnd === null) return unchanged;
  return {
    valid_from: new Date(first).toISOString(),
    valid_until: new Date(lastEnd).toISOString(),
  };
}
