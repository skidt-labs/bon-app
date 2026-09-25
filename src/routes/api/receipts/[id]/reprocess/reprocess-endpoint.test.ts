import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// $lib/server/db/schema wird bewusst NICHT gemockt (reine Tabellendefinitionen, eq()
// braucht echte Column-Objekte) — dieselbe Begründung wie bei
// confirm/confirm-endpoint.test.ts und receipts-endpoint.test.ts.
const mocks = vi.hoisted(() => ({
	enqueueExtraction: vi.fn(),
	updateCalls: [] as { set: unknown }[],
	// Zeilen, die das jeweils NÄCHSTE .returning() liefert. Leer = Standardfall
	// "eine Zeile getroffen" ([{ id: 'r1' }]); ein vorangestelltes [] stellt "keine
	// Zeile getroffen" nach (falscher Status/fremder Haushalt/nicht gefunden).
	returningRows: [] as unknown[][],
	selectResult: [] as unknown[]
}));

vi.mock('$lib/server/queue/boss', () => ({ enqueueExtraction: mocks.enqueueExtraction }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => Promise.resolve(mocks.selectResult)
			})
		}),
		update: () => ({
			set: (set: unknown) => ({
				where: () => {
					mocks.updateCalls.push({ set });
					const rows = mocks.returningRows.shift() ?? [{ id: 'r1' }];
					// Muss BEIDES können: direkt awaitbar sein (so nutzt es der
					// kompensierende Fehlschlags-Pfad ohne .returning()) und .returning()
					// anbieten (so nutzt es der atomare Statuswächter-Übergang) — dieselbe
					// Konstruktion wie in confirm-endpoint.test.ts.
					return Object.assign(Promise.resolve(rows), {
						returning: () => Promise.resolve(rows)
					});
				}
			})
		})
	}
}));

import { POST } from './+server';

function fakeEvent(
	user: { id: string; householdId: string; rolle?: 'verwalter' | 'mitglied' } | null = {
		id: 'user-1',
		householdId: 'household-1'
	}
) {
	const zugriff = user
		? { haushaltId: user.householdId, nutzerId: user.id, rolle: user.rolle ?? 'mitglied' }
		: null;
	return { params: { id: 'r1' }, locals: { user, zugriff } } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/receipts/[id]/reprocess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.updateCalls.length = 0;
		mocks.returningRows.length = 0;
		mocks.selectResult = [];
		mocks.enqueueExtraction.mockResolvedValue(undefined);
	});

	it('lehnt ohne angemeldeten Nutzer mit 401 ab', async () => {
		let caught: unknown;
		try {
			await POST(fakeEvent(null));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 401)).toBe(true);
		expect(mocks.enqueueExtraction).not.toHaveBeenCalled();
	});

	it('meldet 404, wenn der Bon nicht existiert oder einem anderen Haushalt gehört', async () => {
		mocks.returningRows = [[]]; // das atomare UPDATE trifft keine Zeile
		mocks.selectResult = []; // und die Diagnose-Abfrage findet auch keinen Bon
		let caught: unknown;
		try {
			await POST(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 404)).toBe(true);
		expect(mocks.enqueueExtraction).not.toHaveBeenCalled();
	});

	// Der wichtigste Wächter dieser Aufgabe: ein bereits bestätigter Bon darf NICHT
	// versehentlich neu ausgelesen (und damit überschrieben) werden.
	it('verweigert die Neuauslesung eines bereits bestätigten Bons', async () => {
		mocks.returningRows = [[]];
		mocks.selectResult = [{ id: 'r1', status: 'confirmed' }];
		let caught: unknown;
		try {
			await POST(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.enqueueExtraction).not.toHaveBeenCalled();
	});

	// Derselbe Bon darf nicht doppelt in der Warteschlange landen — 'pending' und
	// 'extracting' bedeuten beide "steckt schon drin".
	it('verweigert die Neuauslesung eines Bons, der bereits in der Warteschlange steckt oder läuft', async () => {
		for (const status of ['pending', 'extracting']) {
			mocks.returningRows = [[]];
			mocks.selectResult = [{ id: 'r1', status }];
			mocks.updateCalls.length = 0;
			let caught: unknown;
			try {
				await POST(fakeEvent());
			} catch (err) {
				caught = err;
			}
			expect(isHttpError(caught, 409), status).toBe(true);
			expect(mocks.enqueueExtraction, status).not.toHaveBeenCalled();
		}
	});

	it('verweigert die Neuauslesung eines Bons, der bereits ausgelesen ist und auf Bestätigung wartet', async () => {
		mocks.returningRows = [[]];
		mocks.selectResult = [{ id: 'r1', status: 'review' }];
		let caught: unknown;
		try {
			await POST(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.enqueueExtraction).not.toHaveBeenCalled();
	});

	// Der zentrale Erfolgsfall: genau der Bon, den Teil B, Punkt 2 sonst für immer
	// auf 'extracting' stehen liesse.
	it('reiht einen gescheiterten Bon erneut ein und setzt ihn auf pending zurück', async () => {
		mocks.returningRows = [[{ id: 'r1' }]]; // das atomare UPDATE trifft die Zeile

		const response = await POST(fakeEvent());

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ id: 'r1', queued: true });

		expect(mocks.updateCalls).toHaveLength(1);
		expect(mocks.updateCalls[0].set).toMatchObject({ status: 'pending', failureReason: null });
		expect(mocks.enqueueExtraction).toHaveBeenCalledWith('r1');
	});

	// Doppel-Klick/Doppelaufruf: der ZWEITE Aufruf trifft mit dem atomaren UPDATE
	// keine Zeile mehr (Status ist schon 'pending'), landet also nicht ein zweites
	// Mal in der Warteschlange.
	it('lässt einen zweiten, unmittelbar folgenden Aufruf leer ausgehen (kein doppeltes Einreihen)', async () => {
		mocks.returningRows = [[]]; // zweiter Aufruf: das atomare UPDATE trifft nichts mehr
		mocks.selectResult = [{ id: 'r1', status: 'pending' }]; // Diagnose sieht den ersten Aufruf bereits

		let caught: unknown;
		try {
			await POST(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 409)).toBe(true);
		expect(mocks.enqueueExtraction).not.toHaveBeenCalled();
	});

	// Derselbe Fehlerpfad wie beim ursprünglichen Upload (receipts-endpoint.test.ts):
	// enqueueExtraction schlägt fehl, der Bon darf nicht unsichtbar auf "pending"
	// hängen bleiben, als würde noch etwas passieren.
	it('markiert den Bon wieder als failed und meldet queued:false, wenn enqueueExtraction fehlschlägt', async () => {
		mocks.returningRows = [[{ id: 'r1' }]];
		mocks.enqueueExtraction.mockRejectedValue(new Error('pg-boss ist nicht erreichbar'));

		const response = await POST(fakeEvent());

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ id: 'r1', queued: false });

		expect(mocks.updateCalls).toHaveLength(2);
		expect(mocks.updateCalls[1].set).toMatchObject({ status: 'failed' });
		const setArg = mocks.updateCalls[1].set as { failureReason: string };
		expect(typeof setArg.failureReason).toBe('string');
		expect(setArg.failureReason.length).toBeGreaterThan(0);
	});
});
