/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/receipts/lernen-privat.db.test.ts
 *
 * Bewacht eine Eigenschaft, die man am Bon selbst nicht sieht: aus einem PRIVATEN Bon
 * darf nichts gelernt werden. `lerneAusKorrektur` schreibt Produktnamen nach `products`,
 * und die sind pro HAUSHALT sichtbar — ein privater Bon mit "Verlobungsring" erzeugte
 * sonst einen Eintrag, den alle sehen, obwohl der Bon selbst verborgen bleibt.
 *
 * `lernenNachtragen` benutzt den globalen `db` und oeffnet eigene Transaktionen; ein
 * umschliessendes ROLLBACK ginge daran vorbei. Darum echte, getaggte Zeilen und gezieltes
 * Aufraeumen — dasselbe Muster wie in household.db.test.ts.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { households, users, receipts, products, categories } from '$lib/server/db/schema';
import { lernenNachtragen } from './korrekturen';

const RUN = process.env.RUN_DB_TESTS === '1';
const TAG = `test-lernen-${Date.now()}`;

afterAll(async () => {
	if (!RUN) return;
	await db.delete(products).where(like(products.canonicalName, `%${TAG}%`));
	await db.delete(receipts).where(like(receipts.imagePath, `${TAG}%`));
	await db.delete(users).where(like(users.email, `%${TAG}%`));
	await db.delete(households).where(like(households.name, `%${TAG}%`));
});

describe.skipIf(!RUN)('Lernen aus privaten Bons (live)', () => {
	async function aufbau(sichtbarkeit: 'geteilt' | 'privat') {
		const [h] = await db
			.insert(households)
			.values({ name: `${TAG} Haushalt`, slug: randomUUID() })
			.returning({ id: households.id });
		const [u] = await db
			.insert(users)
			.values({
				oidcSub: randomUUID(),
				email: `${randomUUID()}-${TAG}@example.invalid`,
				displayName: 'Testperson'
			})
			.returning({ id: users.id });
		const [b] = await db
			.insert(receipts)
			.values({
				householdId: h.id,
				uploadedBy: u.id,
				imagePath: `${TAG}/erfunden.webp`,
				thumbPath: `${TAG}/erfunden-klein.webp`,
				sichtbarkeit
			})
			.returning({ id: receipts.id });
		const [kat] = await db.select({ id: categories.id }).from(categories).limit(1);
		return { haushaltId: h.id, bonId: b.id, kategorieId: kat.id };
	}

	const produkteImHaushalt = async (haushaltId: string) =>
		(await db.select({ id: products.id }).from(products).where(eq(products.householdId, haushaltId)))
			.length;

	it('lernt NICHT aus einem privaten Bon', async () => {
		const { haushaltId, bonId, kategorieId } = await aufbau('privat');
		await lernenNachtragen(bonId, [{ rawText: `VERLOBUNGSRING ${TAG}`, categoryId: kategorieId }]);
		expect(await produkteImHaushalt(haushaltId)).toBe(0);
	});

	it('lernt aus einem geteilten Bon sehr wohl', async () => {
		// Die Gegenprobe. Ohne sie bewiese der Test oben nur, dass gar nichts gelernt wird.
		const { haushaltId, bonId, kategorieId } = await aufbau('geteilt');
		await lernenNachtragen(bonId, [{ rawText: `BIO MILCH ${TAG}`, categoryId: kategorieId }]);
		expect(await produkteImHaushalt(haushaltId)).toBe(1);
	});
});
