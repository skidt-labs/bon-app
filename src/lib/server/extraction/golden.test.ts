import { describe, it, expect } from 'vitest';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from './index';
import { storeReceiptImage, receiptPathFor } from '../storage/images';

const DIR = 'tests/fixtures/receipts';
const RUN = process.env.RUN_GOLDEN === '1';
const BILD_ENDUNGEN = ['.png', '.jpg', '.jpeg', '.webp'];

async function findeBild(stem: string): Promise<string> {
  const dateien = await readdir(DIR);
  const treffer = dateien.find((f) => BILD_ENDUNGEN.some((e) => f === stem + e));
  if (!treffer) throw new Error(`Kein Bild zu ${stem} gefunden (${BILD_ENDUNGEN.join('/')})`);
  return join(DIR, treffer);
}

/**
 * Schickt die Vorlage durch DIESELBE Aufbereitung wie der Upload-Pfad
 * (2000 px lange Kante, WebP Q82). Ohne das prüfte der Test ein anderes Bild,
 * als die Produktion je zu sehen bekommt — ein 1,7-MB-PNG statt 70 KB WebP —
 * und wäre über Erkennungsqualität und Tokenverbrauch nicht aussagekräftig.
 */
async function wieImUpload(pfad: string): Promise<Buffer> {
  const vorher = process.env.RECEIPT_DIR;
  const tmp = await mkdtemp(join(tmpdir(), 'golden-'));
  process.env.RECEIPT_DIR = tmp;
  try {
    const { imagePath } = await storeReceiptImage(await readFile(pfad), new Date());
    return await readFile(receiptPathFor(imagePath));
  } finally {
    process.env.RECEIPT_DIR = vorher;
    await rm(tmp, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN)('Goldenes Testset', async () => {
  const files = RUN ? (await readdir(DIR)).filter((f) => f.endsWith('.expected.json')) : [];

  for (const expectedFile of files) {
    const stem = expectedFile.replace('.expected.json', '');

    it(`liest ${stem} korrekt`, async () => {
      const expected = JSON.parse(await readFile(join(DIR, expectedFile), 'utf8'));
      // getProvider().extract() liefert { receipt, usage }, nicht den Bon direkt
      // (siehe ExtractionResult in ./types) — der Bon-Vergleich läuft auf .receipt.
      const { receipt: actual } = await getProvider().extract(await wieImUpload(await findeBild(stem)));

      expect(actual.totalGrossCents).toBe(expected.totalGrossCents);
      expect(actual.items).toHaveLength(expected.items.length);

      for (const [i, want] of expected.items.entries()) {
        const got = actual.items[i];
        // Bewusst NUR Preis und Zeilentyp: Zwei Läufe bei temperature 0 lieferten
        // für dieselbe Zeile einmal quantity "1"/"stk" und einmal null. Ein Test,
        // der jedes Feld vergleicht, wird flatterhaft und irgendwann ignoriert.
        // Hier stehen genau die Felder, bei denen ein Fehler wehtut.
        expect(got.totalPriceCents, `Zeile ${i + 1} Preis`).toBe(want.totalPriceCents);
        expect(got.lineType, `Zeile ${i + 1} Typ`).toBe(want.lineType);

        // Rabattbezug nur prüfen, wo die Vorlage ihn vorgibt — das ist einer der
        // sechs Fallstricke und würde sonst still verloren gehen.
        if (want.appliesToLine != null) {
          expect(got.appliesToLine, `Zeile ${i + 1} Rabattbezug`).toBe(want.appliesToLine);
        }
      }
    }, 120_000);
  }
});
