/**
 * Integrationstest gegen die Test-Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/berichte/gespeichert.db.test.ts
 *
 * Bewacht die Rechte: anlegen darf jedes Mitglied, umbenennen/aendern/loeschen nur der
 * Ersteller oder ein Verwalter; ein fremder Haushalt findet den Bericht nicht.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { households, users, householdMembers, merchants } from '$lib/server/db/schema';
import { zurueckgerollt, testHaushalt } from '$lib/server/db/testdaten';
import { filterAusAdresse } from '$lib/berichte/filter';
import { berichtAendern, berichtLoeschen, berichtSpeichern, berichtUmbenennen, gespeichertLaden, gespeicherteListe, gespeichertWirksam } from './gespeichert';

const RUN = process.env.RUN_DB_TESTS === '1';
const HEUTE = '2026-09-25';

describe.skipIf(!RUN)('Gespeicherte Berichte (live)', () => {
	it('haelt die Rechte ein und bleibt im eigenen Haushalt', async () => {
		await expect(
			db.transaction(async (tx) => {
				const tdb = tx as unknown as typeof db;
				const haushalt = async () => (await tx.insert(households).values({ name: 'Berichtstest', slug: randomUUID() }).returning({ id: households.id }))[0].id;
				const person = async (h: string, rolle: 'verwalter' | 'mitglied', name: string) => {
					const [u] = await tx
						.insert(users)
						.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: name })
						.returning({ id: users.id });
					await tx.insert(householdMembers).values({ householdId: h, userId: u.id, rolle });
					return { haushaltId: h, nutzerId: u.id, rolle };
				};
				const h1 = await haushalt();
				const h2 = await haushalt();
				const erika = await person(h1, 'verwalter', 'Erika');
				const max = await person(h1, 'mitglied', 'Max');
				const moritz = await person(h1, 'mitglied', 'Moritz');
				const fremd = await person(h2, 'verwalter', 'Fremd');
				const filter = filterAusAdresse(new URLSearchParams('suche=Kaffee&umfang=meine'), HEUTE).filter;

				const angelegt = await berichtSpeichern(tdb, max, { name: '  Kaffee  ', filter, mitZeitraum: false });
				expect(angelegt.ok).toBe(true);
				const id = angelegt.ok ? angelegt.wert : '';
				expect(await berichtSpeichern(tdb, moritz, { name: 'Kaffee', filter, mitZeitraum: false })).toEqual({
					ok: false, grund: 'Einen Bericht mit diesem Namen gibt es im Haushalt schon.'
				});
				expect(await berichtSpeichern(tdb, moritz, { name: '   ', filter, mitZeitraum: false })).toMatchObject({ ok: false });

				const geladen = await gespeichertLaden(tdb, moritz, id);
				expect(geladen).toMatchObject({ name: 'Kaffee', parameter: { suche: 'Kaffee', umfang: 'meine' }, zeitraum: null, erstellerName: 'Max', darfAendern: false });
				expect((await gespeichertLaden(tdb, erika, id))?.darfAendern).toBe(true);
				expect((await gespeichertLaden(tdb, max, id))?.darfAendern).toBe(true);
				expect(await gespeichertLaden(tdb, fremd, id)).toBeNull();
				expect(await gespeicherteListe(tdb, fremd)).toEqual([]);
				expect((await gespeicherteListe(tdb, moritz)).map((b) => b.name)).toEqual(['Kaffee']);

				// Moritz darf nicht, der Fremde findet ihn nicht, der Verwalter darf.
				expect(await berichtUmbenennen(tdb, moritz, id, 'Tee')).toMatchObject({ ok: false });
				expect(await berichtLoeschen(tdb, moritz, id)).toMatchObject({ ok: false });
				expect(await berichtLoeschen(tdb, fremd, id)).toEqual({ ok: false, grund: 'Den Bericht gibt es nicht (mehr).' });
				expect(await berichtUmbenennen(tdb, erika, id, 'Tee')).toEqual({ ok: true, wert: id });
				const neu = filterAusAdresse(new URLSearchParams('suche=Tee'), HEUTE).filter;
				expect(await berichtAendern(tdb, max, id, neu)).toEqual({ ok: true, wert: id });
				expect((await gespeichertLaden(tdb, max, id))?.parameter).toEqual({ suche: 'Tee' });
				expect(await berichtLoeschen(tdb, max, id)).toEqual({ ok: true, wert: id });
				expect(await gespeichertLaden(tdb, max, id)).toBeNull();
				expect(await gespeichertLaden(tdb, max, 'keine-uuid')).toBeNull();

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});

// Sammelfassung 3.6: was es nicht mehr gibt, faellt aus dem gespeicherten Bericht heraus —
// dieselbe Aufloesung wie beim Anzeigen.
describe.skipIf(!RUN)('Gespeicherte Berichte: wirksamer Stand (live)', () => {
	it('bereinigt um geloeschte Laeden und ausgetretene Personen, Uebriges bleibt', async () => {
		await zurueckgerollt(async (tx) => {
			const tdb = tx as unknown as typeof db;
			const { haushaltId, k } = await testHaushalt(tx);
			const laden = async (name: string) =>
				(await tx.insert(merchants).values({ name, normalizedName: `${name}-${randomUUID()}` }).returning({ id: merchants.id }))[0].id;
			const weg = await laden('Geschlossener Laden');
			const da = await laden('Offener Laden');
			const [max] = await tx
				.insert(users)
				.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Max' })
				.returning({ id: users.id });
			await tx.insert(householdMembers).values({ householdId: haushaltId, userId: max.id, rolle: 'mitglied' });
			const b = { parameter: { laden: `${weg},${da}`, person: max.id, suche: 'Kaffee' }, zeitraum: null };

			expect(await gespeichertWirksam(tdb, k, b, HEUTE)).toMatchObject({ laden: [weg, da], person: [max.id], suche: 'Kaffee' });
			await tx.delete(merchants).where(eq(merchants.id, weg));
			await tx.delete(householdMembers).where(eq(householdMembers.userId, max.id));
			expect(await gespeichertWirksam(tdb, k, b, HEUTE)).toMatchObject({ laden: [da], person: [], suche: 'Kaffee' });
		});
	});
});
