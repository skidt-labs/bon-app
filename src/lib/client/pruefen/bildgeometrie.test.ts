import { describe, it, expect } from 'vitest';
import {
	rahmenAus,
	alsAnteil,
	ansichtAufRahmen,
	rahmenUnterPunkt,
	naechsteZoomStufe,
	ZOOM_STUFEN
} from './bildgeometrie';

const bild = { breite: 1000, hoehe: 4000 };

describe('rahmenAus und alsAnteil', () => {
	it('macht aus der OCR-Box ein benanntes Rechteck', () => {
		expect(rahmenAus([10, 20, 100, 14])).toEqual({ x: 10, y: 20, breite: 100, hoehe: 14 });
	});

	// Anteile statt Pixel: die Rahmen sitzen dann richtig, egal wie gross das Bild
	// dargestellt wird — ohne dass die Komponente bei jedem Zoom neu rechnet.
	it('rechnet in Anteile des Bildes um', () => {
		expect(alsAnteil({ x: 500, y: 2000, breite: 250, hoehe: 40 }, bild)).toEqual({
			x: 0.5,
			y: 0.5,
			breite: 0.25,
			hoehe: 0.01
		});
	});

	it('vertraegt ein Bild ohne Groesse, ohne durch null zu teilen', () => {
		expect(alsAnteil({ x: 10, y: 10, breite: 5, hoehe: 5 }, { breite: 0, hoehe: 0 })).toEqual({
			x: 0,
			y: 0,
			breite: 0,
			hoehe: 0
		});
	});
});

describe('ansichtAufRahmen', () => {
	const sicht = { breite: 440, hoehe: 700 };

	// Die Zeile soll in der Mitte des Sichtfensters stehen, nicht am Rand: so sieht man
	// die Zeilen darueber und darunter mit — das ist beim Pruefen die halbe Information.
	it('zentriert die Zeile im Sichtfenster', () => {
		const { oben } = ansichtAufRahmen({ x: 0, y: 2000, breite: 1000, hoehe: 40 }, bild, sicht, 1);
		// Bild auf Sichtbreite skaliert: 440/1000 = 0,44 → Zeile liegt bei 2000*0,44 = 880
		// Mittig: 880 + 0,44*40/2 − 700/2 = 880 + 8,8 − 350 = 538,8
		expect(oben).toBeCloseTo(538.8, 1);
	});

	// Oben und unten wird nicht ueber den Rand gescrollt — sonst steht das Bild
	// halb im Leeren, und der Mensch sucht, wo es hin ist.
	it('bleibt an den Raendern stehen', () => {
		expect(ansichtAufRahmen({ x: 0, y: 0, breite: 1000, hoehe: 40 }, bild, sicht, 1).oben).toBe(0);
		const unten = ansichtAufRahmen({ x: 0, y: 3960, breite: 1000, hoehe: 40 }, bild, sicht, 1).oben;
		expect(unten).toBeCloseTo(440 * 4 - 700, 0); // Bildhoehe skaliert (1760) minus Sichthoehe
	});

	// Bei zoom 1 passt das Bild genau in die Breite, es gibt nichts seitlich zu rollen.
	// Erst gezoomt wird die Waagerechte interessant — und dann gilt dasselbe:
	// mittig, aber nicht ueber den Rand.
	it('zentriert auch waagerecht, sobald gezoomt wird', () => {
		const mitte = { x: 400, y: 0, breite: 100, hoehe: 40 };
		expect(ansichtAufRahmen(mitte, bild, sicht, 1).links).toBe(0); // nichts zu rollen
		// zoom 2: Massstab 0,88 → Mitte der Zeile bei 450*0,88 = 396; 396 − 220 = 176
		expect(ansichtAufRahmen(mitte, bild, sicht, 2).links).toBeCloseTo(176, 0);
		// Ganz rechts wird am Rand abgeschnitten: 1000*0,88 − 440 = 440
		expect(ansichtAufRahmen({ x: 960, y: 0, breite: 40, hoehe: 40 }, bild, sicht, 2).links).toBeCloseTo(440, 0);
	});
});

describe('rahmenUnterPunkt', () => {
	const zeilen = [
		{ box: [0, 0, 100, 20] as [number, number, number, number] },
		{ box: [0, 30, 100, 20] as [number, number, number, number] }
	];
	it('findet die Zeile unter dem Punkt', () => {
		expect(rahmenUnterPunkt(zeilen, { x: 50, y: 10 })).toBe(0);
		expect(rahmenUnterPunkt(zeilen, { x: 50, y: 35 })).toBe(1);
	});
	it('ist null zwischen den Zeilen und ausserhalb', () => {
		expect(rahmenUnterPunkt(zeilen, { x: 50, y: 25 })).toBeNull();
		expect(rahmenUnterPunkt(zeilen, { x: 500, y: 10 })).toBeNull();
	});
	// Ueberlappen zwei Rahmen, gewinnt der kleinere: er ist der genauere Treffer.
	it('nimmt bei Ueberlappung den kleineren Rahmen', () => {
		const zwei = [
			{ box: [0, 0, 200, 100] as [number, number, number, number] },
			{ box: [10, 10, 50, 20] as [number, number, number, number] }
		];
		expect(rahmenUnterPunkt(zwei, { x: 20, y: 15 })).toBe(1);
	});
});

describe('Zoom', () => {
	it('geht die Stufen hoch und runter und bleibt an den Enden', () => {
		expect(naechsteZoomStufe(1, 1)).toBe(ZOOM_STUFEN[ZOOM_STUFEN.indexOf(1) + 1]);
		expect(naechsteZoomStufe(ZOOM_STUFEN[0], -1)).toBe(ZOOM_STUFEN[0]);
		expect(naechsteZoomStufe(ZOOM_STUFEN[ZOOM_STUFEN.length - 1], 1)).toBe(
			ZOOM_STUFEN[ZOOM_STUFEN.length - 1]
		);
	});
	it('findet zu einem Zwischenwert die naechste Stufe', () => {
		expect(naechsteZoomStufe(1.05, 1)).toBeGreaterThan(1.05);
		expect(naechsteZoomStufe(1.05, -1)).toBeLessThan(1.05);
	});
});
