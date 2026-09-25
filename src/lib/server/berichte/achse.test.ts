import { describe, it, expect } from 'vitest';
import { achsenMonate, monatsNachbarn } from './abfragen';

describe('achsenMonate', () => {
	it('liefert die letzten Monate, aeltester zuerst', () => {
		expect(achsenMonate('2026-09', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
	});

	it('geht ueber den Jahreswechsel', () => {
		expect(achsenMonate('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
	});

	it('bricht bei einem unbrauchbaren Monat ab, statt zu raten', () => {
		expect(achsenMonate('quatsch', 3)).toEqual(['quatsch']);
	});
});

/*
 * Bis 0.3.0 lasen die Knoepfe ihre Ziele aus der Verlaufsachse ab: „‹" sprang an deren
 * Anfang (fuenf Monate zurueck), „›" auf den vorletzten Achsenmonat — also EBENFALLS
 * zurueck, obwohl der Pfeil nach vorn zeigte. Jeder Tipp fuehrte tiefer in die
 * Vergangenheit. Die Nachbarn haengen deshalb nicht mehr an der Achse.
 */
describe('monatsNachbarn', () => {
	it('zeigt zurueck auf den Vormonat und vor auf den Folgemonat', () => {
		expect(monatsNachbarn('2026-08', '2026-09')).toEqual({ zurueck: '2026-07', vor: '2026-09' });
	});

	it('bietet im laufenden Monat kein „vor" an', () => {
		expect(monatsNachbarn('2026-09', '2026-09')).toEqual({ zurueck: '2026-08', vor: null });
	});

	it('bietet auch jenseits des laufenden Monats kein „vor" an', () => {
		expect(monatsNachbarn('2027-03', '2026-09').vor).toBeNull();
	});

	it('geht in beide Richtungen ueber den Jahreswechsel', () => {
		expect(monatsNachbarn('2026-01', '2026-09')).toEqual({ zurueck: '2025-12', vor: '2026-02' });
		expect(monatsNachbarn('2025-12', '2026-09')).toEqual({ zurueck: '2025-11', vor: '2026-01' });
	});
});
