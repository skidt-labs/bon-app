import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	bon: null as Record<string, unknown> | null,
	reaktiviert: { id: 'r1' } as unknown,
	updateTreffer: [{ id: 'r1' }] as unknown[],
	updates: [] as unknown[],
	fehlgeschlagen: vi.fn(async () => {})
}));

vi.mock('$lib/server/bons/liste', () => ({
	bonLaden: vi.fn(async () => mocks.bon),
	bonReaktivieren: vi.fn(async () => mocks.reaktiviert),
	bonAlsFehlgeschlagenMarkieren: mocks.fehlgeschlagen
}));
vi.mock('$lib/server/queue/boss', () => ({ enqueueExtraction: vi.fn(async () => {}) }));

import { dochEinBon } from './kein-bon-entscheidung';

const fakeDb = {
	update: () => ({
		set: (set: unknown) => ({
			where: () => {
				mocks.updates.push(set);
				return { returning: async () => mocks.updateTreffer };
			}
		})
	})
} as never;
const ich = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' as const };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.updates = [];
	mocks.updateTreffer = [{ id: 'r1' }];
	mocks.reaktiviert = { id: 'r1' };
});

describe('dochEinBon', () => {
	it('meldet 404 fuer einen unsichtbaren Bon', async () => {
		mocks.bon = null;
		expect(await dochEinBon(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 404 });
	});

	it('meldet 409 fuer einen Bon ohne Kein-Bon-Hinweis — etwa weil nur der Mac weg war', async () => {
		mocks.bon = { id: 'r1', status: 'failed', needsReviewReason: null };
		expect(await dochEinBon(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 409 });
	});

	it('reiht einen fehlgeschlagenen Bon ohne Vorpruefung neu ein', async () => {
		mocks.bon = { id: 'r1', status: 'failed', needsReviewReason: ['kein_bon_ohne_preise'] };
		const einreihen = vi.fn(async () => {});
		expect(await dochEinBon(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true });
		expect(einreihen).toHaveBeenCalledWith('r1');
	});

	it('meldet 409, wenn ein zweiter Klick den Bon schon neu eingereiht hat', async () => {
		mocks.bon = { id: 'r1', status: 'failed', needsReviewReason: ['kein_bon_leer'] };
		mocks.reaktiviert = null;
		const einreihen = vi.fn(async () => {});
		expect(await dochEinBon(fakeDb, ich, 'r1', einreihen)).toMatchObject({ ok: false, status: 409 });
		expect(einreihen).not.toHaveBeenCalled();
	});

	it('markiert ihn als fehlgeschlagen, wenn das Einreihen scheitert', async () => {
		mocks.bon = { id: 'r1', status: 'failed', needsReviewReason: ['kein_bon_leer'] };
		const einreihen = vi.fn(async () => {
			throw new Error('Warteschlange weg');
		});
		expect(await dochEinBon(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true });
		expect(mocks.fehlgeschlagen).toHaveBeenCalled();
	});

	// Pruefung 27.09.2026: ein zweiter Klick, waehrend der Bon schon wieder wartet, bekam 200.
	it('meldet 409 fuer einen Bon, der gerade wieder gelesen wird', async () => {
		mocks.bon = { id: 'r1', status: 'pending', needsReviewReason: ['kein_bon_ohne_preise'] };
		expect(await dochEinBon(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 409 });
		expect(mocks.updates).toHaveLength(0);
	});

	it('meldet 409 fuer einen verworfenen Bon', async () => {
		mocks.bon = { id: 'r1', status: 'verworfen', needsReviewReason: ['kein_bon_kartenbeleg'] };
		expect(await dochEinBon(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 409 });
	});

	it('nimmt bei einem gelesenen Bon nur den Hinweis heraus', async () => {
		mocks.bon = { id: 'r1', status: 'review', needsReviewReason: ['sum_mismatch', 'kein_bon_kartenbeleg'] };
		const einreihen = vi.fn(async () => {});
		expect(await dochEinBon(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true });
		expect(einreihen).not.toHaveBeenCalled();
		expect(mocks.updates).toHaveLength(1);
	});

	it('meldet 409, wenn sich der gelesene Bon gerade geaendert hat', async () => {
		mocks.bon = { id: 'r1', status: 'review', needsReviewReason: ['kein_bon_kartenbeleg'] };
		mocks.updateTreffer = [];
		expect(await dochEinBon(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 409 });
	});
});
