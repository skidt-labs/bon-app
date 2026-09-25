import { describe, it, expect } from 'vitest';
import { mengeAlsZahl, rechenprobe } from './rechenprobe';
import type { EditorZeile } from './editor';

const z = (over: Partial<EditorZeile>): EditorZeile => ({
	id: 'x',
	lineNo: 1,
	rawText: 'X',
	lineType: 'article',
	quantity: '1',
	unit: null,
	unitPriceCents: null,
	totalPriceCents: 0,
	vatClass: null,
	appliesToLine: null,
	categoryId: null,
	ocrZeile: null,
	...over
});

describe('mengeAlsZahl', () => {
	it('liest Komma und Punkt gleichermassen', () => {
		expect(mengeAlsZahl('1')).toBe(1);
		expect(mengeAlsZahl('2,5')).toBe(2.5);
		expect(mengeAlsZahl('2.5')).toBe(2.5);
		expect(mengeAlsZahl('0.654')).toBeCloseTo(0.654, 3);
	});

	it('vertraegt Leerraum und eine angehaengte Einheit', () => {
		expect(mengeAlsZahl(' 2,5 kg ')).toBe(2.5);
		expect(mengeAlsZahl('3 Stk')).toBe(3);
	});

	// Was sich nicht eindeutig lesen laesst, ist null — nicht 0. Eine Null waere eine
	// Behauptung, und die Rechenprobe wuerde daraus einen falschen Hinweis bauen.
	it('ist null, wenn nichts Eindeutiges dasteht', () => {
		expect(mengeAlsZahl(null)).toBeNull();
		expect(mengeAlsZahl('')).toBeNull();
		expect(mengeAlsZahl('ca.')).toBeNull();
		expect(mengeAlsZahl('0')).toBeNull();
		expect(mengeAlsZahl('-2')).toBeNull();
	});
});

describe('rechenprobe', () => {
	// Der Fall vom ALDI-Bon (17.09.2026): im Bild steht "COLA MIX/ZERO1,5" — die 1,5 ist
	// die Gebindegroesse, von PaddleOCR ohne Leerzeichen an den Namen geklebt. Das Modell
	// machte daraus einen Einzelpreis von 1,50 EUR, waehrend der Bon 0,65 EUR druckt.
	// 1 x 1,50 ergibt nicht 0,65 — die Zeile widerspricht sich selbst.
	it('meldet den erfundenen Einzelpreis der Cola-Zeile', () => {
		expect(rechenprobe(z({ quantity: '1', unitPriceCents: 150, totalPriceCents: 65 }))).toEqual({
			erwartet: 150
		});
	});

	it('schweigt, wenn die Rechnung aufgeht', () => {
		expect(rechenprobe(z({ quantity: '2', unitPriceCents: 69, totalPriceCents: 138 }))).toBeNull();
		expect(rechenprobe(z({ quantity: '1', unitPriceCents: 25, totalPriceCents: 25 }))).toBeNull();
	});

	// Gewichtsware rundet: 2,5 x 2,49 = 6,225, gespeichert sind 6,22. Ein Cent Spielraum,
	// sonst meldete die Probe bei jedem Kilopreis einen Fehler, der keiner ist.
	it('laesst dem Runden einen Cent Spielraum', () => {
		expect(rechenprobe(z({ quantity: '2.5', unitPriceCents: 249, totalPriceCents: 622 }))).toBeNull();
		expect(
			rechenprobe(z({ quantity: '0.654', unitPriceCents: 129, totalPriceCents: 84 }))
		).toBeNull();
	});

	// Ohne Einzelpreis gibt es nichts zu rechnen — und das ist der NORMALFALL: die
	// meisten Bons drucken nur den Endpreis. Ein Hinweis darauf waere Laerm.
	it('schweigt ohne Einzelpreis und ohne lesbare Menge', () => {
		expect(rechenprobe(z({ quantity: '1', unitPriceCents: null, totalPriceCents: 65 }))).toBeNull();
		expect(rechenprobe(z({ quantity: null, unitPriceCents: 150, totalPriceCents: 65 }))).toBeNull();
		expect(rechenprobe(z({ quantity: 'ca.', unitPriceCents: 150, totalPriceCents: 65 }))).toBeNull();
	});

	it('rechnet bei Rabatten mit den Betraegen, nicht mit den Vorzeichen', () => {
		expect(
			rechenprobe(z({ lineType: 'discount', quantity: '1', unitPriceCents: -50, totalPriceCents: -50 }))
		).toBeNull();
		expect(
			rechenprobe(z({ lineType: 'discount', quantity: '1', unitPriceCents: -50, totalPriceCents: -25 }))
		).toEqual({ erwartet: 50 });
	});

	// Bei Infozeilen ist der Betrag ohne Bedeutung; dort zu rechnen waere sinnlos.
	it('schweigt bei Zeilen, die kein Geld tragen', () => {
		expect(
			rechenprobe(z({ lineType: 'info', quantity: '1', unitPriceCents: 150, totalPriceCents: 65 }))
		).toBeNull();
	});
});
