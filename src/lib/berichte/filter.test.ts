import { describe, it, expect } from 'vitest';
import {
	filterAusAdresse, filterAlsAdresse, wirktAufPositionen, budgetsNichtZeigbar,
	leererFilter, zeitraumTage, hatFilter, ohneMerkmal, ohneFilter, merkmalParameter, zeitraumParameter
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

	it('meldet unbrauchbare Werte der neuen Merkmale', () => {
		expect(lies('betrag=viel').hinweise).toHaveLength(1);
		expect(lies('sicht=alle').hinweise).toHaveLength(1);
		expect(lies('person=x').hinweise).toHaveLength(1);
		expect(lies('topf=x').hinweise).toHaveLength(1);
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

describe('filterAusAdresse: Merkmale der Stufe 2', () => {
	const U2 = '9d1e2f3a-5555-6666-7777-888888888888';

	it('liest Person und Topf als Id-Listen', () => {
		expect(lies(`person=${UUID},${U2}`).filter.person).toEqual([UUID, U2]);
		expect(lies(`topf=${U2.toUpperCase()}`).filter.topf).toEqual([U2]);
	});

	it('nimmt „ohne" als Laden und „unsortiert" als Kategorie', () => {
		expect(lies(`laden=${UUID},ohne`).filter.laden).toEqual([UUID, 'ohne']);
		expect(lies('kategorie=unsortiert').filter.kategorie).toEqual(['unsortiert']);
	});

	// Checkboxen derselben Gruppe schicken den Namen mehrfach: laden=a&laden=b.
	it('versteht wiederholte Parameter wie eine Kommaliste', () => {
		expect(lies(`laden=${UUID}&laden=ohne`).filter.laden).toEqual([UUID, 'ohne']);
	});

	it('liest Betragsspannen in Cent', () => {
		expect(lies('betrag=ab:5000').filter.betrag).toEqual({ ab: 5000, bis: null });
		expect(lies('betrag=bis:2000').filter.betrag).toEqual({ ab: null, bis: 2000 });
		expect(lies('betrag=2000-5000').filter.betrag).toEqual({ ab: 2000, bis: 5000 });
		expect(lies('betrag=5000-2000')).toMatchObject({ filter: { betrag: { ab: 2000, bis: 5000 } }, hinweise: [expect.stringContaining('getauscht')] });
	});

	it('liest Betraege aus dem Formular in Euro', () => {
		expect(lies('betrag_ab=50&betrag_bis=').filter.betrag).toEqual({ ab: 5000, bis: null });
		expect(lies('betrag_ab=12,5&betrag_bis=99.99').filter.betrag).toEqual({ ab: 1250, bis: 9999 });
		expect(lies('betrag_ab=&betrag_bis=').filter.betrag).toBeNull();
		expect(lies('betrag_ab=zehn').hinweise).toHaveLength(1);
	});

	it('liest die Suche getrimmt und begrenzt', () => {
		expect(lies('suche=%20Kaffee%20').filter.suche).toBe('Kaffee');
		expect(lies('suche=').filter.suche).toBeNull();
		const lang = lies(`suche=${'a'.repeat(150)}`);
		expect(lang.filter.suche).toHaveLength(100);
		expect(lang.hinweise).toHaveLength(1);
	});

	it('liest geteilt/privat, leer heisst beides', () => {
		expect(lies('sicht=privat').filter.sicht).toBe('privat');
		expect(lies('sicht=').filter.sicht).toBeNull();
		expect(lies('sicht=').hinweise).toEqual([]);
	});

	it('schreibt alle Merkmale kanonisch zurueck', () => {
		for (const x of [
			`zeitraum=monat&monat=2026-09&person=${UUID}&betrag=ab:5000&topf=${U2}&suche=Kaffee%20Crema&sicht=geteilt`,
			'zeitraum=jahr&jahr=2025&laden=ohne&kategorie=unsortiert&betrag=2000-5000',
			'zeitraum=monat&monat=2026-09&betrag=bis:2000'
		]) {
			expect(filterAlsAdresse(lies(x).filter)).toBe(x);
		}
	});
});

describe('hatFilter / ohneMerkmal / ohneFilter', () => {
	const f = leererFilter({ art: 'monat', monat: '2026-09' });

	it('erkennt jedes Merkmal, aber nicht Zeitraum und Umfang', () => {
		expect(hatFilter(f)).toBe(false);
		expect(hatFilter({ ...f, umfang: 'meine' })).toBe(false);
		for (const g of [{ laden: ['ohne'] }, { person: [UUID] }, { betrag: { ab: 1, bis: null } }, { topf: [UUID] }, { suche: 'x' }, { sicht: 'privat' as const }]) {
			expect(hatFilter({ ...f, ...g })).toBe(true);
		}
	});

	it('entfernt ein Merkmal oder alle, Zeitraum und Umfang bleiben', () => {
		const voll = { ...f, umfang: 'meine' as const, laden: [UUID], suche: 'x' };
		expect(ohneMerkmal(voll, 'laden')).toEqual({ ...voll, laden: [] });
		expect(ohneMerkmal(voll, 'suche')).toEqual({ ...voll, suche: null });
		expect(ohneFilter(voll)).toEqual({ ...f, umfang: 'meine' });
	});
});

describe('merkmalParameter / zeitraumParameter', () => {
	it('trennt Merkmale (mit Umfang) vom Zeitraum', () => {
		const { filter } = lies(`zeitraum=spanne&von=2026-03-01&bis=2026-03-31&umfang=meine&laden=${UUID}&suche=Kaffee Crema`);
		expect(merkmalParameter(filter)).toEqual({ umfang: 'meine', laden: UUID, suche: 'Kaffee Crema' });
		expect(zeitraumParameter(filter.zeitraum)).toEqual({ zeitraum: 'spanne', von: '2026-03-01', bis: '2026-03-31' });
		expect(zeitraumParameter({ art: 'jahr', jahr: 2026 })).toEqual({ zeitraum: 'jahr', jahr: '2026' });
	});
});

// Abschlusspruefung Stufe 2: slice() schnitt ein Emoji an der 100-Zeichen-Grenze in der
// Mitte durch; encodeURIComponent warf dann URIError — die Seite endete in einem 500.
describe('filterAusAdresse: lange Suche mit Emoji', () => {
	it('kuerzt nach Zeichen, nicht nach UTF-16-Einheiten, und bleibt als Adresse schreibbar', () => {
		const { filter } = lies(`suche=${encodeURIComponent('a'.repeat(99) + '\u{1F600}x')}`);
		expect(Array.from(filter.suche ?? '')).toHaveLength(100);
		expect(filter.suche?.endsWith('\u{1F600}')).toBe(true);
		expect(() => filterAlsAdresse(filter)).not.toThrow();
	});
});
