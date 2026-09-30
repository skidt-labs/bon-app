import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	bon: null as Record<string, unknown> | null,
	updateTreffer: [{ id: 'r1' }] as unknown[],
	updates: [] as unknown[],
	fehlgeschlagen: vi.fn(async () => {})
}));

vi.mock('$lib/server/bons/liste', () => ({
	bonLaden: vi.fn(async () => mocks.bon),
	bonAlsFehlgeschlagenMarkieren: mocks.fehlgeschlagen
}));
vi.mock('$lib/server/queue/boss', () => ({ enqueueExtraction: vi.fn(async () => {}) }));
vi.mock('$lib/server/storage/images', () => ({ loescheBilder: vi.fn(async () => {}) }));

import { zielstatusBeimWiederherstellen, inPapierkorbLegen, ausPapierkorbHolen, bonsEndgueltigLoeschen } from './papierkorb';
import { loescheBilder } from '$lib/server/storage/images';

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
});

describe('zielstatusBeimWiederherstellen', () => {
	it('gibt den Status von vorher zurueck', () => {
		expect(zielstatusBeimWiederherstellen('review')).toBe('review');
		expect(zielstatusBeimWiederherstellen('confirmed')).toBe('confirmed');
		expect(zielstatusBeimWiederherstellen('failed')).toBe('failed');
		expect(zielstatusBeimWiederherstellen('doppelt')).toBe('doppelt');
	});
	it('stellt einen beim Lesen verworfenen Bon wieder in die Warteschlange', () => {
		expect(zielstatusBeimWiederherstellen('pending')).toBe('pending');
		expect(zielstatusBeimWiederherstellen('extracting')).toBe('pending');
		expect(zielstatusBeimWiederherstellen(null)).toBe('pending');
	});
});

describe('inPapierkorbLegen', () => {
	it('meldet 404 fuer einen Bon, den es fuer diesen Menschen nicht gibt', async () => {
		mocks.bon = null;
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', false)).toMatchObject({ ok: false, status: 404 });
	});
	it('meldet 403 fuer den Bon eines anderen Mitglieds', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u2', status: 'review' };
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', false)).toMatchObject({ ok: false, status: 403 });
		expect(mocks.updates).toHaveLength(0);
	});
	it('verlangt beim bestaetigten Bon die ausdrueckliche Rueckfrage', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'confirmed' };
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', false)).toMatchObject({ ok: false, status: 409 });
		expect(mocks.updates).toHaveLength(0);
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', true)).toEqual({ ok: true });
		expect(mocks.updates[0]).toMatchObject({ status: 'verworfen', statusVorVerwerfen: 'confirmed', verworfenVon: 'u1' });
	});
	it('meldet 409 fuer einen Bon, der schon im Papierkorb liegt', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen' };
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', true)).toMatchObject({ ok: false, status: 409 });
	});
	it('meldet 409, wenn der Bon sich zwischen Lesen und Schreiben geaendert hat', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'review' };
		mocks.updateTreffer = [];
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', false)).toMatchObject({ ok: false, status: 409 });
	});
});

describe('ausPapierkorbHolen', () => {
	it('reiht einen beim Lesen verworfenen Bon neu ein', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen', statusVorVerwerfen: 'extracting' };
		const einreihen = vi.fn(async () => {});
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true });
		expect(einreihen).toHaveBeenCalledWith('r1');
		expect(mocks.updates[0]).toMatchObject({ status: 'pending', statusVorVerwerfen: null, verworfenAm: null });
	});
	it('markiert ihn als fehlgeschlagen, wenn das Einreihen scheitert', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen', statusVorVerwerfen: 'pending' };
		const einreihen = vi.fn(async () => {
			throw new Error('Warteschlange weg');
		});
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true });
		expect(mocks.fehlgeschlagen).toHaveBeenCalled();
	});
	it('reiht einen ausgelesenen Bon nicht ein', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen', statusVorVerwerfen: 'review' };
		const einreihen = vi.fn(async () => {});
		await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen);
		expect(einreihen).not.toHaveBeenCalled();
		expect(mocks.updates[0]).toMatchObject({ status: 'review' });
	});
	it('meldet 409 fuer einen Bon, der nicht im Papierkorb liegt', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'review' };
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 409 });
	});
	it('meldet 403 fuer den Bon eines anderen Mitglieds', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u2', status: 'verworfen', statusVorVerwerfen: 'review' };
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1')).toMatchObject({ ok: false, status: 403 });
	});
});

describe('bonsEndgueltigLoeschen', () => {
	// Seit „Bild bearbeiten" (30.09.2026) kann ein Bon zwei Fassungen haben — beide muessen weg.
	it('loescht auch das Original eines bearbeiteten Bons', async () => {
		const db = {
			delete: () => ({
				where: () => ({
					returning: async () => [
						{ imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' },
						{ imagePath: 'c/x.webp', thumbPath: 'c/x.thumb.webp', originalImagePath: null, originalThumbPath: null }
					]
				})
			})
		} as never;
		expect(await bonsEndgueltigLoeschen(db, ['r1', 'r2'])).toBe(2);
		expect(loescheBilder).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp', 'a/foto.webp', 'a/foto.thumb.webp', 'c/x.webp', 'c/x.thumb.webp']);
	});
});
