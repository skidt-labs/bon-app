import { describe, it, expect } from 'vitest';
import { ordneZeilenZu, abweichungInZeile, aehnlichkeit } from './zuordnung';

const z = (...texte: string[]) => texte.map((text) => ({ text }));

describe('aehnlichkeit', () => {
	it('ist 1 bei gleichen Buchstaben, egal wie geschrieben', () => {
		expect(aehnlichkeit('H-Milch 3,5 %', 'H-MILCH 3,5%')).toBe(1);
		expect(aehnlichkeit('Bananen', 'BANANEN')).toBe(1);
	});
	it('erkennt Teilnamen und ignoriert Betraege', () => {
		expect(aehnlichkeit('Butter', 'RABATT BUTTER -0,50')).toBeGreaterThan(0.3);
		expect(aehnlichkeit('Pfand', 'PFANDWERT 0,25')).toBeGreaterThan(0.3);
	});
	it('ist 0 ohne Buchstaben oder bei fremden Woertern', () => {
		expect(aehnlichkeit('Bananen', '1,79 A')).toBe(0);
		expect(aehnlichkeit('Bananen', 'BUTTER')).toBe(0);
		expect(aehnlichkeit('ab', 'ab')).toBe(0); // zu kurz fuer ein Trigramm
	});
});

describe('ordneZeilenZu — Tesseract: Name und Betrag in einer Zeile', () => {
	const zeilen = z(
		'FRISCHMARKT BEISPIELSTR.',
		'H-MILCH 3,5% 1,09 A',
		'BUTTER 2,49 A',
		'  RABATT BUTTER -0,50',
		'BANANEN',
		' 1,204 kg x 1,49/kg 1,79 A',
		'PFAND 0,25 A',
		'SUMME 6,01',
		'16.09.2026 17:42'
	);

	it('findet jede Position an ihrer Zeile', () => {
		const m = ordneZeilenZu(
			[
				{ lineNo: 1, rawText: 'H-Milch 3,5 %', totalPriceCents: 109 },
				{ lineNo: 2, rawText: 'Butter', totalPriceCents: 249 },
				{ lineNo: 3, rawText: 'Rabatt Butter', totalPriceCents: -50 },
				{ lineNo: 4, rawText: 'Bananen', totalPriceCents: 179 },
				{ lineNo: 5, rawText: 'Pfand', totalPriceCents: 25 }
			],
			zeilen
		);
		expect([...m.entries()]).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 6]]);
	});

	// Bananen: der Name steht in Zeile 4, der Betrag in Zeile 5 — die Namenszeile
	// gewinnt (1 + 1,0 = 2,0 gegen 1,5). Das ist die Zeile, die ein Mensch im Bild sucht.
	it('bevorzugt die Namenszeile, wenn der Betrag woanders steht', () => {
		const m = ordneZeilenZu([{ lineNo: 4, rawText: 'Bananen', totalPriceCents: 179 }], zeilen);
		expect(m.get(4)).toBe(4);
	});

	// "16.09.2026" darf nicht als Betrag 16,09 gelten — betraegeInCent schliesst Daten aus.
	it('haelt ein Datum nicht fuer einen Betrag', () => {
		const m = ordneZeilenZu([{ lineNo: 9, rawText: 'Irgendwas', totalPriceCents: 1609 }], zeilen);
		expect(m.get(9)).toBeNull();
	});
});

describe('ordneZeilenZu — PaddleOCR: Name und Betrag in getrennten Kaesten', () => {
	const zeilen = z('BIO ERDNUSSMUS', '1,65€1', 'BIO ERDNUSSMUS', '1,65€1', 'PFANDWERT 0,25', 'PFANDWERT0,25');

	// Zwei gleiche Artikel: beide Namenszeilen haben dieselbe Punktzahl; die erste geht
	// an die erste Position, die zweite an die zweite — Bon-Reihenfolge.
	it('legt zwei gleiche Artikel auf zwei aufeinanderfolgende Namenszeilen', () => {
		const m = ordneZeilenZu(
			[
				{ lineNo: 1, rawText: 'Bio Erdnussmus', totalPriceCents: 165 },
				{ lineNo: 2, rawText: 'Bio Erdnussmus', totalPriceCents: 165 }
			],
			zeilen
		);
		expect(m.get(1)).toBe(0);
		expect(m.get(2)).toBe(2);
	});

	it('findet Pfand an beiden Schreibweisen, mit und ohne Leerzeichen', () => {
		const m = ordneZeilenZu(
			[
				{ lineNo: 3, rawText: 'Pfandwert', totalPriceCents: 25 },
				{ lineNo: 4, rawText: 'Pfandwert', totalPriceCents: 25 }
			],
			zeilen
		);
		expect(m.get(3)).toBe(4);
		expect(m.get(4)).toBe(5);
	});

	// Nur ein Betrag, kein Name: zwei Preiskaesten "1,65€1", nichts unterscheidet sie.
	// Eine falsche Hervorhebung waere schlimmer als keine — also null.
	it('sagt null, wenn nur der Betrag passt und mehrere Zeilen ihn tragen', () => {
		const m = ordneZeilenZu([{ lineNo: 1, rawText: 'Xyz', totalPriceCents: 165 }], zeilen);
		expect(m.get(1)).toBeNull();
	});

	it('nimmt den einzigen Preiskasten, wenn er eindeutig ist', () => {
		const m = ordneZeilenZu([{ lineNo: 1, rawText: 'Xyz', totalPriceCents: 25 }], z('SUMME 9,99', '0,25'));
		expect(m.get(1)).toBe(1);
	});
});

describe('ordneZeilenZu — Grenzen', () => {
	it('ist null ohne Zeilen, ohne Betrag und ohne Namen', () => {
		expect(ordneZeilenZu([{ lineNo: 1, rawText: 'Milch', totalPriceCents: 109 }], []).get(1)).toBeNull();
		expect(ordneZeilenZu([{ lineNo: 1, rawText: '', totalPriceCents: 0 }], z('MILCH 1,09')).get(1)).toBeNull();
	});

	it('vergibt jede Zeile hoechstens einmal', () => {
		const m = ordneZeilenZu(
			[
				{ lineNo: 1, rawText: 'Milch', totalPriceCents: 109 },
				{ lineNo: 2, rawText: 'Milch', totalPriceCents: 109 }
			],
			z('MILCH 1,09 A')
		);
		expect(m.get(1)).toBe(0);
		expect(m.get(2)).toBeNull();
	});
});

describe('abweichungInZeile', () => {
	// Der Fall aus den Mockups: Zeile traegt Einzelpreis (1,49) und Gesamt (1,79); das
	// Modell las 1,29. Der Einzelpreis faellt raus, uebrig bleibt 1,79 — die Abweichung.
	it('nennt den Betrag im Bild, wenn genau einer uebrig bleibt und er abweicht', () => {
		const zeilen = z(' 1,204 kg x 1,49/kg 1,79 A');
		expect(abweichungInZeile(zeilen, 0, 129, 149)).toBe(179);
	});

	it('ist null, wenn der Betrag im Bild steht', () => {
		expect(abweichungInZeile(z('BUTTER 2,49 A'), 0, 249, null)).toBeNull();
	});

	// PaddleOCR: der Preis steht im naechsten Kasten, der nur Zahlen traegt.
	it('schaut in den naechsten Kasten, wenn die Zeile keinen Betrag hat und er nur Zahlen traegt', () => {
		expect(abweichungInZeile(z('BIO ERDNUSSMUS', '1,65€1'), 0, 185, null)).toBe(165);
		// … aber nicht, wenn der naechste Kasten ein Artikel ist.
		expect(abweichungInZeile(z('BIO ERDNUSSMUS', 'BUTTER 2,49'), 0, 185, null)).toBeNull();
	});

	it('ist null bei zwei moeglichen Betraegen — raten waere eine Behauptung', () => {
		expect(abweichungInZeile(z('2 x 1,29 2,58 A'), 0, 300, null)).toBeNull();
	});

	it('ist null bei Rabatten mit richtigem Betrag, Vorzeichen egal', () => {
		expect(abweichungInZeile(z('RABATT BUTTER -0,50'), 0, -50, null)).toBeNull();
	});
});

describe('Gewichtung von Name gegen Betrag', () => {
	// Gemessen am Lidl-Bon vom 2026-09-17 (Sichtpruefung Etappe 2): PaddleOCR las
	// "Gr.Oliv.Zitr.Kräuter" als "Gr.0liy.Zitr.Kräuter" — Null statt O, y statt v.
	// Aehnlichkeit 0,48. Solange "nur Betrag" 1,5 zaehlte, schlugen die beiden
	// Preiskaesten "1,79 A" die Namenszeile (1,48), und weil es zwei gleiche Betraege
	// waren, blieb die Position ganz ohne Zuordnung. Betraege wiederholen sich auf
	// einem Bon staendig, Namen fast nie — der Name muss gewinnen.
	it('zieht einen verlesenen Namen zwei gleichen Preiskaesten vor', () => {
		const zeilen = [
			{ text: 'Oliv.-Mix ohne Stein' },
			{ text: '1,79 A' },
			{ text: 'Gr.0liy.Zitr.Kräuter' },
			{ text: '1,79 A' }
		];
		const zuordnung = ordneZeilenZu(
			[
				{ lineNo: 1, rawText: 'Oliv.-Mix ohne Stein', totalPriceCents: 179 },
				{ lineNo: 2, rawText: 'Gr.Oliv.Zitr.Kräuter', totalPriceCents: 179 }
			],
			zeilen
		);
		expect(zuordnung.get(1)).toBe(0);
		expect(zuordnung.get(2)).toBe(2);
	});

	// Die Gegenprobe: ohne jeden Namensbeleg bleibt es bei der alten Regel — ein Betrag,
	// den mehrere Zeilen tragen, unterscheidet nichts, also null.
	it('bleibt bei null, wenn nur der Betrag spricht und er mehrfach vorkommt', () => {
		const zuordnung = ordneZeilenZu(
			[{ lineNo: 1, rawText: 'XYZ', totalPriceCents: 179 }],
			[{ text: '1,79 A' }, { text: '1,79 A' }]
		);
		expect(zuordnung.get(1)).toBeNull();
	});

	// Und ein einzelner Betrag ohne Namen zaehlt weiterhin als Beleg.
	it('nimmt einen eindeutigen Betrag auch ohne Namen', () => {
		const zuordnung = ordneZeilenZu(
			[{ lineNo: 1, rawText: 'XYZ', totalPriceCents: 179 }],
			[{ text: 'ganz was anderes' }, { text: '1,79 A' }]
		);
		expect(zuordnung.get(1)).toBe(1);
	});
});

describe('abweichungInZeile: der Einzelpreis darf nicht den letzten Beleg wegfiltern', () => {
	// Gemessen am ALDI-Bon vom 2026-09-17: im Bild steht "KARTOFFELN.FK 2.5KG" und
	// darunter "2,49 €". Das Modell nahm 2,49 als Kilopreis und rechnete 2,5 x 2,49 =
	// 6,22 als Endbetrag — eine Zahl, die auf dem Bon nirgends steht. Der Hinweis blieb
	// stumm, weil der Filter gegen den Einzelpreis den einzigen Betrag wegwarf.
	it('meldet den einzigen Betrag auch dann, wenn er gleich dem Einzelpreis ist', () => {
		const zeilen = [{ text: 'KARTOFFELN.FK 2.5KC' }, { text: '2,49€1' }];
		expect(abweichungInZeile(zeilen, 0, 622, 249)).toBe(249);
	});

	// Die Gegenprobe: stehen BEIDE Zahlen in der Zeile, bleibt der Filter wirksam —
	// der Einzelpreis ist dann nicht der Endbetrag.
	it('bietet den Einzelpreis nicht an, wenn die Zeile auch den Endbetrag traegt', () => {
		const zeilen = [{ text: ' 1,204 kg x 1,49/kg 1,79 A' }];
		expect(abweichungInZeile(zeilen, 0, 129, 149)).toBe(179);
	});

	// Und wenn der gelesene Betrag im Bild steht, schweigt sie weiterhin.
	it('schweigt, wenn der gelesene Betrag im Bild steht', () => {
		expect(abweichungInZeile([{ text: 'KARTOFFELN 2,49 A' }], 0, 249, 249)).toBeNull();
	});
});
