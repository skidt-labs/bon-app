/**
 * Der Vergleichslauf (Etappe 4): beide OCR-Engines ueber dieselben echten Bons, danach
 * beide durch dasselbe Modell auf der Hardware des Betreibers.
 *
 *   set -a; . ./.env; set +a
 *   OCR_PADDLE_URL=http://<ip-des-dienstes>:8000 \
 *     npx vite-node scripts/ocr-vergleich.ts -- docs/ocr-vergleich.md
 *
 * SCHREIBT NICHT IN DIE DATENBANK. Er liest `receipts` und `receipt_items` und legt
 * einen Markdown-Bericht ab — sonst nichts. Ein Vergleichslauf, der nebenbei
 * `extraction_runs` fuellt, verfaelscht genau die Tabelle, aus der spaeter die
 * Betriebsstatistik gelesen wird, und ein zweiter Lauf wuerde die Bons der Produktion
 * ueberschreiben.
 *
 * Die Bilder gehen an Tesseract im selben Prozess und an `bon-paddleocr` im
 * Nachbarcontainer. Nichts davon verlaesst den Server; das Modell laeuft auf dem Mac
 * des Betreibers.
 */
import { readFile } from 'node:fs/promises';
import { writeFileSync, accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '../src/lib/server/db';
import { receipts, receiptItems } from '../src/lib/server/db/schema';
import { receiptPathFor } from '../src/lib/server/storage/images';
import { erzeugeTesseractAnbieter } from '../src/lib/server/ocr/anbieter';
import { erzeugePaddleOcrAnbieter } from '../src/lib/server/ocr/paddle';
import { pruefeOcrQualitaet } from '../src/lib/server/ocr/qualitaet';
import { bericht, beanstandungCode } from '../src/lib/server/ocr/vergleich';
import type { Messpunkt } from '../src/lib/server/ocr/vergleich';
import type { OcrAnbieter } from '../src/lib/server/ocr/anbieter';
import type { ExecFileImpl } from '../src/lib/server/ocr/lesen';
import { createOcrTextProvider } from '../src/lib/server/extraction/ocr-text-provider';
import { checkPlausibility } from '../src/lib/server/validation/plausibility';

const ZIEL = resolve(process.argv[2] ?? 'docs/ocr-vergleich.md');
/**
 * Die Rohmesswerte neben dem Bericht. Nicht Zierde, sondern Lehre aus dem ersten Lauf:
 * der lief 25 Minuten durch alle Bons und beide Engines und starb dann beim Schreiben
 * an einem relativen Pfad, der ins Leere zeigte — die gesamte Messung war weg, weil sie
 * nur im Speicher stand. Seitdem wird ERST geprueft, ob geschrieben werden kann, und am
 * Ende stehen die Messwerte als JSON daneben. Damit laesst sich der Bericht neu
 * erzeugen, ohne noch einmal 18-mal das Modell zu fragen.
 */
const ZIEL_DATEN = ZIEL.replace(/\.md$/, '') + '.json';

function pflicht(name: string): string {
	const w = process.env[name];
	if (!w) throw new Error(`${name} fehlt — zuerst: set -a; . ./.env; set +a`);
	return w;
}

/**
 * Anteil der bestaetigten Positionsbetraege, die in der Auslesung wieder vorkommen.
 *
 * Bewusst ueber die BETRAEGE und nicht ueber die Artikelnamen: ein Name kann
 * abgekuerzt, gross- oder kleingeschrieben und trotzdem richtig sein, ein Betrag nicht.
 * Und ein falscher Betrag ist der Fehler, der in einem Haushaltsbuch tatsaechlich weh
 * tut. Mehrfach vorkommende Betraege werden mit ihrer Anzahl gezaehlt, damit zwei
 * gleiche Positionen nicht von einer einzigen erschlagen werden.
 */
function betraegeGetroffen(soll: number[], ist: number[]): number {
	if (soll.length === 0) return 1;
	const vorrat = [...ist];
	let treffer = 0;
	for (const s of soll) {
		const i = vorrat.indexOf(s);
		if (i >= 0) {
			vorrat.splice(i, 1);
			treffer++;
		}
	}
	return treffer / soll.length;
}

async function main() {
	// VOR der ersten Messung, nicht danach. Eine halbe Stunde Modellzeit darf nicht an
	// einem Verzeichnis scheitern, das es nicht gibt.
	try {
		accessSync(dirname(ZIEL), constants.W_OK);
	} catch {
		throw new Error(
			`Das Zielverzeichnis ${dirname(ZIEL)} ist nicht beschreibbar — der Lauf wird gar ` +
				`nicht erst begonnen. Zielpfad als zweites Argument angeben.`
		);
	}

	const paddleUrl = process.env.OCR_PADDLE_URL ?? 'http://bon-paddleocr:8000';
	const anbieter: Record<string, OcrAnbieter> = {
		tesseract: erzeugeTesseractAnbieter({ execFileImpl: tesseractImWorker }),
		paddleocr: erzeugePaddleOcrAnbieter({ baseUrl: paddleUrl })
	};

	const modellName = pflicht('EXTRACTION_MODEL');
	const alle = await db.select().from(receipts);
	const punkte: Messpunkt[] = [];

	for (const bon of alle) {
		if (!bon.imagePath) continue;
		let bild: Buffer;
		try {
			bild = await readFile(receiptPathFor(bon.imagePath));
		} catch (e) {
			console.error(`[vergleich] ${bon.id}: Bild nicht lesbar, uebersprungen (${e})`);
			continue;
		}
		const masse = await sharp(bild).metadata();

		// Sollwerte NUR von bestaetigten Bons. Ein Bon im Zustand 'review' traegt die
		// Auslesung, die geprueft werden soll — ihn als Sollwert zu nehmen hiesse, die
		// Engine gegen sich selbst zu messen.
		const gepruefte =
			bon.status === 'confirmed'
				? await db.select().from(receiptItems).where(eq(receiptItems.receiptId, bon.id))
				: null;

		for (const [name, ocr] of Object.entries(anbieter)) {
			const engine = name as 'tesseract' | 'paddleocr';
			process.stderr.write(`[vergleich] ${bon.id.slice(0, 8)} / ${engine} ... `);

			// Dieser Lauf liefert die OCR-Kennzahlen (Zeilen, Confidence, Dauer). Der
			// Anbieter weiter unten liest DASSELBE Bild noch einmal — das ist Absicht:
			// er ist der Weg, den auch der Betrieb geht, und ein nachgebauter Aufruf
			// haette gemessen, was hier steht, statt was dort passiert. Die doppelte
			// Texterkennung kostet wenige Sekunden je Bon gegen 30 bis 60 s Modellzeit.
			const gelesen = await ocr.lies(bild, { mitBoxen: true });
			const punkt: Messpunkt = {
				bonId: bon.id,
				engine,
				bildBreite: masse.width ?? 0,
				bildHoehe: masse.height ?? 0,
				ocr:
					gelesen.status === 'gelesen'
						? {
								status: 'gelesen',
								dauerMs: gelesen.durationMs,
								zeilen: gelesen.zeilen?.length ?? gelesen.text.split('\n').length,
								zeichen: gelesen.text.length,
								confidence: mittlereConfidence(gelesen.zeilen)
							}
						: {
								status: gelesen.status,
								dauerMs: gelesen.durationMs,
								grund: gelesen.status === 'werkzeugKaputt' ? gelesen.grund : undefined
							},
				tuersteher: null,
				modell: null,
				gegenBestaetigt: null
			};

			if (gelesen.status === 'gelesen') {
				const urteil = pruefeOcrQualitaet(gelesen.text);
				punkt.tuersteher = {
					brauchbar: urteil.brauchbar,
					anzahlBetraege: urteil.anzahlBetraege,
					hatSummenzeile: urteil.hatSummenzeile
				};

				if (urteil.brauchbar) {
					// Derselbe Anbieter wie im Betrieb, nur mit der hier gewaehlten Engine —
					// damit misst der Vergleich den echten Weg und keinen nachgebauten.
					const provider = createOcrTextProvider({
						baseUrl: pflicht('EXTRACTION_BASE_URL'),
						apiKey: pflicht('EXTRACTION_API_KEY'),
						model: modellName,
						timeoutMs: Number(process.env.EXTRACTION_TIMEOUT_MS ?? 300_000),
						ocrAnbieter: ocr
					});
					const begonnen = Date.now();
					try {
						const ergebnis = await provider.extract(bild);
						// Nur Codes, kein Bontext: die Meldungen des Anbieters tragen
						// Artikelnamen und Betraege mit sich, und der Bericht landet in
						// `docs/`. Siehe `beanstandungCode`.
						const beanstandungen = [
							...checkPlausibility(ergebnis.receipt),
							...ergebnis.warnings
						].map(beanstandungCode);
						punkt.modell = {
							status: 'gelesen',
							dauerMs: Date.now() - begonnen,
							positionen: ergebnis.receipt.items.length,
							beanstandungen
						};
						if (gepruefte) {
							const soll = gepruefte.map((i) => i.totalPriceCents).filter((c): c is number => c !== null);
							const ist = ergebnis.receipt.items
								.map((i) => i.totalPriceCents)
								.filter((c): c is number => c !== null);
							punkt.gegenBestaetigt = {
								summeStimmt: ergebnis.receipt.totalGrossCents === bon.totalGrossCents,
								positionenSoll: gepruefte.length,
								positionenIst: ergebnis.receipt.items.length,
								betraegeGetroffen: betraegeGetroffen(soll, ist)
							};
						}
					} catch (err) {
						punkt.modell = {
							status: 'gescheitert',
							dauerMs: Date.now() - begonnen,
							fehler: err instanceof Error ? err.message : String(err)
						};
					}
				}
			}

			punkte.push(punkt);
			process.stderr.write(
				`${punkt.ocr.status}, Tuersteher ${punkt.tuersteher?.brauchbar ?? '—'}, ` +
					`Modell ${punkt.modell?.status ?? '—'}\n`
			);
		}
	}

	// Zuerst die Rohdaten, dann der Bericht: geht beim Darstellen etwas schief, ist die
	// Messung trotzdem gerettet.
	writeFileSync(ZIEL_DATEN, JSON.stringify(punkte, null, 2) + '\n', 'utf8');
	const text = bericht(punkte, {
		datum: new Date().toISOString().slice(0, 10),
		modell: modellName
	});
	writeFileSync(ZIEL, text + '\n', 'utf8');
	console.log(`\nBericht: ${ZIEL}\nMesswerte: ${ZIEL_DATEN} (${punkte.length} Messpunkte)`);
	process.exit(0);
}

/**
 * Tesseract laeuft im Abbild von `bon-worker`, nicht auf dem Host. Statt es fuer den
 * Vergleichslauf zusaetzlich auf dem Host zu installieren, ruft dieser Lauf GENAU das
 * Programm auf, das auch im Betrieb liest — dieselbe Version, dieselben Sprachdaten.
 * Eine zweite Installation waere eine zweite Fehlerquelle und haette den Vergleich
 * gegen eine Engine gefuehrt, die so nie einen echten Bon gelesen hat.
 *
 * PaddleOCR braucht das nicht: es spricht ohnehin ueber HTTP mit seinem Container.
 */
const tesseractImWorker: ExecFileImpl = (file, args, _optionen, stdin) =>
	new Promise((aufloesen, ablehnen) => {
		const kind = spawn('docker', ['exec', '-i', 'bon-worker', file, ...args]);
		let stdout = '';
		let stderr = '';
		kind.stdout.on('data', (d) => (stdout += d));
		kind.stderr.on('data', (d) => (stderr += d));
		kind.on('error', ablehnen);
		kind.on('close', (code) =>
			code === 0
				? aufloesen({ stdout, stderr })
				: ablehnen(new Error(`tesseract endete mit ${code}: ${stderr.slice(0, 200)}`))
		);
		if (stdin) kind.stdin.end(stdin);
		else kind.stdin.end();
	});

function mittlereConfidence(zeilen?: { confidence: number | null }[]): number | null {
	if (!zeilen) return null;
	const bekannte = zeilen.map((z) => z.confidence).filter((c): c is number => c !== null);
	return bekannte.length ? bekannte.reduce((a, b) => a + b, 0) / bekannte.length : null;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
