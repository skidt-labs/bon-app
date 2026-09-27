import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ bericht: vi.fn(), bons: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/zeit', () => ({ heutigerTag: () => '2026-09-25' }));
vi.mock('$lib/server/berichte/abfragen', () => ({ berichtLaden: mocks.bericht }));
vi.mock('$lib/server/berichte/bons', () => ({ bonsZuFilter: mocks.bons }));
const gespeichert = vi.hoisted(() => ({
	laden: vi.fn(), liste: vi.fn(async () => []), speichern: vi.fn(), aendern: vi.fn(), umbenennen: vi.fn(), loeschen: vi.fn()
}));
vi.mock('$lib/server/berichte/optionen', () => ({ istWahlmerkmal: (m: string) => ['laden', 'kategorie', 'person', 'topf'].includes(m), filterOptionen: vi.fn(async () => [{ wert: 'x' }]) }));
vi.mock('$lib/server/berichte/gespeichert', async () => {
	const echt = await vi.importActual<typeof import('$lib/server/berichte/gespeichert')>('$lib/server/berichte/gespeichert');
	return {
		alsFilter: echt.alsFilter,
		istGeaendert: echt.istGeaendert,
		gespeichertLaden: gespeichert.laden,
		gespeicherteListe: gespeichert.liste,
		berichtSpeichern: gespeichert.speichern,
		berichtAendern: gespeichert.aendern,
		berichtUmbenennen: gespeichert.umbenennen,
		berichtLoeschen: gespeichert.loeschen
	};
});

import { load as berichtSeite } from './+page.server';
import { load as bonsSeite } from './bons/+page.server';
import { actions } from './+page.server';

const angemeldet = (q: string) =>
	({ url: new URL(`https://bon.example.org/reports?${q}`), locals: { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } } }) as never;

beforeEach(() => {
	gespeichert.laden.mockReset().mockResolvedValue(null);
	mocks.bericht.mockReset().mockImplementation(async (_db, _k, filter) => ({ filter, hinweise: ['aus der Abfrage'] }));
	mocks.bons.mockReset().mockImplementation(async (_db, _k, filter) => ({ filter, hinweise: [], titel: 'Obst', bons: [] }));
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
	it('fuehrt ueber die mitgegebene Adresse zurueck zum Bericht', async () => {
		const zurueck = encodeURIComponent('zeitraum=monat&monat=2026-08&laden=ohne');
		const daten = (await bonsSeite(angemeldet(`kategorie=obst&zurueck=${zurueck}`))) as { zumBericht: string };
		expect(daten.zumBericht).toBe('/reports?zeitraum=monat&monat=2026-08&laden=ohne');
	});

	it('reicht die Liste samt ihrem wirksamen Filter durch', async () => {
		mocks.bons.mockImplementationOnce(async (_db, _k, filter) => ({ filter, hinweise: ['Wähle im Bericht einen Filter, eine Kategorie oder einen Laden.'], titel: null, bons: [] }));
		const daten = (await bonsSeite(angemeldet('zeitraum=monat&monat=2026-09'))) as { liste: { bons: unknown[] }; hinweise: string[] };
		expect(mocks.bons).toHaveBeenCalledOnce();
		expect(daten.liste.bons).toEqual([]);
		expect(daten.hinweise).toEqual([expect.stringContaining('Wähle im Bericht')]);
	});

	it('liest die Ansicht und laedt die Liste', async () => {
		const daten = (await bonsSeite(angemeldet('zeitraum=monat&monat=2026-09&kategorie=obst&ansicht=position'))) as { ansicht: string; liste: { titel: string } };
		expect(daten.ansicht).toBe('position');
		expect(daten.liste.titel).toBe('Obst');
		const quatsch = (await bonsSeite(angemeldet('kategorie=obst&ansicht=quatsch'))) as { ansicht: string; hinweise: string[] };
		expect(quatsch.ansicht).toBe('bon');
		expect(quatsch.hinweise).toEqual([expect.stringContaining('quatsch')]);
	});
});

const GESPEICHERT_ID = '3f2a0b7c-1111-2222-3333-444444444444';

describe('/reports: gespeicherte Berichte und Filterauswahl', () => {
	it('oeffnet „?bericht=" mit den gespeicherten Filtern', async () => {
		gespeichert.laden.mockResolvedValue({ id: GESPEICHERT_ID, name: 'Kaffee', parameter: { suche: 'Kaffee' }, zeitraum: null, erstellerName: 'Erika', darfAendern: true });
		const daten = (await berichtSeite(angemeldet(`bericht=${GESPEICHERT_ID}`))) as { aktiv: { name: string; geaendert: boolean } };
		expect(mocks.bericht).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ suche: 'Kaffee' }), '2026-09-25');
		expect(daten.aktiv).toMatchObject({ name: 'Kaffee', geaendert: false });
	});

	it('laesst die Adresse gewinnen, sobald sie eigene Filter traegt', async () => {
		gespeichert.laden.mockResolvedValue({ id: GESPEICHERT_ID, name: 'Kaffee', parameter: { suche: 'Kaffee' }, zeitraum: null, erstellerName: 'Erika', darfAendern: true });
		const daten = (await berichtSeite(angemeldet(`bericht=${GESPEICHERT_ID}&suche=Tee`))) as { aktiv: { geaendert: boolean } };
		expect(mocks.bericht).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ suche: 'Tee' }), '2026-09-25');
		expect(daten.aktiv.geaendert).toBe(true);
	});

	it('meldet einen unbekannten gespeicherten Bericht', async () => {
		const daten = (await berichtSeite(angemeldet(`bericht=${GESPEICHERT_ID}`))) as { hinweise: string[]; aktiv: unknown };
		expect(daten.aktiv).toBeNull();
		expect(daten.hinweise[0]).toContain('gespeicherten Bericht');
	});

	it('laedt die Auswahl nur fuer bekannte Merkmale', async () => {
		expect(((await berichtSeite(angemeldet('wahl=laden'))) as { optionen: unknown }).optionen).toEqual([{ wert: 'x' }]);
		expect(((await berichtSeite(angemeldet('wahl=betrag'))) as { wahl: string; optionen: unknown })).toMatchObject({ wahl: 'betrag', optionen: null });
		expect(((await berichtSeite(angemeldet('wahl=quatsch'))) as { hinweise: string[] }).hinweise).toEqual(expect.arrayContaining([expect.stringContaining('quatsch')]));
	});

	const formular = (felder: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(felder)) f.set(k, v);
		return { locals: { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } }, request: new Request('https://bon.example.org/reports', { method: 'POST', body: f }) } as never;
	};

	it('speichert und leitet auf den gespeicherten Bericht', async () => {
		gespeichert.speichern.mockResolvedValue({ ok: true, wert: GESPEICHERT_ID });
		await expect(actions.speichern(formular({ name: 'Kaffee', adresse: 'zeitraum=monat&monat=2026-09&suche=Kaffee', mitZeitraum: 'ja' }))).rejects.toMatchObject({
			status: 303,
			location: `/reports?zeitraum=monat&monat=2026-09&suche=Kaffee&bericht=${GESPEICHERT_ID}`
		});
		expect(gespeichert.speichern).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ name: 'Kaffee', mitZeitraum: true }));
	});

	it('gibt den Grund zurueck, wenn Speichern scheitert', async () => {
		gespeichert.speichern.mockResolvedValue({ ok: false, grund: 'Einen Bericht mit diesem Namen gibt es im Haushalt schon.' });
		expect(await actions.speichern(formular({ name: 'Kaffee', adresse: 'zeitraum=monat&monat=2026-09' }))).toMatchObject({
			status: 400, data: { grund: 'Einen Bericht mit diesem Namen gibt es im Haushalt schon.' }
		});
	});
});
