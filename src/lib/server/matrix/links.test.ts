import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ zeilen: [] as any[], geloescht: [] as unknown[] }));

vi.mock('../db', () => {
	// Befund R02: nutzerZuMatrixId() verkettet jetzt ZWEI innerJoin() (users, dann
	// household_members) statt einem. `Kette` liefert bei jedem Aufruf dasselbe
	// Objekt zurück (innerJoin UND where), damit beliebig viele Joins verkettbar
	// bleiben, ohne die Attrappe bei jeder künftigen Erweiterung neu bauen zu müssen.
	type Kette = { innerJoin: () => Kette; where: () => Promise<any[]> };
	const kette = (): Kette => ({
		innerJoin: () => kette(),
		where: () => Promise.resolve(mocks.zeilen)
	});
	return {
		db: {
			select: () => ({ from: () => kette() }),
			delete: () => ({ where: (w: unknown) => { mocks.geloescht.push(w); return Promise.resolve(); } })
		}
	};
});

import { db } from '../db';
import { nutzerZuMatrixId, verknuepfungLoesen } from './links';

describe('Verknüpfungen', () => {
	beforeEach(() => {
		mocks.zeilen = [];
		mocks.geloescht = [];
	});

	it('findet den App-Nutzer zu einem gekoppelten Matrix-Konto', async () => {
		mocks.zeilen = [{ userId: 'u1', householdId: 'h1', displayName: 'Erika Mustermann' }];
		expect(await nutzerZuMatrixId('@erika:example.org')).toEqual({
			userId: 'u1',
			householdId: 'h1',
			displayName: 'Erika Mustermann'
		});
	});

	// Der wichtigste Fall: ein ungekoppeltes Konto bekommt null, nicht irgendeinen Nutzer.
	// Ein Rückfall auf "den ersten Nutzer" wäre ein Datenleck in fremde Kaufhistorie.
	it('gibt null für ein nicht gekoppeltes Matrix-Konto', async () => {
		mocks.zeilen = [];
		expect(await nutzerZuMatrixId('@fremd:example.org')).toBeNull();
	});

	it('löst eine Verknüpfung', async () => {
		// db (bzw. eine Transaktion) wird als Ausfuehrer hereingereicht (Fix-Runde 2:
		// mitgliedEntfernen() ruft dieselbe Funktion mit einem `tx` statt dem globalen
		// `db` auf, damit das Loesen der Verknuepfung Teil derselben Transaktion ist).
		await verknuepfungLoesen(db, 'u1');
		expect(mocks.geloescht).toHaveLength(1);
	});
});
