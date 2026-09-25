import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
	verknuepfung: null as unknown,
	botStand: null as unknown,
	angefragteNutzer: [] as string[],
	angelegteCodesFuer: [] as string[],
	geloesteNutzer: [] as string[]
}));

vi.mock('$lib/server/matrix/links', () => ({
	verknuepfungFuerNutzer: vi.fn(async (userId: string) => {
		mocks.angefragteNutzer.push(userId);
		return mocks.verknuepfung;
	}),
	verknuepfungLoesen: vi.fn(async (_ausfuehrer: unknown, userId: string) => {
		mocks.geloesteNutzer.push(userId);
	})
}));

vi.mock('$lib/server/matrix/pairing', () => ({
	codeAnlegen: vi.fn(async (userId: string) => {
		mocks.angelegteCodesFuer.push(userId);
		return { code: 'ABCDEFGH', expiresAt: new Date('2026-09-15T12:10:00Z') };
	})
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => Promise.resolve(mocks.botStand ? [mocks.botStand] : []) })
		})
	}
}));

import { load, actions } from './+page.server';

/**
 * `load` ist als `void | PageData` typisiert, weil die Weiterleitung für nicht
 * angemeldete Besucher darin steckt. Statt den Typ wegzucasten wird hier ZUGESICHERT,
 * dass für einen angemeldeten Nutzer wirklich Daten zurückkommen — eine stillschweigend
 * leere Antwort wäre selbst ein Befund.
 */
async function ladeDaten(user: unknown) {
	const daten = await load(ereignis(user));
	if (!daten) throw new Error('load lieferte keine Daten für einen angemeldeten Nutzer');
	return daten;
}

function ereignis(user: unknown) {
	// `params.id` ist bewusst gesetzt: der Test weist nach, dass die Seite ihn NICHT benutzt.
	return { locals: { user }, params: { id: 'FREMDER-NUTZER' } } as never;
}

describe('Matrix-Einstellungen', () => {
	beforeEach(() => {
		mocks.verknuepfung = null;
		mocks.botStand = null;
		mocks.angefragteNutzer = [];
		mocks.angelegteCodesFuer = [];
		mocks.geloesteNutzer = [];
	});

	it('schickt einen nicht angemeldeten Besucher zur Anmeldung', async () => {
		let caught: unknown;
		try {
			await load(ereignis(null));
		} catch (err) {
			caught = err;
		}
		expect(isRedirect(caught)).toBe(true);
	});

	// Dieselbe Absicherung wie bei der Haushaltsseite: die Identität kommt aus der
	// Sitzung, nie aus der URL. Ein Parameter an dieser Stelle wäre kein Anzeigefehler,
	// sondern liesse jemanden einen Kopplungscode für ein FREMDES Konto erzeugen — und
	// damit dessen Bons einschleusen.
	it('fragt ausschliesslich die Verknuepfung des angemeldeten Nutzers ab', async () => {
		await load(ereignis({ id: 'u1', householdId: 'h1' }));
		expect(mocks.angefragteNutzer).toEqual(['u1']);
		expect(mocks.angefragteNutzer).not.toContain('FREMDER-NUTZER');
	});

	// Ein toter Bot ist der stille Totalausfall dieses Wegs: Bons wandern ins Leere und
	// es faellt erst bei der naechsten Anmeldung auf. `null` heisst „noch nie gelaufen"
	// und muss auch so ankommen — nicht als Zeitstempel, den niemand einordnen kann.
	it('meldet null, wenn der Bot noch nie gelaufen ist', async () => {
		const daten = await ladeDaten({ id: 'u1', householdId: 'h1' });
		expect(daten.botZuletztGesehen).toBeNull();
	});

	it('gibt den letzten Sync-Zeitpunkt weiter', async () => {
		const wann = new Date('2026-09-15T12:00:00Z');
		mocks.botStand = { lastSyncAt: wann };
		const daten = await ladeDaten({ id: 'u1', householdId: 'h1' });
		expect(daten.botZuletztGesehen).toEqual(wann);
	});

	it('legt einen Code nur fuer den angemeldeten Nutzer an', async () => {
		const ergebnis = await actions.code(ereignis({ id: 'u1', householdId: 'h1' }));
		expect(mocks.angelegteCodesFuer).toEqual(['u1']);
		expect(ergebnis).toMatchObject({ code: 'ABCDEFGH' });
	});

	it('verweigert das Anlegen eines Codes ohne Anmeldung', async () => {
		const ergebnis = await actions.code(ereignis(null));
		expect((ergebnis as { status?: number }).status).toBe(401);
		expect(mocks.angelegteCodesFuer).toEqual([]);
	});

	it('loest nur die Verknuepfung des angemeldeten Nutzers', async () => {
		await actions.loesen(ereignis({ id: 'u1', householdId: 'h1' }));
		expect(mocks.geloesteNutzer).toEqual(['u1']);
	});

	it('verweigert das Loesen ohne Anmeldung', async () => {
		const ergebnis = await actions.loesen(ereignis(null));
		expect((ergebnis as { status?: number }).status).toBe(401);
		expect(mocks.geloesteNutzer).toEqual([]);
	});
});
