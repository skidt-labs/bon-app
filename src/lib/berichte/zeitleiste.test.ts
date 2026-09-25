import { describe, it, expect } from 'vitest';
import {
	zeitraumName, blaetterZiele, wechsleArt, vergleichsZeitraeume, verlaufsAchse, ladeFenster,
	monatImZeitraum, zeitwahlKacheln, jahresAuswahl, vergleichText, adresse, leerText
} from './zeitleiste';
import { leererFilter } from './filter';

const HEUTE = '2026-09-25';

describe('zeitraumName', () => {
	it('nennt Monat, Jahr und Spanne', () => {
		expect(zeitraumName({ art: 'monat', monat: '2026-09' })).toBe('September 2026');
		expect(zeitraumName({ art: 'jahr', jahr: 2025 })).toBe('2025');
		expect(zeitraumName({ art: 'spanne', von: '2026-03-01', bis: '2026-08-31' })).toBe('1. März – 31. Aug. 2026');
		expect(zeitraumName({ art: 'spanne', von: '2025-12-01', bis: '2026-01-31' })).toBe('1. Dez. 2025 – 31. Jan. 2026');
		expect(zeitraumName({ art: 'spanne', von: '2026-03-05', bis: '2026-03-05' })).toBe('5. März 2026');
	});
});

/*
 * Die Blaetterzeile hat immer drei Felder. „‹" gibt es immer, „›" nur bis zum laufenden
 * Zeitraum — sein Platz bleibt dann leer stehen (Komponente). Hier wird geprueft, WOHIN
 * die Pfeile fuehren: bis 0.3.0 fuehrten beide zurueck.
 */
describe('blaetterZiele', () => {
	it('blaettert Monate vor und zurueck, nie in die Zukunft', () => {
		expect(blaetterZiele({ art: 'monat', monat: '2026-08' }, HEUTE)).toEqual({
			zurueck: { art: 'monat', monat: '2026-07' },
			vor: { art: 'monat', monat: '2026-09' }
		});
		expect(blaetterZiele({ art: 'monat', monat: '2026-09' }, HEUTE).vor).toBeNull();
		expect(blaetterZiele({ art: 'monat', monat: '2026-01' }, HEUTE)).toEqual({
			zurueck: { art: 'monat', monat: '2025-12' },
			vor: { art: 'monat', monat: '2026-02' }
		});
	});

	it('blaettert Jahre', () => {
		expect(blaetterZiele({ art: 'jahr', jahr: 2026 }, HEUTE)).toEqual({ zurueck: { art: 'jahr', jahr: 2025 }, vor: null });
		expect(blaetterZiele({ art: 'jahr', jahr: 2024 }, HEUTE).vor).toEqual({ art: 'jahr', jahr: 2025 });
	});

	it('verschiebt eine Spanne um ihre eigene Laenge und kuerzt am heutigen Tag', () => {
		expect(blaetterZiele({ art: 'spanne', von: '2026-03-01', bis: '2026-03-31' }, HEUTE)).toEqual({
			zurueck: { art: 'spanne', von: '2026-01-29', bis: '2026-02-28' },
			// Um 31 Tage verschoben: kein Monatsraster, sondern dieselbe Laenge.
			vor: { art: 'spanne', von: '2026-04-01', bis: '2026-05-01' }
		});
		expect(blaetterZiele({ art: 'spanne', von: '2026-09-01', bis: '2026-09-10' }, HEUTE).vor).toEqual({
			art: 'spanne', von: '2026-09-11', bis: '2026-09-20'
		});
		expect(blaetterZiele({ art: 'spanne', von: '2026-09-11', bis: '2026-09-20' }, HEUTE).vor).toEqual({
			art: 'spanne', von: '2026-09-21', bis: HEUTE
		});
		expect(blaetterZiele({ art: 'spanne', von: '2026-09-01', bis: HEUTE }, HEUTE).vor).toBeNull();
	});
});

describe('wechsleArt', () => {
	it('behaelt beim Wechsel den Bezug zum gewaehlten Zeitraum', () => {
		expect(wechsleArt({ art: 'monat', monat: '2026-09' }, 'jahr', HEUTE)).toEqual({ art: 'jahr', jahr: 2026 });
		expect(wechsleArt({ art: 'monat', monat: '2026-09' }, 'spanne', HEUTE)).toEqual({ art: 'spanne', von: '2026-09-01', bis: HEUTE });
		expect(wechsleArt({ art: 'jahr', jahr: 2025 }, 'monat', HEUTE)).toEqual({ art: 'monat', monat: '2025-12' });
		expect(wechsleArt({ art: 'jahr', jahr: 2026 }, 'monat', HEUTE)).toEqual({ art: 'monat', monat: '2026-09' });
		expect(wechsleArt({ art: 'spanne', von: '2026-03-01', bis: '2026-08-31' }, 'monat', HEUTE)).toEqual({ art: 'monat', monat: '2026-08' });
		expect(wechsleArt({ art: 'monat', monat: '2026-05' }, 'monat', HEUTE)).toEqual({ art: 'monat', monat: '2026-05' });
	});
});

describe('vergleichsZeitraeume', () => {
	it('vergleicht einen Monat mit Vormonat und Vorjahresmonat', () => {
		expect(vergleichsZeitraeume({ art: 'monat', monat: '2026-09' }, HEUTE)).toEqual([
			{ bezeichnung: 'August 2026', von: '2026-08-01', bis: '2026-08-31' },
			{ bezeichnung: 'September 2025', von: '2025-09-01', bis: '2025-09-30' }
		]);
	});

	it('vergleicht das laufende Jahr bis heute UND das ganze Vorjahr', () => {
		expect(vergleichsZeitraeume({ art: 'jahr', jahr: 2026 }, HEUTE)).toEqual([
			{ bezeichnung: '2025 bis 25. Sept.', von: '2025-01-01', bis: '2025-09-25' },
			{ bezeichnung: '2025', von: '2025-01-01', bis: '2025-12-31' }
		]);
		expect(vergleichsZeitraeume({ art: 'jahr', jahr: 2025 }, HEUTE)).toEqual([
			{ bezeichnung: '2024', von: '2024-01-01', bis: '2024-12-31' }
		]);
	});

	it('faellt vom 29. Februar im Vorjahr auf den 28.', () => {
		expect(vergleichsZeitraeume({ art: 'jahr', jahr: 2028 }, '2028-02-29')[0]).toEqual({
			bezeichnung: '2027 bis 28. Feb.', von: '2027-01-01', bis: '2027-02-28'
		});
	});

	it('vergleicht eine Spanne mit gleich langer Zeit direkt davor', () => {
		expect(vergleichsZeitraeume({ art: 'spanne', von: '2026-03-01', bis: '2026-03-31' }, HEUTE)).toEqual([
			{ bezeichnung: '29. Jan. – 28. Feb. 2026', von: '2026-01-29', bis: '2026-02-28' }
		]);
	});
});

describe('verlaufsAchse', () => {
	it('zeigt 12 Monate bis zum gewaehlten Monat', () => {
		const a = verlaufsAchse({ art: 'monat', monat: '2026-09' }, HEUTE);
		expect(a).toHaveLength(12);
		expect(a[0]).toEqual({ monat: '2025-10', offen: false });
		expect(a[11]).toEqual({ monat: '2026-09', offen: false });
	});

	it('zeigt im Jahr Januar bis Dezember, die kuenftigen Monate offen', () => {
		const a = verlaufsAchse({ art: 'jahr', jahr: 2026 }, HEUTE);
		expect(a.map((x) => x.monat)).toEqual([
			'2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
			'2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'
		]);
		expect(a.filter((x) => x.offen).map((x) => x.monat)).toEqual(['2026-10', '2026-11', '2026-12']);
	});

	it('endet bei einer Spanne im Monat ihres letzten Tages', () => {
		const a = verlaufsAchse({ art: 'spanne', von: '2026-03-01', bis: '2026-08-31' }, HEUTE);
		expect(a[0].monat).toBe('2025-09');
		expect(a[11].monat).toBe('2026-08');
	});
});

describe('ladeFenster', () => {
	it('deckt Zeitraum, Vergleiche und Verlauf ab', () => {
		expect(ladeFenster({ art: 'monat', monat: '2026-09' }, HEUTE)).toEqual({ von: '2025-09-01', bis: '2026-09-30' });
		expect(ladeFenster({ art: 'jahr', jahr: 2026 }, HEUTE)).toEqual({ von: '2025-01-01', bis: '2026-12-31' });
		expect(ladeFenster({ art: 'spanne', von: '2026-03-01', bis: '2026-03-31' }, HEUTE)).toEqual({ von: '2025-04-01', bis: '2026-03-31' });
	});
});

describe('monatImZeitraum', () => {
	it('markiert die Monate, die der Zeitraum beruehrt', () => {
		expect(monatImZeitraum('2026-09', { art: 'monat', monat: '2026-09' })).toBe(true);
		expect(monatImZeitraum('2026-08', { art: 'monat', monat: '2026-09' })).toBe(false);
		expect(monatImZeitraum('2026-03', { art: 'jahr', jahr: 2026 })).toBe(true);
		expect(monatImZeitraum('2026-02', { art: 'spanne', von: '2026-02-20', bis: '2026-03-05' })).toBe(true);
		expect(monatImZeitraum('2026-04', { art: 'spanne', von: '2026-02-20', bis: '2026-03-05' })).toBe(false);
	});
});

describe('zeitwahlKacheln', () => {
	it('liefert 12 Kacheln mit Betrag und sperrt die Zukunft', () => {
		const k = zeitwahlKacheln(2026, HEUTE, { '2026-08': 12345 });
		expect(k).toHaveLength(12);
		expect(k[7]).toEqual({ monat: '2026-08', kurz: 'Aug', cents: 12345, gesperrt: false });
		expect(k[0].cents).toBeNull();
		expect(k[8].gesperrt).toBe(false); // laufender Monat ist waehlbar
		expect(k[9].gesperrt).toBe(true);
		expect(zeitwahlKacheln(2027, HEUTE, {}).every((x) => x.gesperrt)).toBe(true);
	});
});

describe('jahresAuswahl', () => {
	it('reicht vom fruehesten Jahr mit Daten bis zum laufenden, neuestes zuerst', () => {
		expect(jahresAuswahl(HEUTE, { '2024-05': 1, '2026-01': 2 })).toEqual([2026, 2025, 2024]);
		expect(jahresAuswahl(HEUTE, {})).toEqual([2026]);
	});
});

describe('vergleichText', () => {
	it('nennt Vorzeichen und Wort, nicht nur eine Farbe', () => {
		expect(vergleichText({ bezeichnung: 'August 2026', cents: 10000, prozent: 12 })).toBe('+12 % zu August 2026');
		expect(vergleichText({ bezeichnung: 'August 2026', cents: 10000, prozent: -5 })).toBe('−5 % zu August 2026');
		expect(vergleichText({ bezeichnung: 'August 2026', cents: 10000, prozent: 0 })).toBe('±0 % zu August 2026');
	});

	it('behauptet keinen Vergleich, wo es keinen gibt', () => {
		expect(vergleichText({ bezeichnung: 'August 2026', cents: null, prozent: null })).toBe(
			'Kein Vergleich zu August 2026 — dort liegt kein bestätigter Bon'
		);
		expect(vergleichText({ bezeichnung: 'August 2026', cents: 0, prozent: null })).toBe(
			'Kein Prozentwert zu August 2026 (0,00 €)'
		);
	});
});

describe('adresse', () => {
	it('baut Links aus Pfad, Filter und Zusatzparametern', () => {
		const f = leererFilter({ art: 'monat', monat: '2026-09' });
		expect(adresse('/reports', f)).toBe('/reports?zeitraum=monat&monat=2026-09');
		expect(adresse('/reports/bons', { ...f, kategorie: ['obst'] }, { ansicht: 'position' })).toBe(
			'/reports/bons?zeitraum=monat&monat=2026-09&kategorie=obst&ansicht=position'
		);
	});
});

// Abschlusspruefung: der Leertext sagte immer „noch kein Bon bestaetigt" — auch unter
// „Nur meine" oder mit Filter, wo der Haushalt sehr wohl bestaetigte Bons haben kann.
describe('leerText', () => {
	const f = leererFilter({ art: 'monat', monat: '2026-09' });
	const UUID = '3f2a0b7c-1111-2222-3333-444444444444';

	it('sagt ohne Filter, dass nichts bestaetigt ist', () => {
		expect(leerText(f)).toEqual({ text: 'Für September 2026 ist noch kein Bon bestätigt.', zurueck: null });
	});

	it('sagt unter „Nur meine", dass es um die eigenen Bons geht, und bietet den Haushalt an', () => {
		expect(leerText({ ...f, umfang: 'meine' })).toEqual({
			text: 'Für September 2026 hast du keinen eigenen bestätigten Bon.',
			zurueck: { text: 'Ganzen Haushalt zeigen', filter: f }
		});
	});

	it('sagt mit Filter, dass nichts PASST, und bietet den ungefilterten Bericht an', () => {
		expect(leerText({ ...f, laden: [UUID], kategorie: ['obst'] })).toEqual({
			text: 'Für September 2026 gibt es keinen passenden bestätigten Bon.',
			zurueck: { text: 'Ohne Filter zeigen', filter: f }
		});
	});
});
