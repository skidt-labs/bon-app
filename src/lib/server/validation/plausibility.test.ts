import { describe, it, expect } from 'vitest';
import { checkPlausibility } from './plausibility';
import { extractedReceiptSchema } from '../extraction/schema';
import type { ExtractedReceipt } from '../extraction/schema';
import lidlFixture from '../../../../tests/fixtures/receipts/lidl-musterstadt-2026-03-16.expected.json';

function receipt(over: Partial<ExtractedReceipt> = {}): ExtractedReceipt {
  // Fix-Runde 1 fuegt vat_missing hinzu: eine leere vatSummary auf einem sonst
  // normalen Bon (lesbare Summe, mindestens ein Artikel) ist jetzt selbst ein Befund.
  // Der urspruengliche Helfer nutzte vatSummary: [] als "das ist hier nicht das
  // Thema" — das wuerde jetzt fast jeden bestehenden Test mit vat_missing
  // verunreinigen. Der Default liefert deshalb einen einzelnen, zur (ggf.
  // ueberschriebenen) totalGrossCents passenden MwSt-Datensatz; Tests, die
  // tatsaechlich die MwSt-Logik pruefen wollen, ueberschreiben vatSummary weiterhin
  // explizit ueber `over`.
  const totalGrossCents = over.totalGrossCents !== undefined ? over.totalGrossCents : 383;
  const defaultVatSummary = totalGrossCents === null
    ? []
    : [{ rate: 19, netCents: totalGrossCents - 1, taxCents: 1, grossCents: totalGrossCents }];

  return {
    merchantName: 'REWE', merchantAddress: null,
    purchasedAt: '2026-09-13T17:42:00+02:00',
    totalGrossCents, currency: 'EUR', paymentMethod: null,
    vatSummary: defaultVatSummary,
    items: [
      { lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1', unit: 'stk',
        unitPriceCents: 109, totalPriceCents: 109, vatClass: 'A', appliesToLine: null },
      { lineNo: 2, rawText: 'BUTTER', lineType: 'article', quantity: '1', unit: 'stk',
        unitPriceCents: 249, totalPriceCents: 249, vatClass: 'A', appliesToLine: null },
      { lineNo: 3, rawText: 'PFAND', lineType: 'deposit', quantity: '1', unit: 'stk',
        unitPriceCents: 25, totalPriceCents: 25, vatClass: 'A', appliesToLine: null }
    ],
    ...over
  } as ExtractedReceipt;
}

const NOW = new Date('2026-09-13T20:00:00Z');

// Einmal geparst, in mehreren Tests wiederverwendet (F1-F5 pruefen jeweils zusaetzlich,
// dass der neue Code auf dem echten Bon NICHT feuert).
const lidlReceipt = extractedReceiptSchema.parse(lidlFixture);
const LIDL_NOW = new Date('2026-09-14T00:00:00Z');

describe('checkPlausibility', () => {
  it('meldet nichts, wenn die Summe aufgeht', () => {
    expect(checkPlausibility(receipt(), NOW)).toEqual([]);
  });

  it('zählt Pfand mit', () => {
    const r = receipt({ totalGrossCents: 358 });   // ohne Pfand gerechnet
    expect(checkPlausibility(r, NOW)).toContain('sum_mismatch');
  });

  it('zieht Rabattzeilen ab', () => {
    const r = receipt();
    r.items.push({ lineNo: 4, rawText: 'RABATT', lineType: 'discount', quantity: '1',
      unit: 'stk', unitPriceCents: -50, totalPriceCents: -50, vatClass: 'A', appliesToLine: 2 });
    r.totalGrossCents = 333;
    // Der Default-Helfer berechnet vatSummary beim Bau von receipt() aus der
    // urspruenglichen totalGrossCents (383) — eine nachtraegliche Mutation von
    // totalGrossCents muss vatSummary hier von Hand nachziehen, sonst meldet
    // vat_mismatch faelschlich (seit F3/vat_missing traegt der Helfer ueberhaupt
    // eine vatSummary, siehe Kommentar an receipt()).
    r.vatSummary = [{ rate: 19, netCents: 332, taxCents: 1, grossCents: 333 }];
    expect(checkPlausibility(r, NOW)).toEqual([]);
  });

  it('ignoriert Treuepunkte und Infozeilen', () => {
    const r = receipt();
    r.items.push({ lineNo: 4, rawText: 'PAYBACK 12 PUNKTE', lineType: 'loyalty', quantity: null,
      unit: null, unitPriceCents: null, totalPriceCents: 0, vatClass: null, appliesToLine: null });
    expect(checkPlausibility(r, NOW)).toEqual([]);
  });

  it('meldet Datum in der Zukunft', () => {
    const r = receipt({ purchasedAt: '2027-01-01T10:00:00+01:00' });
    expect(checkPlausibility(r, NOW)).toContain('date_in_future');
  });

  it('meldet unplausibel altes Datum', () => {
    const r = receipt({ purchasedAt: '2010-01-01T10:00:00+01:00' });
    expect(checkPlausibility(r, NOW)).toContain('date_too_old');
  });

  it('meldet Rabatte, die auf eine nicht vorhandene Zeile zeigen', () => {
    const r = receipt();
    r.items.push({ lineNo: 9, rawText: 'RABATT', lineType: 'discount', quantity: '1',
      unit: 'stk', unitPriceCents: -50, totalPriceCents: -50, vatClass: 'A', appliesToLine: 77 });
    r.totalGrossCents = 333;
    expect(checkPlausibility(r, NOW)).toContain('discount_unlinked');
  });

  it('meldet leere Bons', () => {
    const r = receipt({ items: [] });
    expect(checkPlausibility(r, NOW)).toContain('no_items');
  });

  it('meldet abweichenden MwSt-Block', () => {
    const r = receipt({ vatSummary: [{ rate: 7, netCents: 100, taxCents: 7, grossCents: 999 }] });
    expect(checkPlausibility(r, NOW)).toContain('vat_mismatch');
  });

  it('meldet keine Summenabweichung, wenn die Bonsumme fehlt', () => {
    const r = receipt({ totalGrossCents: null });
    expect(checkPlausibility(r, NOW)).not.toContain('sum_mismatch');
  });

  // Aufgabe 3 (Entwurf E7a, Punkt 5): eine fehlende Endsumme ist selbst ein Befund,
  // unabhaengig davon, ob Positionen gelesen wurden. Bisher fiel das nur auf, wenn
  // ZUGLEICH die Positionssumme nicht aufging (sum_mismatch schweigt ohne totalGrossCents).
  it('meldet missing_total, wenn die Bonsumme fehlt, auch mit gefuellten Positionen', () => {
    const r = receipt({ totalGrossCents: null });
    expect(checkPlausibility(r, NOW)).toContain('missing_total');
  });

  it('meldet kein missing_total, wenn die Bonsumme gelesen wurde', () => {
    expect(checkPlausibility(receipt(), NOW)).not.toContain('missing_total');
  });

  // --- Realer Bon (Task-10-Brief: "Real data to check your work against") ---
  // Die Ground Truth traegt "_"-Metadatenschluessel und laesst quantity/unit bewusst
  // weg, um genau die Modell-Aussetzer nachzustellen, die schema.ts abfaengt. Deshalb
  // wird hier nicht gecastet, sondern echt geparst — dieselbe Schablone wie in jedem
  // Aufruf aus dem Extraktionspfad (Task 8/9), inklusive Streichen der "_"-Felder und
  // Auffuellen von appliesToLine/quantity/unit auf null.
  it('meldet nichts fuer den echten Lidl-Bon (18 Positionen, 104,31 EUR, beide MwSt-Klassen)', () => {
    // Gegenprobe, dass das Parsen wirklich die dokumentierten Luecken auffuellt und
    // nicht bloss stillschweigend durchreicht, was zufaellig im JSON stand.
    expect(lidlReceipt.items[12].appliesToLine).toBe(12); // Rabatt (Zeile 13) -> Artikel (Zeile 12)
    expect(lidlReceipt.items[0].quantity).toBeNull();     // im Fixture nicht vorhanden
    // "now" bewusst weit nach dem Kaufdatum (2026-03-16): ein Puffer von Monaten macht
    // das Ergebnis unabhaengig davon, in welcher Server-Zeitzone der Test laeuft.
    expect(checkPlausibility(lidlReceipt, LIDL_NOW)).toEqual([]);
  });

  // --- Bericht Punkt 1: unerkannter Zeilentyp -> 'info' -> faellt aus der Summe ---
  it('eine von der Extraktion falsch benannte Zeilenart faellt aus der Summe und loest sum_mismatch aus', () => {
    // Die Kette: extractedItemSchema faengt ein unbekanntes lineType als 'info' ab
    // (.catch('info'), siehe schema.ts) statt den Bon zu verwerfen. sumItemsCents
    // zaehlt 'info' nicht mit (MONETARY-Set). Der Preis der Zeile bleibt aber stehen,
    // also weicht die Summe von der gedruckten Endsumme ab.
    const raw = {
      merchantName: 'REWE', merchantAddress: null, purchasedAt: null,
      totalGrossCents: 109, currency: 'EUR', paymentMethod: null, vatSummary: [],
      items: [{ lineNo: 1, rawText: 'MILCH', lineType: 'schnickschnack', quantity: '1',
        unit: 'stk', unitPriceCents: 109, totalPriceCents: 109, vatClass: 'A', appliesToLine: null }]
    };
    const r = extractedReceiptSchema.parse(raw);
    expect(r.items[0].lineType).toBe('info'); // Gegenprobe: das Schema hat wirklich abgefangen
    expect(checkPlausibility(r)).toContain('sum_mismatch');
  });

  // --- Bericht Punkt 2: vat_incomplete deckt genau die Felder ab, die "?? 0" nutzt ---
  it('vat_incomplete feuert auch, wenn die "?? 0"-Summe zufaellig aufgeht', () => {
    // Eine zweite MwSt-Zeile ohne jeden Wert traegt dank "?? 0" mit 0 zur Summe bei.
    // Die erste Zeile deckt die gedruckte Endsumme bereits vollstaendig ab, also
    // bliebe die Luecke fuer vat_mismatch unsichtbar. vat_incomplete prueft aber
    // dieselben vier Felder direkt auf null, unabhaengig vom Summenvergleich.
    const r = receipt({
      vatSummary: [
        { rate: 19, netCents: 322, taxCents: 61, grossCents: 383 },
        { rate: null, netCents: null, taxCents: null, grossCents: null }
      ]
    });
    const problems = checkPlausibility(r, NOW);
    expect(problems).not.toContain('vat_mismatch');
    expect(problems).toContain('vat_incomplete');
  });

  it('vat_incomplete und vat_mismatch feuern gemeinsam, wenn eine Zeile grossCents verschluckt', () => {
    // Normalfall: die fehlende grossCents-Angabe laesst die "?? 0"-Summe hinter der
    // Endsumme zurueck. vat_mismatch feuert wie erwartet zusaetzlich zu vat_incomplete —
    // aber vat_incomplete allein ist bereits die verlaessliche, summen-unabhaengige Meldung.
    const r = receipt({ vatSummary: [{ rate: 19, netCents: 322, taxCents: 61, grossCents: null }] });
    const problems = checkPlausibility(r, NOW);
    expect(problems).toContain('vat_incomplete');
    expect(problems).toContain('vat_mismatch');
  });

  // --- Bericht Punkt 3 (Fix-Runde 1, F6): der urspruengliche TZ-Bug ist behoben ---
  // In Runde 1 stand hier ein Test, der bewies, dass new Date(...) auf einem
  // TZ=UTC-Server einen frischen, korrekten Bon faelschlich als date_in_future
  // meldete. F6 ersetzt new Date(...) durch parseBonZeit (src/lib/server/zeit.ts),
  // das Europe/Berlin unabhaengig von process.env.TZ korrekt auflöst — siehe
  // zeit.test.ts fuer die ausfuehrliche Abdeckung (Sommer-/Winterzeit, expliziter
  // Offset, DST-Luecke). Hier nur die Regression: derselbe Fall, der vorher
  // faelschlich feuerte, feuert jetzt nicht mehr.
  it('meldet KEIN "date_in_future" mehr bei einem Zeitstempel ohne UTC-Offset auf einem UTC-Server', () => {
    const original = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const r = receipt({ purchasedAt: '2026-01-15T18:16:00' }); // 18:16 Uhr Berlin (CET, UTC+1)
      const scanTime = new Date('2026-01-15T17:20:00Z'); // Scan wenige Minuten nach dem Kauf
      expect(checkPlausibility(r, scanTime)).not.toContain('date_in_future');
    } finally {
      process.env.TZ = original;
    }
  });

  // --- Fix-Runde 1, F1: doppelte lineNo ---
  it('meldet doppelte lineNo', () => {
    const r = receipt();
    r.items[1].lineNo = 1; // Zeile 2 traegt jetzt dieselbe lineNo wie Zeile 1
    expect(checkPlausibility(r, NOW)).toContain('duplicate_line_no');
  });

  it('duplicate_line_no feuert nicht auf dem echten Lidl-Bon', () => {
    expect(checkPlausibility(lidlReceipt, LIDL_NOW)).not.toContain('duplicate_line_no');
  });

  // --- Fix-Runde 1, F2: jede Zeile "info" ---
  it('meldet einen Bon, dessen Zeilen ausnahmslos als "info" klassifiziert sind', () => {
    const r = receipt({
      totalGrossCents: 0,
      vatSummary: [],
      items: [
        { lineNo: 1, rawText: 'MILCH', lineType: 'info', quantity: '1', unit: 'stk',
          unitPriceCents: 109, totalPriceCents: 0, vatClass: null, appliesToLine: null },
        { lineNo: 2, rawText: 'BUTTER', lineType: 'info', quantity: '1', unit: 'stk',
          unitPriceCents: 249, totalPriceCents: 0, vatClass: null, appliesToLine: null }
      ]
    });
    expect(checkPlausibility(r, NOW)).toContain('no_monetary_items');
  });

  it('no_monetary_items feuert nicht auf dem echten Lidl-Bon', () => {
    expect(checkPlausibility(lidlReceipt, LIDL_NOW)).not.toContain('no_monetary_items');
  });

  // --- Fix-Runde 1, F3: MwSt-Block komplett fehlend ---
  it('meldet einen fehlenden MwSt-Block auf einem sonst normalen Bon', () => {
    const r = receipt({ vatSummary: [] }); // Artikel vorhanden, Summe lesbar, kein MwSt-Block
    expect(checkPlausibility(r, NOW)).toContain('vat_missing');
  });

  it('vat_missing feuert nicht auf dem echten Lidl-Bon (MwSt-Block vorhanden)', () => {
    expect(checkPlausibility(lidlReceipt, LIDL_NOW)).not.toContain('vat_missing');
  });

  it('vat_missing feuert nicht auf einem leeren Bon oder ohne lesbare Summe (eigene Codes greifen bereits)', () => {
    expect(checkPlausibility(receipt({ items: [], vatSummary: [] }), NOW)).not.toContain('vat_missing');
    expect(checkPlausibility(receipt({ totalGrossCents: null, vatSummary: [] }), NOW)).not.toContain('vat_missing');
  });

  // --- Fix-Runde 1, F4: sign_mismatch auch fuer article ---
  it('meldet einen negativen Artikelpreis', () => {
    const r = receipt();
    r.items[0].totalPriceCents = -109;
    expect(checkPlausibility(r, NOW)).toContain('sign_mismatch');
  });

  it('sign_mismatch (Artikel) feuert nicht auf dem echten Lidl-Bon', () => {
    expect(checkPlausibility(lidlReceipt, LIDL_NOW)).not.toContain('sign_mismatch');
  });
});

describe('missing_raw_text', () => {
  it('meldet eine Artikelzeile ohne Namen', () => {
    const r = receipt();
    r.items[0].rawText = '';
    expect(checkPlausibility(r, NOW)).toContain('missing_raw_text');
  });
  it('meldet eine Rabattzeile ohne Namen, auch mit sauberem Bezug', () => {
    const r = receipt();
    r.items.push({ lineNo: 8, rawText: '', lineType: 'discount', quantity: null, unit: null,
      unitPriceCents: null, totalPriceCents: -50, vatClass: null, appliesToLine: 1 });
    const p = checkPlausibility(r, NOW);
    expect(p).toContain('missing_raw_text');
    expect(p).not.toContain('discount_unlinked');
  });
  it('meldet nichts bei einer namenlosen Pfandzeile', () => {
    const r = receipt();
    r.items.push({ lineNo: 7, rawText: '', lineType: 'deposit', quantity: null, unit: null,
      unitPriceCents: null, totalPriceCents: 25, vatClass: null, appliesToLine: null });
    expect(checkPlausibility(r, NOW)).not.toContain('missing_raw_text');
  });
  it('meldet nichts bei einer namenlosen Infozeile', () => {
    const r = receipt();
    r.items.push({ lineNo: 9, rawText: '', lineType: 'info', quantity: null, unit: null,
      unitPriceCents: null, totalPriceCents: 0, vatClass: null, appliesToLine: null });
    expect(checkPlausibility(r, NOW)).not.toContain('missing_raw_text');
  });
});
