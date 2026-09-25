import { describe, it, expect } from 'vitest';
import {
	zeileEinfuegen,
	zeileVerschieben,
	zeileLoeschen,
	neuNummerieren,
	positionssumme,
	pruefeVorBestaetigen,
	type EditorZeile
} from './editor';

const z = (over: Partial<EditorZeile> = {}): EditorZeile => ({
	id: 'id-' + (over.lineNo ?? 1),
	lineNo: 1,
	rawText: 'MILCH',
	lineType: 'article',
	quantity: '1',
	unit: 'stk',
	unitPriceCents: 109,
	totalPriceCents: 109,
	vatClass: 'A',
	appliesToLine: null,
	categoryId: null,
	ocrZeile: null,
	...over
});

describe('zeileEinfuegen', () => {
	it('setzt eine leere Zeile dahinter und nummeriert die Folgenden neu', () => {
		const vorher = [z({ lineNo: 1 }), z({ lineNo: 2, rawText: 'BUTTER' })];
		const nachher = zeileEinfuegen(vorher, 0);
		expect(nachher).toHaveLength(3);
		expect(nachher.map((x) => x.lineNo)).toEqual([1, 2, 3]);
		expect(nachher[1].id).toBeNull(); // neu, gibt es in der Datenbank noch nicht
		expect(nachher[1].totalPriceCents).toBe(0);
		expect(nachher[2].rawText).toBe('BUTTER');
	});

	// Ein Bezug zeigt auf eine ZEILENNUMMER. Schiebt sich eine Zeile dazwischen, muss er
	// mitwandern — sonst zeigt der Rabatt nach dem Einfuegen auf den falschen Artikel,
	// und niemand sieht es.
	it('zieht Bezuege mit, wenn sich die Nummern verschieben', () => {
		const vorher = [
			z({ lineNo: 1, rawText: 'BUTTER' }),
			z({ lineNo: 2, rawText: 'RABATT', lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })
		];
		const nachher = zeileEinfuegen(vorher, 0);
		expect(nachher[2].appliesToLine).toBe(1); // BUTTER blieb Zeile 1
		const vorn = zeileEinfuegen(vorher, -1); // ganz oben einfuegen
		expect(vorn[2].appliesToLine).toBe(2); // BUTTER ist jetzt Zeile 2
	});
});

describe('zeileLoeschen', () => {
	it('entfernt die Zeile, nummeriert neu und meldet die geloeschte ID', () => {
		const vorher = [
			z({ lineNo: 1 }),
			z({ lineNo: 2, rawText: 'BUTTER' }),
			z({ lineNo: 3, rawText: 'PFAND' })
		];
		const { zeilen, geloescht } = zeileLoeschen(vorher, 1);
		expect(zeilen.map((x) => x.rawText)).toEqual(['MILCH', 'PFAND']);
		expect(zeilen.map((x) => x.lineNo)).toEqual([1, 2]);
		expect(geloescht).toEqual(['id-2']);
	});

	// Eine Zeile mit Bezug auf die geloeschte: der Bezug wird null, nicht "irgendeine".
	// Der Rabatt bleibt sichtbar und ohne Zuordnung — der Mensch entscheidet.
	it('loest Bezuege auf die geloeschte Zeile, statt sie umzubiegen', () => {
		const vorher = [
			z({ lineNo: 1, rawText: 'BUTTER' }),
			z({ lineNo: 2, rawText: 'MILCH' }),
			z({ lineNo: 3, rawText: 'RABATT', lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })
		];
		const { zeilen } = zeileLoeschen(vorher, 0);
		expect(zeilen.find((x) => x.rawText === 'RABATT')?.appliesToLine).toBeNull();
	});

	// Eine neue Zeile, die nie gespeichert wurde, darf NICHT in `geloescht` landen:
	// der Server wuerde eine ID suchen, die es nicht gibt, und mit 409 abbrechen.
	it('meldet neue Zeilen nicht zum Loeschen', () => {
		const { geloescht } = zeileLoeschen([z({ lineNo: 1, id: null }), z({ lineNo: 2 })], 0);
		expect(geloescht).toEqual([]);
	});
});

describe('positionssumme', () => {
	it('zaehlt nur Geldzeilen, Rabatte negativ', () => {
		const zeilen = [
			z({ lineNo: 1, totalPriceCents: 109 }),
			z({ lineNo: 2, lineType: 'discount', totalPriceCents: -50 }),
			z({ lineNo: 3, lineType: 'deposit', totalPriceCents: 25 }),
			z({ lineNo: 4, lineType: 'info', totalPriceCents: 9999 })
		];
		expect(positionssumme(zeilen)).toBe(84);
	});
});

describe('pruefeVorBestaetigen', () => {
	it('ist still, wenn alles passt', () => {
		expect(pruefeVorBestaetigen([z({ lineNo: 1 })])).toEqual([]);
	});

	// Der bestehende Fall no_price: eine Warenzeile ohne Betrag ist kein Bon, sondern
	// eine Luecke. Bestaetigen bleibt gesperrt, bis sie zu ist.
	it('nennt Warenzeilen ohne Betrag mit ihrer Nummer', () => {
		const hinweise = pruefeVorBestaetigen([z({ lineNo: 1, totalPriceCents: 0 }), z({ lineNo: 2 })]);
		expect(hinweise).toHaveLength(1);
		expect(hinweise[0]).toContain('1');
	});

	it('laesst Infozeilen ohne Betrag durch', () => {
		expect(pruefeVorBestaetigen([z({ lineNo: 1, lineType: 'info', totalPriceCents: 0 })])).toEqual([]);
	});

	it('nennt einen Bezug ins Leere', () => {
		const hinweise = pruefeVorBestaetigen([
			z({ lineNo: 1, lineType: 'discount', totalPriceCents: -50, appliesToLine: 9 })
		]);
		expect(hinweise[0]).toContain('9');
	});

	// Die Summendifferenz SPERRT NICHT: ein Bon darf mit Differenz bestaetigt werden,
	// wenn der Mensch das entscheidet (Entwurf §2). Sie ist ein Hinweis in der Kopfzeile,
	// kein Hindernis — deshalb taucht sie hier gar nicht auf.
	it('sperrt nicht wegen einer Summendifferenz', () => {
		expect(pruefeVorBestaetigen([z({ lineNo: 1, totalPriceCents: 1 })])).toEqual([]);
	});

	// Der Server lehnt einen Bezug auf sich selbst ab (korrekturen.ts). Faellt das erst
	// dort auf, sieht der Mensch einen 400er statt eines Hinweises an der Zeile.
	it('nennt einen Bezug auf sich selbst', () => {
		const hinweise = pruefeVorBestaetigen([
			z({ lineNo: 1, lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })
		]);
		expect(hinweise).toHaveLength(1);
		expect(hinweise[0]).toContain('sich selbst');
	});
});

describe('neuNummerieren', () => {
	it('macht aus jeder Reihenfolge 1..n und zieht Bezuege mit', () => {
		const vorher = [
			z({ lineNo: 7, rawText: 'BUTTER' }),
			z({ lineNo: 9, rawText: 'RABATT', lineType: 'discount', totalPriceCents: -50, appliesToLine: 7 })
		];
		const nachher = neuNummerieren(vorher);
		expect(nachher.map((x) => x.lineNo)).toEqual([1, 2]);
		expect(nachher[1].appliesToLine).toBe(1);
	});

	// Ein Bezug auf eine Nummer, die es nicht (mehr) gibt, wird null statt auf die
	// naechstbeste umgebogen — eine falsche Zuordnung waere schlimmer als keine.
	it('setzt einen Bezug ins Leere auf null', () => {
		const nachher = neuNummerieren([z({ lineNo: 3, appliesToLine: 8 })]);
		expect(nachher[0].appliesToLine).toBeNull();
	});
});

describe('zeileVerschieben', () => {
	it('tauscht mit dem Nachbarn und nummeriert neu', () => {
		const vorher = [
			z({ lineNo: 1, rawText: 'MILCH' }),
			z({ lineNo: 2, rawText: 'BUTTER' }),
			z({ lineNo: 3, rawText: 'PFAND' })
		];
		const runter = zeileVerschieben(vorher, 0, 1);
		expect(runter.map((x) => x.rawText)).toEqual(['BUTTER', 'MILCH', 'PFAND']);
		expect(runter.map((x) => x.lineNo)).toEqual([1, 2, 3]);

		const hoch = zeileVerschieben(vorher, 2, -1);
		expect(hoch.map((x) => x.rawText)).toEqual(['MILCH', 'PFAND', 'BUTTER']);
	});

	// Ein Bezug zeigt auf eine ZEILENNUMMER. Wandert die Zeile, muss er mitwandern —
	// sonst haengt der Rabatt nach dem Verschieben am falschen Artikel, und niemand
	// sieht es. Dieselbe Falle wie beim Einfuegen.
	it('zieht Bezuege mit, wenn zwei Zeilen tauschen', () => {
		const vorher = [
			z({ lineNo: 1, rawText: 'BUTTER' }),
			z({ lineNo: 2, rawText: 'RABATT', lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })
		];
		const nachher = zeileVerschieben(vorher, 0, 1);
		// BUTTER steht jetzt auf 2, der Rabatt auf 1 — und zeigt weiter auf BUTTER.
		expect(nachher[0].rawText).toBe('RABATT');
		expect(nachher[0].appliesToLine).toBe(2);
		expect(nachher[1].rawText).toBe('BUTTER');
	});

	// An den Enden passiert nichts — kein Umlauf. Eine Zeile, die oben aus der Liste
	// faellt und unten wieder auftaucht, waere eine Ueberraschung, kein Werkzeug.
	it('laesst die Liste an den Enden unveraendert', () => {
		const vorher = [z({ lineNo: 1 }), z({ lineNo: 2, rawText: 'BUTTER' })];
		expect(zeileVerschieben(vorher, 0, -1)).toEqual(vorher);
		expect(zeileVerschieben(vorher, 1, 1)).toEqual(vorher);
	});
});
