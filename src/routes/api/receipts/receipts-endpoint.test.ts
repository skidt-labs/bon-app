import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// $lib/server/db/schema hat keine Nebenwirkungen (reine Tabellendefinitionen) und wird
// bewusst NICHT gemockt: eq(receipts.id, ...) im Handler braucht ein echtes Column-Objekt,
// kein Fake dafür.
//
// $lib/server/db, $lib/server/storage/images und $lib/server/queue/boss werden gemockt,
// damit der Handler ohne laufende Datenbank und ohne echten pg-boss getestet werden kann.
const mocks = vi.hoisted(() => ({
	storeReceiptImage: vi.fn(),
	enqueueExtraction: vi.fn(),
	insertReturning: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn()
}));

// istSystemfehler() bleibt die ECHTE Implementierung (reine Funktion, ohne
// Seiteneffekte) — nur storeReceiptImage wird gemockt. Der Handler ruft
// istSystemfehler() im catch-Zweig auf; ein reiner Stub-Export ohne diese Funktion
// liesse den Handler dort mit einem rohen TypeError abbrechen statt mit dem
// erwarteten 422/503.
vi.mock('$lib/server/storage/images', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/storage/images')>();
	return { ...actual, storeReceiptImage: mocks.storeReceiptImage };
});

vi.mock('$lib/server/queue/boss', () => ({
	enqueueExtraction: mocks.enqueueExtraction
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
		update: () => ({
			set: (data: unknown) => {
				mocks.updateSet(data);
				return { where: mocks.updateWhere };
			}
		})
	}
}));

import { POST } from './+server';

function fakeEvent(source: string) {
	const form = new FormData();
	form.append('image', new File([new Uint8Array([1, 2, 3, 4])], 'test.jpg', { type: 'image/jpeg' }));
	form.append('source', source);
	const request = new Request('http://bon.local/api/receipts', { method: 'POST', body: form });
	const locals = {
		user: { id: 'user-1', email: 'a@example.com', displayName: 'A B', householdId: 'household-1' },
		zugriff: { haushaltId: 'household-1', nutzerId: 'user-1', rolle: 'mitglied' as const }
	};
	// RequestEvent trägt noch viele weitere, hier ungenutzte Felder (cookies, fetch, ...) -
	// der Handler liest nur request und locals.
	return { request, locals } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/receipts – enqueue-Fehlerpfad', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storeReceiptImage.mockResolvedValue({
			imagePath: '2026/09/x.webp',
			thumbPath: '2026/09/x.thumb.webp'
		});
		mocks.insertReturning.mockResolvedValue([{ id: 'receipt-1' }]);
		mocks.updateWhere.mockResolvedValue(undefined);
	});

	// Stand frueher auf 503. Aus der Abschlusspruefung: Ein Fehlerstatus heisst fuer die
	// Offline-Warteschlange "spaeter erneut versuchen" — der naechste Durchgang laedt
	// DASSELBE Foto ein zweites Mal hoch und erzeugt einen Doppel-Bon zusaetzlich zur
	// Karteileiche. Der Bon liegt aber samt Bild schon auf dem Server; fehlgeschlagen
	// ist nur der Hintergrundauftrag, und den bringt ein erneuter Upload nicht zurueck.
	// 201 mit `queued: false` sagt die Wahrheit, sichtbar ueber Status `failed`.
	it('markiert den Bon als failed und meldet queued:false, wenn enqueueExtraction fehlschlägt', async () => {
		mocks.enqueueExtraction.mockRejectedValue(new Error('pg-boss ist nicht erreichbar'));

		const res = await POST(fakeEvent('upload'));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toEqual({ id: 'receipt-1', queued: false });

		expect(mocks.updateSet).toHaveBeenCalledTimes(1);
		const [setArg] = mocks.updateSet.mock.calls[0] as [{ status: string; failureReason: string }];
		expect(setArg.status).toBe('failed');
		expect(typeof setArg.failureReason).toBe('string');
		expect(setArg.failureReason.length).toBeGreaterThan(0);

		expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
	});

	it('aktualisiert nichts und gibt 201 zurück, wenn enqueueExtraction erfolgreich ist', async () => {
		mocks.enqueueExtraction.mockResolvedValue(undefined);

		const response = await POST(fakeEvent('upload'));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ id: 'receipt-1', queued: true });
		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.updateWhere).not.toHaveBeenCalled();
	});
});

// Befund R03: der Handler behandelte JEDE Exception aus storeReceiptImage pauschal
// als 422 und liess die Outbox (siehe outbox.ts, PERMANENTLY_REJECTED) die einzige
// Kopie des Fotos loeschen — auch bei einem Systemfehler (volle Platte), an dem das
// Bild selbst unversehrt ist. Der Prüfer hat das mit injiziertem ENOSPC reproduziert.
describe('POST /api/receipts – Fehler beim Speichern des Bilds', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('meldet 503 bei einem Systemfehler (ENOSPC) — die Outbox soll das Foto behalten', async () => {
		mocks.storeReceiptImage.mockRejectedValue(
			Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
		);

		let caught: unknown;
		try {
			await POST(fakeEvent('upload'));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 503)).toBe(true);
	});

	it('meldet weiterhin 422 bei einem Dekodierfehler ohne .code — die Outbox darf aufraeumen', async () => {
		mocks.storeReceiptImage.mockRejectedValue(new Error('Input buffer contains unsupported image format'));

		let caught: unknown;
		try {
			await POST(fakeEvent('upload'));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 422)).toBe(true);
	});
});
