import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { erzeugePaddleOcrAnbieter } from './paddle';
import { kurz } from './anbieter';
import { ordneZeilenZu } from './zuordnung';
import { abweichungInZeile } from '$lib/bons/betraege';

/**
 * Die Sichtpruefung der Zuordnung an einem ECHTEN Bon (Etappe 2, Aufgabe 2.4 Schritt 5).
 * Hinter RUN_OCR_LIVE=1, nicht Teil der normalen Suite:
 *
 *   RUN_OCR_LIVE=1 BON_ID=<uuid> BERICHT=/pfad/ausserhalb/des/repos.txt \
 *   PADDLE_URL=http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' bon-paddleocr):8000 \
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" \
 *     npx vitest run src/lib/server/ocr/zuordnung.live.test.ts
 *
 * NUR LESEND: liest den Bon und seine Positionen, laesst PaddleOCR das Bild noch einmal
 * lesen und rechnet die Zuordnung nach. Es wird nichts geschrieben — weder in die
 * Datenbank noch an die Warteschlange.
 *
 * Die ZUSICHERUNGEN pruefen nur Struktur (Index im Bereich, keine Zeile doppelt
 * vergeben). Die Tabelle, an der ein Mensch die Zuordnung beurteilt, geht in eine Datei
 * AUSSERHALB des Repos — echter Bontext wird nicht eingecheckt und darf auch nicht in
 * einem Testprotokoll landen (dieselbe Regel wie in paddle.live.test.ts).
 */
const AUS = process.env.RUN_OCR_LIVE !== '1';
const URL_ = process.env.PADDLE_URL ?? 'http://bon-paddleocr:8000';
const BON_ID = process.env.BON_ID ?? '';
const BERICHT = process.env.BERICHT ?? '';

describe.skipIf(AUS)('Zuordnung an einem echten Bon', () => {
	it('ordnet jede Position hoechstens einer Bildzeile zu', async () => {
		expect(BON_ID, 'BON_ID fehlt').not.toBe('');
		expect(BERICHT, 'BERICHT (Zielpfad ausserhalb des Repos) fehlt').not.toBe('');

		const [bon] = await db
			.select({ id: receipts.id, pfad: receipts.imagePath })
			.from(receipts)
			.where(eq(receipts.id, BON_ID));
		expect(bon, 'Bon nicht gefunden').toBeTruthy();

		const positionen = await db
			.select({
				lineNo: receiptItems.lineNo,
				rawText: receiptItems.rawText,
				lineType: receiptItems.lineType,
				totalPriceCents: receiptItems.totalPriceCents,
				unitPriceCents: receiptItems.unitPriceCents
			})
			.from(receiptItems)
			.where(eq(receiptItems.receiptId, bon.id))
			.orderBy(asc(receiptItems.lineNo));

		const anbieter = erzeugePaddleOcrAnbieter({ baseUrl: URL_ });
		// Puffer, NICHT Pfad: PaddleOCR laeuft in einem eigenen Container und sieht das
		// Dateisystem des Aufrufers nicht (der Anbieter lehnt einen Pfad ausdruecklich ab).
		const bild = readFileSync(join('data', 'receipts', bon.pfad));
		const ergebnis = await anbieter.lies(bild, { mitBoxen: true, timeoutMs: 300_000 });
		expect(
			ergebnis.status,
			`OCR nicht gelesen: ${'grund' in ergebnis ? ergebnis.grund : ''}`
		).toBe('gelesen');
		if (ergebnis.status !== 'gelesen' || !ergebnis.zeilen) return;
		const zeilen = kurz(ergebnis.zeilen);

		const zuordnung = ordneZeilenZu(
			positionen.map((p) => ({
				lineNo: p.lineNo,
				rawText: p.rawText,
				totalPriceCents: p.totalPriceCents
			})),
			zeilen
		);

		// Struktur, nicht Inhalt: jeder Index liegt im Bereich, keine Bildzeile ist
		// zweimal vergeben. Ob die Zuordnung SINNVOLL ist, entscheidet der Mensch
		// anhand der Tabelle unten — das kann keine Zusicherung.
		const vergeben = new Set<number>();
		for (const [, i] of zuordnung) {
			if (i === null) continue;
			expect(i).toBeGreaterThanOrEqual(0);
			expect(i).toBeLessThan(zeilen.length);
			expect(vergeben.has(i), 'Bildzeile doppelt vergeben').toBe(false);
			vergeben.add(i);
		}

		const zugeordnet = [...zuordnung.values()].filter((i) => i !== null).length;
		const zeilenText = [
			`Bon ${bon.id}`,
			`Bild: ${bon.pfad}`,
			`OCR-Zeilen: ${zeilen.length} · Positionen: ${positionen.length} · zugeordnet: ${zugeordnet}`,
			'',
			'Nr | Art         | Position (Modell)            | Betrag | → Bildzeile | Text im Bild',
			'---+-------------+------------------------------+--------+-------------+-------------'
		];
		for (const p of positionen) {
			const i = zuordnung.get(p.lineNo) ?? null;
			const bild = i === null ? '—' : String(i);
			const text = i === null ? '' : zeilen[i].text;
			const abw =
				i === null ? null : abweichungInZeile(zeilen, i, p.totalPriceCents, p.unitPriceCents);
			zeilenText.push(
				`${String(p.lineNo).padStart(2)} | ${p.lineType.padEnd(11)} | ${p.rawText.slice(0, 28).padEnd(28)} | ${(p.totalPriceCents / 100).toFixed(2).padStart(6)} | ${bild.padStart(11)} | ${text}` +
					(abw === null ? '' : `   ◀ ABWEICHUNG: im Bild ${(abw / 100).toFixed(2)}`)
			);
		}
		zeilenText.push('', '--- alle OCR-Zeilen ---');
		zeilen.forEach((z, i) =>
			zeilenText.push(`${String(i).padStart(3)} [${z.box.join(',')}] ${z.text}`)
		);

		mkdirSync(dirname(BERICHT), { recursive: true });
		writeFileSync(BERICHT, zeilenText.join('\n') + '\n', 'utf-8');
		console.log(
			`Bericht geschrieben: ${BERICHT} — ${zugeordnet} von ${positionen.length} Positionen zugeordnet, ${zeilen.length} OCR-Zeilen.`
		);
	}, 360_000);
});
