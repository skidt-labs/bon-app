import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	bon: null as Record<string, unknown> | null,
	updateTreffer: [{ id: 'r1' }] as unknown[],
	updates: [] as Record<string, unknown>[],
	/** Bei dieser Tabelle wirft das UPDATE (Datenbankfehler). */
	wirftBei: null as unknown,
	fehlgeschlagen: vi.fn(async () => {})
}));

vi.mock('$lib/server/bons/liste', () => ({
	bonLaden: vi.fn(async () => mocks.bon),
	bonAlsFehlgeschlagenMarkieren: mocks.fehlgeschlagen
}));
vi.mock('$lib/server/queue/boss', () => ({ enqueueExtraction: vi.fn(async () => {}) }));
vi.mock('$lib/server/storage/images', () => ({ storeReceiptImage: vi.fn(), loescheBilder: vi.fn(async () => {}), istSystemfehler: () => false, leseBild: vi.fn() }));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bildErsetzen, originalWiederherstellen } from './bild';
import { receipts, receiptItems } from '$lib/server/db/schema';

const tabellen: unknown[] = [];
const bedingungen: unknown[] = [];
/** Je UPDATE: lief es in der Transaktion (true) oder direkt auf der Verbindung (false)? */
const inTransaktion: boolean[] = [];
function verbindung(imTx: boolean): unknown {
	return {
		update: (tabelle: unknown) => ({
			set: (set: Record<string, unknown>) => ({
				where: (bedingung: unknown) => {
					mocks.updates.push(set);
					tabellen.push(tabelle);
					bedingungen.push(bedingung);
					inTransaktion.push(imTx);
					const ergebnis = async () => {
						if (tabelle === mocks.wirftBei) throw new Error('Verbindung weg');
						return mocks.updateTreffer;
					};
					return {
						then: (ja: (v: unknown) => unknown, nein: (e: unknown) => unknown) => ergebnis().then(ja, nein),
						returning: ergebnis
					};
				}
			})
		}),
		transaction: async (f: (tx: unknown) => Promise<unknown>) => f(verbindung(true))
	};
}
const fakeDb = verbindung(false) as never;
/** Parameter der WHERE-Bedingung des i-ten UPDATEs, wie Postgres sie bekommt. */
const parameter = (i: number) => new PgDialect().sqlToQuery(bedingungen[i] as SQL).params;
const ich = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' as const };
const bon = (over: Record<string, unknown> = {}) => ({
	id: 'r1',
	uploadedBy: 'u1',
	status: 'review',
	imagePath: 'a/foto.webp',
	thumbPath: 'a/foto.thumb.webp',
	originalImagePath: null,
	originalThumbPath: null,
	...over
});

function deps() {
	return {
		speichern: vi.fn(async () => ({ imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', width: 100 })),
		loeschen: vi.fn(async () => {}),
		einreihen: vi.fn(async () => {})
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.updates = [];
	tabellen.length = 0;
	bedingungen.length = 0;
	inTransaktion.length = 0;
	mocks.wirftBei = null;
	mocks.updateTreffer = [{ id: 'r1' }];
});

describe('bildErsetzen', () => {
	it('meldet 404 und 403 wie beim Papierkorb', async () => {
		mocks.bon = null;
		expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps())).toMatchObject({ ok: false, status: 404 });
		mocks.bon = bon({ uploadedBy: 'u2' });
		expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps())).toMatchObject({ ok: false, status: 403 });
	});

	it('meldet 409 fuer Bons, die gerade gelesen werden, bestaetigt oder verworfen sind — ohne zu speichern', async () => {
		for (const status of ['pending', 'extracting', 'confirmed', 'verworfen', 'doppelt']) {
			mocks.bon = bon({ status });
			const d = deps();
			expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).toMatchObject({ ok: false, status: 409 });
			expect(d.speichern).not.toHaveBeenCalled();
		}
	});

	it('merkt sich beim ersten Bearbeiten das Original und liest neu', async () => {
		mocks.bon = bon();
		const d = deps();
		expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).toEqual({ ok: true });
		expect(mocks.updates[0]).toMatchObject({
			imagePath: 'b/neu.webp',
			thumbPath: 'b/neu.thumb.webp',
			originalImagePath: 'a/foto.webp',
			originalThumbPath: 'a/foto.thumb.webp',
			status: 'pending',
			needsReviewReason: null
		});
		expect(d.loeschen).not.toHaveBeenCalled();
		expect(d.einreihen).toHaveBeenCalledWith('r1');
	});

	// Pruefung 30.09.2026: bis neu gelesen ist, zeigten die alten Rahmen auf das neue Bild.
	it('loest die Zuordnung der Positionen zum alten Bild', async () => {
		mocks.bon = bon();
		await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps());
		const i = tabellen.indexOf(receiptItems);
		expect(i).toBeGreaterThanOrEqual(0);
		expect(mocks.updates[i]).toEqual({ ocrZeile: null });
	});

	it('behaelt beim zweiten Bearbeiten das erste Original und loescht die Zwischenfassung', async () => {
		mocks.bon = bon({ imagePath: 'b/zwischen.webp', thumbPath: 'b/zwischen.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' });
		const d = deps();
		await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d);
		expect(mocks.updates[0]).toMatchObject({ originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' });
		expect(d.loeschen).toHaveBeenCalledWith(['b/zwischen.webp', 'b/zwischen.thumb.webp']);
	});

	it('loescht die neuen Dateien und liest nicht, wenn sich der Bon inzwischen geaendert hat', async () => {
		mocks.bon = bon();
		mocks.updateTreffer = [];
		const d = deps();
		expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).toMatchObject({ ok: false, status: 409 });
		expect(d.loeschen).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp']);
		expect(d.einreihen).not.toHaveBeenCalled();
	});

	it('markiert als fehlgeschlagen, wenn das Einreihen scheitert', async () => {
		mocks.bon = bon({ status: 'failed' });
		const d = deps();
		d.einreihen.mockRejectedValueOnce(new Error('Warteschlange weg'));
		expect(await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).toEqual({ ok: true });
		expect(mocks.fehlgeschlagen).toHaveBeenCalled();
	});

	// Sammelfassung 4.1: ein veralteter Stand (anderer Tab hat inzwischen bearbeitet und der Bon
	// ist schon wieder gelesen) hat denselben Status, aber ein anderes Bild.
	it('prueft im UPDATE neben dem Status auch den gelesenen Bildpfad (4.1)', async () => {
		mocks.bon = bon();
		await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps());
		expect(tabellen[0]).toBe(receipts);
		expect(parameter(0)).toEqual(['r1', 'review', 'a/foto.webp']);
	});

	it('loescht die neuen Dateien und wirft weiter, wenn die Datenbank beim Speichern scheitert (4.1)', async () => {
		mocks.bon = bon();
		mocks.wirftBei = receipts;
		const d = deps();
		await expect(bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).rejects.toThrow('Verbindung weg');
		expect(d.loeschen).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp']);
		expect(d.einreihen).not.toHaveBeenCalled();
		expect(mocks.fehlgeschlagen).not.toHaveBeenCalled();
	});

	it('schreibt Bild und Zeilenrahmen in EINER Transaktion (4.1)', async () => {
		mocks.bon = bon();
		await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps());
		expect(tabellen).toEqual([receipts, receiptItems]);
		expect(inTransaktion).toEqual([true, true]);
	});

	it('scheitert das Loesen der Zeilenrahmen, wird nicht eingereiht und die neuen Dateien gehen (4.1)', async () => {
		mocks.bon = bon();
		mocks.wirftBei = receiptItems;
		const d = deps();
		await expect(bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), d)).rejects.toThrow('Verbindung weg');
		expect(d.loeschen).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp']);
		expect(d.einreihen).not.toHaveBeenCalled();
	});

	it('ruehrt bei einem geaenderten Bon die Zeilenrahmen nicht an', async () => {
		mocks.bon = bon();
		mocks.updateTreffer = [];
		await bildErsetzen(fakeDb, ich, 'r1', Buffer.from('x'), deps());
		expect(tabellen).toEqual([receipts]);
	});
});

describe('originalWiederherstellen', () => {
	it('meldet 409 ohne Original', async () => {
		mocks.bon = bon();
		expect(await originalWiederherstellen(fakeDb, ich, 'r1', deps())).toMatchObject({ ok: false, status: 409 });
	});

	it('setzt die Pfade zurueck, loescht die bearbeitete Fassung und liest neu', async () => {
		mocks.bon = bon({ imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' });
		const d = deps();
		expect(await originalWiederherstellen(fakeDb, ich, 'r1', d)).toEqual({ ok: true });
		expect(mocks.updates[0]).toMatchObject({
			imagePath: 'a/foto.webp',
			thumbPath: 'a/foto.thumb.webp',
			originalImagePath: null,
			originalThumbPath: null,
			status: 'pending'
		});
		expect(d.loeschen).toHaveBeenCalledWith(['b/neu.webp', 'b/neu.thumb.webp']);
		expect(d.einreihen).toHaveBeenCalledWith('r1');
		expect(mocks.updates[tabellen.indexOf(receiptItems)]).toEqual({ ocrZeile: null });
	});

	it('prueft den gelesenen Bildpfad und schreibt in EINER Transaktion (4.1)', async () => {
		mocks.bon = bon({ imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' });
		await originalWiederherstellen(fakeDb, ich, 'r1', deps());
		expect(parameter(0)).toEqual(['r1', 'review', 'b/neu.webp']);
		expect(tabellen).toEqual([receipts, receiptItems]);
		expect(inTransaktion).toEqual([true, true]);
	});

	it('loescht bei einem Datenbankfehler nichts und liest nicht neu', async () => {
		mocks.bon = bon({ imagePath: 'b/neu.webp', thumbPath: 'b/neu.thumb.webp', originalImagePath: 'a/foto.webp', originalThumbPath: 'a/foto.thumb.webp' });
		mocks.wirftBei = receiptItems;
		const d = deps();
		await expect(originalWiederherstellen(fakeDb, ich, 'r1', d)).rejects.toThrow('Verbindung weg');
		expect(d.loeschen).not.toHaveBeenCalled();
		expect(d.einreihen).not.toHaveBeenCalled();
	});
});
