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

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
	zielstatusBeimWiederherstellen,
	inPapierkorbLegen,
	ausPapierkorbHolen,
	bonsEndgueltigLoeschen,
	papierkorbLeeren,
	papierkorbGrenze,
	verwaisteAbhaengige
} from './papierkorb';
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
	// 2.3: „bitte bestätigen" las sich wie „Bon bestätigen"; die Kennung laesst die Bonliste
	// in die zweite Stufe springen, statt beim zweiten Klick wieder hier zu landen.
	it('fragt beim bestaetigten Bon verstaendlich nach und kennzeichnet die Rueckfrage', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'confirmed' };
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', false)).toEqual({
			ok: false,
			status: 409,
			meldung: 'Dieser Bon ist bestätigt und zählt in Berichten und Budgets. Im Papierkorb zählt er nicht mehr — wirklich verwerfen?',
			brauchtRueckfrage: true
		});
	});
	it('kennzeichnet andere Ablehnungen nicht als Rueckfrage', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen' };
		expect(await inPapierkorbLegen(fakeDb, ich, 'r1', true)).not.toHaveProperty('brauchtRueckfrage');
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
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true, eingereiht: true, status: 'pending' });
		expect(einreihen).toHaveBeenCalledWith('r1');
		expect(mocks.updates[0]).toMatchObject({ status: 'pending', statusVorVerwerfen: null, verworfenAm: null });
	});
	// 2.11: vorher meldete die Antwort Erfolg, und der Bon stand still auf „fehlgeschlagen".
	it('markiert ihn als fehlgeschlagen und sagt es, wenn das Einreihen scheitert', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen', statusVorVerwerfen: 'pending' };
		const einreihen = vi.fn(async () => {
			throw new Error('Warteschlange weg');
		});
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true, eingereiht: false, status: 'pending' });
		expect(mocks.fehlgeschlagen).toHaveBeenCalled();
	});
	it('reiht einen ausgelesenen Bon nicht ein', async () => {
		mocks.bon = { id: 'r1', uploadedBy: 'u1', status: 'verworfen', statusVorVerwerfen: 'review' };
		const einreihen = vi.fn(async () => {});
		expect(await ausPapierkorbHolen(fakeDb, ich, 'r1', einreihen)).toEqual({ ok: true, eingereiht: false, status: 'review' });
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

/** Eine Verbindung, deren transaction() eine Attrappe mit select/delete/update hergibt. */
function loeschDb(o: { abhaengige?: { id: string; original: string | null }[]; geloescht: Record<string, unknown>[] }) {
	const ablauf: string[] = [];
	const tx = {
		select: () => ({ from: () => ({ where: async () => (ablauf.push('select'), o.abhaengige ?? []) }) }),
		delete: () => ({ where: () => ({ returning: async () => (ablauf.push('delete'), o.geloescht) }) }),
		update: () => ({ set: (set: unknown) => ({ where: async () => void ablauf.push(`update ${Object.keys(set as object).join(',')}`) }) })
	};
	return { d: { transaction: async (f: (t: unknown) => Promise<unknown>) => f(tx) } as never, ablauf };
}

describe('bonsEndgueltigLoeschen', () => {
	// Seit „Bild bearbeiten" (30.09.2026) kann ein Bon zwei Fassungen haben — beide muessen weg.
	it('loescht auch das Original eines bearbeiteten Bons', async () => {
		const { d } = loeschDb({
			geloescht: [
				{ id: 'r1', imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' },
				{ id: 'r2', imagePath: 'c/x.webp', thumbPath: 'c/x.thumb.webp', originalImagePath: null, originalThumbPath: null }
			]
		});
		expect(await bonsEndgueltigLoeschen(d, ['r1', 'r2'])).toBe(2);
		expect(loescheBilder).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp', 'a/foto.webp', 'a/foto.thumb.webp', 'c/x.webp', 'c/x.thumb.webp']);
	});

	// 2.8: liest die Verweise VOR dem DELETE (danach hat ON DELETE SET NULL sie geleert).
	it('loest die Doppel-Verweise auf ein geloeschtes Original in derselben Transaktion', async () => {
		const { d, ablauf } = loeschDb({
			abhaengige: [{ id: 'd1', original: 'r1' }],
			geloescht: [{ id: 'r1', imagePath: 'a.webp', thumbPath: 'a.thumb.webp', originalImagePath: null, originalThumbPath: null }]
		});
		await bonsEndgueltigLoeschen(d, ['r1']);
		expect(ablauf).toEqual(['select', 'delete', 'update needsReviewReason', 'update status', 'update statusVorVerwerfen']);
	});

	it('fasst niemanden an, wenn das DELETE nichts trifft (Bon inzwischen zurueckgeholt)', async () => {
		const { d, ablauf } = loeschDb({ abhaengige: [{ id: 'd1', original: 'r1' }], geloescht: [] });
		expect(await bonsEndgueltigLoeschen(d, ['r1'])).toBe(0);
		expect(ablauf).toEqual(['select', 'delete']);
	});
});

// Sammelfassung 4.3: zwischen Auswahl (abgelaufeneBons) und DELETE kann ein Bon zurueckgeholt und
// neu verworfen worden sein. Status 'verworfen' stimmt dann wieder — nur die Frist nicht.
describe('papierkorbLeeren', () => {
	const jetzt = new Date('2026-10-07T02:30:00Z');

	function leerenDb() {
		const geloescht: unknown[] = [];
		const verbindung = {
			select: () => ({ from: () => ({ where: async () => [{ id: 'r1' }] }) }),
			delete: () => ({
				where: (bedingung: unknown) => {
					geloescht.push(bedingung);
					return { returning: async () => [] };
				}
			})
		};
		// Seit 2.8 laeuft das DELETE in einer Transaktion; die Attrappe reicht sich selbst hinein.
		const d = { ...verbindung, transaction: async (f: (tx: unknown) => Promise<unknown>) => f(verbindung) } as never;
		return { d, geloescht };
	}

	it('rechnet die Frist von jetzt 30 Tage zurueck', () => {
		expect(papierkorbGrenze(jetzt).toISOString()).toBe('2026-09-07T02:30:00.000Z');
	});

	it('prueft die Frist auch im DELETE selbst (4.3)', async () => {
		const { d, geloescht } = leerenDb();
		await papierkorbLeeren(d, jetzt);
		expect(geloescht).toHaveLength(1);
		const q = new PgDialect().sqlToQuery(geloescht[0] as SQL);
		expect(q.sql).toContain('"receipts"."verworfen_am" <');
		expect(q.params).toContain('2026-09-07T02:30:00.000Z');
	});

	it('endgueltig loeschen von Hand kennt keine Frist', async () => {
		const { d, geloescht } = leerenDb();
		await bonsEndgueltigLoeschen(d, ['r1']);
		expect(new PgDialect().sqlToQuery(geloescht[0] as SQL).sql).not.toContain('verworfen_am');
	});
});

describe('verwaisteAbhaengige', () => {
	it('nimmt nur Bons, deren Original wirklich geloescht wurde und die selbst bleiben', () => {
		const abhaengige = [
			{ id: 'd1', original: 'r1' },
			{ id: 'd2', original: 'r9' },
			{ id: 'r2', original: 'r1' },
			{ id: 'd3', original: null }
		];
		expect(verwaisteAbhaengige(abhaengige, new Set(['r1', 'r2']))).toEqual(['d1']);
	});
});
