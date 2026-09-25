import { describe, it, expect } from 'vitest';
import { nachlaufStarten, ohneKategorie } from './nachlauf';
import { echteModellDeps } from './modell';

/**
 * Der Nachlauf als ausfuehrbarer Lauf — hinter RUN_NACHLAUF=1, damit er nie
 * versehentlich in der Suite mitlaeuft. Er SCHREIBT (anders als die uebrigen
 * .db.test-Dateien, die zurueckrollen):
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_NACHLAUF=1 \
 *     npx vitest run src/lib/server/kategorien/nachlauf.run.test.ts
 *
 * Er fasst nur LEERE Kategorien an; von Menschen gesetzte bleiben unberuehrt.
 */
const AUS = process.env.RUN_NACHLAUF !== '1';

describe.skipIf(AUS)('Kategorie-Nachlauf ueber den Bestand', () => {
	it('sortiert die Positionen ohne Kategorie ein', async () => {
		const vorher = await ohneKategorie();
		console.log(`[nachlauf] ${vorher} Positionen ohne Kategorie`);

		const bericht = await nachlaufStarten(echteModellDeps(), {
			melden: (id, e) =>
				console.log(
					`[nachlauf] ${id}: ${e.ausGedaechtnis} aus Gedächtnis, ${e.vomModell} vom Modell, ${e.unsortiert} unsortiert${e.fehler ? ` — ${e.fehler}` : ''}`
				)
		});

		const nachher = await ohneKategorie();
		console.log(
			`[nachlauf] ${bericht.bons} Bons · ${bericht.ausGedaechtnis} aus Gedächtnis · ${bericht.vomModell} vom Modell · ${bericht.unsortiert} unsortiert`
		);
		console.log(`[nachlauf] ohne Kategorie: ${vorher} → ${nachher}`);
		if (bericht.fehler.length) console.log('[nachlauf] Fehler:', bericht.fehler);
		if (Object.keys(bericht.verworfeneSlugs).length)
			console.log('[nachlauf] erfundene Kategorien:', bericht.verworfeneSlugs);

		// Der Nachlauf darf nichts SCHLECHTER machen: hinterher duerfen nicht mehr
		// Positionen ohne Kategorie dastehen als vorher.
		expect(nachher).toBeLessThanOrEqual(vorher);
	}, 1_800_000);
});
