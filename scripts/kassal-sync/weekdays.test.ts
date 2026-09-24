import { describe, expect, it } from 'vitest';
import { offerWindow, restrictedWeekdays } from './weekdays.js';

// Ekte tilbud fra Tjek-katalogene uke 39 2026 (torsdag 24.–lørdag 26. sep.).
const THU_TO_SAT = ['2026-09-23T22:00:00+0000', '2026-09-26T21:59:59+0000'] as const;

describe('restrictedWeekdays', () => {
  it('reads explicit ranges, "kun"/"hver" lists and bare weekend offers', () => {
    expect(restrictedWeekdays('KUPP! FREDAG-LØRDAG 250 g')).toEqual(new Set([5, 6]));
    expect(restrictedWeekdays('HELGE-KUPPET! KUN TORSDAG - LØRDAG')).toEqual(new Set([4, 5, 6]));
    expect(restrictedWeekdays('Tilbudet gjelder hver fredag fra 07.08.26 KUN FREDAGER!')).toEqual(
      new Set([5]),
    );
    expect(restrictedWeekdays('kun fredag og lørdag')).toEqual(new Set([5, 6]));
    expect(restrictedWeekdays('FAST HELGETILBUD / HG (129,00/KG) FØRPRIS 17,90')).toEqual(
      new Set([5, 6]),
    );
  });

  it('lets explicit days win over the word "helgetilbud"', () => {
    expect(restrictedWeekdays('HELGE-TILBUD TORSDAG-LØRDAG Pr kg')).toEqual(new Set([4, 5, 6]));
  });

  it('ignores texts without a day restriction', () => {
    expect(restrictedWeekdays('Ukens brød. Gjelder t.o.m. søndag 4.10.')).toBeNull();
    expect(restrictedWeekdays('TILBUD Pr hg. Førpris 197,90')).toBeNull();
    expect(restrictedWeekdays('HELGENS BUKETT')).toBeNull();
  });
});

describe('offerWindow', () => {
  it('narrows MENY smågodt («FAST HELGETILBUD») to Friday–Saturday', () => {
    expect(offerWindow(...THU_TO_SAT, 'SMÅGODT I LØSVEKT | FAST HELGETILBUD / HG')).toEqual({
      valid_from: '2026-09-24T22:00:00.000Z', // fredag 00:00 i Oslo
      valid_until: '2026-09-26T21:59:59.000Z', // lørdag 23:59:59 i Oslo
    });
  });

  it('keeps Tjek dates when the text has no restriction', () => {
    expect(offerWindow(...THU_TO_SAT, 'FLØTEGRATINERTE POTETER')).toEqual({
      valid_from: THU_TO_SAT[0],
      valid_until: THU_TO_SAT[1],
    });
  });

  it('keeps Tjek dates when none of the named days fall inside them', () => {
    expect(offerWindow(...THU_TO_SAT, 'KUN MANDAG')).toEqual({
      valid_from: THU_TO_SAT[0],
      valid_until: THU_TO_SAT[1],
    });
  });

  it('handles winter time (UTC+1)', () => {
    // torsdag 3.–lørdag 5. desember 2026
    expect(
      offerWindow('2026-12-02T23:00:00+0000', '2026-12-05T22:59:59+0000', 'KUN FREDAG'),
    ).toEqual({
      valid_from: '2026-12-03T23:00:00.000Z',
      valid_until: '2026-12-04T22:59:59.000Z',
    });
  });
});
