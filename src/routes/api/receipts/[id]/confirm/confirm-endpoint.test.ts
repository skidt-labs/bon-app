import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// $lib/server/db/schema wird bewusst NICHT gemockt (reine Tabellendefinitionen, eq()
// braucht echte Column-Objekte) — dieselbe Begründung wie in
// src/routes/api/receipts/receipts-endpoint.test.ts und
// src/worker/production-deps.test.ts.
//
// Seit der Oberflaechen-Umstellung (Etappe 3, 2026-09-17) laeuft der Endpunkt ueber den
// gemeinsamen Vertrag in $lib/server/receipts/korrekturen: loeschen, Bezuege loesen,
// aendern/anlegen, Bezuege setzen, Kopf. Der Mock kennt deshalb delete, insert und
// update; die Haendler-Aufloesung ist gemockt, damit kein echtes insert auf merchants
// noetig ist.
const mocks = vi.hoisted(() => ({
	selectResult: [] as unknown[],
	// Was tx.select() liefert: der Bestand der Positionen dieses Bons, gegen den die
	// Korrekturen geprueft (Vollstaendigkeit, Zugehoerigkeit) und verglichen (corrected)
	// werden.
	bestand: [] as unknown[],
	updateCalls: [] as { table: unknown; set: unknown }[],
	insertCalls: [] as { table: unknown; values: unknown }[],
	deleteCalls: [] as { table: unknown }[],
	// Zeilen, die das naechste .returning() liefert. Leer = Standardfall "eine Zeile
	// getroffen"; ein vorangestelltes [] stellt den Fall "keine Zeile getroffen" nach.
	returningRows: [] as unknown[][]
}));

vi.mock('$lib/server/merchants', () => ({ haendlerAufloesen: vi.fn(async () => 'merchant-1') }));

// Das Lerngedaechtnis hat eigene Tests (kategorien/lernen.test.ts). Hier geht es um den
// Endpunkt; ein echter Aufruf wuerde nur die Nachbildung der Datenbank beschaeftigen.
vi.mock('$lib/server/kategorien/lernen', () => ({ lerneAusKorrektur: vi.fn(async () => {}) }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => Promise.resolve(mocks.selectResult)
			})
		}),
		transaction: async (fn: (tx: unknown) => Promise<void>) => {
			const tx = {
				select: () => ({
					from: () => ({
						where: () => Promise.resolve(mocks.bestand)
					})
				}),
				update: (table: unknown) => ({
					set: (set: unknown) => ({
						where: () => {
							mocks.updateCalls.push({ table, set });
							// Awaitbar UND mit .returning(): das Update auf `receipts` wird direkt
							// awaited, das je Position ruft .returning(). Nur .returning() zieht
							// eine vorbereitete Trefferliste — sonst verschoebe das Loesen der
							// Bezuege (ohne returning) die Reihenfolge der Faelle.
							return Object.assign(Promise.resolve([]), {
								returning: () => Promise.resolve(mocks.returningRows.shift() ?? [{ id: 'item-getroffen' }])
							});
						}
					})
				}),
				insert: (table: unknown) => ({
					values: (values: unknown) => {
						mocks.insertCalls.push({ table, values });
						return Promise.resolve();
					}
				}),
				delete: (table: unknown) => ({
					where: () => {
						mocks.deleteCalls.push({ table });
						return Promise.resolve();
					}
				})
			};
			// Drizzle gibt den Rueckgabewert des Rumpfes weiter — der Endpunkt holt sich so
			// die Liste der von Hand gesetzten Kategorien heraus.
			return await fn(tx);
		}
	}
}));

import { POST } from './+server';
import { receipts, receiptItems } from '$lib/server/db/schema';

const ZEILE_A = '11111111-1111-4111-8111-111111111111';
const ZEILE_B = '22222222-2222-4222-8222-222222222222';

function zeile(over: Record<string, unknown> = {}) {
	return {
		id: ZEILE_A,
		lineNo: 1,
		rawText: 'MILCH',
		lineType: 'article',
		quantity: '1',
		unit: 'stk',
		unitPriceCents: 109,
		totalPriceCents: 109,
		vatClass: 'A',
		appliesToLine: null,
		categoryId: null,
		...over
	};
}

/** Eine Zeile, wie sie in der Datenbank steht — gleiche Felder wie zeile(), plus corrected. */
function bestandZeile(over: Record<string, unknown> = {}) {
	const { appliesToLine: _weg, ...rest } = zeile(over);
	void _weg;
	return { ...rest, corrected: false };
}

function rumpf(items: unknown[] = [zeile()], over: Record<string, unknown> = {}) {
	return {
		receipt: { merchantNameRaw: 'Frischmarkt', purchasedAt: null, totalGrossCents: 109, paymentMethod: null },
		items,
		geloescht: [],
		...over
	};
}

function fakeEvent(
	body: unknown,
	user: { id: string; householdId: string; rolle?: 'verwalter' | 'mitglied' } | null = {
		id: 'user-1',
		householdId: 'household-1'
	}
) {
	const request = new Request('http://bon.local/api/receipts/r1/confirm', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const zugriff = user
		? { haushaltId: user.householdId, nutzerId: user.id, rolle: user.rolle ?? 'mitglied' }
		: null;
	return { params: { id: 'r1' }, request, locals: { user, zugriff } } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/receipts/[id]/confirm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.selectResult = [];
		mocks.bestand = [bestandZeile()];
		mocks.updateCalls.length = 0;
		mocks.insertCalls.length = 0;
		mocks.deleteCalls.length = 0;
		mocks.returningRows.length = 0;
	});

	it('lehnt ohne angemeldeten Nutzer mit 401 ab', async () => {
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf(), null));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 401)).toBe(true);
	});

	it('meldet 404, wenn der Bon nicht existiert oder einem anderen Haushalt gehört', async () => {
		mocks.selectResult = [];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 404)).toBe(true);
	});

	it('lehnt Korrekturen mit Bruchzahlen-Cent hart ab (Kerninvariante: ganzzahlige Cent)', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf([zeile({ totalPriceCents: 1.09 })])));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('lehnt einen unbekannten lineType ab, statt ihn stillschweigend durchzulassen', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf([zeile({ lineType: 'gutschein' })])));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
	});

	// Der alte Rumpf (nur id, totalPriceCents, lineType) ist seit Etappe 3 unvollstaendig.
	// Er darf nicht still als "der Rest bleibt" durchgehen — er wird abgelehnt, und die
	// Handy-Ansicht schickt seit demselben Commit den vollstaendigen Rumpf.
	it('lehnt den alten, unvollstaendigen Rumpf ab', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent({ items: [{ id: ZEILE_A, totalPriceCents: 109, lineType: 'article' }] }));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
	});

	it('lehnt Luecken in den Zeilennummern mit Klartext ab — der Server nummeriert nicht um', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf([zeile({ lineNo: 1 }), zeile({ id: ZEILE_B, lineNo: 3 })])));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
		expect((caught as { body: { message: string } }).body.message).toMatch(/lückenlos/);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('schreibt jede Position, loest und setzt Bezuege, und setzt den Bon auf confirmed', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		mocks.bestand = [bestandZeile({ lineNo: 1 }), bestandZeile({ id: ZEILE_B, lineNo: 2 })];

		const response = await POST(
			fakeEvent(
				rumpf([
					zeile({ lineNo: 1, totalPriceCents: 129 }),
					zeile({ id: ZEILE_B, lineNo: 2, rawText: 'RABATT', lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })
				])
			)
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });

		const itemUpdates = mocks.updateCalls.filter((c) => c.table === receiptItems);
		// 1x parken + alle Bezuege loesen, 2x Positionen schreiben, 1x den Bezug von Zeile 2 setzen
		expect(itemUpdates).toHaveLength(4);
		expect(itemUpdates[0].set).toMatchObject({ appliesToLine: null });
		expect(itemUpdates[0].set).toHaveProperty('lineNo'); // die Negation als SQL
		expect(itemUpdates[1].set).toMatchObject({ totalPriceCents: 129, lineType: 'article', rawText: 'MILCH' });
		expect(itemUpdates[2].set).toMatchObject({ totalPriceCents: -50, lineType: 'discount' });
		expect(itemUpdates[3].set).toEqual({ appliesToLine: 1 });

		const receiptUpdate = mocks.updateCalls.find((c) => c.table === receipts);
		expect(receiptUpdate?.set).toMatchObject({
			status: 'confirmed',
			confirmedBy: 'user-1',
			merchantId: 'merchant-1',
			merchantNameRaw: 'Frischmarkt',
			totalGrossCents: 109
		});
	});

	it('legt eine neue Zeile (id null) an und markiert sie als korrigiert', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		await POST(fakeEvent(rumpf([zeile(), zeile({ id: null, lineNo: 2, rawText: 'NACHGETRAGEN', totalPriceCents: 99 })])));
		expect(mocks.insertCalls).toHaveLength(1);
		expect(mocks.insertCalls[0].table).toBe(receiptItems);
		expect(mocks.insertCalls[0].values).toMatchObject({ receiptId: 'r1', rawText: 'NACHGETRAGEN', corrected: true });
	});

	it('loescht die als geloescht gemeldeten Zeilen', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		mocks.bestand = [bestandZeile(), bestandZeile({ id: ZEILE_B, lineNo: 2 })];
		await POST(fakeEvent(rumpf([zeile()], { geloescht: [ZEILE_B] })));
		expect(mocks.deleteCalls).toHaveLength(1);
		expect(mocks.deleteCalls[0].table).toBe(receiptItems);
	});

	// Ohne die Trefferzahl-Pruefung war der WHERE-Schutz zugleich ein stilles Loch:
	// trifft er keine Zeile, passiert nichts — und der Bon wurde trotzdem `confirmed`.
	// Das ist der schlimmste Ausgang fuer dieses Projekt: nicht "kaputt und markiert",
	// sondern "still falsch". `confirmed` ist der Status, den die Auswertungen lesen und
	// der als Wahrheit gegen das Modell gehalten wird.
	it('meldet 409 und bestaetigt den Bon NICHT, wenn eine Korrektur auf eine fremde Zeile zeigt', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		mocks.bestand = []; // dieser Bon hat die Zeile nicht
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		// Entscheidend: das Update auf `receipts` darf gar nicht erst versucht worden sein.
		expect(mocks.updateCalls.some((c) => c.table === receipts)).toBe(false);
	});

	// Eine Zeile des Bestands, die weder geaendert noch geloescht wird, waere nach dem
	// Parken mit negativer Nummer zurueckgeblieben — und der Bon trotzdem bestaetigt.
	it('meldet 409, wenn eine Zeile des Bons in den Korrekturen fehlt', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		mocks.bestand = [bestandZeile(), bestandZeile({ id: ZEILE_B, lineNo: 2 })];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf([zeile()]))); // ZEILE_B weder gesendet noch geloescht
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.deleteCalls).toHaveLength(0);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('meldet 409, wenn eine Zeile zwischen Laden und Schreiben verschwindet (Wettlauf)', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		mocks.returningRows = [[]]; // das Update trifft nichts mehr
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.updateCalls.some((c) => c.table === receipts)).toBe(false);
	});

	it('verweigert die Bestaetigung eines Bons, der noch nicht ausgelesen ist', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'extracting' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('verweigert die Bestaetigung, solange der Doppel-Hinweis offen ist', async () => {
		// Sonst stuende derselbe Einkauf zweimal im Haushaltsbuch — der ALDI-Bon vom 16.09.
		// war genau so zweimal bestaetigt worden.
		mocks.selectResult = [{ id: 'r1', status: 'review', vermutetesOriginalId: 'r0' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('verweigert die erneute Bestaetigung eines bereits bestaetigten Bons', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'confirmed' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('lehnt einen Betrag ausserhalb des int4-Bereichs ab, statt am UPDATE zu sterben', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent(rumpf([zeile({ totalPriceCents: 2_147_483_648 })])));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
	});

	// `corrected` darf nicht pauschal true werden: das Feld fuettert spaeter das Lernen
	// (Phase 2, Aufgabe 7). Verglichen wird gegen den Bestand — nur eine Zeile, an der
	// sich etwas geaendert hat, gilt als korrigiert.
	it('laesst corrected false, wenn die Zeile unveraendert zurueckkommt', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		await POST(fakeEvent(rumpf()));
		const itemUpdate = mocks.updateCalls.filter((c) => c.table === receiptItems)[1];
		expect(itemUpdate?.set).toMatchObject({ corrected: false });
	});

	it('setzt corrected, wenn sich ein Feld geaendert hat', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		await POST(fakeEvent(rumpf([zeile({ totalPriceCents: 119 })])));
		const itemUpdate = mocks.updateCalls.filter((c) => c.table === receiptItems)[1];
		expect(itemUpdate?.set).toMatchObject({ corrected: true, totalPriceCents: 119 });
	});
});
