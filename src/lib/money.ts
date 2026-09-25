/** Gruppierte Schreibweise: 1.234 / 1.234,56 / 1.234.567,89 */
const GROUPED = /^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
/** Einfache Schreibweise: 5 / 1,09 / 12.34 / -0,50 */
const PLAIN = /^-?\d+(?:[.,]\d{1,2})?$/;

export function parseAmountToCents(raw: string): number {
  // Nur Leerraum und Währungsmarker entfernen — Buchstaben bleiben stehen. Sonst würde z.B.
  // "MwSt 19%" nach dem Strippen wie "1919" bzw. "19" aussehen und als 19,00 € durchgehen,
  // obwohl es gar kein Betrag ist (Bons enthalten viele ziffernhaltige Nicht-Beträge:
  // Steuersätze, Mengen, Datumsangaben, EAN-Codes).
  const stripped = raw.replace(/\s|EUR|€/gi, '');

  let normalised: string;
  if (GROUPED.test(stripped)) {
    // Punkte sind Tausendertrennzeichen, das Komma (falls vorhanden) ist das Dezimaltrennzeichen.
    normalised = stripped.replace(/\./g, '').replace(',', '.');
  } else if (PLAIN.test(stripped)) {
    // Höchstens ein Trennzeichen, das ist immer das Dezimaltrennzeichen.
    normalised = stripped.replace(',', '.');
  } else {
    throw new Error(`Kein Betrag lesbar: ${raw}`);
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    throw new Error(`Kein Betrag lesbar: ${raw}`);
  }
  return Math.round(value * 100);
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
