import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ bericht: vi.fn(), bons: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/zeit', () => ({ heutigerTag: () => '2026-09-25' }));
vi.mock('$lib/server/berichte/abfragen', () => ({ berichtLaden: mocks.bericht }));
vi.mock('$lib/server/berichte/bons', () => ({ bonsZuFilter: mocks.bons }));

import { load as berichtSeite } from './+page.server';
import { load as bonsSeite } from './bons/+page.server';

const angemeldet = (q: string) =>
	({ url: new URL(`https://bon.example.org/reports?${q}`), locals: { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } } }) as never;

beforeEach(() => {
	mocks.bericht.mockReset().mockResolvedValue({ hinweise: ['aus der Abfrage'] });
	mocks.bons.mockReset().mockResolvedValue({ hinweise: [], titel: 'Obst', bons: [] });
});

describe('/reports', () => {
	it('leitet ohne Anmeldung zur Anmeldung', async () => {
		await expect(berichtSeite({ url: new URL('https://bon.example.org/reports'), locals: {} } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('reicht den gelesenen Filter weiter und fuehrt beide Hinweisquellen zusammen', async () => {
		const daten = (await berichtSeite(angemeldet('zeitraum=jahr&jahr=2027'))) as { hinweise: string[]; filter: unknown; heute: string };
		expect(mocks.bericht).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ zeitraum: { art: 'jahr', jahr: 2026 } }), '2026-09-25');
		expect(daten.hinweise).toEqual([expect.stringContaining('Zukunft'), 'aus der Abfrage']);
		expect(daten.heute).toBe('2026-09-25');
	});
});

describe('/reports/bons', () => {
	it('fragt nichts ab, solange weder Kategorie noch Laden gewaehlt ist', async () => {
		const daten = (await bonsSeite(angemeldet('zeitraum=monat&monat=2026-09'))) as { liste: unknown; hinweise: string[] };
		expect(mocks.bons).not.toHaveBeenCalled();
		expect(daten.liste).toBeNull();
		expect(daten.hinweise).toEqual([expect.stringContaining('Kategorie oder einen Laden')]);
	});

	it('liest die Ansicht und laedt die Liste', async () => {
		const daten = (await bonsSeite(angemeldet('zeitraum=monat&monat=2026-09&kategorie=obst&ansicht=position'))) as { ansicht: string; liste: { titel: string } };
		expect(daten.ansicht).toBe('position');
		expect(daten.liste.titel).toBe('Obst');
		expect((await bonsSeite(angemeldet('kategorie=obst&ansicht=quatsch')) as { ansicht: string }).ansicht).toBe('bon');
	});
});
