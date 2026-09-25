import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// $lib/server/db/schema wird bewusst NICHT gemockt — siehe Begründung in den
// Geschwister-Tests (receipts-endpoint.test.ts, production-deps.test.ts).
const mocks = vi.hoisted(() => ({
	selectResult: [] as unknown[],
	readFile: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => Promise.resolve(mocks.selectResult)
			})
		})
	}
}));

vi.mock('node:fs/promises', () => ({
	readFile: mocks.readFile
}));

import { GET } from './+server';

function fakeEvent(
	user: { id: string; householdId: string; rolle?: 'verwalter' | 'mitglied' } | null = {
		id: 'user-1',
		householdId: 'household-1'
	}
) {
	const zugriff = user
		? { haushaltId: user.householdId, nutzerId: user.id, rolle: user.rolle ?? 'mitglied' }
		: null;
	return { params: { id: 'r1' }, locals: { user, zugriff } } as unknown as Parameters<typeof GET>[0];
}

describe('GET /receipts/[id]/image', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.selectResult = [];
	});

	it('lehnt ohne angemeldeten Nutzer mit 401 ab', async () => {
		let caught: unknown;
		try {
			await GET(fakeEvent(null));
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 401)).toBe(true);
	});

	it('meldet 404, wenn der Bon nicht existiert oder einem anderen Haushalt gehört', async () => {
		mocks.selectResult = [];
		let caught: unknown;
		try {
			await GET(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 404)).toBe(true);
		expect(mocks.readFile).not.toHaveBeenCalled();
	});

	it('meldet 404 (mit eigenem Text), wenn die DB-Zeile existiert, die Datei auf der Platte aber fehlt', async () => {
		mocks.selectResult = [{ imagePath: '2026/09/x.webp' }];
		mocks.readFile.mockRejectedValue(new Error('ENOENT'));
		let caught: unknown;
		try {
			await GET(fakeEvent());
		} catch (err) {
			caught = err;
		}
		expect(isHttpError(caught, 404)).toBe(true);
	});

	it('liefert das Bild als image/webp mit langer privater Cache-Lebensdauer', async () => {
		mocks.selectResult = [{ imagePath: '2026/09/x.webp' }];
		mocks.readFile.mockResolvedValue(Buffer.from([1, 2, 3, 4]));

		const response = await GET(fakeEvent());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(response.headers.get('cache-control')).toBe('private, max-age=31536000');
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
	});
});
