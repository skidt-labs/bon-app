import { describe, it, expect } from 'vitest';
import { reihen, reiheVon, randBetrag, ortImBild, type Kasten } from './reihen';

/** Ein Kasten wie von PaddleOCR: Text und Rahmen [x, y, Breite, Hoehe]. */
const k = (text: string, x: number, y: number, w = 60, h = 20): Kasten => ({ text, box: [x, y, w, h] });

// Ein erfundener Bon in drei Bon-Zeilen. Wie bei PaddleOCR liegt der Preis im Kasten
// neben dem Namen, das Steuerkennzeichen ganz rechts in einem eigenen.
const bon: Kasten[] = [
	k('MILCH 1,5%', 10, 100, 200),
	k('1,09', 400, 101),
	k('A', 460, 100, 15),
	k('2 x 1,29', 10, 130, 120),
	k('2,58', 400, 131),
	k('B', 460, 130, 15),
	k('PFAND', 10, 160, 100),
	k('0,25-', 400, 160)
];

describe('reihen', () => {
	it('fasst Kaesten gleicher Hoehe zu Bon-Zeilen, links nach rechts', () => {
		expect(reihen(bon)).toEqual([
			[0, 1, 2],
			[3, 4, 5],
			[6, 7]
		]);
	});

	it('sortiert innerhalb einer Reihe nach x, auch wenn die Kaesten anders kommen', () => {
		const durcheinander = [k('A', 460, 100, 15), k('1,09', 400, 100), k('MILCH', 10, 100)];
		expect(reihen(durcheinander)).toEqual([[2, 1, 0]]);
	});

	// Schief fotografiert: der Preis sitzt ein paar Pixel tiefer als der Name.
	it('haelt einen Versatz unter halber Hoehe in einer Reihe, trennt groessere', () => {
		const schief = [k('KAESE', 10, 100), k('2,19', 400, 108), k('BROT', 10, 125), k('1,49', 400, 133)];
		expect(reihen(schief)).toEqual([
			[0, 1],
			[2, 3]
		]);
		// Versatz genau halbe Hoehe (10 bei Hoehe 20): getrennt — die Regel ist „kleiner als“.
		expect(reihen([k('KAESE', 10, 100), k('2,19', 400, 110)])).toEqual([[0], [1]]);
	});

	it('laesst Kaesten ohne Rahmen aus', () => {
		expect(reihen([{ text: 'OHNE' }, k('MIT', 10, 10)])).toEqual([[1]]);
	});
});

describe('reiheVon', () => {
	it('findet die Reihe eines Kastens', () => {
		expect(reiheVon(bon, 4)).toEqual([3, 4, 5]);
	});

	it('gibt ohne Rahmen nur den Kasten selbst', () => {
		expect(reiheVon([{ text: 'MILCH 1,09' }, { text: 'BROT' }], 1)).toEqual([1]);
	});
});

describe('randBetrag', () => {
	it('nimmt den Betrag vor dem Steuerkennzeichen', () => {
		expect(randBetrag(bon, [0, 1, 2])).toBe(109);
	});

	it('nimmt in der Mengenzeile den Betrag am Rand, nicht den Einzelpreis', () => {
		expect(randBetrag(bon, [3, 4, 5])).toBe(258);
	});

	it('liest ein nachgestelltes Minus als negativ', () => {
		expect(randBetrag(bon, [6, 7])).toBe(-25);
	});

	it('liest ein vorangestelltes Minus als negativ', () => {
		expect(randBetrag([k('RABATT', 10, 10), k('-0,50 A', 400, 10)], [0, 1])).toBe(-50);
	});

	it('ist null, wenn rechts kein Betrag steht', () => {
		expect(randBetrag([k('1,99', 10, 10), k('DANKE', 400, 10)], [0, 1])).toBeNull();
		expect(randBetrag([k('A', 460, 10, 15)], [0])).toBeNull();
	});

	// Gemessen 06.11.2026: PaddleOCR klebt das Kennzeichen oft an den Preis.
	it('liest einen Betrag mit angeklebtem Steuerkennzeichen', () => {
		expect(randBetrag([k('KAESE', 10, 10), k('1,99A', 400, 10)], [0, 1])).toBe(199);
		expect(randBetrag([k('KAESE', 10, 10), k('2,49AW', 400, 10)], [0, 1])).toBe(249);
		expect(randBetrag([k('KAESE', 10, 10), k('0,99EUR', 400, 10)], [0, 1])).toBe(99);
		expect(randBetrag([k('RABATT', 10, 10), k('0,50-B', 400, 10)], [0, 1])).toBe(-50);
		expect(ortImBild([k('2 x 1,29B', 10, 10, 200)], 129)).toBe('rand');
	});

	it('liest Mengenangaben im Namen nicht als angeklebtes Kennzeichen', () => {
		expect(randBetrag([k('COLA 0,75L', 10, 10, 200)], [0])).toBeNull();
		expect(ortImBild([k('COLA 0,75Liter', 10, 10, 200)], 75)).toBe('nirgends');
	});

	it('nimmt bei einem Kasten fuer die ganze Zeile den letzten Betrag', () => {
		expect(randBetrag([k('2 x 1,29 2,58 B', 10, 10, 480)], [0])).toBe(258);
	});
});

describe('ortImBild', () => {
	it('unterscheidet Rand, Mitte und nirgends', () => {
		expect(ortImBild(bon, 129)).toBe('mitte');
		expect(ortImBild(bon, 258)).toBe('rand');
		expect(ortImBild(bon, 999)).toBe('nirgends');
	});

	it('vergleicht ohne Vorzeichen', () => {
		expect(ortImBild(bon, -25)).toBe('rand');
		expect(ortImBild(bon, 25)).toBe('rand');
	});
});
