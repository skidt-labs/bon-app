import type { ExtractedReceipt } from '../extraction/schema';
import { parseBonZeit } from '../zeit';
import { MONETAER } from '$lib/bons/zeilenarten';

const TOLERANCE_CENTS = 1;
const MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Zeilentypen, die zur Bonsumme beitragen. `loyalty` und `info` tun das nicht. */
const MONETARY: ReadonlySet<string> = new Set(MONETAER);

export function sumItemsCents(receipt: ExtractedReceipt): number {
  return receipt.items
    .filter((i) => MONETARY.has(i.lineType))
    .reduce((acc, i) => acc + i.totalPriceCents, 0);
}

export function checkPlausibility(receipt: ExtractedReceipt, now: Date = new Date()): string[] {
  const problems: string[] = [];

  if (receipt.items.length === 0) problems.push('no_items');

  // Eine systematische Fehlklassifizierung degradiert jede Zeile zu 'info' (der
  // .catch-Fallback in schema.ts) — dann ist die Summe 0, der Bon hat aber sehr wohl
  // Positionen. sum_mismatch allein greift hier nicht zuverlässig (0 gegen einen
  // ebenfalls unlesbaren/0-Gesamtbetrag geht zufällig auf), deshalb ein eigener Code.
  if (receipt.items.length > 0 && !receipt.items.some((i) => MONETARY.has(i.lineType))) {
    problems.push('no_monetary_items');
  }

  // Gegenstück zur Härtung von rawText: Das Schema lässt einen fehlenden, null-en oder
  // leeren Artikelnamen jetzt durch, statt den ganzen Bon zu verwerfen — dann muss der
  // Verlust aber sichtbar werden. Ohne Namen ist die Zeile für die Kategorie-Zuordnung
  // ab Phase 2 wertlos, und beim Abgleich mit dem Papier fällt sie sonst nicht auf.
  // Auch 'discount': ein Rabatt ohne Text ist in der Pruef-Ansicht eine leere Zeile mit
  // blossem Minusbetrag — genau der unbemerkte Verlust, den dieser Code verhindern soll.
  // discount_unlinked deckt das nicht ab (das meldet den fehlenden Bezug, nicht den
  // fehlenden Text) und schweigt gerade dann, wenn der Bezug sauber gelesen wurde.
  // Pfand-, Treue- und Infozeilen bleiben draussen: deren Text ist generisch ("PFAND",
  // "PAYBACK") und traegt nichts, was man beim Abgleich mit dem Papier vermissen wuerde.
  const BRAUCHT_TEXT = new Set(['article', 'discount']);
  if (receipt.items.some((i) => BRAUCHT_TEXT.has(i.lineType) && i.rawText.trim() === '')) {
    problems.push('missing_raw_text');
  }

  // lineNo muss pro Bon eindeutig sein — appliesToLine referenziert eine einzelne
  // Zeilennummer, und Task 11s Insert erzwingt Eindeutigkeit über eine DB-Constraint.
  // Liefert das Modell Duplikate, schlägt sonst der gesamte Insert fehl und der Bon
  // stirbt — das "eine schlechte Spalte wirft den ganzen Bon weg"-Muster, das dieses
  // Modul verhindern soll. Hier, während es noch reparierbar ist, sichtbar machen.
  const lineNos = new Set(receipt.items.map((i) => i.lineNo));
  if (lineNos.size !== receipt.items.length) problems.push('duplicate_line_no');

  // Aufgabe 3 (Entwurf E7a, Punkt 5): eine Antwort ohne Endsumme ist KEIN gueltiges
  // Ergebnis, auch wenn die Positionen gefuellt sind — im Testlauf gegen den Mac kam
  // genau das vor (Positionen da, totalGrossCents null). Bisher fiel das nur auf,
  // wenn ZUGLEICH die Positionssumme nicht aufging: sum_mismatch/vat_mismatch/
  // vat_missing setzen alle receipt.totalGrossCents !== null voraus und schweigen
  // hier komplett. Eigener, davon unabhaengiger Code.
  if (receipt.totalGrossCents === null) problems.push('missing_total');

  if (receipt.totalGrossCents !== null) {
    if (Math.abs(sumItemsCents(receipt) - receipt.totalGrossCents) > TOLERANCE_CENTS) {
      problems.push('sum_mismatch');
    }
    // `?? 0`, weil unbekannte Beträge als null durchkommen — siehe vat_incomplete.
    const vatGross = receipt.vatSummary.reduce((acc, v) => acc + (v.grossCents ?? 0), 0);
    if (receipt.vatSummary.length > 0 && Math.abs(vatGross - receipt.totalGrossCents) > TOLERANCE_CENTS) {
      problems.push('vat_mismatch');
    }
  }

  // Eine MwSt-Zeile mit Leerstellen ist nicht vertrauenswürdig. Ohne diese Prüfung
  // rutschte ein fehlender Steuersatz durch: Netto+Steuer=Brutto ginge auf, und eine
  // mit 19 % besteuerte Position stünde still als 0 % in der Datenbank.
  const vatIncomplete = receipt.vatSummary.some(
    (v) => v.rate === null || v.netCents === null || v.taxCents === null || v.grossCents === null
  );
  if (vatIncomplete) problems.push('vat_incomplete');

  // Ein komplett fehlender MwSt-Block ist genauso unsichtbar wie eine fehlklassifizierte
  // Zeile: vat_mismatch und vat_incomplete greifen beide erst, wenn vatSummary Zeilen
  // hat. Ein abgeschnittenes Foto oder unlesbarer Kleindruck kann den ganzen Block
  // verschlucken, ohne dass eine Zahl je falsch aussieht. Guard bewusst eng: nur ein
  // Bon, der sonst normal aussieht (lesbare Summe, mindestens ein Artikel), bekommt
  // diesen Code — ein leerer Bon oder einer ohne lesbare Summe hat bereits eigene Codes
  // (no_items / kein sum_mismatch ohne totalGrossCents).
  if (
    receipt.vatSummary.length === 0 &&
    receipt.totalGrossCents !== null &&
    receipt.items.some((i) => i.lineType === 'article')
  ) {
    problems.push('vat_missing');
  }

  // Rabatt- und Pfandzeilen dürfen nur auf Zeilennummern zeigen, die es auf diesem
  // Bon wirklich gibt — sonst scheitert später der Fremdschlüssel beim Einfügen.
  // Das prüft nur, dass das Ziel EXISTIERT, nicht, dass es das RICHTIGE Ziel ist:
  // ein Rabatt, der auf eine vorhandene, aber falsche Zeile zeigt, kommt hier
  // unbeanstandet durch — das erfordert Kenntnis, welcher Artikel semantisch gemeint
  // war, die wir nicht haben. Diese Fälle fängt ein Mensch im Review-Bildschirm ab,
  // der appliesToLine sichtbar anzeigt (Task 13).
  if (receipt.items.some((i) => i.appliesToLine !== null && !lineNos.has(i.appliesToLine))) {
    problems.push('discount_unlinked');
  }

  if (receipt.purchasedAt) {
    const at = parseBonZeit(receipt.purchasedAt);
    if (at === null) {
      // Das Modell hat entweder etwas geliefert, das kein Datum ist ("gestern",
      // "13.09."), oder eine Wanduhrzeit, die es in Europe/Berlin nie gab (siehe
      // parseBonZeit). Task 11 setzt die Spalte dann auf null — hier wird es sichtbar.
      problems.push('date_unparsable');
    } else {
      if (at.getTime() > now.getTime()) problems.push('date_in_future');
      if (at.getTime() < now.getTime() - MAX_AGE_MS) problems.push('date_too_old');
    }
  }

  // Vorzeichen müssen zum Zeilentyp passen. Ein positiver "Rabatt", ein negatives
  // Pfand oder ein negativer Artikel verrät eine Fehlinterpretation und würde die
  // Summe verfälschen. Ein negativer Artikel könnte theoretisch eine Rückgabe sein,
  // die falsch klassifiziert wurde — aber das ist ein Complaint-Code, keine
  // Ablehnung, und ein negativer Warenposten verdient so oder so einen Blick.
  const signWrong = receipt.items.some((i) =>
    (i.lineType === 'deposit' && i.totalPriceCents < 0) ||
    (i.lineType === 'deposit_return' && i.totalPriceCents > 0) ||
    (i.lineType === 'discount' && i.totalPriceCents > 0) ||
    (i.lineType === 'loyalty' && i.totalPriceCents !== 0) ||
    (i.lineType === 'article' && i.totalPriceCents < 0)
  );
  if (signWrong) problems.push('sign_mismatch');

  return problems;
}
