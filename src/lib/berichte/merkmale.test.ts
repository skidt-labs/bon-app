import { describe, it, expect } from 'vitest';
import { aktiveMerkmale, merkmalText, filterZusammenfassung, LEERE_NAMEN } from './merkmale';
import { leererFilter } from './filter';

const f = leererFilter({ art: 'monat', monat: '2026-09' });
const NAMEN = {
	laden: { l1: 'Testladen', l2: 'Zweiter Laden' },
	kategorie: { obst: 'Obst & Gemüse' },
	person: { p1: 'Erika' },
	topf: { t1: 'Essen' }
};

describe('aktiveMerkmale', () => {
	it('nennt die gesetzten Merkmale in fester Reihenfolge', () => {
		expect(aktiveMerkmale(f)).toEqual([]);
		expect(aktiveMerkmale({ ...f, suche: 'x', laden: ['l1'], sicht: 'geteilt' })).toEqual(['laden', 'suche', 'sicht']);
	});
});

describe('merkmalText', () => {
	it('beschriftet jeden Chip mit Namen statt Ids', () => {
		expect(merkmalText({ ...f, laden: ['l1', 'ohne'] }, 'laden', NAMEN)).toBe('Laden: Testladen, Laden unbekannt');
		expect(merkmalText({ ...f, kategorie: ['obst', 'unsortiert'] }, 'kategorie', NAMEN)).toBe('Kategorie: Obst & Gemüse, Ohne Kategorie');
		// Nicht „Unsortiert“: so heisst eine echte Kategorie unter Sonstiges.
		expect(merkmalText({ ...f, person: ['p1'] }, 'person', NAMEN)).toBe('Person: Erika');
		expect(merkmalText({ ...f, topf: ['t1'] }, 'topf', NAMEN)).toBe('Topf: Essen');
		expect(merkmalText({ ...f, suche: 'Kaffee' }, 'suche', NAMEN)).toBe('Suche: „Kaffee"');
		expect(merkmalText({ ...f, sicht: 'privat' }, 'sicht', NAMEN)).toBe('Nur eigene private');
		expect(merkmalText({ ...f, sicht: 'geteilt' }, 'sicht', NAMEN)).toBe('Nur geteilte');
	});

	it('schreibt Betraege in Euro', () => {
		expect(merkmalText({ ...f, betrag: { ab: 5000, bis: null } }, 'betrag', NAMEN)).toBe('Betrag: ab 50,00 €');
		expect(merkmalText({ ...f, betrag: { ab: null, bis: 2000 } }, 'betrag', NAMEN)).toBe('Betrag: bis 20,00 €');
		expect(merkmalText({ ...f, betrag: { ab: 2000, bis: 5000 } }, 'betrag', NAMEN)).toBe('Betrag: 20,00–50,00 €');
	});

	it('faellt ohne Namen nicht aus', () => {
		expect(merkmalText({ ...f, laden: ['l9'] }, 'laden', LEERE_NAMEN)).toBe('Laden: unbekannter Laden');
	});
});

describe('filterZusammenfassung', () => {
	it('liefert einen Text je gesetztem Merkmal', () => {
		expect(filterZusammenfassung({ ...f, laden: ['l1'], suche: 'Kaffee' }, NAMEN)).toEqual(['Laden: Testladen', 'Suche: „Kaffee"']);
	});
});
