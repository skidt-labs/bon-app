import { describe, it, expect } from 'vitest';
import { alsCsv, csvFeld } from './csv';

const zeile = {
	datum: '2026-09-17',
	haendler: 'ALDI',
	bonId: 'r1',
	lineNo: 1,
	rawText: 'BIO MILCH',
	lineType: 'article',
	quantity: '1',
	unit: 'stk',
	unitPriceCents: 109,
	totalPriceCents: 109,
	kategorie: 'Milchprodukte & Eier',
	oberkategorie: 'Lebensmittel'
};

describe('csvFeld', () => {
	// Semikolon ist das Trennzeichen (deutsches Excel). Ein Semikolon im Text muss
	// deshalb in Anfuehrungszeichen, sonst verrutscht die ganze Zeile.
	it('setzt Felder mit Trennzeichen, Anfuehrungszeichen oder Umbruch in Anfuehrungszeichen', () => {
		expect(csvFeld('Milch; Butter')).toBe('"Milch; Butter"');
		expect(csvFeld('12" Pizza')).toBe('"12"" Pizza"');
		expect(csvFeld('Zeile1\nZeile2')).toBe('"Zeile1\nZeile2"');
	});

	it('laesst harmlose Felder in Ruhe', () => {
		expect(csvFeld('BIO MILCH')).toBe('BIO MILCH');
	});

	it('macht aus null ein leeres Feld, nicht das Wort null', () => {
		expect(csvFeld(null)).toBe('');
	});
});

describe('alsCsv', () => {
	it('beginnt mit einer Kopfzeile und trennt mit Semikolon', () => {
		const zeilen = alsCsv([zeile]).split('\r\n');
		expect(zeilen[0].split(';')).toContain('Bezeichnung');
		expect(zeilen[0].split(';').length).toBe(zeilen[1].split(';').length);
	});

	/**
	 * Beträge zweimal: als Dezimalzahl mit KOMMA, damit deutsches Excel sie als Zahl
	 * erkennt, und als ganzzahliger Cent, damit nachrechnen ohne Rundung geht. Wer nur
	 * die Dezimalspalte hat, addiert Gleitkommazahlen — und genau das ist die
	 * Fehlerquelle, die dieses Projekt an jeder Stelle vermeidet.
	 */
	it('schreibt Betraege als Komma-Dezimalzahl UND als Cent', () => {
		const spalten = alsCsv([zeile]).split('\r\n')[1].split(';');
		expect(spalten).toContain('1,09');
		expect(spalten).toContain('109');
	});

	it('schreibt negative Betraege mit Komma', () => {
		const spalten = alsCsv([{ ...zeile, totalPriceCents: -50, unitPriceCents: null }])
			.split('\r\n')[1]
			.split(';');
		expect(spalten).toContain('-0,50');
		expect(spalten).toContain('-50');
	});

	it('gibt auch ohne Zeilen eine Kopfzeile aus', () => {
		expect(alsCsv([]).split('\r\n')[0]).toContain('Datum');
	});

	// Zeilenumbrueche als CRLF: das erwarten Excel und die CSV-Festlegung (RFC 4180).
	it('trennt die Zeilen mit CRLF', () => {
		expect(alsCsv([zeile])).toContain('\r\n');
	});
});
