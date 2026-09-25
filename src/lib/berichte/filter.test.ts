import { describe, it, expect } from 'vitest';
import {
	filterAusAdresse, filterAlsAdresse, wirktAufPositionen, budgetsNichtZeigbar,
	leererFilter, zeitraumTage
} from './filter';

const HEUTE = '2026-09-25';
const lies = (q: string) => filterAusAdresse(new URLSearchParams(q), HEUTE);
const UUID = '3f2a0b7c-1111-2222-3333-444444444444';

describe('filterAusAdresse: Zeitraum', () => {
	it('nimmt ohne Angaben den laufenden Monat, ohne Hinweis', () => {
		expect(lies('')).toEqual({ filter: leererFilter({ art: 'monat', monat: '2026-09' }), hinweise: [] });
	});

	it('versteht die Altform ?monat=', () => {
		expect(lies('monat=2026-08').filter.zeitraum).toEqual({ art: 'monat', monat: '2026-08' });
		expect(lies('monat=2026-08').hinweise).toEqual([]);
	});

	it('meldet einen unbrauchbaren Monat und zeigt den laufenden', () => {
		const { filter, hinweise } = lies('zeitraum=monat&monat=quatsch');
		expect(filter.zeitraum).toEqual({ art: 'monat', monat: '2026-09' });
		expect(hinweise).toHaveLength(1);
		expect(hinweise[0]).toContain('quatsch');
	});

	it('faellt bei einem kuenftigen Monat auf den laufenden zurueck', () => {
		const { filter, hinweise } = lies('monat=2026-10');
		expect(filter.zeitraum).toEqual({ art: 'monat', monat: '2026-09' });
		expect(hinweise[0]).toContain('Zukunft');
	});

	it('liest ein Jahr, faellt bei Zukunft und Unsinn zurueck', () => {
		expect(lies('zeitraum=jahr&jahr=2025').filter.zeitraum).toEqual({ art: 'jahr', jahr: 2025 });
		expect(lies('zeitraum=jahr').filter.zeitraum).toEqual({ art: 'jahr', jahr: 2026 });
		expect(lies('zeitraum=jahr&jahr=2027')).toMatchObject({ filter: { zeitraum: { jahr: 2026 } }, hinweise: [expect.stringContaining('Zukunft')] });
		expect(lies('zeitraum=jahr&jahr=abc').hinweise).toHaveLength(1);
	});

	it('liest eine Spanne', () => {
		expect(lies('zeitraum=spanne&von=2026-03-01&bis=2026-08-31').filter.zeitraum).toEqual({
			art: 'spanne', von: '2026-03-01', bis: '2026-08-31'
		});
	});

	it('tauscht vertauschte Grenzen und meldet es', () => {
		const { filter, hinweise } = lies('zeitraum=spanne&von=2026-08-31&bis=2026-03-01');
		expect(filter.zeitraum).toEqual({ art: 'spanne', von: '2026-03-01', bis: '2026-08-31' });
		expect(hinweise).toHaveLength(1);
	});

	it('kuerzt ein Ende in der Zukunft auf heute', () => {
		const { filter, hinweise } = lies('zeitraum=spanne&von=2026-09-01&bis=2026-12-31');
		expect(filter.zeitraum).toEqual({ art: 'spanne', von: '2026-09-01', bis: HEUTE });
		expect(hinweise).toHaveLength(1);
	});

	it('begrenzt eine Spanne auf drei Jahre', () => {
		const { filter, hinweise } = lies('zeitraum=spanne&von=2020-01-01&bis=2026-09-25');
		expect(filter.zeitraum).toEqual({ art: 'spanne', von: '2023-09-26', bis: '2026-09-25' });
		expect(hinweise[0]).toContain('3 Jahre');
	});

	it('nimmt bei unbrauchbarer Spanne den laufenden Monat bis heute', () => {
		for (const q of ['zeitraum=spanne', 'zeitraum=spanne&von=2026-02-30&bis=2026-03-10', 'zeitraum=spanne&von=x&bis=y']) {
			const { filter, hinweise } = lies(q);
			expect(filter.zeitraum).toEqual({ art: 'spanne', von: '2026-09-01', bis: HEUTE });
			expect(hinweise).toHaveLength(1);
		}
	});

	it('meldet eine unbekannte Zeitraum-Art', () => {
		const { filter, hinweise } = lies('zeitraum=woche');
		expect(filter.zeitraum).toEqual({ art: 'monat', monat: '2026-09' });
		expect(hinweise[0]).toContain('woche');
	});
});

describe('filterAusAdresse: Umfang und Merkmale', () => {
	it('liest den Umfang und meldet Unbekanntes', () => {
		expect(lies('umfang=meine').filter.umfang).toBe('meine');
		expect(lies('umfang=alle')).toMatchObject({ filter: { umfang: 'haushalt' }, hinweise: [expect.stringContaining('alle')] });
	});

	it('nimmt gueltige Laden-Ids, verwirft den Rest mit Hinweis, ohne Doppelte', () => {
		const { filter, hinweise } = lies(`laden=${UUID},x,${UUID.toUpperCase()}`);
		expect(filter.laden).toEqual([UUID]);
		expect(hinweise).toHaveLength(1);
	});

	it('nimmt Kategorie-Slugs, verwirft Unbrauchbares mit Hinweis', () => {
		const { filter, hinweise } = lies('kategorie=lebensmittel,Obst!');
		expect(filter.kategorie).toEqual(['lebensmittel']);
		expect(hinweise).toHaveLength(1);
	});

	it('meldet Filter der Stufe 2, statt sie still zu uebergehen', () => {
		const { hinweise } = lies('suche=kaffee&person=x');
		expect(hinweise).toHaveLength(2);
		expect(hinweise.join(' ')).toContain('suche');
	});
});

describe('filterAlsAdresse', () => {
	it('ist kanonisch: lesen und schreiben ergibt dieselbe Adresse', () => {
		for (const x of [
			'zeitraum=monat&monat=2026-08',
			'zeitraum=jahr&jahr=2025',
			'zeitraum=spanne&von=2026-03-01&bis=2026-08-31',
			`zeitraum=monat&monat=2026-09&umfang=meine&laden=${UUID}&kategorie=lebensmittel,obst`
		]) {
			expect(filterAlsAdresse(lies(x).filter)).toBe(x);
		}
	});

	it('laesst die Vorgabe „haushalt" weg', () => {
		expect(filterAlsAdresse(leererFilter({ art: 'jahr', jahr: 2026 }))).toBe('zeitraum=jahr&jahr=2026');
	});
});

describe('zeitraumTage', () => {
	it('liefert erste und letzte Tage', () => {
		expect(zeitraumTage({ art: 'monat', monat: '2028-02' })).toEqual({ von: '2028-02-01', bis: '2028-02-29' });
		expect(zeitraumTage({ art: 'jahr', jahr: 2026 })).toEqual({ von: '2026-01-01', bis: '2026-12-31' });
		expect(zeitraumTage({ art: 'spanne', von: '2026-03-01', bis: '2026-03-02' })).toEqual({ von: '2026-03-01', bis: '2026-03-02' });
	});
});

describe('wirktAufPositionen', () => {
	it('gilt fuer Kategorie, nicht fuer Laden', () => {
		const f = leererFilter({ art: 'monat', monat: '2026-09' });
		expect(wirktAufPositionen(f)).toBe(false);
		expect(wirktAufPositionen({ ...f, laden: [UUID] })).toBe(false);
		expect(wirktAufPositionen({ ...f, kategorie: ['obst'] })).toBe(true);
		expect(wirktAufPositionen({ ...f, suche: 'kaffee' })).toBe(true);
	});
});

describe('budgetsNichtZeigbar', () => {
	const f = leererFilter({ art: 'monat', monat: '2026-09' });

	it('zeigt Budgets im ungefilterten Haushaltsbericht fuer Monat und Jahr', () => {
		expect(budgetsNichtZeigbar(f)).toBeNull();
		expect(budgetsNichtZeigbar({ ...f, zeitraum: { art: 'jahr', jahr: 2026 } })).toBeNull();
	});

	// Ein geteilter Topf rechnet mit dem ganzen Haushalt; unter „Nur meine" waere seine
	// Zahl eine Behauptung, die niemand aus den gezeigten Bons nachrechnen kann.
	it('blendet sie bei „Nur meine", Spanne und Filtern mit Grund aus', () => {
		expect(budgetsNichtZeigbar({ ...f, umfang: 'meine' })).toContain('Haushalt');
		expect(budgetsNichtZeigbar({ ...f, zeitraum: { art: 'spanne', von: '2026-09-01', bis: HEUTE } })).toContain('Monat');
		expect(budgetsNichtZeigbar({ ...f, laden: [UUID] })).toContain('ungefiltert');
		expect(budgetsNichtZeigbar({ ...f, kategorie: ['obst'] })).toContain('ungefiltert');
	});
});

// Abschlusspruefung: jahr=0500 oder monat=0500-06 liefen bis in die Abfrage und endeten
// in einem 500 — ohne Hinweis. Vor 2000 gibt es keine Kassenbons in dieser App.
describe('filterAusAdresse: Jahre vor 2000', () => {
	it('meldet sie und zeigt den laufenden Zeitraum', () => {
		expect(lies('zeitraum=jahr&jahr=0500')).toMatchObject({ filter: { zeitraum: { art: 'jahr', jahr: 2026 } }, hinweise: [expect.stringContaining('2000')] });
		expect(lies('monat=0500-06')).toMatchObject({ filter: { zeitraum: { art: 'monat', monat: '2026-09' } }, hinweise: [expect.stringContaining('2000')] });
		const spanne = lies('zeitraum=spanne&von=0500-01-01&bis=0500-02-01');
		expect(spanne.filter.zeitraum).toEqual({ art: 'spanne', von: '2026-09-01', bis: HEUTE });
		expect(spanne.hinweise).toHaveLength(1);
	});
});

// Abschlusspruefung: doppelte Hinweise brachen die Seite beim Hydrieren (Svelte-Schluessel).
describe('filterAusAdresse: Hinweise', () => {
	it('meldet dasselbe nur einmal', () => {
		expect(lies('laden=x,x').hinweise).toHaveLength(1);
		expect(lies('kategorie=A,A&laden=x').hinweise).toHaveLength(2);
	});
});
