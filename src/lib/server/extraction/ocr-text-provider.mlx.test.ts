import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOcrTextProvider } from './ocr-text-provider';

/**
 * Live-Wächter gegen den ECHTEN Mac (mlx.example.org) — deshalb hinter
 * RUN_MLX_TESTS=1 und NICHT Teil der normalen Suite (die muss ohne Netz und ohne den
 * Mac laufen, siehe Aufgabenstellung). Nach dem Vorbild von RUN_DB_TESTS/RUN_GOLDEN:
 *
 *   set -a; . ./.env; set +a
 *   RUN_MLX_TESTS=1 npx vitest run src/lib/server/extraction/ocr-text-provider.mlx.test.ts
 *
 * WICHTIG (siehe Task-2-Bericht): das in `.env` hinterlegte EXTRACTION_API_KEY gehört
 * zum Cloud-Anbieter (Abacus) der laufenden Produktion, NICHT zu mlx.example.org —
 * ein Testaufruf mit diesem Schlüssel gegen den Mac schlug in dieser Session mit
 * HTTP 401 "Invalid or missing API key" fehl. Dieser Test bleibt trotzdem an
 * EXTRACTION_API_KEY/EXTRACTION_BASE_URL/EXTRACTION_MODEL hängen (wie in der
 * Aufgabenstellung vorgegeben) — er braucht einen für mlx.example.org gültigen
 * Schlüssel in genau dieser Variable, um grün zu laufen.
 *
 * Es gibt zu den Vorlagen in tests/fixtures/ocr/ KEINE Originalbilder (Aufgabe 1 hat
 * bewusst nur den bereits anonymisierten OCR-TEXT abgelegt, siehe deren README.md) —
 * dieser Test kann also nicht `provider.extract(bildPuffer)` Ende-zu-Ende gegen ein
 * Foto laufen lassen. Er speist stattdessen die Vorlage über `execFileImpl` GENAU dort
 * ein, wo sonst Tesseract stünde (derselbe Injektionspunkt wie in den Unit-Tests) —
 * "echt" ist an diesem Test der MODELLAUFRUF, nicht der Tesseract-Schritt.
 */
const RUN = process.env.RUN_MLX_TESTS === '1';
const FIXTURES = join('tests', 'fixtures', 'ocr');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ist nicht gesetzt`);
  return value;
}

function providerMitVorlage(execFileImpl: Parameters<typeof createOcrTextProvider>[0]['execFileImpl']) {
  return createOcrTextProvider({
    baseUrl: requireEnv('EXTRACTION_BASE_URL'),
    apiKey: requireEnv('EXTRACTION_API_KEY'),
    model: requireEnv('EXTRACTION_MODEL'),
    timeoutMs: 150_000,
    execFileImpl
  });
}

async function ausVorlage(datei: string) {
  const text = await readFile(join(FIXTURES, datei), 'utf8');
  return providerMitVorlage(async () => ({ stdout: text, stderr: '' }));
}

const MONETARY = new Set(['article', 'deposit', 'deposit_return', 'discount']);

describe.skipIf(!RUN)('Textweg-Anbieter gegen den echten Mac (mlx.example.org)', () => {
  // Erwartungswerte aus der Aufgabenstellung (bestätigte Wahrheit bzw. nachgerechnet):
  // Endsumme 4001, 24 echte Positionen, sieben Rabatte mit Bezugszeile — die Zahl
  // stammt aus `select count(*) ... where line_type='discount'` auf dem bestaetigten
  // Bon, nicht aus einer Erinnerung. Sie stand hier zuerst als "acht", weil der
  // Koordinator sie im Auftragstext falsch angab; der Test schlug dadurch an einem
  // korrekten Modellergebnis fehl. Der bekannte
  // Restfehler (eine erfundene 25. deposit-Zeile über +1,00 EUR) muss durch die
  // Code-Regel in ocr-text-provider.ts entfernt sein — DESHALB hier 24, nicht 25.
  it('liest den langen Lidl-Bon (24 Positionen, sieben Rabatte) korrekt', async () => {
    const provider = await ausVorlage('lidl-lang-1130px.txt');

    const { receipt, warnings } = await provider.extract(Buffer.from('unbenutzt'));

    expect(receipt.totalGrossCents).toBe(4001);
    expect(receipt.items).toHaveLength(24);

    const rabatte = receipt.items.filter((i) => i.lineType === 'discount');
    expect(rabatte).toHaveLength(7);
    for (const r of rabatte) {
      expect(r.appliesToLine, `Rabatt ohne Bezugszeile: ${JSON.stringify(r)}`).not.toBeNull();
    }

    // Keine info-Zeilen — der Zusatz verbietet das ausdrücklich (siehe
    // ocr-prompt-zusatz.ts).
    expect(receipt.items.some((i) => i.lineType === 'info')).toBe(false);

    const summe = receipt.items
      .filter((i) => MONETARY.has(i.lineType))
      .reduce((acc, i) => acc + i.totalPriceCents, 0);
    expect(summe, `Positionssumme ${summe} gegen Endsumme ${receipt.totalGrossCents}`).toBe(
      receipt.totalGrossCents
    );

    // Falls die Prompt-Runde (OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR) tatsächlich greift,
    // hat die Code-Regel nichts zu entfernen — beides ist ein bestandener Lauf. War
    // die erfundene Zeile da, MUSS warnings sie melden (sonst wäre die Entfernung
    // still, genau das, was Aufgabenstellung und ExtractionResult.warnings verbieten).
    if (warnings.length > 0) {
      expect(warnings[0]).toContain('entfernt');
    }
  }, 180_000);

  it('liest den kurzen Lidl-Bon (drei Positionen) korrekt', async () => {
    const provider = await ausVorlage('lidl-kurz-448px.txt');

    const { receipt } = await provider.extract(Buffer.from('unbenutzt'));

    expect(receipt.totalGrossCents).toBe(757);
    expect(receipt.items).toHaveLength(3);
    const summe = receipt.items
      .filter((i) => MONETARY.has(i.lineType))
      .reduce((acc, i) => acc + i.totalPriceCents, 0);
    expect(summe).toBe(757);
  }, 180_000);
});
