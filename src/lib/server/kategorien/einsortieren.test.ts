import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Nur die Auswahl am Anfang von bonEinsortieren. Die Datenbank ist nachgebildet: jede Abfrage
 * liefert die naechste vorbereitete Antwort (Bon, Unsortiert-Kategorie, Positionen), das
 * Schreiben der Zuordnungen geht ins Leere.
 */
const mocks = vi.hoisted(() => ({ antworten: [] as unknown[][], abfragen: 0 }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => {
					mocks.abfragen++;
					return Promise.resolve(mocks.antworten.shift() ?? []);
				}
			})
		}),
		update: () => ({ set: () => ({ where: async () => {} }) })
	}
}));
// Das Gedaechtnis kennt nichts: jede Zeile bleibt offen und ginge ans Modell.
vi.mock('./kaskade', () => ({
	ordneAusGedaechtnis: vi.fn(async (zeilen: unknown[]) => ({ zugeordnet: [], offen: zeilen }))
}));

import { bonEinsortieren } from './einsortieren';

const bestand = (status: string): unknown[][] => [
	[{ householdId: 'h1', merchantId: null, status }],
	[{ id: 'kat-unsortiert' }],
	[{ id: 'i1', rawText: 'MILCH', lineType: 'article' }]
];

beforeEach(() => {
	mocks.abfragen = 0;
	mocks.antworten = [];
});

describe('bonEinsortieren', () => {
	// 2.4: vor allem der Nachlauf fragte das Modell auch fuer Bons im Papierkorb; der Worker
	// nur, wenn jemand den Bon zwischen Speichern und Einsortieren verworfen hat.
	it('fragt fuer einen Bon im Papierkorb kein Modell', async () => {
		mocks.antworten = bestand('verworfen');
		const modell = { frageModell: vi.fn(async () => ({ text: '{}', usage: null })) };
		const e = await bonEinsortieren('r1', modell);
		expect(modell.frageModell).not.toHaveBeenCalled();
		expect(e).toEqual({ ausGedaechtnis: 0, vomModell: 0, unsortiert: 0, verworfen: [], fehler: null, usage: null });
		expect(mocks.abfragen).toBe(1);
	});

	it('fragt fuer einen Bon in Pruefung weiter das Modell (Gegenprobe)', async () => {
		mocks.antworten = bestand('review');
		const modell = { frageModell: vi.fn(async () => ({ text: '{}', usage: null })) };
		const e = await bonEinsortieren('r1', modell);
		expect(modell.frageModell).toHaveBeenCalled();
		expect(e.fehler).toBeNull();
	});
});
