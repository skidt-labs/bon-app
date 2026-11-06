import { describe, it, expect } from 'vitest';
import { abweichungInZeile } from './betraege';

const k = (text: string, x: number, y: number, w = 60, h = 20) => ({ text, box: [x, y, w, h] as [number, number, number, number] });

describe('abweichungInZeile mit Kaesten (Reihe statt einzelner Kasten)', () => {
	// Die Position ist dem Namenskasten zugeordnet; der Preis steht im Kasten daneben,
	// das Steuerkennzeichen ganz rechts. Gelesen wurde der Einzelpreis.
	const kaesten = [k('2 x 1,29', 10, 100, 120), k('2,58', 400, 101), k('B', 460, 100, 15), k('SAFT', 10, 130), k('1,99', 400, 130)];

	it('nennt den Randbetrag der eigenen Reihe', () => {
		expect(abweichungInZeile(kaesten, 0, 129, null)).toBe(258);
	});

	it('nennt ihn auch, wenn der Einzelpreis gespeichert ist', () => {
		expect(abweichungInZeile(kaesten, 0, 129, 129)).toBe(258);
	});

	it('ist null, wenn der Randbetrag stimmt', () => {
		expect(abweichungInZeile(kaesten, 0, 258, 129)).toBeNull();
	});

	it('nennt den Randbetrag, wenn der Namenskasten selbst keinen Betrag traegt', () => {
		expect(abweichungInZeile(kaesten, 3, 258, null)).toBe(199);
	});

	it('vergleicht ohne Vorzeichen und nennt den Betrag ohne Vorzeichen', () => {
		const pfand = [k('PFAND', 10, 10), k('0,25-', 400, 10)];
		expect(abweichungInZeile(pfand, 0, -25, null)).toBeNull();
		expect(abweichungInZeile(pfand, 0, -50, null)).toBe(25);
	});

	it('faellt ohne Randbetrag auf die alte Regel zurueck (Preis in der Zeile darunter)', () => {
		const zeilen = [k('KARTOFFELN 2.5KG', 10, 10, 200), k('2,49 €', 400, 40)];
		expect(abweichungInZeile(zeilen, 0, 622, 249)).toBe(249);
	});
});
