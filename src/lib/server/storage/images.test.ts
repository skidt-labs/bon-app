import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bon-'));
  process.env.RECEIPT_DIR = dir;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('storeReceiptImage', () => {
  it('legt Original und Thumbnail unter Jahr/Monat ab', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 900, height: 2400, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { imagePath, thumbPath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));

    expect(imagePath).toMatch(/^2026\/09\/[0-9a-f-]{36}\.webp$/);
    expect(thumbPath).toMatch(/^2026\/09\/[0-9a-f-]{36}\.thumb\.webp$/);
    await expect(readFile(join(dir, imagePath))).resolves.toBeInstanceOf(Buffer);
  });

  // Die Breite ist die Kante, auf die es beim Lesen ankommt: ein Bon ist schmal und
  // lang, und die Zeichenbreite entscheidet, ob Text noch entzifferbar ist. Die alte
  // Regel begrenzte die LAENGSTE Kante auf 2000 px — bei einem langen Bon ging das
  // Budget in die Hoehe und die Breite fiel auf unter 300 px. Gemessen am 2026-09-15:
  // ein echter Bon lag als 276x2000 vor, rund 13 Pixel je Zeichen; Tesseract las
  // daraus nur noch Kauderwelsch, waehrend zwei breitere Bons (383/395 px) sauber
  // gelesen wurden. Das Original wird nicht aufbewahrt, der Verlust ist endgueltig.
  it('quetscht einen langen Bon nicht in der Breite zusammen', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 1200, height: 4000, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { imagePath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    const meta = await sharp(join(dir, imagePath)).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(4000);
  });

  it('begrenzt die Breite nach oben', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { imagePath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    const meta = await sharp(join(dir, imagePath)).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1200);
  });

  // Auch die Hoehe braucht eine Decke, sonst frisst ein sehr langer Bon beliebig viel
  // Speicher und Bild-Tokens. Erst wenn sie greift, darf die Breite wieder schrumpfen.
  it('begrenzt einen extrem langen Bon ueber die Hoehe', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 1500, height: 12000, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { imagePath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    const meta = await sharp(join(dir, imagePath)).metadata();
    expect(meta.height).toBe(8000);
    expect(meta.width).toBe(1000);
  });

  it('vergroessert ein kleines Bild nicht', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 400, height: 900, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { imagePath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    const meta = await sharp(join(dir, imagePath)).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(900);
  });

  // Aufgabe 3 (Entwurf E4): der Matrix-Bot muss warnen können, wenn Element ein Foto
  // kaputtkomprimiert — dafür braucht er die tatsächliche Breite des gespeicherten
  // Bildes (also NACH Rotation/Resize, genau das, was Tesseract später sieht).
  it('liefert die tatsächliche Breite mit (Entwurf E4)', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 900, height: 2400, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { width } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    expect(width).toBe(900);
  });

  it('liefert die begrenzte Breite mit, wenn MAX_WIDTH greift', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { width } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    expect(width).toBe(1600);
  });

  it('macht das Thumbnail deutlich kleiner', async () => {
    const { storeReceiptImage } = await import('./images');
    const input = await sharp({
      create: { width: 900, height: 2400, channels: 3, background: '#fff' }
    }).jpeg().toBuffer();

    const { thumbPath } = await storeReceiptImage(input, new Date('2026-09-13T10:00:00Z'));
    const meta = await sharp(join(dir, thumbPath)).metadata();
    expect(meta.height).toBe(600);
  });
});

// Befund R03: /api/receipts behandelte JEDE Exception aus storeReceiptImage pauschal
// als 422 ("Bild nicht verarbeitbar") und liess die Outbox die einzige Kopie des
// Fotos loeschen — auch bei einer vollen Platte (ENOSPC), an der das Bild selbst
// unversehrt ist. istSystemfehler() unterscheidet ueber den Fehlercode, den Node bei
// Dateisystemfehlern setzt, nicht ueber sharps (instabilen) Fehlertext.
describe('istSystemfehler', () => {
  it('erkennt jeden bekannten Dateisystemfehlercode', async () => {
    const { istSystemfehler } = await import('./images');
    for (const code of ['ENOSPC', 'EACCES', 'EROFS', 'EDQUOT', 'EIO', 'EMFILE', 'ENFILE', 'ENOENT']) {
      expect(istSystemfehler(Object.assign(new Error('x'), { code }))).toBe(true);
    }
  });

  it('haelt einen sharp-Dekodierfehler (kein .code) fuer KEINEN Systemfehler', async () => {
    const { istSystemfehler } = await import('./images');
    expect(istSystemfehler(new Error('Input buffer contains unsupported image format'))).toBe(false);
  });

  // Im Zweifel 422 (Foto weg, aber wenigstens kein haengenbleibender 5xx), nicht 5xx
  // (koennte einen Client dauerhaft denselben unlesbaren Upload wiederholen lassen).
  it('behandelt einen unbekannten Fehlercode NICHT als Systemfehler', async () => {
    const { istSystemfehler } = await import('./images');
    expect(istSystemfehler(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(false);
  });

  it('kommt mit Nicht-Objekt-Fehlern klar', async () => {
    const { istSystemfehler } = await import('./images');
    expect(istSystemfehler(null)).toBe(false);
    expect(istSystemfehler(undefined)).toBe(false);
    expect(istSystemfehler('kaputt')).toBe(false);
  });
});
