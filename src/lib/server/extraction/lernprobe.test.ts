import { describe, it, expect } from 'vitest';
import { lernprobe, type LernBon } from './lernprobe';
import type { LineType } from '$lib/bons/zeilenarten';

const k = (text: string, x: number, y: number, w = 60, h = 20) => ({ text, box: [x, y, w, h] as [number, number, number, number] });
const m = (rawText: string, totalPriceCents: number, lineType: LineType = 'article') => ({
	rawText,
	lineType,
	totalPriceCents,
	unitPriceCents: null
});
const b = (rawText: string, totalPriceCents: number, lineType: LineType = 'article') => ({ rawText, lineType, totalPriceCents });

// Erfundene Bons. Je Fall steht dabei, was die Lernprobe zaehlen soll.
const bon1: LernBon = {
	kaesten: [
		k('APFELSAFT NATURTRUEB', 10, 100, 200),
		k('1,99', 400, 100),
		k('A', 460, 100, 15),
		k('2 x 1,29', 10, 130, 120),
		k('ORANGEN NETZ', 140, 130, 150),
		k('2,58', 400, 131),
		k('A', 460, 130, 15),
		k('VOLLKORNBROT', 10, 160, 150),
		k('3,49', 400, 160),
		k('A', 460, 160, 15),
		k('RABATT VOLLKORNBROT', 10, 190, 200),
		k('0,50-', 400, 190)
	],
	modellItems: [
		m('APFELSAFT NATURTRUEB', 379), // nirgends → automatisch richtig
		m('ORANGEN NETZ', 129), // Mitte → automatisch richtig
		m('VOLLKORNBROT', 258), // Rand einer anderen Zeile → kein Eingriff, Hinweis richtig
		m('RABATT VOLLKORNBROT', -50, 'discount') // stimmt
	],
	items: [
		b('APFELSAFT NATURTRUEB', 199),
		b('ORANGEN NETZ', 258),
		b('VOLLKORNBROT', 349),
		b('RABATT VOLLKORNBROT', -50, 'discount')
	]
};

const bon2: LernBon = {
	kaesten: [
		k('KAESE GOUDA', 10, 10, 150),
		k('2,19', 400, 10),
		k('BUTTER', 10, 40, 100),
		k('1,89', 400, 40),
		k('EIER', 10, 70),
		k('2,49', 400, 70),
		k('JOGHURT', 10, 100, 100),
		k('2,99', 400, 100)
	],
	modellItems: [
		m('KAESE GOUDA', 319), // war richtig (von Hand bestaetigt), wird veraendert
		m('BUTTER', 179), // war falsch, wird auf einen anderen falschen Wert gesetzt
		m('EIER', 299), // richtig, steht als Rand von JOGHURT → Hinweis ueberfluessig
		m('JOGHURT', 299), // stimmt
		m('TOMATEN', 99) // ohne Partner (umbenannt) → zaehlt nicht
	],
	items: [b('KAESE GOUDA', 319), b('BUTTER', 199), b('EIER', 299), b('JOGHURT', 299), b('TOMATEN ROT', 129)]
};

describe('lernprobe', () => {
	it('zaehlt Eingriffe, Hinweise und Korrekturen ueber gepaarte Positionen', () => {
		expect(lernprobe([bon1, bon2])).toEqual({
			bons: 2,
			paare: 8,
			preisKorrekturen: 4,
			automatisch: { richtig: 2, falsch: 1, richtigeVeraendert: 1 },
			hinweis: { richtig: 1, ueberfluessig: 1 }
		});
	});

	it('paart gleiche Texte der Reihe nach, Gross/Klein und Leerraum egal', () => {
		const z = lernprobe([
			{
				kaesten: [],
				modellItems: [m('milch  1,5 %', 109), m('MILCH 1,5 %', 109)],
				items: [b('MILCH 1,5 %', 109), b('Milch 1,5 %', 119)]
			}
		]);
		expect(z.paare).toBe(2);
		expect(z.preisKorrekturen).toBe(1);
	});

	it('ist bei leerer Eingabe ueberall 0', () => {
		expect(lernprobe([])).toEqual({
			bons: 0,
			paare: 0,
			preisKorrekturen: 0,
			automatisch: { richtig: 0, falsch: 0, richtigeVeraendert: 0 },
			hinweis: { richtig: 0, ueberfluessig: 0 }
		});
	});
});
