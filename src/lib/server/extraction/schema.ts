import { z } from 'zod';
import { ZEILENARTEN } from '$lib/bons/zeilenarten';

// Bruchzahlen lehnt z.int() weiterhin HART ab — das ist die siebenmal abgesicherte
// Kerninvariante: 1.09 statt 109 wäre um Faktor 100 daneben und plausibel aussehend.
const cents = z.int();

// Postgres speichert jede Geldspalte als int4. z.int() allein liesse Werte bis 2^53
// durch: Liest das Modell eine EAN-Zeile als Endsumme (4006381333931), passiert das
// das Schema und stirbt erst am INSERT — und nimmt den ganzen Bon mit, obwohl seine
// Positionen fehlerfrei gelesen sein können.
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * Fehlender Schlüssel, null ODER ein Wert ausserhalb des int4-Bereichs ergeben den
 * Rückfallwert. Bewusst im transform und nicht per .catch(): .catch() würde auch die
 * Bruchzahl-Ablehnung schlucken, die hart bleiben muss. Ausreisser degradieren also,
 * Formfehler fliegen weiterhin raus.
 */
const centsOrFallback = <T extends number | null>(fallback: T) =>
  cents.nullish().transform((v) => (v == null || v < INT4_MIN || v > INT4_MAX ? fallback : v));

// ---------------------------------------------------------------------------
// Achte Runde derselben Fehlerklasse. Die ersten sieben drehten sich um "null"
// und "fehlender Schluessel". Ein Audit hat die dritte Achse aufgedeckt: das
// Modell liefert den RICHTIGEN Wert im FALSCHEN TYP. Nachgestellt, alle real —
// sieben davon verwarfen den GANZEN Bon, vier nullten still:
//   lineNo "1" | rate "19%" | rate "19" | merchantAddress als Objekt
//   totalPriceCents "249" | totalGrossCents "2.49" | items als Objekt   -> Bon weg
//   unit "KG" | unit "Stk" | vatClass 1 | lineType "Artikel"            -> still genullt
// Die Arbeitsteilung bleibt: das Schema prueft die FORM. Eine Typabweichung, die
// sich VERLUSTFREI und EINDEUTIG aufloesen laesst, ist keine Formverletzung,
// sondern Schreibweise. Eine, die geraten werden muesste, bleibt eine.

/** "1" -> 1. Nur reine Ziffern. "1a", "", " " bleiben unberuehrt und fliegen raus. */
const zahlAusZiffern = (v: unknown) =>
  typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;

/**
 * Geldbetraege: NUR reine Ganzzahl-Strings werden uebernommen ("-50" -> -50).
 * "2.49" und "2,49" bleiben ABSICHTLICH Strings und werden von z.int() verworfen.
 * Das ist die siebenmal abgesicherte Kerninvariante von der anderen Seite: ob die
 * Bruchzahl als 1.09 oder als "1.09" ankommt, aendert nichts daran, dass unklar
 * ist, ob 109 Cent oder 1 Cent gemeint sind. Raten waere hier um Faktor 100 daneben
 * und saehe plausibel aus — das ist der Fehler, den niemand mehr bemerkt.
 */
const centsAusZiffern = (v: unknown) =>
  typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : v;

/** "19%", "19", "7,0" -> 19 / 19 / 7. Ein Steuersatz ist ein Prozentwert, kein
 *  Geldbetrag — Nachkommastellen sind hier legitim und nicht mehrdeutig. */
const satzAusText = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim().replace(/\s*%$/, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : v;
};

/** "KG", "Stk", "ST\u00DCCK" -> Kleinschreibung. Deutsche Bons drucken Einheiten gross;
 *  die Enum-Werte sind klein. Ohne das wurde jede grossgeschriebene Einheit still
 *  genullt — die Gewichtsware verlor ihre Einheit, ohne dass irgendwo etwas auffiel. */
const kleinschreiben = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

/**
 * Zeilentyp: Kleinschreibung plus die deutschen Woerter, die ein Modell trotz
 * englischer Vorgabe naheliegend liefert. Bewusst KEIN Rateversuch bei Unbekanntem —
 * alles andere faellt weiter auf .catch('info') und wird ueber sum_mismatch sichtbar.
 */
const ZEILENTYP_SYNONYME: Record<string, string> = {
  artikel: 'article', ware: 'article', pfand: 'deposit',
  leergut: 'deposit_return', pfandrueckgabe: 'deposit_return',
  rabatt: 'discount', nachlass: 'discount', treue: 'loyalty', payback: 'loyalty'
};
const zeilentyp = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase().replace(/\u00fc/g, 'ue');
  return ZEILENTYP_SYNONYME[t] ?? t;
};

/**
 * Ein echter Lidl-Bon lieferte die Adresse als Objekt (storeName/street/zip/city)
 * statt als einen String — und verwarf damit den GANZEN Bon, obwohl alle 18
 * Positionen fehlerfrei gelesen waren. Werte in Schluesselreihenfolge zusammenfuegen:
 * verlustfrei, und die Reihenfolge im Modell-JSON entspricht der Leserichtung.
 */
const textAusObjekt = (v: unknown) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
  const teile = Object.values(v as Record<string, unknown>)
    .filter((x) => typeof x === 'string' && x.trim() !== '');
  return teile.length ? teile.join(', ') : null;
};

/** Zahl oder Boolean, wo ein String erwartet wird (vatClass 1 statt "1"). */
const alsText = (v: unknown) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v);

/**
 * items als Objekt statt Array ({"1": {...}, "2": {...}}) verwarf ebenfalls den
 * ganzen Bon. Object.values() stellt die Liste wieder her. Nur bei einem echten
 * Objekt — ein String oder eine Zahl bleibt unberuehrt und wird abgelehnt.
 */
const alsListe = (v: unknown) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.values(v) : v;

export const extractedItemSchema = z.object({
  lineNo: z.preprocess(zahlAusZiffern, z.int().positive()),
  // Siebte Instanz derselben Fehlerklasse — an der Stelle, die zweimal ausdrücklich
  // ausgenommen wurde mit der Begründung, rawText sei "Buchführung des Modells" und der
  // Prompt gebe dort keinen Anlass zum Nullen. Die Annahme war falsch: Der Prompt weist
  // Unlesbares generell auf null an, und min(1) verwarf bei fehlendem, null-em oder
  // leerem Wert den GANZEN Bon. Der Verlust bleibt sichtbar über missing_raw_text.
  rawText: z.string().nullish().transform((v) => v ?? '').catch(''),
  // .catch('info'), nicht 'article': eine falsch benannte Zeile darf nicht stillschweigend
  // zur Ware werden und in die Summenbildung einfließen. "info" wird von
  // checkPlausibility (Task 10) von der Geldsumme ausgeschlossen, wodurch ein Preis an der
  // Zeile die Summe von der gedruckten Endsumme abweichen lässt (sum_mismatch) — der Bon
  // überlebt, das Problem wird sichtbar, und Task 13s lineType-Dropdown korrigiert es mit
  // einem Klick. Die sechs Werte selbst sind absichtlich nicht erweitert (anders als bei
  // "unit"): die Taxonomie ist als vollständig gedacht, hier fehlt kein echter Wert.
  lineType: z.preprocess(
    zeilentyp,
    z.enum(ZEILENARTEN).catch('info')
  ),
  // .nullish() statt .nullable(): ein echter Lidl-Bon zeigte, dass das Modell fehlende
  // Werte auch als FEHLENDEN SCHLÜSSEL ausliefert, nicht nur als null — .nullable() allein
  // lehnt "undefined" (fehlender Schlüssel) ab. .transform(v => v ?? null) fängt beide
  // Fälle einheitlich auf null ab, damit der ausgelieferte Typ weiterhin string|null ist
  // (kein zusätzliches "| undefined", auf das Task 10/11 nicht vorbereitet sind).
  // .catch(null) bleibt zusätzlich bestehen: schon fast unfailbar (jeder String oder null
  // geht durch), aber ein Modell, das eine Zahl statt eines Strings liefert (z. B.
  // quantity: 2 statt "2"), ist genauso naheliegend wie jede andere Formabweichung hier.
  quantity: z.preprocess(alsText, z.string().nullish().transform((v) => v ?? null).catch(null)),
  // g/ml ergänzt (Feinkost-/Getränkezeilen drucken oft Gramm bzw. Milliliter statt
  // Kilo/Liter). .nullish()+.transform, dann .catch(null): dieselbe fehlender-Schlüssel-
  // Falle wie bei quantity, plus eine unübliche/unlesbare Einheit (z. B. "Pfd.", "Portion",
  // "Bund") darf den Bon nicht scheitern lassen — rawText und quantity bleiben unberührt.
  unit: z.preprocess(
    kleinschreiben,
    z.enum(['stk', 'kg', 'g', 'l', 'ml']).nullish().transform((v) => v ?? null).catch(null)
  ),
  // .nullish()+.transform: derselbe fehlender-Schlüssel-Fund wie oben. Kein .catch() hier —
  // die Geldbetrags-Ganzzahl-Regel muss bei einem TATSÄCHLICH vorhandenen, aber
  // fehlerhaften Wert (Bruchzahl, falscher Typ) weiter hart ablehnen; nur die Abwesenheit
  // wird toleriert.
  unitPriceCents: z.preprocess(centsAusZiffern, centsOrFallback(null)),
  // Nicht cents (nicht-nullable) belassen: "info"-Zeilen haben laut Prompt keinen
  // Geldwert, und das Modell könnte hier — wie bei "loyalty" explizit erlaubt —
  // versucht sein, null zu setzen. Ein genullter Preis ist bereits doppelt abgesichert:
  // Task 13 hebt Artikelzeilen mit totalPriceCents === 0 in der Review nach oben, und
  // ein genullter Preis lässt die Summe von der gedruckten Endsumme abweichen, was
  // Task 10s checkPlausibility als sum_mismatch meldet. Scheitern lassen wäre schlechter
  // als eine bereits behandelte Null.
  totalPriceCents: z.preprocess(centsAusZiffern, centsOrFallback(0)),
  // .nullish()+.transform, dann .catch(null): fehlender Schlüssel wie überall in dieser
  // Runde, plus derselbe Formabweichungs-Schutz wie bei quantity.
  vatClass: z.preprocess(alsText, z.string().nullish().transform((v) => v ?? null).catch(null)),
  // 0 statt null für "kein Bezug" ist eine naheliegende Modell-Ausgabe und würde
  // sonst den ganzen Bon verwerfen. Ein unauflösbarer Bezug wird ohnehin in Task 11
  // auf null gesetzt und über discount_unlinked sichtbar gemacht. .nullish()+.transform
  // fängt zusätzlich den fehlenden Schlüssel ab, bevor .catch() überhaupt gebraucht wird.
  appliesToLine: z.preprocess(
    zahlAusZiffern,
    z
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? null)
    .catch(null)
  )
});

export const extractedReceiptSchema = z.object({
  // Ein echter Lidl-Bon zeigte: das Modell lässt unlesbare Kopffelder auch komplett weg
  // (fehlender Schlüssel), nicht nur null wie angewiesen. .nullable() allein hätte das
  // abgelehnt. .nullish()+.transform(v => v ?? null) behandelt beides gleich und hält
  // den ausgelieferten Typ bei string|null (kein zusätzliches "| undefined").
  merchantName: z.string().nullish().transform((v) => v ?? null),
  merchantAddress: z.preprocess(textAusObjekt, z.string().nullish().transform((v) => v ?? null)),
  purchasedAt: z.string().nullish().transform((v) => v ?? null),
  // Kein 0-Fallback wie bei totalPriceCents: ein echter Bon-Gesamtbetrag ist so gut wie
  // nie 0, ein erfundener 0-Wert wäre also kein plausibler, sondern ein garantiert
  // falscher Sentinel und würde JEDEN Bon mit unlesbarer Endsumme als sum_mismatch
  // melden. null bleibt "wir wissen es nicht" — das ist der bereits bestehende Vertrag.
  totalGrossCents: z.preprocess(centsAusZiffern, centsOrFallback(null)),
  // Nicht .default('EUR'): das greift nur bei undefined, nicht bei null. Das Modell
  // wird im Prompt angewiesen, unlesbare Kopffelder auf null zu setzen — dieselbe Falle
  // wie bei vatSummary, siehe Kommentar dort.
  currency: z.string().nullish().transform((v) => v ?? 'EUR'),
  paymentMethod: z.string().nullish().transform((v) => v ?? null),
  vatSummary: z
    .array(
      z.object({
        // null statt 0: Ein Steuersatz von 0 ist eine BEHAUPTUNG, null ist eine
        // Leerstelle. Mit 0 stünde eine mit 19 % besteuerte Zeile still als 0 %
        // in der Datenbank, und Netto+Steuer=Brutto ginge trotzdem auf. Ein
        // ursprünglich erwogener 0-Fallback (siehe Git-Historie) hatte genau zwei
        // Lücken: nur "rate" fehlend reconciled anstandslos (19 % würde als 0 %
        // archiviert, ohne dass irgendein Check anschlägt), und fehlen alle drei
        // Centfelder, ist 0+0=0 in sich konsistent — eine aus dem Nichts erfundene
        // Zeile, die niemand markiert. null macht "unbekannt" nicht mit "bekannt
        // und null" verwechselbar; Task 10 bekommt dafür einen eigenen
        // vat_incomplete-Complaint-Code und reduziert grossCents mit "?? 0".
        rate: z.preprocess(satzAusText, z.number().nullish().transform((v) => v ?? null)),
        netCents: z.preprocess(centsAusZiffern, centsOrFallback(null)),
        taxCents: z.preprocess(centsAusZiffern, centsOrFallback(null)),
        grossCents: z.preprocess(centsAusZiffern, centsOrFallback(null))
      })
    )
    // Nicht .default([]): das greift nur bei undefined. Das Modell wird im Prompt
    // angewiesen, Unlesbares auf null zu setzen — ein fehlender MwSt-Block darf
    // aber nicht den ganzen Bon scheitern lassen.
    .nullish()
    .transform((v) => v ?? []),
  // Nicht nicht-nullable belassen: ein völlig unlesbarer Bon (verwackeltes oder
  // abgeschnittenes Foto) lädt das Modell durch die "unlesbar -> null"-Konvention
  // geradezu ein, hier null zu setzen. Eine leere Liste ist bereits ein behandelter
  // Fall (Task 10s checkPlausibility meldet no_items dafür) — scheitern lassen wäre
  // schlechter als das.
  items: z.preprocess(alsListe, z.array(extractedItemSchema).nullish().transform((v) => v ?? []))
});

export type ExtractedItem = z.infer<typeof extractedItemSchema>;
export type ExtractedReceipt = z.infer<typeof extractedReceiptSchema>;

// ---------------------------------------------------------------------------
// Aufgabe 4, Teil A: JSON Schema fuer response_format.json_schema (mlx_vlm/
// llguidance auf dem Mac — ECHTE Grammatik-Erzwingung, keine Prompt-Bitte).
// ABGELEITET aus extractedReceiptSchema, nicht von Hand danebengeschrieben — zwei
// Schemata, die auseinanderlaufen koennen, sind laut Aufgabenstellung ein
// kuenftiger Fehler.
//
// Zod 4 kann das selbst (z.toJSONSchema, seit 4.x eingebaut) — kein zusaetzliches
// Paket wie zod-to-json-schema noetig, das Projekt hat schon "zod": "^4.6.5".
//
// { io: 'input' } statt der Voreinstellung 'output': unser Schema besteht
// ueberwiegend aus z.preprocess-Helfern, die TOLERANZ fuer ein UNGEBUNDENES Modell
// herstellen (String-Zahlen, "19%", Grossschreibung, Objekt-statt-String, ...).
// Unter echter Grammatik-Erzwingung KANN das Modell diese Abweichungen gar nicht
// mehr liefern — die Grammatik selbst laesst nur den Zieltyp zu, und genau den
// bildet io:'input' ab: fuer z.preprocess(fn, s) liefert zod den Typ von `s`
// (den bereinigten Zieltyp, z. B. eine positive Ganzzahl fuer lineNo), NICHT den
// Typ, den `fn` zusaetzlich tolerieren wuerde (siehe
// node_modules/zod/v4/core/json-schema-processors.js, pipeProcessor: bei einer
// Preprocess-Pipe ist "in" der Transform selbst, deshalb wird "out" = `s`
// verwendet — nachvollzogen und mit einem Probeschema verifiziert, 2026-09-15).
// Fuer ein einfaches `.nullish().transform(v => v ?? null)` (ohne vorgeschaltetes
// preprocess) liefert es dagegen den validierten Typ VOR der Transformation
// (string|null, nicht erforderlich) — exakt das, was das Modell ausgeben soll,
// wenn es einen Wert nicht kennt: null, bzw. das Feld ganz weglassen.
//
// GRENZE DIESES VERFAHRENS (gemeldet, nicht geloest — siehe Task-4-Bericht):
// Die int4-Grenzpruefung (INT4_MIN/INT4_MAX oben) sitzt als reine JS-Bedingung
// INNERHALB der .transform()-Funktion von centsOrFallback, nicht als zod-Regel
// (.min()/.max()). Eine JSON-Schema-Ableitung sieht nur die AEUSSERE Zod-Struktur
// (hier: cents = z.int(), ohne Grenzen), nicht den Koerper einer beliebigen
// JS-Funktion — das abgeleitete Schema erlaubt fuer jedes Cent-Feld deshalb den
// vollen von z.int() zugelassenen Bereich (+/-9007199254740991,
// Number.MAX_SAFE_INTEGER), NICHT den engeren int4-Bereich. Der Kommentar bei
// `cents` weiter oben beschreibt genau den Fall, den das nicht abfaengt: eine als
// Endsumme gelesene EAN-Zeile (4006381333931) waere unter erzwungenem Schema
// weiterhin ein GUELTIGES Token fuer totalGrossCents. centsOrFallback(...)s
// Degradieren beim Parsen bleibt deshalb WEITERHIN noetig — es ist keine zweite
// Verteidigungslinie, die man jetzt weglassen koennte, sondern weiterhin die
// einzige gegen genau diesen Fall. Absichtlich NICHT von Hand nachgeschaerft
// (z. B. per .min(INT4_MIN)/.max(INT4_MAX) direkt auf `cents`), weil das die
// bestehende, bewusste Design-Entscheidung "Ausreisser degradieren, Formfehler
// fliegen raus" veraendern wuerde (siehe Kommentar bei `cents`/`centsOrFallback`)
// — das war nicht Teil dieses Auftrags und haette Ausreisser von einem
// Rueckfallwert zu einer harten Ablehnung des ganzen Bons gemacht.
/**
 * Was das MODELL liefern soll — nicht, was wir beim Lesen annehmen.
 *
 * Diese Unterscheidung hat am 2026-09-15 zwei echte Bons gekostet. Das Zod-Schema ist
 * absichtlich nachsichtig: fast jedes Feld hat einen Rueckfallwert, damit ein Bon nie
 * an einem einzelnen schlechten Feld scheitert. In der Eingaberichtung bedeutet das
 * "alles darf fehlen", und `z.toJSONSchema` beschreibt das korrekt. Genau diese
 * Beschreibung ging dann als GRAMMATIK an das Modell — also als Anweisung, was es
 * schreiben DARF. Es antwortete folgerichtig mit `{}`: drei Ausgabe-Tokens, kein
 * einziges Feld, und das war nach dieser Grammatik voellig gueltig.
 *
 * Unsere Nachsicht beim Lesen ist kein Lastenheft fuers Schreiben. Die Form kommt
 * weiterhin aus dem Zod-Schema (eine Quelle, kein zweites Schema daneben), die
 * Pflicht kommt von hier. Ein Test haelt beide Listen deckungsgleich mit den
 * tatsaechlich vorhandenen Feldern.
 */
export const ANTWORT_PFLICHTFELDER = [
	'merchantName', 'merchantAddress', 'purchasedAt', 'totalGrossCents',
	'currency', 'paymentMethod', 'vatSummary', 'items'
] as const;

export const ANTWORT_PFLICHTFELDER_POSITION = [
	'lineNo', 'rawText', 'lineType', 'quantity', 'unit',
	'unitPriceCents', 'totalPriceCents', 'vatClass', 'appliesToLine'
] as const;

function mitPflichtfeldern(schema: Record<string, unknown>): Record<string, unknown> {
	const kopf: Record<string, unknown> = { ...schema, required: [...ANTWORT_PFLICHTFELDER] };
	const eigenschaften = kopf.properties as Record<string, any>;
	// `items` ist nullable und deshalb in ein anyOf gehuellt; der Array-Zweig traegt
	// das Positionsschema. Ohne diese Suche haengt die Pflichtliste im Nichts.
	const feld = eigenschaften.items;
	const zweig = feld.anyOf
		? feld.anyOf.find((x: Record<string, unknown>) => x.type === 'array')
		: feld;
	if (zweig?.items) {
		zweig.items = { ...zweig.items, required: [...ANTWORT_PFLICHTFELDER_POSITION] };
	}
	return kopf;
}

export const bonResponseJsonSchema = mitPflichtfeldern(
	z.toJSONSchema(extractedReceiptSchema, { io: 'input' }) as Record<string, unknown>
);
