import { describe, expect, it } from 'vitest';
import { compactHistory } from './history.js';

const pt = (date: string, price: number) => ({ date, price });

describe('compactHistory', () => {
  it('slår sammen en flat serie til første og siste punkt, med kun dato', () => {
    const flat = ['01', '02', '03', '04', '05'].map((d) =>
      pt(`2026-10-${d}T07:01:04.000000Z`, 87.9),
    );
    expect(compactHistory(flat, 20)).toEqual([pt('2026-10-01', 87.9), pt('2026-10-05', 87.9)]);
  });

  it('beholder alle dager når prisen har endret seg', () => {
    const moved = [pt('2026-10-01', 70), pt('2026-10-02', 70), pt('2026-10-03', 48.9)];
    expect(compactHistory(moved, 20)).toEqual(moved);
  });

  it('bruker siste måling per dag og sorterer etter dato', () => {
    const out = compactHistory(
      [
        pt('2026-10-02T20:00:00Z', 60),
        pt('2026-10-01T08:00:00Z', 70),
        pt('2026-10-02T07:00:00Z', 65),
      ],
      20,
    );
    expect(out).toEqual([pt('2026-10-01', 70), pt('2026-10-02', 60)]);
  });

  it('begrenser til de siste `keep` dagene før flat-sjekken', () => {
    const series = [
      pt('2026-10-01', 90),
      pt('2026-10-02', 50),
      pt('2026-10-03', 50),
      pt('2026-10-04', 50),
    ];
    // De tre siste er flate, så de slås sammen.
    expect(compactHistory(series, 3)).toEqual([pt('2026-10-02', 50), pt('2026-10-04', 50)]);
  });

  it('gir null med under to punkter', () => {
    expect(compactHistory([], 20)).toBeNull();
    expect(compactHistory([pt('2026-10-01', 10)], 20)).toBeNull();
    expect(
      compactHistory([pt('2026-10-01T01:00Z', 10), pt('2026-10-01T09:00Z', 12)], 20),
    ).toBeNull();
  });
});
