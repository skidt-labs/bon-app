import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jahresAuswahl } from '$lib/berichte/zeitleiste';
import { alsFilter } from '$lib/server/berichte/gespeichert';

const mocks = vi.hoisted(() => ({ bericht: vi.fn(), bons: vi.fn(), summen: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/zeit', () => ({ heutigerTag: () => '2026-09-25' }));
vi.mock('$lib/server/berichte/abfragen', () => ({ berichtLaden: mocks.bericht, monatsSummenLaden: mocks.summen }));
vi.mock('$lib/server/berichte/bons', () => ({ bonsZuFilter: mocks.bons }));
const matrix = vi.hoisted(() => ({
	chat: vi.fn(async (_userId: string): Promise<{ matrixUserId: string; raum: string | null } | null> => null),
	enqueue: vi.fn(async (_job: { userId: string; text: string }): Promise<boolean> => true)
}));
vi.mock('$lib/server/matrix/links', () => ({ direktchatFuer: matrix.chat }));
vi.mock('$lib/server/queue/boss', () => ({ enqueueMatrixBericht: matrix.enqueue }));
vi.mock('$lib/server/betrieb/verwaltung', () => ({ haushaltsName: vi.fn(async () => 'Familie Beispiel') }));
vi.mock('$env/dynamic/private', () => ({ env: { ORIGIN: 'https://bon.example.org' } }));
const gespeichert = vi.hoisted(() => ({
	laden: vi.fn(), liste: vi.fn(async () => []), speichern: vi.fn(), aendern: vi.fn(), umbenennen: vi.fn(), loeschen: vi.fn(), wirksam: vi.fn()
}));
vi.mock('$lib/server/berichte/optionen', () => ({ istWahlmerkmal: (m: string) => ['laden', 'kategorie', 'person', 'topf'].includes(m), filterOptionen: vi.fn(async () => [{ wert: 'x' }]) }));
vi.mock('$lib/server/berichte/gespeichert', async () => {
	const echt = await vi.importActual<typeof import('$lib/server/berichte/gespeichert')>('$lib/server/berichte/gespeichert');
	return {
		alsFilter: echt.alsFilter,
		istGeaendert: echt.istGeaendert,
		gespeichertWirksam: gespeichert.wirksam,
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
import { load as druckSeite } from './druck/+page.server';
import { actions } from './+page.server';

const angemeldet = (q: string) =>
	({ url: new URL(`https://bon.example.org/reports?${q}`), locals: { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } } }) as never;

beforeEach(() => {
	matrix.chat.mockReset().mockResolvedValue(null);
	matrix.enqueue.mockReset();
	gespeichert.laden.mockReset().mockResolvedValue(null);
	gespeichert.wirksam
		.mockReset()
		.mockImplementation(async (_db: unknown, _k: unknown, b: Parameters<typeof alsFilter>[0], heute: string) => alsFilter(b, heute).filter);
	mocks.bericht.mockReset().mockImplementation(async (_db, _k, filter) => ({ filter, hinweise: ['aus der Abfrage'] }));
	mocks.bons.mockReset().mockImplementation(async (_db, _k, filter) => ({ filter, hinweise: [], titel: 'Obst', bons: [] }));
	mocks.summen.mockReset().mockResolvedValue({});
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

	// 3.1: ein leeres ?ansicht= ist „nicht angegeben" — kein Hinweis mit leeren Anfuehrungszeichen.
	it('behandelt ein leeres ansicht= wie nicht angegeben', async () => {
		for (const q of ['kategorie=obst&ansicht=', 'kategorie=obst&ansicht=%20']) {
			const daten = (await bonsSeite(angemeldet(q))) as { ansicht: string; hinweise: string[] };
			expect(daten.ansicht).toBe('bon');
			expect(daten.hinweise).toEqual([]);
		}
	});

	// Sammelfassung 3.3: die Kacheln zeigten „—", und die Jahresliste kannte nur das laufende Jahr.
	it('laedt die Monatssummen fuer die Zeitwahl wie der Bericht', async () => {
		mocks.summen.mockResolvedValue({ '2024-05': 1200, '2026-08': 4711 });
		const daten = (await bonsSeite(angemeldet('kategorie=obst&umfang=meine'))) as { monatsSummen: Record<string, number> };
		expect(mocks.summen).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ umfang: 'meine' }));
		expect(daten.monatsSummen).toEqual({ '2024-05': 1200, '2026-08': 4711 });
		expect(jahresAuswahl('2026-09-25', daten.monatsSummen)).toEqual([2026, 2025, 2024]);
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

	const LADEN_WEG = '3f2a0b7c-aaaa-bbbb-cccc-000000000001';
	const LADEN_DA = '3f2a0b7c-aaaa-bbbb-cccc-000000000002';
	const mitZweiLaeden = {
		id: GESPEICHERT_ID, name: 'Läden', parameter: { laden: `${LADEN_WEG},${LADEN_DA}` }, zeitraum: null, erstellerName: 'Erika', darfAendern: true
	};

	// Sammelfassung 3.6
	it('wertet einen inzwischen geloeschten Laden nicht als Aenderung, der Hinweis bleibt', async () => {
		gespeichert.laden.mockResolvedValue(mitZweiLaeden);
		mocks.bericht.mockImplementation(async (_db, _k, filter) => ({
			filter: { ...filter, laden: filter.laden.filter((l: string) => l !== LADEN_WEG) },
			hinweise: ['Einen der gewählten Läden gibt es nicht (mehr) — weggelassen.']
		}));
		const daten = (await berichtSeite(angemeldet(`bericht=${GESPEICHERT_ID}`))) as { aktiv: { geaendert: boolean }; hinweise: string[] };
		expect(daten.aktiv.geaendert).toBe(false);
		expect(daten.hinweise).toContain('Einen der gewählten Läden gibt es nicht (mehr) — weggelassen.');
		expect(gespeichert.wirksam).not.toHaveBeenCalled();
	});

	it('vergleicht auch mit eigener Adresse gegen den bereinigten gespeicherten Bericht', async () => {
		gespeichert.laden.mockResolvedValue(mitZweiLaeden);
		gespeichert.wirksam.mockImplementation(async (_db: unknown, _k: unknown, b: Parameters<typeof alsFilter>[0], heute: string) => ({
			...alsFilter(b, heute).filter,
			laden: [LADEN_DA]
		}));
		// Nur der Monat ist anders — der gespeicherte Bericht hat keinen Zeitraum, das zaehlt nicht.
		const blaettern = (await berichtSeite(angemeldet(`zeitraum=monat&monat=2026-08&laden=${LADEN_DA}&bericht=${GESPEICHERT_ID}`))) as {
			aktiv: { geaendert: boolean };
		};
		expect(blaettern.aktiv.geaendert).toBe(false);
		expect(gespeichert.wirksam).toHaveBeenCalledWith({}, expect.anything(), mitZweiLaeden, '2026-09-25');
		const mitSuche = (await berichtSeite(angemeldet(`laden=${LADEN_DA}&suche=Tee&bericht=${GESPEICHERT_ID}`))) as { aktiv: { geaendert: boolean } };
		expect(mitSuche.aktiv.geaendert).toBe(true);
	});
});

describe('/reports/druck', () => {
	// Die Druckansicht rechnet mit DERSELBEN Funktion und denselben Argumenten wie die Seite.
	it('rechnet identisch zur Berichtsseite', async () => {
		mocks.bericht.mockImplementation(async (_db, _k, filter) => ({ filter, hinweise: [], kennzahlen: { summe: 4711, bons: 3 } }));
		const q = 'zeitraum=jahr&jahr=2025&suche=Kaffee';
		const seite = (await berichtSeite(angemeldet(q))) as { kennzahlen: unknown };
		const argsSeite = mocks.bericht.mock.calls.at(-1);
		const druck = (await druckSeite(angemeldet(q))) as { kennzahlen: unknown; heute: string };
		const argsDruck = mocks.bericht.mock.calls.at(-1);
		expect(argsDruck).toEqual(argsSeite);
		expect(druck.kennzahlen).toEqual(seite.kennzahlen);
		expect(druck.heute).toBe('2026-09-25');
	});

	it('leitet ohne Anmeldung zur Anmeldung', async () => {
		await expect(druckSeite({ url: new URL('https://bon.example.org/reports/druck'), locals: {} } as never)).rejects.toMatchObject({ status: 302 });
	});
});

describe('/reports: Zusammenfassung per Matrix', () => {
	const formular = (felder: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(felder)) f.set(k, v);
		return { locals: { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } }, request: new Request('https://bon.example.org/reports', { method: 'POST', body: f }) } as never;
	};

	it('meldet den Zustand fuer den Knopf', async () => {
		expect(((await berichtSeite(angemeldet(''))) as { matrix: string }).matrix).toBe('nicht_gekoppelt');
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: null });
		expect(((await berichtSeite(angemeldet(''))) as { matrix: string }).matrix).toBe('kein_chat');
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: '!dm:example.org' });
		expect(((await berichtSeite(angemeldet(''))) as { matrix: string }).matrix).toBe('bereit');
	});

	it('sagt klar, was fehlt, statt still nichts zu tun', async () => {
		expect(await actions.matrix(formular({ adresse: 'zeitraum=monat&monat=2026-09' }))).toMatchObject({ status: 400, data: { grund: expect.stringContaining('gekoppelt') } });
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: null });
		expect(await actions.matrix(formular({ adresse: 'zeitraum=monat&monat=2026-09' }))).toMatchObject({ status: 400, data: { grund: expect.stringContaining('Direktchat') } });
		expect(matrix.enqueue).not.toHaveBeenCalled();
	});

	it('legt einen Auftrag mit der Zusammenfassung an', async () => {
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: '!dm:example.org' });
		mocks.bericht.mockImplementation(async (_db, _k, filter) => ({
			filter, namen: { laden: {}, kategorie: {}, person: {}, topf: {} }, hinweise: [],
			kennzahlen: { summe: 1234, bons: 2 }, vergleiche: [], kategorien: []
		}));
		// Zurueck zum GLEICHEN Bericht (Abschlusspruefung: vorher laufender Monat ohne Filter).
		await expect(actions.matrix(formular({ adresse: 'zeitraum=jahr&jahr=2025&suche=Kaffee' }))).rejects.toMatchObject({
			status: 303,
			location: '/reports?zeitraum=jahr&jahr=2025&suche=Kaffee&gesendet=1'
		});
		expect(matrix.enqueue).toHaveBeenCalledWith({ userId: 'u1', text: expect.stringContaining('Ausgaben: 12,34 € in 2 Bons') });
		expect(matrix.enqueue.mock.calls[0][0].text).toContain('https://bon.example.org/reports?zeitraum=jahr&jahr=2025&suche=Kaffee');
	});

	// Sammelfassung 3.10: was auch gekuerzt nicht in eine Nachricht passt, geht nicht still verloren.
	it('legt keinen Auftrag an, der fuer den Bot zu lang waere', async () => {
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: '!dm:example.org' });
		const laeden = ['3f2a0b7c-aaaa-bbbb-cccc-000000000001', '3f2a0b7c-aaaa-bbbb-cccc-000000000002', '3f2a0b7c-aaaa-bbbb-cccc-000000000003'];
		mocks.bericht.mockImplementation(async (_db, _k, filter) => ({
			filter,
			namen: { laden: Object.fromEntries(laeden.map((l) => [l, 'Sehr langer Ladenname '.repeat(70)])), kategorie: {}, person: {}, topf: {} },
			hinweise: [], kennzahlen: { summe: 1234, bons: 2 }, vergleiche: [], kategorien: []
		}));
		expect(await actions.matrix(formular({ adresse: `zeitraum=monat&monat=2026-09&laden=${laeden.join(',')}` }))).toMatchObject({
			status: 400,
			data: { grund: expect.stringContaining('zu lang') }
		});
		expect(matrix.enqueue).not.toHaveBeenCalled();
	});

	// Sammelfassung 3.11
	it('sagt es, wenn der Auftrag nicht angenommen wurde', async () => {
		matrix.chat.mockResolvedValue({ matrixUserId: '@erika:example.org', raum: '!dm:example.org' });
		mocks.bericht.mockImplementation(async (_db, _k, filter) => ({
			filter, namen: { laden: {}, kategorie: {}, person: {}, topf: {} }, hinweise: [],
			kennzahlen: { summe: 1234, bons: 2 }, vergleiche: [], kategorien: []
		}));
		matrix.enqueue.mockResolvedValueOnce(false);
		expect(await actions.matrix(formular({ adresse: 'zeitraum=monat&monat=2026-09' }))).toMatchObject({
			status: 429,
			data: { grund: 'Ein Bericht ist gerade unterwegs — bitte einen Moment warten.' }
		});
	});
});

describe('/reports: Meldung nach dem Senden', () => {
	it('zeigt die Meldung aus der Adresse, ohne sie als Filterfehler zu melden', async () => {
		const daten = (await berichtSeite(angemeldet('zeitraum=monat&monat=2026-09&gesendet=1'))) as { meldung: string | null; hinweise: string[] };
		expect(daten.meldung).toContain('Direktchat');
		expect(daten.hinweise).toEqual(['aus der Abfrage']);
		expect(((await berichtSeite(angemeldet('zeitraum=monat&monat=2026-09'))) as { meldung: string | null }).meldung).toBeNull();
	});
});
