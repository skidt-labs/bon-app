import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

// `eq` wird ersetzt, damit sichtbar wird, MIT WELCHEM WERT gefiltert wird. Genau
// darauf kommt es an: die Haushalts-Id muss aus der Sitzung stammen, niemals aus der
// URL. Ein Parameter an dieser Stelle waere kein Anzeigefehler, sondern ein Leck in
// die Kaufhistorie einer fremden Familie.
const mocks = vi.hoisted(() => ({ gefiltert: [] as unknown[] }));

vi.mock('drizzle-orm', async (orig) => {
	const echt = await orig<typeof import('drizzle-orm')>();
	return {
		...echt,
		eq: (spalte: unknown, wert: unknown) => {
			mocks.gefiltert.push(wert);
			return echt.eq(spalte as never, wert as never);
		}
	};
});

vi.mock('$lib/server/db', () => {
	const kette = {
		from: () => kette,
		leftJoin: () => kette,
		where: () => kette,
		groupBy: () => Promise.resolve([]),
		then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res)
	};
	return { db: { select: () => kette } };
});

import { load } from './+page.server';

function ereignis(user: { id: string; householdId: string } | null, extra: Record<string, unknown> = {}) {
	const zugriff = user ? { haushaltId: user.householdId, nutzerId: user.id, rolle: 'mitglied' as const } : null;
	return { locals: { user, zugriff }, params: { id: 'FREMDER-HAUSHALT' }, ...extra } as never;
}

describe('Mitglieder-Ansicht', () => {
	beforeEach(() => {
		mocks.gefiltert.length = 0;
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

	it('filtert ausschliesslich auf die Haushalts-Id aus der Sitzung', async () => {
		await load(ereignis({ id: 'u1', householdId: 'MEIN-HAUSHALT' }));
		expect(mocks.gefiltert).toContain('MEIN-HAUSHALT');
		// Der Parameter aus der URL darf NIRGENDS in einen Filter geraten.
		expect(mocks.gefiltert).not.toContain('FREMDER-HAUSHALT');
	});
});
