import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// Nachbildung wie in confirm/confirm-endpoint.test.ts.
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

import { PUT } from './+server';
import { receipts } from '$lib/server/db/schema';

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
	const request = new Request('http://bon.local/api/receipts/r1', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const zugriff = user
		? { haushaltId: user.householdId, nutzerId: user.id, rolle: user.rolle ?? 'mitglied' }
		: null;
	return { params: { id: 'r1' }, request, locals: { user, zugriff } } as unknown as Parameters<typeof PUT>[0];
}

describe('PUT /api/receipts/[id]', () => {
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
			await PUT(fakeEvent(rumpf(), null));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 401)).toBe(true);
	});

	it('meldet 404, wenn der Bon nicht existiert oder einem anderen Haushalt gehört', async () => {
		let caught: unknown;
		try {
			await PUT(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 404)).toBe(true);
	});

	it('speichert einen Bon in Pruefung, ohne ihn zu bestaetigen', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		const response = await PUT(fakeEvent(rumpf()));
		expect(response.status).toBe(200);
		const kopf = mocks.updateCalls.find((c) => c.table === receipts);
		expect(kopf?.set).toMatchObject({ merchantNameRaw: 'Frischmarkt' });
		// Entscheidend: kein Statuswechsel, kein confirmedAt.
		expect(kopf?.set).not.toHaveProperty('status');
		expect(kopf?.set).not.toHaveProperty('confirmedAt');
	});

	/**
	 * Ein Fehler faellt oft erst Wochen spaeter auf. Waere `confirmed` hier gesperrt,
	 * stuende er dauerhaft als geprueft in den Auswertungen — genau das passierte am
	 * 17.09.2026 mit einem Bon, der 6,22 EUR statt 2,49 EUR trug. Die Sperre soll eine
	 * doppelte BESTAETIGUNG verhindern, nicht die spaetere Korrektur.
	 */
	it('nimmt auch einen bestaetigten Bon an und laesst ihn bestaetigt', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'confirmed' }];
		const response = await PUT(fakeEvent(rumpf()));
		expect(response.status).toBe(200);
		const kopf = mocks.updateCalls.find((c) => c.table === receipts);
		expect(kopf?.set).not.toHaveProperty('status');
		expect(kopf?.set).not.toHaveProperty('confirmedAt');
	});

	it('verweigert einen Bon, der noch gar nicht ausgelesen ist', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'extracting' }];
		let caught: unknown;
		try {
			await PUT(fakeEvent(rumpf()));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.updateCalls).toHaveLength(0);
	});

	it('lehnt Luecken in den Zeilennummern ab — der Server nummeriert nicht um', async () => {
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await PUT(fakeEvent(rumpf([zeile({ lineNo: 1 }), zeile({ id: ZEILE_B, lineNo: 3 })])));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 400)).toBe(true);
	});
});
