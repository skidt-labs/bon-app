import { describe, it, expect } from 'vitest';
import { mengeAusText, partnerFuerMengenreihe, mengenVorschlag } from './mengenzeilen';
import { reihen, type Kasten } from './reihen';

/** Ein Kasten wie von PaddleOCR: Text und Rahmen [x, y, Breite, Hoehe]. */
const k = (text: string, x: number, y: number, w = 60, h = 20): Kasten => ({ text, box: [x, y, w, h] });

describe('mengeAusText', () => {
	it('liest Stueckzahl mal Preis', () => {
		expect(mengeAusText('2 x 1,09')).toEqual({ menge: '2', einheit: 'stk', einzelCents: 109, produktCents: 218 });
		expect(mengeAusText('2 X 1,09 = 2,18')).toEqual({ menge: '2', einheit: 'stk', einzelCents: 109, produktCents: 218 });
		expect(mengeAusText('2 × 1,09')).toEqual({ menge: '2', einheit: 'stk', einzelCents: 109, produktCents: 218 });
		expect(mengeAusText('2 Stk x 1,09')).toEqual({ menge: '2', einheit: 'stk', einzelCents: 109, produktCents: 218 });
	});

	it('liest Gewicht mal Kilopreis', () => {
		expect(mengeAusText('0,532 kg x 2,99 EUR/kg')).toEqual({
			menge: '0.532',
			einheit: 'kg',
			einzelCents: 299,
			produktCents: 159
		});
		expect(mengeAusText('0,532 kg × 2,99 €/kg')).toEqual({
			menge: '0.532',
			einheit: 'kg',
			einzelCents: 299,
			produktCents: 159
		});
	});

	it('nimmt Artikelzeilen nicht als Mengenzeile', () => {
		expect(mengeAusText('MILCH 1,5% 1,09')).toBeNull();
		expect(mengeAusText('COLA MIX/ZERO1,5')).toBeNull();
		expect(mengeAusText('1,09')).toBeNull();
	});
});

describe('partnerFuerMengenreihe', () => {
	it('Mengenzeile unter der Ware: Partner oben', () => {
		const bon = [k('BROETCHEN', 10, 100, 200), k('2,58', 400, 100), k('2 x 1,29', 30, 130, 120), k('BUTTER', 10, 160, 200), k('1,99', 400, 160)];
		const rs = reihen(bon);
		const p = partnerFuerMengenreihe(bon, rs, 1);
		expect(p).toMatchObject({ randCents: 258, richtung: 'oben' });
		expect(p?.reihe).toEqual(rs[0]);
	});

	it('Mengenzeile ueber der Ware: Partner unten', () => {
		const bon = [k('BUTTER', 10, 100, 200), k('1,99', 400, 100), k('2 x 1,29', 30, 130, 120), k('BROETCHEN', 10, 160, 200), k('2,58', 400, 160)];
		const rs = reihen(bon);
		expect(partnerFuerMengenreihe(bon, rs, 1)).toMatchObject({ randCents: 258, richtung: 'unten' });
	});

	it('Ergebnis in derselben Zeile: Partner ist die Zeile selbst', () => {
		const bon = [k('BROETCHEN', 10, 100, 200), k('2 x 1,29', 30, 130, 120), k('2,58', 400, 130), k('BUTTER', 10, 160, 200), k('1,99', 400, 160)];
		const rs = reihen(bon);
		expect(partnerFuerMengenreihe(bon, rs, 1)).toMatchObject({ randCents: 258, richtung: 'selbst' });
	});

	it('beide Nachbarn passen: kein Partner', () => {
		const bon = [k('A-WARE', 10, 100, 200), k('2,58', 400, 100), k('2 x 1,29', 30, 130, 120), k('B-WARE', 10, 160, 200), k('2,58', 400, 160)];
		expect(partnerFuerMengenreihe(bon, reihen(bon), 1)).toBeNull();
	});

	it('kein Nachbar passt: kein Partner', () => {
		const bon = [k('A-WARE', 10, 100, 200), k('2,59', 400, 100), k('2 x 1,29', 30, 130, 120), k('B-WARE', 10, 160, 200), k('1,99', 400, 160)];
		expect(partnerFuerMengenreihe(bon, reihen(bon), 1)).toBeNull();
	});

	it('eine Reihe ohne Mengenangabe hat keinen Partner', () => {
		const bon = [k('A-WARE', 10, 100, 200), k('2,58', 400, 100)];
		expect(partnerFuerMengenreihe(bon, reihen(bon), 0)).toBeNull();
	});
});

describe('mengenVorschlag', () => {
	const unten = [k('BROETCHEN', 10, 100, 200), k('2,58', 400, 100), k('2 x 1,29', 30, 130, 120), k('BUTTER', 10, 160, 200), k('1,99', 400, 160)];

	it('findet die Mengenzeile unter der Ware', () => {
		expect(mengenVorschlag(unten, 0, 258)).toMatchObject({ menge: '2', einzelCents: 129, richtung: 'unten' });
	});

	it('findet die Mengenzeile ueber der Ware', () => {
		const oben = [k('BUTTER', 10, 100, 200), k('1,99', 400, 100), k('2 x 1,29', 30, 130, 120), k('BROETCHEN', 10, 160, 200), k('2,58', 400, 160)];
		expect(mengenVorschlag(oben, 3, 258)).toMatchObject({ menge: '2', einzelCents: 129, richtung: 'oben' });
	});

	it('Rabatt: Betrag ohne Vorzeichen verglichen', () => {
		expect(mengenVorschlag(unten, 0, -258)).not.toBeNull();
	});

	it('nichts fuer die Ware, zu der die Mengenzeile nicht gehoert', () => {
		expect(mengenVorschlag(unten, 3, 199)).toBeNull();
	});

	it('nichts, wenn der Betrag nicht zum Produkt passt', () => {
		expect(mengenVorschlag(unten, 0, 300)).toBeNull();
	});

	it('Ergebnis auf der Mengenzeile: Vorschlag fuer die Position mit Bildzeile dort', () => {
		const selbst = [k('BROETCHEN', 10, 100, 200), k('2 x 1,29', 30, 130, 120), k('2,58', 400, 130)];
		expect(mengenVorschlag(selbst, 2, 258)).toMatchObject({ menge: '2', richtung: 'selbst' });
	});

	// Abschlusspruefung 0.13.0, I2: die naechste Ware mit eigenem Betrag bekommt den Vorschlag nicht.
	it('Mengenzeile mit Betrag: kein Vorschlag fuer die Ware darunter mit eigenem Betrag', () => {
		const bon = [k('H-MILCH 3,5%', 10, 100, 200), k('2 x 1,09', 30, 130, 120), k('2,18', 400, 130), k('BUTTER', 10, 160, 200), k('2,18', 400, 160)];
		expect(mengenVorschlag(bon, 3, 218)).toBeNull();
		expect(mengenVorschlag(bon, 0, 218)).toMatchObject({ menge: '2', richtung: 'unten' });
	});
});

