import { describe, it, expect } from 'vitest';
import { extractedReceiptSchema, bonResponseJsonSchema } from './schema';

const valid = {
  merchantName: 'REWE Markt GmbH',
  merchantAddress: 'Hauptstr. 1, 12345 Musterstadt',
  purchasedAt: '2026-09-13T17:42:00+02:00',
  totalGrossCents: 383,
  currency: 'EUR',
  paymentMethod: 'ec',
  vatSummary: [{ rate: 7, netCents: 358, taxCents: 25, grossCents: 383 }],
  items: [
    { lineNo: 1, rawText: 'G&G H-MILCH 3,5%', lineType: 'article',
      quantity: '1' as string | number,
      unit: 'stk', unitPriceCents: 109, totalPriceCents: 109 as number | null,
      vatClass: 'A', appliesToLine: null as number | null },
    { lineNo: 2, rawText: 'PFAND 0,25', lineType: 'deposit', quantity: '1',
      unit: 'stk', unitPriceCents: 25, totalPriceCents: 25, vatClass: 'A',
      appliesToLine: null as number | null }
  ]
};

describe('extractedReceiptSchema', () => {
  it('nimmt einen vollständigen Bon an', () => {
    expect(extractedReceiptSchema.parse(valid).items).toHaveLength(2);
  });

  it('faengt unbekannte Zeilentypen als info ab, statt sie abzulehnen', () => {
    // War ursprünglich "lehnt unbekannte Zeilentypen ab" (erwartete .toThrow()). Seit F7
    // hat lineType .catch('info'): eine unbekannte Zeilenart darf nicht die Summenbildung
    // ausschließen, indem sie den ganzen Bon scheitern lässt — siehe schema.ts.
    const bad = structuredClone(valid);
    bad.items[0].lineType = 'schnickschnack';
    expect(extractedReceiptSchema.parse(bad).items[0].lineType).toBe('info');
  });

  it('lehnt Bruchzahlen bei Centbeträgen ab', () => {
    const bad = structuredClone(valid);
    bad.items[0].totalPriceCents = 1.09;
    expect(() => extractedReceiptSchema.parse(bad)).toThrow();
  });

  it('erlaubt negative Beträge für Rabattzeilen', () => {
    const discount = structuredClone(valid);
    discount.items.push({
      lineNo: 3, rawText: 'RABATT COUPON', lineType: 'discount', quantity: '1',
      unit: 'stk', unitPriceCents: -50, totalPriceCents: -50, vatClass: 'A', appliesToLine: 1
    });
    expect(extractedReceiptSchema.parse(discount).items).toHaveLength(3);
  });

  it('erlaubt fehlende Kopfdaten (unlesbarer Bon)', () => {
    const sparse = { ...valid, merchantAddress: null, purchasedAt: null, paymentMethod: null };
    expect(() => extractedReceiptSchema.parse(sparse)).not.toThrow();
  });

  it('nimmt einen fehlenden MwSt-Block an', () => {
    const { vatSummary, ...ohne } = valid;
    expect(extractedReceiptSchema.parse(ohne).vatSummary).toEqual([]);
  });

  it('nimmt vatSummary null an und macht eine leere Liste daraus', () => {
    expect(extractedReceiptSchema.parse({ ...valid, vatSummary: null }).vatSummary).toEqual([]);
  });

  it('nimmt currency null an und setzt EUR', () => {
    expect(extractedReceiptSchema.parse({ ...valid, currency: null }).currency).toBe('EUR');
  });

  it('nimmt fehlendes currency an und setzt EUR', () => {
    const { currency, ...ohneCurrency } = valid;
    expect(extractedReceiptSchema.parse(ohneCurrency).currency).toBe('EUR');
  });

  it('nimmt items null an und macht eine leere Liste daraus', () => {
    expect(extractedReceiptSchema.parse({ ...valid, items: null }).items).toEqual([]);
  });

  it('macht aus einem fehlenden Positionspreis eine Null statt zu werfen', () => {
    const r = structuredClone(valid);
    r.items[0].totalPriceCents = null;
    expect(extractedReceiptSchema.parse(r).items[0].totalPriceCents).toBe(0);
  });

  it('nimmt Gramm und Milliliter als Einheit an', () => {
    const r = structuredClone(valid);
    r.items[0].unit = 'g';
    expect(extractedReceiptSchema.parse(r).items[0].unit).toBe('g');
  });

  it('macht aus einer unbekannten Einheit null statt zu werfen', () => {
    const r = structuredClone(valid);
    r.items[0].unit = 'Bund';
    expect(extractedReceiptSchema.parse(r).items[0].unit).toBeNull();
  });

  it('faengt einen unbekannten Zeilentyp als info ab, statt zu werfen', () => {
    const r = structuredClone(valid);
    // Stand frueher 'Artikel' hier. Das wird inzwischen als deutsche Schreibweise
    // von 'article' erkannt und ist damit kein Beispiel mehr fuer einen UNBEKANNTEN
    // Typ — die Degradierung zu info war nie das Ziel, nur die Notloesung. Ein
    // wirklich unbekannter Wert muss weiterhin abgefangen werden.
    r.items[0].lineType = 'Sonderposten';
    const parsed = extractedReceiptSchema.parse(r);
    expect(parsed.items[0].lineType).toBe('info');
    // Der Preis bleibt stehen — dadurch geht die Summe nicht auf und
    // checkPlausibility meldet sum_mismatch. Genau so soll es auffallen.
    expect(parsed.items[0].totalPriceCents).toBe(109);
  });

  it('faengt eine Zahl in quantity ab, statt zu werfen', () => {
    const r = structuredClone(valid);
    r.items[0].quantity = 2;
    // Erwartete frueher null: der Wert wurde weggeworfen, nur damit nichts fliegt.
    // Eine Zahl in einem Textfeld ist aber keine Leerstelle, sondern eine
    // Schreibweise — "2" behaelt die Menge, statt sie zu verlieren. Die Absicht des
    // Tests (eine Typabweichung darf nicht werfen) bleibt unveraendert.
    expect(extractedReceiptSchema.parse(r).items[0].quantity).toBe('2');
  });

  it('faengt appliesToLine 0 ab, statt den ganzen Bon zu verwerfen', () => {
    const r = structuredClone(valid);
    r.items[0].appliesToLine = 0;
    expect(extractedReceiptSchema.parse(r).items[0].appliesToLine).toBeNull();
  });

  it('nimmt eine Antwort an, bei der optionale Schluessel schlicht fehlen', () => {
    const minimal = {
      merchantName: 'LIDL',
      purchasedAt: '2026-03-16T18:16:00',
      totalGrossCents: 10431,
      vatSummary: [{ netCents: 2227, grossCents: 2383 }],
      items: [{ lineNo: 1, rawText: 'Tomaten Strauch', lineType: 'article', totalPriceCents: 429 }]
    };
    const r = extractedReceiptSchema.parse(minimal);
    expect(r.items).toHaveLength(1);
    expect(r.merchantAddress).toBeNull();
    expect(r.paymentMethod).toBeNull();
    // Fehlende Zahlen in der MwSt-Zeile fallen auf null, nicht auf 0 (seit F11) — sonst
    // stünde eine fehlende taxCents-Angabe als 0 da, und Netto+Steuer=Brutto könnte
    // zufällig trotzdem aufgehen. Task 10 bekommt dafür einen eigenen vat_incomplete-Code.
    expect(r.vatSummary[0].rate).toBeNull();
    expect(r.vatSummary[0].taxCents).toBeNull();
    expect(r.vatSummary[0].netCents).toBe(2227);
    expect(r.vatSummary[0].grossCents).toBe(2383);
    // Fehlende optionale Item-Felder fallen ebenfalls auf ihren dokumentierten Fallback.
    expect(r.items[0].quantity).toBeNull();
    expect(r.items[0].unit).toBeNull();
    expect(r.items[0].vatClass).toBeNull();
    expect(r.items[0].appliesToLine).toBeNull();
  });

  it('laesst einen fehlenden Steuersatz null statt 0 werden', () => {
    const r = structuredClone(valid);
    delete (r.vatSummary[0] as Record<string, unknown>).rate;
    expect(extractedReceiptSchema.parse(r).vatSummary[0].rate).toBeNull();
  });

  it('erfindet keine Nullzeile, wenn alle Betraege fehlen', () => {
    const r = structuredClone(valid);
    r.vatSummary = [{}] as typeof r.vatSummary;
    const row = extractedReceiptSchema.parse(r).vatSummary[0];
    expect([row.rate, row.netCents, row.taxCents, row.grossCents]).toEqual([null, null, null, null]);
  });
});

// ===========================================================================
// Achte Runde derselben Fehlerklasse: richtiger Wert, falscher Typ.
// Die ersten sieben Runden drehten sich um "null" und "fehlender Schluessel".
// Ein Audit deckte die dritte Achse auf — alle Faelle unten wurden gegen das
// echte Schema nachgestellt, bevor sie gefixt wurden. Sieben verwarfen den
// GANZEN Bon, vier nullten still.
// ===========================================================================
describe('Typabweichungen des Modells', () => {
  const bon = () => ({
    merchantName: 'LIDL',
    merchantAddress: 'Hauptstr. 1, 12345 Musterstadt',
    purchasedAt: '2026-03-16T17:16:00Z',
    totalGrossCents: 249,
    currency: 'EUR',
    paymentMethod: 'girocard',
    vatSummary: [{ rate: 19, netCents: 209, taxCents: 40, grossCents: 249 }],
    items: [
      {
        lineNo: 1, rawText: 'BUTTER', lineType: 'article', quantity: '1',
        unit: 'stk', unitPriceCents: 249, totalPriceCents: 249,
        vatClass: 'A', appliesToLine: null
      }
    ]
  });
  const parse = (b: unknown) => extractedReceiptSchema.parse(b);

  it('nimmt lineNo als Ziffernstring an', () => {
    const b = bon(); (b.items[0] as any).lineNo = '3';
    expect(parse(b).items[0].lineNo).toBe(3);
  });

  it('verwirft lineNo, die keine reine Zahl ist', () => {
    for (const kaputt of ['1a', '', ' ', '0', 'eins']) {
      const b = bon(); (b.items[0] as any).lineNo = kaputt;
      expect(() => parse(b), kaputt).toThrow();
    }
  });

  it('nimmt den Steuersatz als Text an, mit Prozentzeichen und Komma', () => {
    for (const [ein, aus] of [['19%', 19], ['19', 19], ['7,0', 7], [' 19 % ', 19]] as const) {
      const b = bon(); (b.vatSummary[0] as any).rate = ein;
      expect(parse(b).vatSummary[0].rate, String(ein)).toBe(aus);
    }
  });

  // Der echte Lidl-Bon lieferte die Adresse als Objekt und verwarf damit alle
  // 18 fehlerfrei gelesenen Positionen mit.
  it('faltet eine als Objekt gelieferte Adresse zu einem String', () => {
    const b = bon();
    (b as any).merchantAddress = { street: 'Hauptstr. 1', zip: '12345', city: 'Musterstadt' };
    expect(parse(b).merchantAddress).toBe('Hauptstr. 1, 12345, Musterstadt');
  });

  it('macht aus einer leeren Adress-Struktur null, nicht einen leeren String', () => {
    const b = bon(); (b as any).merchantAddress = { street: '', zip: '  ' };
    expect(parse(b).merchantAddress).toBeNull();
  });

  // Deutsche Bons drucken Einheiten gross. Vorher wurde jede davon still genullt —
  // die Gewichtsware verlor ihre Einheit, ohne dass irgendwo etwas auffiel.
  it('nimmt grossgeschriebene Einheiten an', () => {
    for (const [ein, aus] of [['KG', 'kg'], ['Stk', 'stk'], ['G', 'g'], ['ML', 'ml']] as const) {
      const b = bon(); (b.items[0] as any).unit = ein;
      expect(parse(b).items[0].unit, ein).toBe(aus);
    }
  });

  it('nullt eine wirklich unbekannte Einheit weiterhin, statt zu scheitern', () => {
    const b = bon(); (b.items[0] as any).unit = 'Bund';
    expect(parse(b).items[0].unit).toBeNull();
  });

  it('nimmt deutsche Zeilentypen an', () => {
    for (const [ein, aus] of [
      ['Artikel', 'article'], ['PFAND', 'deposit'], ['Leergut', 'deposit_return'],
      ['Rabatt', 'discount'], ['Payback', 'loyalty'], ['ARTICLE', 'article']
    ] as const) {
      const b = bon(); (b.items[0] as any).lineType = ein;
      expect(parse(b).items[0].lineType, ein).toBe(aus);
    }
  });

  it('faellt bei einem unbekannten Zeilentyp weiterhin auf info zurueck', () => {
    const b = bon(); (b.items[0] as any).lineType = 'Sonderposten';
    expect(parse(b).items[0].lineType).toBe('info');
  });

  it('macht aus einer Zahl in einem Textfeld einen String', () => {
    const b = bon();
    (b.items[0] as any).vatClass = 1;
    (b.items[0] as any).quantity = 2;
    const i = parse(b).items[0];
    expect(i.vatClass).toBe('1');
    expect(i.quantity).toBe('2');
  });

  it('stellt eine als Objekt gelieferte Positionsliste wieder her', () => {
    const b = bon();
    (b as any).items = { '1': bon().items[0], '2': { ...bon().items[0], lineNo: 2 } };
    expect(parse(b).items).toHaveLength(2);
  });

  it('verwirft eine Positionsliste, die weder Liste noch Objekt ist', () => {
    const b = bon(); (b as any).items = 'BUTTER 2,49';
    expect(() => parse(b)).toThrow();
  });

  // ---------------------------------------------------------------------
  // GEGENPROBE zur Kerninvariante. Die Lockerung oben darf sie nicht anritzen:
  // ein Geldbetrag bleibt eine ganze Zahl in Cent. Ob die Bruchzahl als 1.09
  // oder als "1.09" ankommt, aendert nichts daran, dass unklar ist, ob 109 Cent
  // oder 1 Cent gemeint sind — und ein Fehler um Faktor 100, der plausibel
  // aussieht, ist genau der, den hinterher niemand mehr bemerkt.
  // ---------------------------------------------------------------------
  it('nimmt Geldbetraege als reinen Ziffernstring an', () => {
    const b = bon();
    (b.items[0] as any).totalPriceCents = '249';
    (b.items[0] as any).unitPriceCents = '-50';
    (b.vatSummary[0] as any).netCents = '209';
    const r = parse(b);
    expect(r.items[0].totalPriceCents).toBe(249);
    expect(r.items[0].unitPriceCents).toBe(-50);
    expect(r.vatSummary[0].netCents).toBe(209);
  });

  it('lehnt Bruchzahlen bei Geld weiterhin hart ab — als Zahl UND als String', () => {
    const faelle: [string, (b: any) => void][] = [
      ['Zahl 1.09', (b) => (b.items[0].totalPriceCents = 1.09)],
      ['String "2.49"', (b) => (b.items[0].totalPriceCents = '2.49')],
      ['String "2,49"', (b) => (b.items[0].totalPriceCents = '2,49')],
      ['Endsumme "2.49"', (b) => (b.totalGrossCents = '2.49')],
      ['Einzelpreis 0.5', (b) => (b.items[0].unitPriceCents = 0.5)],
      ['netCents "2.09"', (b) => (b.vatSummary[0].netCents = '2.09')]
    ];
    for (const [name, mutiere] of faelle) {
      const b = bon(); mutiere(b);
      expect(() => parse(b), name).toThrow();
    }
  });

  it('degradiert einen als Geld gelesenen EAN weiterhin, auch als String', () => {
    const b = bon(); (b as any).totalGrossCents = '4006381333931';
    expect(parse(b).totalGrossCents).toBeNull();
  });
});

// Aufgabe 4, Teil A: JSON Schema für response_format.json_schema (mlx_vlm/
// llguidance), ABGELEITET aus extractedReceiptSchema — siehe Kommentar bei
// bonResponseJsonSchema in schema.ts.
describe('bonResponseJsonSchema (Aufgabe 4, Teil A)', () => {
  // Der Import allein würfe schon beim Laden des Moduls, wenn z.toJSONSchema an
  // einem z.preprocess-Helfer scheitert (unser Schema besteht überwiegend daraus) —
  // trotzdem eine explizite Zusicherung, damit ein künftiger Rückbau nicht
  // versehentlich eine leere/kaputte Konstante durchwinkt.
  it('lässt sich ohne Fehler aus dem Zod-Schema ableiten und ist ein Objekt-Schema', () => {
    expect(bonResponseJsonSchema).toBeTypeOf('object');
    expect((bonResponseJsonSchema as { type?: string }).type).toBe('object');
  });

  it('beschreibt alle Kopf-Felder des Bons', () => {
    const props = Object.keys(
      (bonResponseJsonSchema as { properties: Record<string, unknown> }).properties
    );
    expect(props).toEqual(
      expect.arrayContaining([
        'merchantName', 'merchantAddress', 'purchasedAt', 'totalGrossCents',
        'currency', 'paymentMethod', 'vatSummary', 'items'
      ])
    );
  });

  function itemSchema() {
    const items = (
      bonResponseJsonSchema as unknown as {
        properties: { items: { anyOf?: { type?: string; items?: unknown }[]; items?: unknown } };
      }
    ).properties.items;
    const arraySchema = items.anyOf ? items.anyOf.find((s) => s.type === 'array') : items;
    return (arraySchema as { items: { properties: Record<string, { enum?: string[] }>; required: string[] } })
      .items;
  }

  // io: 'input' muss den ZIEL-Typ liefern, nicht die Roheingabe-Toleranz: das
  // Modell soll unter erzwungenem Schema NUR die sechs echten Werte schreiben
  // dürfen, nicht die deutschen Synonyme ("artikel", "rabatt", ...), die
  // `zeilentyp` (schema.ts) für ein UNGEBUNDENES Modell zusätzlich toleriert.
  it('erzwingt den ZIEL-Typ der Positionen, nicht die Roheingabe-Toleranz (io: "input")', () => {
    const item = itemSchema();
    expect(item.properties.lineType.enum?.slice().sort()).toEqual(
      ['article', 'deposit', 'deposit_return', 'discount', 'info', 'loyalty'].sort()
    );
    // KORRIGIERT am 2026-09-15, nachdem zwei echte Bons daran leer blieben.
    // Die fruehere Erwartung lautete, quantity/unit duerften FEHLEN — "das ist der
    // bewusst erlaubte 'ich weiss es nicht'-Fall". Das klingt richtig und ist es
    // nicht: unter erzwungenem Schema ist die Feldliste kein Zugestaendnis, sondern
    // eine ANWEISUNG, was das Modell schreiben darf. Durfte alles fehlen, war `{}`
    // die kuerzeste gueltige Antwort — und genau die kam, drei Ausgabe-Tokens lang.
    //
    // "darf null sein" ist nicht "darf fehlen". Beide Felder lassen weiterhin null
    // zu; verpflichtend ist nur, dass das Modell die Leerstelle AUSSPRICHT, statt
    // zu schweigen. Das ist dieselbe Regel wie ueberall in diesem Projekt.
    expect(item.required).toEqual(expect.arrayContaining(['lineNo', 'lineType']));
    expect(item.required).toContain('quantity');
    expect(item.required).toContain('unit');
    expect(JSON.stringify(item.properties.quantity)).toContain('null');
    expect(JSON.stringify(item.properties.unit)).toContain('null');
  });

  // GRENZE DES ABLEITUNGSVERFAHRENS (siehe Kommentar bei bonResponseJsonSchema):
  // die Postgres-int4-Grenze (INT4_MIN/INT4_MAX) sitzt als reine JS-Bedingung
  // INNERHALB von centsOrFallback, nicht als zod-Regel — die Ableitung sieht daher
  // nur zods eigene z.int()-Grenze (Number.MAX_SAFE_INTEGER), die weit über dem
  // int4-Bereich liegt. Dieser Test BEWEIST die gemeldete Lücke, statt sie nur zu
  // behaupten: würde centsOrFallback künftig durch eine echte zod-.max()-Regel
  // ersetzt, MUSS dieser Test rot werden und neu bewertet werden.
  it('spiegelt die int4-Ausreisser-Behandlung NICHT wider (gemeldete Grenze der Ableitung)', () => {
    const totalGrossCents = (
      bonResponseJsonSchema as unknown as {
        properties: { totalGrossCents: { anyOf: { type?: string; maximum?: number }[] } };
      }
    ).properties.totalGrossCents;
    const numeric = totalGrossCents.anyOf.find((s) => s.type === 'integer');
    expect(numeric?.maximum).toBe(Number.MAX_SAFE_INTEGER);
    expect(numeric?.maximum).toBeGreaterThan(2_147_483_647); // int4-Obergrenze aus schema.ts
  });
});
