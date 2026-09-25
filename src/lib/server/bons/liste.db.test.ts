import { describe, it, expect } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, users } from '$lib/server/db/schema';
import { listeLaden } from './liste';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Live-Waechter gegen die LAUFENDE Datenbank — hinter RUN_DB_TESTS=1, nicht Teil der
 * normalen Suite:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/liste.db.test.ts
 *
 * Nur lesend. Prueft, dass die Abfrage mit dem echten Schema laeuft (Unterabfrage fuer
 * die Positionen, coalesce fuer die Zeit) und dass die Zaehler zur Tabelle passen.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('listeLaden gegen die echte Datenbank', () => {
	it('liefert alle Bons eines Haushalts mit Zaehlern, die zur Tabelle passen', async () => {
		const [erster] = await db.select({ householdId: receipts.householdId }).from(receipts).limit(1);
		if (!erster) return; // leere Datenbank: nichts zu pruefen, kein Fehler
		// Eine ECHTE Nutzer-Id, keine Attrappe: seit die Sichtbarkeit in der Bedingung
		// steht, landet `nutzerId` in der Abfrage (uploaded_by = $3) und muss eine UUID
		// sein. Vorher ging 'test' durch, weil das Feld gar nicht benutzt wurde — der
		// Platzhalter war schon immer falsch, er fiel nur nicht auf.
		const [irgendwer] = await db.select({ id: users.id }).from(users).limit(1);
		const k: Zugriffskontext = {
			haushaltId: erster.householdId,
			nutzerId: irgendwer.id,
			rolle: 'mitglied'
		};
		const { bons, zaehler } = await listeLaden(db, k, {
			status: 'alle',
			monat: null,
			haendler: null,
			suche: null
		});
		const [{ n }] = await db
			.select({ n: count() })
			.from(receipts)
			.where(eq(receipts.householdId, erster.householdId));
		expect(bons.length).toBe(Math.min(Number(n), 200));
		expect(zaehler.brauchtDich + zaehler.wirdGelesen + zaehler.bestaetigt).toBeLessThanOrEqual(Number(n));
		for (const b of bons) expect(b.positionen).toBeGreaterThanOrEqual(0);
	});
});
