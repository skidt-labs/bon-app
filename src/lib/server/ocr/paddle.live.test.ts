import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { erzeugePaddleOcrAnbieter } from './paddle';
import { pruefeOcrQualitaet } from './qualitaet';

/**
 * Live-Waechter gegen den ECHTEN Dienst `bon-paddleocr` — deshalb hinter
 * RUN_PADDLE_TESTS=1 und NICHT Teil der normalen Suite (die muss ohne laufende
 * Container gruen sein). Nach dem Vorbild von RUN_MLX_TESTS/RUN_DB_TESTS:
 *
 *   RUN_PADDLE_TESTS=1 \
 *   PADDLE_URL=http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' bon-paddleocr):8000 \
 *   npx vitest run src/lib/server/ocr/paddle.live.test.ts
 *
 * Die Adresse muss aus dem Container geholt werden: der Dienst veroeffentlicht
 * absichtlich keinen Port auf dem Host (er soll nur von bon-worker erreichbar sein).
 * Der Standardwert unten ist der Name im Docker-Netz und funktioniert nur, wenn der
 * Test IM Container laeuft.
 *
 * Er liest die ECHTEN Bons aus `data/receipts` — sie liegen auf diesem Server und
 * gehen nur an den Nachbarcontainer. Deshalb prueft dieser Test ausschliesslich
 * KENNZAHLEN (Anzahl Zeilen, Confidence, Urteil des Tuerstehers) und schreibt
 * niemals Bontext in die Ausgabe: eine durchgefallene Zusicherung darf keinen
 * Kassenbon ins Protokoll kippen.
 */
const AUS = process.env.RUN_PADDLE_TESTS !== '1';
const URL_ = process.env.PADDLE_URL ?? 'http://bon-paddleocr:8000';
const BON_ORDNER = join('data', 'receipts', '2026', '09');

function echteBons(): string[] {
	try {
		return readdirSync(BON_ORDNER)
			.filter((n) => n.endsWith('.webp') && !n.includes('.thumb.'))
			.map((n) => join(BON_ORDNER, n));
	} catch {
		return [];
	}
}

describe.skipIf(AUS)('PaddleOCR gegen den echten Dienst', () => {
	const anbieter = erzeugePaddleOcrAnbieter({ baseUrl: URL_ });

	it('liest jeden Bon im Bestand und besteht damit den Tuersteher', async () => {
		const bons = echteBons();
		expect(bons.length, 'keine Bons in data/receipts gefunden').toBeGreaterThan(0);

		for (const pfad of bons) {
			const ergebnis = await anbieter.lies(readFileSync(pfad), { mitBoxen: true });
			expect(ergebnis.status, pfad).toBe('gelesen');
			if (ergebnis.status !== 'gelesen') continue;

			// Der Tuersteher ist die Stelle, an der sich entscheidet, ob ein Bon
			// ueberhaupt ans Modell geht. Eine Engine, die zwar liest, aber regelmaessig
			// daran scheitert, waere in der Messung wertlos.
			const urteil = pruefeOcrQualitaet(ergebnis.text);
			expect(urteil.brauchbar, `${pfad}: ${JSON.stringify({ ...urteil })}`).toBe(true);

			// Jede Zeile hat einen Rahmen und eine Confidence auf Tesseracts Skala.
			const zeilen = ergebnis.zeilen ?? [];
			expect(zeilen.length, pfad).toBeGreaterThan(20);
			for (const z of zeilen) {
				expect(z.box, pfad).toHaveLength(4);
				expect(z.confidence, pfad).toBeGreaterThan(1);
				expect(z.confidence, pfad).toBeLessThanOrEqual(100);
			}
		}
	}, 600_000);

	it('meldet sich gesund, und zwar erst nach einem gelesenen Probebild', async () => {
		const antwort = await fetch(`${URL_}/health`);
		expect(antwort.status).toBe(200);
		const daten = (await antwort.json()) as {
			status: string;
			probe: { ok: boolean };
			optionen: Record<string, unknown>;
		};
		expect(daten.status).toBe('gesund');
		expect(daten.probe.ok).toBe(true);
		// Auflage 2: die Groessengrenze steht fest im Dienst. Laeuft er ohne sie, findet
		// er auf langen Bons nur einen Bruchteil der Artikel — bei hoher Confidence,
		// also ohne jedes Warnzeichen.
		expect(daten.optionen).toMatchObject({ detLimitSideLen: 8000, detLimitType: 'max' });
	});
});
