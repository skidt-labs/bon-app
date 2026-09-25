/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/haushalt/einladungen.db.test.ts
 *
 * `einladungErzeugen`/`einladungEinloesen`/`rolleSetzen`/`mitgliedEntfernen` rufen
 * intern `db.transaction(...)` auf dem MODUL-WEITEN `db` auf, nicht auf einem von
 * aussen hereingereichten Ausfuehrer (anders als z.B. budgetAnlegen). Ein aeusseres
 * "alles in einer Transaktion, am Ende ROLLBACK" wie in budgets.db.test.ts geht damit
 * nicht — die innere Transaktion zieht sich eine EIGENE Verbindung aus dem Pool und
 * committet unabhaengig von einer aeusseren. Deshalb hier wie in household.db.test.ts:
 * echte, getaggte Zeilen anlegen und in `afterAll` gezielt wieder entfernen.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { and, count, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { households, users, householdMembers, receipts, budgets, budgetKategorien, products, einladungen, matrixLinks, matrixPairingCodes } from '../db/schema';
import { einladungErzeugen, einladungPruefen, einladungEinloesen, rolleSetzen, mitgliedEntfernen, LetzterVerwalter, MitgliedNichtGefunden, HAUSHALT_TABELLEN_GEZAEHLT, HAUSHALT_TABELLEN_AUSGENOMMEN, entfernenVorschau } from './einladungen';
import { mitgliedschaftWiederherstellen } from '../household';
import { nutzerZuMatrixId } from '../matrix/links';
import { codeAnlegen, codeEinloesen } from '../matrix/pairing';
import type { Rolle } from './mitglieder';
import type { Zugriffskontext } from '../zugriff/kontext';

const RUN = process.env.RUN_DB_TESTS === '1';
const TAG = `test-einladung-${Date.now()}`;

function psql(sqlText: string): string {
	return execFileSync('docker', ['exec', 'bon-db', 'psql', '-q', '-U', 'bon', '-d', 'bon', '-tAc', sqlText], {
		encoding: 'utf8'
	}).trim();
}

const haushaltIds: string[] = [];
const userIds: string[] = [];

async function neuerHaushalt(suffix: string): Promise<string> {
	const [h] = await db
		.insert(households)
		.values({ name: `${TAG}-${suffix}`, slug: `${TAG}-${suffix}` })
		.returning({ id: households.id });
	haushaltIds.push(h.id);
	return h.id;
}

async function neuesMitglied(householdId: string, rolle: Rolle, suffix: string): Promise<string> {
	const [u] = await db
		.insert(users)
		.values({
			oidcSub: `${TAG}-${suffix}`,
			email: `${TAG}-${suffix}@example.invalid`,
			displayName: `${TAG}-${suffix}`
		})
		.returning({ id: users.id });
	userIds.push(u.id);
	await db.insert(householdMembers).values({ householdId, userId: u.id, rolle });
	return u.id;
}

function kontext(haushaltId: string, nutzerId: string, rolle: Rolle): Zugriffskontext {
	return { haushaltId, nutzerId, rolle };
}

/** Wie viele Verwalter ein Haushalt JETZT hat — fuer die Eigenschaftspruefung unten. */
async function verwalterJeHaushalt(haushaltId: string): Promise<number> {
	const [{ n }] = await db
		.select({ n: count() })
		.from(householdMembers)
		.where(and(eq(householdMembers.householdId, haushaltId), eq(householdMembers.rolle, 'verwalter')));
	return n;
}

async function haushaltExistiert(haushaltId: string): Promise<boolean> {
	const [h] = await db.select({ id: households.id }).from(households).where(eq(households.id, haushaltId));
	return !!h;
}

/**
 * Die Eigenschaft DIREKT, unabhaengig vom Weg dorthin: jeder Haushalt, der noch
 * existiert, hat mindestens einen Verwalter. Review-Befund Fix-Runde 1: die
 * Leerheits-Pruefung in einladungEinloesen haelt diese Eigenschaft heute nur ein, WEIL
 * sie strenger ist als noetig (jedes weitere Mitglied blockiert, nicht nur ein
 * fehlender zweiter Verwalter) — ein Kommentar dort haelt das fest, ein Kommentar ist
 * aber kein Waechter. Diese Pruefung ist es: sie fragt nicht "wurde die
 * Leerheitsregel richtig anwendet", sondern "steht am Ende ein Haushalt ohne Verwalter
 * da". Wird die Leerheitsregel spaeter verfeinert (z.B. auf "kein zweiter Verwalter"
 * statt "kein weiteres Mitglied"), bleibt dieser Test die Instanz, die das auffaengt.
 */
async function erwarteMindestensEinenVerwalter(haushaltId: string) {
	if (await haushaltExistiert(haushaltId)) {
		expect(await verwalterJeHaushalt(haushaltId)).toBeGreaterThanOrEqual(1);
	}
}

afterAll(async () => {
	if (!RUN) return;
	// Reihenfolge wegen der Fremdschluessel: receipts/budgets/budget_kategorien/products
	// (RESTRICT bzw. Kaskade auf household_id) und einladungen (kein ON DELETE auf
	// erstellt_von/eingeloest_von) zuerst, dann users (household_id ist RESTRICT gegen
	// households), zuletzt households. Ein Loeschversuch auf eine bereits vom Test selbst
	// entfernte Zeile (der geleerte alte Haushalt in einladungEinloesen) trifft einfach
	// null Zeilen.
	if (haushaltIds.length) {
		await db.delete(receipts).where(inArray(receipts.householdId, haushaltIds));
		await db.delete(budgetKategorien).where(inArray(budgetKategorien.householdId, haushaltIds));
		await db.delete(budgets).where(inArray(budgets.householdId, haushaltIds));
		await db.delete(products).where(inArray(products.householdId, haushaltIds));
		await db.delete(einladungen).where(inArray(einladungen.householdId, haushaltIds));
	}
	if (userIds.length) {
		await db.delete(einladungen).where(inArray(einladungen.erstelltVon, userIds));
		await db.delete(householdMembers).where(inArray(householdMembers.userId, userIds));
		await db.delete(users).where(inArray(users.id, userIds));
	}
	if (haushaltIds.length) {
		await db.delete(households).where(inArray(households.id, haushaltIds));
	}
});

describe.skipIf(!RUN)('einladungErzeugen / einladungPruefen (live)', () => {
	it('speichert nur den Hash, nie den Klartext', async () => {
		const h = await neuerHaushalt('erzeugen-a');
		const verwalter = await neuesMitglied(h, 'verwalter', 'erzeugen-a-verwalter');

		const { token } = await einladungErzeugen(kontext(h, verwalter, 'verwalter'), 'mitglied');
		const [zeile] = await db
			.select({ tokenHash: einladungen.tokenHash })
			.from(einladungen)
			.where(eq(einladungen.erstelltVon, verwalter));

		expect(zeile.tokenHash).not.toBe(token);
		expect(zeile.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
	});

	it('liefert Haushaltsname und Rolle fuer einen gueltigen Token', async () => {
		const h = await neuerHaushalt('pruefen-a');
		const verwalter = await neuesMitglied(h, 'verwalter', 'pruefen-a-verwalter');
		const { token } = await einladungErzeugen(kontext(h, verwalter, 'verwalter'), 'mitglied');

		expect(await einladungPruefen(token)).toEqual({
			householdId: h,
			haushaltsname: `${TAG}-pruefen-a`,
			rolle: 'mitglied'
		});
	});

	it('liefert null fuer einen unbekannten Token', async () => {
		expect(await einladungPruefen('unbekannter-token-existiert-nicht')).toBeNull();
	});

	it('liefert null fuer einen abgelaufenen Token', async () => {
		const h = await neuerHaushalt('pruefen-abgelaufen');
		const verwalter = await neuesMitglied(h, 'verwalter', 'pruefen-abgelaufen-verwalter');
		const { token } = await einladungErzeugen(kontext(h, verwalter, 'verwalter'), 'mitglied', -1);

		expect(await einladungPruefen(token)).toBeNull();
	});
});

describe.skipIf(!RUN)('einladungEinloesen (live)', () => {
	it('haengt den einzigen Bewohner um und loescht den leeren alten Haushalt', async () => {
		const alt = await neuerHaushalt('einloesen-solo-alt');
		const einloesender = await neuesMitglied(alt, 'verwalter', 'einloesen-solo-nutzer');
		const neu = await neuerHaushalt('einloesen-solo-neu');
		const einladender = await neuesMitglied(neu, 'verwalter', 'einloesen-solo-einladender');
		const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

		expect(await einladungEinloesen(token, einloesender)).toBe('ok');

		const [altNoch] = await db.select({ id: households.id }).from(households).where(eq(households.id, alt));
		expect(altNoch).toBeUndefined();

		const [mitgliedschaft] = await db
			.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, einloesender));
		expect(mitgliedschaft).toEqual({ householdId: neu, rolle: 'mitglied' });


		// Derselbe Token ein zweites Mal: die Einladung ist jetzt verbraucht.
		expect(await einladungEinloesen(token, einloesender)).toBe('verbraucht');
	});

	it('lehnt einen abgelaufenen Token ab, ohne etwas zu aendern', async () => {
		const h = await neuerHaushalt('einloesen-abgelaufen');
		const nutzer = await neuesMitglied(h, 'verwalter', 'einloesen-abgelaufen-nutzer');
		const ziel = await neuerHaushalt('einloesen-abgelaufen-ziel');
		const einladender = await neuesMitglied(ziel, 'verwalter', 'einloesen-abgelaufen-einladender');
		const { token } = await einladungErzeugen(kontext(ziel, einladender, 'verwalter'), 'mitglied', -1);

		expect(await einladungEinloesen(token, nutzer)).toBe('abgelaufen');

		const [mitgliedschaft] = await db
			.select({ householdId: householdMembers.householdId })
			.from(householdMembers)
			.where(eq(householdMembers.userId, nutzer));
		expect(mitgliedschaft.householdId).toBe(h);
	});

	it(
		'lehnt ab, wenn der alte Haushalt noch ein weiteres Mitglied hat — ' +
			'das schuetzt nebenbei den letzten Verwalter davor, ihn ohne Verwalter zurueckzulassen',
		async () => {
			const alt = await neuerHaushalt('einloesen-mitglied-alt');
			const verwalter = await neuesMitglied(alt, 'verwalter', 'einloesen-mitglied-verwalter');
			await neuesMitglied(alt, 'mitglied', 'einloesen-mitglied-mitglied');
			const neu = await neuerHaushalt('einloesen-mitglied-neu');
			const einladender = await neuesMitglied(neu, 'verwalter', 'einloesen-mitglied-einladender');
			const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

			expect(await einladungEinloesen(token, verwalter)).toBe('haushalt-nicht-leer');

			const [altNoch] = await db.select({ id: households.id }).from(households).where(eq(households.id, alt));
			expect(altNoch).toBeDefined();
			const [mitgliedschaft] = await db
				.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
				.from(householdMembers)
				.where(eq(householdMembers.userId, verwalter));
			expect(mitgliedschaft).toEqual({ householdId: alt, rolle: 'verwalter' });
		}
	);

	it('lehnt ab, wenn der alte Haushalt noch einen Bon hat', async () => {
		const alt = await neuerHaushalt('einloesen-bon-alt');
		const nutzer = await neuesMitglied(alt, 'verwalter', 'einloesen-bon-nutzer');
		await db.insert(receipts).values({ householdId: alt, uploadedBy: nutzer, imagePath: 'x', thumbPath: 'y' });
		const neu = await neuerHaushalt('einloesen-bon-neu');
		const einladender = await neuesMitglied(neu, 'verwalter', 'einloesen-bon-einladender');
		const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

		expect(await einladungEinloesen(token, nutzer)).toBe('haushalt-nicht-leer');
	});

	it('lehnt ab, wenn der alte Haushalt noch einen Topf hat', async () => {
		const alt = await neuerHaushalt('einloesen-topf-alt');
		const nutzer = await neuesMitglied(alt, 'verwalter', 'einloesen-topf-nutzer');
		await db.insert(budgets).values({ householdId: alt, name: `${TAG}-topf` });
		const neu = await neuerHaushalt('einloesen-topf-neu');
		const einladender = await neuesMitglied(neu, 'verwalter', 'einloesen-topf-einladender');
		const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

		expect(await einladungEinloesen(token, nutzer)).toBe('haushalt-nicht-leer');
	});

	// Review-Befund Fix-Runde 1: products fehlte in der Zaehlung. Ein Haushalt mit
	// gewachsenem Produktkatalog, aber sonst leer, galt faelschlich als leer.
	it('lehnt ab, wenn der alte Haushalt noch ein Produkt hat', async () => {
		const alt = await neuerHaushalt('einloesen-produkt-alt');
		const nutzer = await neuesMitglied(alt, 'verwalter', 'einloesen-produkt-nutzer');
		await db.insert(products).values({ householdId: alt, canonicalName: `${TAG}-produkt` });
		const neu = await neuerHaushalt('einloesen-produkt-neu');
		const einladender = await neuesMitglied(neu, 'verwalter', 'einloesen-produkt-einladender');
		const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

		expect(await einladungEinloesen(token, nutzer)).toBe('haushalt-nicht-leer');

		const [altNoch] = await db.select({ id: households.id }).from(households).where(eq(households.id, alt));
		expect(altNoch).toBeDefined();
	});

	it(
		'laesst bei zwei GLEICHZEITIGEN Einloesungen desselben Tokens genau eine gewinnen',
		async () => {
			// Zwei verschiedene, je solo bewohnte Haushalte: der Wettlauf betrifft die
			// EINLADUNGSZEILE (gleicher Token), nicht die Mitgliedszeilen — die sind hier
			// bewusst in zwei verschiedenen Haushalten, damit nur die FOR-UPDATE-Sperre
			// auf `einladungen` den Ausschlag gibt.
			const alt1 = await neuerHaushalt('wettlauf-einloesen-alt1');
			const u1 = await neuesMitglied(alt1, 'verwalter', 'wettlauf-einloesen-u1');
			const alt2 = await neuerHaushalt('wettlauf-einloesen-alt2');
			const u2 = await neuesMitglied(alt2, 'verwalter', 'wettlauf-einloesen-u2');
			const neu = await neuerHaushalt('wettlauf-einloesen-neu');
			const einladender = await neuesMitglied(neu, 'verwalter', 'wettlauf-einloesen-einladender');
			const { token } = await einladungErzeugen(kontext(neu, einladender, 'verwalter'), 'mitglied');

			// Echte Nebenlaeufigkeit: beide Aufrufe holen sich je eine EIGENE Verbindung
			// aus demselben Pool und laufen tatsaechlich ueberlappend gegen Postgres —
			// kein Mock, keine kuenstliche Verzoegerung noetig, die Sperre in
			// einladungEinloesen (FOR UPDATE auf der Einladungszeile) muss das allein regeln.
			const ergebnisse = (await Promise.all([einladungEinloesen(token, u1), einladungEinloesen(token, u2)])).sort();
			expect(ergebnisse).toEqual(['ok', 'verbraucht']);

			const mitgliedschaften = await db
				.select({ userId: householdMembers.userId, householdId: householdMembers.householdId })
				.from(householdMembers)
				.where(inArray(householdMembers.userId, [u1, u2]));
			const umgezogen = mitgliedschaften.filter((m) => m.householdId === neu);
			expect(umgezogen).toHaveLength(1);
		}
	);
});

describe.skipIf(!RUN)('rolleSetzen (live)', () => {
	it('weist die Herabstufung des letzten Verwalters ab', async () => {
		const h = await neuerHaushalt('rolle-letzter');
		const verwalter = await neuesMitglied(h, 'verwalter', 'rolle-letzter-verwalter');

		await expect(rolleSetzen(kontext(h, verwalter, 'verwalter'), verwalter, 'mitglied')).rejects.toThrow(
			LetzterVerwalter
		);

		const [mitgliedschaft] = await db
			.select({ rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, verwalter));
		expect(mitgliedschaft.rolle).toBe('verwalter');
	});

	it('stuft einen von zwei Verwaltern herab', async () => {
		const h = await neuerHaushalt('rolle-zwei');
		const a = await neuesMitglied(h, 'verwalter', 'rolle-zwei-a');
		const b = await neuesMitglied(h, 'verwalter', 'rolle-zwei-b');

		await rolleSetzen(kontext(h, a, 'verwalter'), b, 'mitglied');

		const [mitgliedschaft] = await db
			.select({ rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, b));
		expect(mitgliedschaft.rolle).toBe('mitglied');
	});

	it('befoerdert ein Mitglied zum Verwalter', async () => {
		const h = await neuerHaushalt('rolle-befoerdern');
		const verwalter = await neuesMitglied(h, 'verwalter', 'rolle-befoerdern-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'rolle-befoerdern-mitglied');

		await rolleSetzen(kontext(h, verwalter, 'verwalter'), mitglied, 'verwalter');

		const [mitgliedschaft] = await db
			.select({ rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, mitglied));
		expect(mitgliedschaft.rolle).toBe('verwalter');
	});

	it('wirft MitgliedNichtGefunden fuer ein Ziel ausserhalb des eigenen Haushalts, statt still nichts zu tun', async () => {
		const h = await neuerHaushalt('rolle-fremd-eigen');
		const verwalter = await neuesMitglied(h, 'verwalter', 'rolle-fremd-eigen-verwalter');
		const fremderHaushalt = await neuerHaushalt('rolle-fremd-fremd');
		const fremder = await neuesMitglied(fremderHaushalt, 'mitglied', 'rolle-fremd-fremd-mitglied');

		await expect(rolleSetzen(kontext(h, verwalter, 'verwalter'), fremder, 'verwalter')).rejects.toThrow(
			MitgliedNichtGefunden
		);

		const [mitgliedschaft] = await db
			.select({ rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, fremder));
		expect(mitgliedschaft.rolle).toBe('mitglied');
	});

	// Review-Befund Fix-Runde 1: rolleSetzen las die Mitgliederliste vorher UNGESPERRT.
	// Zwei Verwalter, die sich gleichzeitig gegenseitig herabstufen, saehen beide "es
	// gibt ja noch einen zweiten" und der Haushalt stuende danach ohne Verwalter da.
	it(
		'laesst bei zwei GLEICHZEITIGEN, gegenseitigen Herabstufungen genau eine gewinnen — ein Verwalter bleibt',
		async () => {
			const h = await neuerHaushalt('wettlauf-rolle');
			const a = await neuesMitglied(h, 'verwalter', 'wettlauf-rolle-a');
			const b = await neuesMitglied(h, 'verwalter', 'wettlauf-rolle-b');

			const ergebnisse = await Promise.allSettled([
				rolleSetzen(kontext(h, a, 'verwalter'), b, 'mitglied'),
				rolleSetzen(kontext(h, b, 'verwalter'), a, 'mitglied')
			]);

			const erfuellt = ergebnisse.filter((r) => r.status === 'fulfilled');
			const abgelehnt = ergebnisse.filter((r) => r.status === 'rejected');
			expect(erfuellt).toHaveLength(1);
			expect(abgelehnt).toHaveLength(1);
			expect((abgelehnt[0] as PromiseRejectedResult).reason).toBeInstanceOf(LetzterVerwalter);

			await erwarteMindestensEinenVerwalter(h);
		}
	);
});

describe.skipIf(!RUN)('mitgliedEntfernen (live)', () => {
	it('weist die Selbstentfernung des letzten Verwalters ab', async () => {
		const h = await neuerHaushalt('entfernen-letzter');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-letzter-verwalter');

		await expect(mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), verwalter)).rejects.toThrow(
			LetzterVerwalter
		);

		const [mitgliedschaft] = await db
			.select({ id: householdMembers.id })
			.from(householdMembers)
			.where(eq(householdMembers.userId, verwalter));
		expect(mitgliedschaft).toBeDefined();
	});

	it('entfernt ein Mitglied, laesst aber den Nutzerdatensatz stehen', async () => {
		const h = await neuerHaushalt('entfernen-mitglied');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-mitglied-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'entfernen-mitglied-mitglied');

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), mitglied);

		const [mitgliedschaft] = await db
			.select({ id: householdMembers.id })
			.from(householdMembers)
			.where(eq(householdMembers.userId, mitglied));
		expect(mitgliedschaft).toBeUndefined();

		const [nutzerZeile] = await db.select({ id: users.id }).from(users).where(eq(users.id, mitglied));
		expect(nutzerZeile).toBeDefined();
	});

	// Review-Befund Fix-Runde 2: nutzerZuMatrixId() loest ueber users.household_id auf,
	// nicht ueber die Mitgliedschaft. Ohne diesen Aufruf haette ein entferntes Mitglied
	// per Matrix weiter Bons in den alten Haushalt einschleusen koennen.
	it('loest die Matrix-Verknuepfung mit — der Bot findet den Entfernten danach nicht mehr', async () => {
		const h = await neuerHaushalt('entfernen-matrix');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-matrix-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'entfernen-matrix-mitglied');
		const matrixUserId = `@${TAG}-entfernen-matrix:example.org`;
		await db.insert(matrixLinks).values({ userId: mitglied, matrixUserId });

		expect(await nutzerZuMatrixId(matrixUserId)).not.toBeNull();

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), mitglied);

		expect(await nutzerZuMatrixId(matrixUserId)).toBeNull();
	});

	// Befund R02, Schicht 1: ein Mitglied, das sich VOR seinem Ausschluss einen
	// Kopplungscode erzeugt hat, darf sich damit NICHT mehr koppeln koennen — der Code
	// muss beim Entfernen mit verschwinden, nicht erst bei seinem Ablauf nach 10 Minuten.
	it('loescht offene Matrix-Kopplungscodes des entfernten Mitglieds', async () => {
		const h = await neuerHaushalt('entfernen-code-offen');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-code-offen-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'entfernen-code-offen-mitglied');
		await codeAnlegen(mitglied);

		const vorher = await db
			.select({ id: matrixPairingCodes.id })
			.from(matrixPairingCodes)
			.where(eq(matrixPairingCodes.userId, mitglied));
		expect(vorher).toHaveLength(1);

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), mitglied);

		const nachher = await db
			.select({ id: matrixPairingCodes.id })
			.from(matrixPairingCodes)
			.where(eq(matrixPairingCodes.userId, mitglied));
		expect(nachher).toHaveLength(0);
	});

	// Ein bereits EINGELOESTER Code ist kein Angriffsweg (codeEinloesen lehnt ihn ueber
	// usedAt ab) und kein Datum, dessen Verlust zaehlt — er bleibt bewusst stehen.
	it('laesst einen bereits eingeloesten Kopplungscode des entfernten Mitglieds unangetastet', async () => {
		const h = await neuerHaushalt('entfernen-code-verbraucht');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-code-verbraucht-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'entfernen-code-verbraucht-mitglied');
		const { code } = await codeAnlegen(mitglied);
		const matrixUserId = `@${TAG}-entfernen-code-verbraucht:example.org`;
		await codeEinloesen(code, matrixUserId);

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), mitglied);

		const nachher = await db
			.select({ id: matrixPairingCodes.id, usedAt: matrixPairingCodes.usedAt })
			.from(matrixPairingCodes)
			.where(eq(matrixPairingCodes.userId, mitglied));
		expect(nachher).toHaveLength(1);
		expect(nachher[0].usedAt).not.toBeNull();
	});

	// Review-Befund Fix-Runde 2: geteilte Bons sind KEIN privates Datum des entfernten
	// Mitglieds (Aufgabe 5 unterscheidet das erst) — sie bleiben unveraendert beim
	// Haushalt stehen, uploaded_by zeigt weiter auf den (bestehenden) Nutzerdatensatz.
	it('laesst geteilte Bons des entfernten Mitglieds unveraendert beim Haushalt', async () => {
		const h = await neuerHaushalt('entfernen-bon-bleibt');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-bon-bleibt-verwalter');
		const mitglied = await neuesMitglied(h, 'mitglied', 'entfernen-bon-bleibt-mitglied');
		// `sichtbarkeit` AUSDRUECKLICH: die Spaltenvorgabe ist 'privat' (erst das
		// Bestaetigen teilt), und private Bons gehen seit Aufgabe 7 mit dem Menschen.
		// Der Test meint laut seinem Namen den geteilten Fall — das konnte er bis zur
		// Einfuehrung der Spalte nur nicht sagen. Ohne diese Zeile pruefte er ab jetzt
		// das Gegenteil dessen, was er behauptet.
		const [bon] = await db
			.insert(receipts)
			.values({
				householdId: h,
				uploadedBy: mitglied,
				imagePath: 'x',
				thumbPath: 'y',
				sichtbarkeit: 'geteilt'
			})
			.returning({ id: receipts.id });

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), mitglied);

		const [bonDanach] = await db
			.select({ householdId: receipts.householdId, uploadedBy: receipts.uploadedBy })
			.from(receipts)
			.where(eq(receipts.id, bon.id));
		expect(bonDanach).toEqual({ householdId: h, uploadedBy: mitglied });
	});

	it('wirft MitgliedNichtGefunden fuer ein Ziel ausserhalb des eigenen Haushalts, statt still nichts zu tun', async () => {
		const h = await neuerHaushalt('entfernen-fremd-eigen');
		const verwalter = await neuesMitglied(h, 'verwalter', 'entfernen-fremd-eigen-verwalter');
		const fremderHaushalt = await neuerHaushalt('entfernen-fremd-fremd');
		const fremder = await neuesMitglied(fremderHaushalt, 'mitglied', 'entfernen-fremd-fremd-mitglied');

		await expect(mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), fremder)).rejects.toThrow(
			MitgliedNichtGefunden
		);

		const [mitgliedschaft] = await db
			.select({ id: householdMembers.id })
			.from(householdMembers)
			.where(eq(householdMembers.userId, fremder));
		expect(mitgliedschaft).toBeDefined();
	});

	// Dieselbe Sperre wie bei rolleSetzen, aus demselben Grund (Review-Befund Fix-Runde 1).
	it(
		'laesst bei zwei GLEICHZEITIGEN, gegenseitigen Entfernungen genau eine gewinnen — ein Verwalter bleibt',
		async () => {
			const h = await neuerHaushalt('wettlauf-entfernen');
			const a = await neuesMitglied(h, 'verwalter', 'wettlauf-entfernen-a');
			const b = await neuesMitglied(h, 'verwalter', 'wettlauf-entfernen-b');

			const ergebnisse = await Promise.allSettled([
				mitgliedEntfernen(kontext(h, a, 'verwalter'), b),
				mitgliedEntfernen(kontext(h, b, 'verwalter'), a)
			]);

			const erfuellt = ergebnisse.filter((r) => r.status === 'fulfilled');
			const abgelehnt = ergebnisse.filter((r) => r.status === 'rejected');
			expect(erfuellt).toHaveLength(1);
			expect(abgelehnt).toHaveLength(1);
			expect((abgelehnt[0] as PromiseRejectedResult).reason).toBeInstanceOf(LetzterVerwalter);

			await erwarteMindestensEinenVerwalter(h);
		}
	);
});

describe.skipIf(!RUN)('Vollstaendigkeit der Leerheits-Pruefung (live)', () => {
	it('kennt jede Tabelle mit household_id — gezaehlt oder mit Begruendung ausgenommen', () => {
		const gefunden = psql(
			"select table_name from information_schema.columns " +
				"where table_schema='public' and column_name='household_id' order by table_name"
		)
			.split('\n')
			.filter(Boolean)
			.sort();
		const bekannt = [...HAUSHALT_TABELLEN_GEZAEHLT, ...Object.keys(HAUSHALT_TABELLEN_AUSGENOMMEN)].sort();
		// Schlaegt in BEIDE Richtungen fehl: eine neue Tabelle mit household_id, die hier
		// fehlt (Aufgabe 5/6 vergisst sie einzutragen), UND ein Eintrag hier, dessen
		// Tabelle es gar nicht mehr gibt (Umbenennung, Entfernen).
		expect(gefunden).toEqual(bekannt);
	});
});

describe.skipIf(!RUN)('Eigenschaft: kein bestehender Haushalt ohne Verwalter (live)', () => {
	it('haelt nach einladungEinloesen, rolleSetzen und mitgliedEntfernen — erlaubt wie abgelehnt', async () => {
		// einladungEinloesen: erlaubter Umzug (der alte Haushalt loest sich komplett auf).
		const alt1 = await neuerHaushalt('eigenschaft-einloesen-alt');
		const u1 = await neuesMitglied(alt1, 'verwalter', 'eigenschaft-einloesen-u1');
		const neu1 = await neuerHaushalt('eigenschaft-einloesen-neu');
		const e1 = await neuesMitglied(neu1, 'verwalter', 'eigenschaft-einloesen-e1');
		const { token: t1 } = await einladungErzeugen(kontext(neu1, e1, 'verwalter'), 'mitglied');
		expect(await einladungEinloesen(t1, u1)).toBe('ok');
		expect(await haushaltExistiert(alt1)).toBe(false);
		await erwarteMindestensEinenVerwalter(neu1);

		// einladungEinloesen: abgelehnter Umzug (alter Haushalt hat noch ein Mitglied).
		const alt2 = await neuerHaushalt('eigenschaft-einloesen-abgelehnt-alt');
		const u2 = await neuesMitglied(alt2, 'verwalter', 'eigenschaft-einloesen-abgelehnt-u2');
		await neuesMitglied(alt2, 'mitglied', 'eigenschaft-einloesen-abgelehnt-m2');
		const neu2 = await neuerHaushalt('eigenschaft-einloesen-abgelehnt-neu');
		const e2 = await neuesMitglied(neu2, 'verwalter', 'eigenschaft-einloesen-abgelehnt-e2');
		const { token: t2 } = await einladungErzeugen(kontext(neu2, e2, 'verwalter'), 'mitglied');
		expect(await einladungEinloesen(t2, u2)).toBe('haushalt-nicht-leer');
		await erwarteMindestensEinenVerwalter(alt2);

		// rolleSetzen: erlaubte Herabstufung (zwei Verwalter).
		const h3 = await neuerHaushalt('eigenschaft-rolle-erlaubt');
		const a3 = await neuesMitglied(h3, 'verwalter', 'eigenschaft-rolle-erlaubt-a');
		const b3 = await neuesMitglied(h3, 'verwalter', 'eigenschaft-rolle-erlaubt-b');
		await rolleSetzen(kontext(h3, a3, 'verwalter'), b3, 'mitglied');
		await erwarteMindestensEinenVerwalter(h3);

		// rolleSetzen: abgelehnte Herabstufung (letzter Verwalter).
		const h4 = await neuerHaushalt('eigenschaft-rolle-abgelehnt');
		const a4 = await neuesMitglied(h4, 'verwalter', 'eigenschaft-rolle-abgelehnt-a');
		await expect(rolleSetzen(kontext(h4, a4, 'verwalter'), a4, 'mitglied')).rejects.toThrow(LetzterVerwalter);
		await erwarteMindestensEinenVerwalter(h4);

		// mitgliedEntfernen: erlaubtes Entfernen (ein Mitglied, kein Verwalter betroffen).
		const h5 = await neuerHaushalt('eigenschaft-entfernen-erlaubt');
		const a5 = await neuesMitglied(h5, 'verwalter', 'eigenschaft-entfernen-erlaubt-a');
		const b5 = await neuesMitglied(h5, 'mitglied', 'eigenschaft-entfernen-erlaubt-b');
		await mitgliedEntfernen(kontext(h5, a5, 'verwalter'), b5);
		await erwarteMindestensEinenVerwalter(h5);

		// mitgliedEntfernen: abgelehntes Entfernen (letzter Verwalter).
		const h6 = await neuerHaushalt('eigenschaft-entfernen-abgelehnt');
		const a6 = await neuesMitglied(h6, 'verwalter', 'eigenschaft-entfernen-abgelehnt-a');
		await expect(mitgliedEntfernen(kontext(h6, a6, 'verwalter'), a6)).rejects.toThrow(LetzterVerwalter);
		await erwarteMindestensEinenVerwalter(h6);
	});
});

/**
 * Review-Befund Fix-Runde 2: ein entferntes Mitglied konnte sich zwar wieder anmelden
 * (Sitzung wurde angelegt), aber jede Seite warf es sofort zurueck zur Anmeldung
 * (validateSession verlangt eine Mitgliedschaft) — und ohne gueltige Sitzung liess sich
 * auch keine neue Einladung mehr annehmen. mitgliedschaftWiederherstellen() (household.ts)
 * behebt das; dieser Test prueft die Kette bis zum Ende: der wiederhergestellte Nutzer
 * ist danach wieder ganz normal handlungsfaehig, einschliesslich Einladungen einloesen.
 */
describe.skipIf(!RUN)('Wiedereinstieg nach mitgliedEntfernen (live)', () => {
	it('kann nach der Wiederherstellung eine Einladung einloesen', async () => {
		const h = await neuerHaushalt('wiedereinstieg-alt');
		const verwalter = await neuesMitglied(h, 'verwalter', 'wiedereinstieg-alt-verwalter');
		const entfernt = await neuesMitglied(h, 'mitglied', 'wiedereinstieg-mitglied');

		await mitgliedEntfernen(kontext(h, verwalter, 'verwalter'), entfernt);

		// Genau der Zustand, den ein bestehender Nutzer ohne Mitgliedschaft beim naechsten
		// Login-Callback vorfindet (siehe auth/callback/+server.ts).
		const { householdId: eigenerHaushalt } = await mitgliedschaftWiederherstellen(
			entfernt,
			'wiedereinstieg-mitglied'
		);
		haushaltIds.push(eigenerHaushalt);

		const [mitgliedschaft] = await db
			.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, entfernt));
		expect(mitgliedschaft).toEqual({ householdId: eigenerHaushalt, rolle: 'verwalter' });

		// Jetzt wieder ganz normaler Weg: der frische, leere Haushalt hat keine weiteren
		// Mitglieder, keine Bons, keine Toepfe — eine Einladung laesst sich einloesen.
		const ziel = await neuerHaushalt('wiedereinstieg-ziel');
		const einladender = await neuesMitglied(ziel, 'verwalter', 'wiedereinstieg-ziel-einladender');
		const { token } = await einladungErzeugen(kontext(ziel, einladender, 'verwalter'), 'mitglied');

		expect(await einladungEinloesen(token, entfernt)).toBe('ok');

		const [mitgliedschaftDanach] = await db
			.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, entfernt));
		expect(mitgliedschaftDanach).toEqual({ householdId: ziel, rolle: 'mitglied' });

		const [alterEigenerHaushaltNoch] = await db
			.select({ id: households.id })
			.from(households)
			.where(eq(households.id, eigenerHaushalt));
		expect(alterEigenerHaushaltNoch).toBeUndefined();
	});

	it('nimmt das Private mit und laesst das Geteilte beim Haushalt', async () => {
		const h = await neuerHaushalt('privatweg');
		const chef = await neuesMitglied(h, 'verwalter', 'chef-privatweg');
		const wer = await neuesMitglied(h, 'mitglied', 'geht-privatweg');

		const bon = async (sichtbarkeit: 'geteilt' | 'privat') => {
			const [b] = await db
				.insert(receipts)
				.values({
					householdId: h,
					uploadedBy: wer,
					imagePath: `${TAG}/erfunden.webp`,
					thumbPath: `${TAG}/erfunden-klein.webp`,
					sichtbarkeit
				})
				.returning({ id: receipts.id });
			return b.id;
		};
		const geteilterBon = await bon('geteilt');
		const privaterBon = await bon('privat');
		const [privaterTopf] = await db
			.insert(budgets)
			.values({ householdId: h, name: `${TAG} Geschenke`, sichtbarkeit: 'privat', eigentuemerId: wer })
			.returning({ id: budgets.id });
		const [geteilterTopf] = await db
			.insert(budgets)
			.values({ householdId: h, name: `${TAG} Haushalt` })
			.returning({ id: budgets.id });

		// Der Dialog nennt die Zahlen VOR dem Klick — hier wird geprueft, dass er die
		// richtigen nennt und nicht etwa die geteilten mitzaehlt.
		const vorschau = await entfernenVorschau({ haushaltId: h, nutzerId: chef, rolle: 'verwalter' }, wer);
		expect(vorschau).toEqual({ privateBons: 1, privateToepfe: 1 });

		await mitgliedEntfernen({ haushaltId: h, nutzerId: chef, rolle: 'verwalter' }, wer);

		const bonDa = async (id: string) =>
			(await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, id))).length > 0;
		const topfDa = async (id: string) =>
			(await db.select({ id: budgets.id }).from(budgets).where(eq(budgets.id, id))).length > 0;

		// Privates geht mit dem Menschen: es koennte sonst NIEMAND mehr sehen — er selbst
		// nicht (keine Mitgliedschaft), sonst auch keiner (privat).
		expect(await bonDa(privaterBon)).toBe(false);
		expect(await topfDa(privaterTopf.id)).toBe(false);

		// Geteiltes bleibt beim Haushalt. Es steckt in bestaetigten Berichten, und der
		// Nutzerdatensatz bleibt deshalb ebenfalls bestehen (uploaded_by zeigt darauf).
		expect(await bonDa(geteilterBon)).toBe(true);
		expect(await topfDa(geteilterTopf.id)).toBe(true);
		expect(
			(await db.select({ id: users.id }).from(users).where(eq(users.id, wer))).length
		).toBe(1);
	});
});
