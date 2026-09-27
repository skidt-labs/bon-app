import { describe, it, expect } from 'vitest';
import { keinKassenbon } from './kein-bon';
import { keinBonCode } from '$lib/bons/beanstandungen';

const ECHTER_BON_MIT_KARTE = [
	'Musterladen',
	'Brot 2,49 A',
	'Milch 1,19 B',
	'Butter 2,29 B',
	'Kaese 3,49 B',
	'Aepfel 1,99 B',
	'Kaffee 5,99 A',
	'SUMME 17,44',
	'Kartenzahlung girocard',
	'Terminal-ID 12345678',
	'Genehmigung 123456',
	'Betrag EUR 17,44'
].join('\n');

describe('keinKassenbon', () => {
	it('erkennt ein Bild ohne Text', () => {
		expect(keinKassenbon('')).toBe('kein_bon_leer');
		expect(keinKassenbon('  \n ')).toBe('kein_bon_leer');
		expect(keinKassenbon('a b c')).toBe('kein_bon_leer');
	});

	it('erkennt Text ohne einen einzigen Preis', () => {
		const brief = 'Sehr geehrte Damen und Herren,\nwir bestätigen Ihren Termin am Montag.\nMit freundlichen Grüßen';
		expect(keinKassenbon(brief)).toBe('kein_bon_ohne_preise');
	});

	it('erkennt einen Kartenbeleg vom Terminal', () => {
		const beleg = 'Kundenbeleg\nKartenzahlung girocard\nTerminal-ID 12345678\nBetrag EUR 23,40\nGenehmigung 123456\nKopie für Kunde';
		expect(keinKassenbon(beleg)).toBe('kein_bon_kartenbeleg');
	});

	// Der wichtigste Fall: ein echter Einkauf mit Zahlungsteil traegt dieselben Woerter.
	it('laesst einen echten Bon mit Kartenzahlungsteil in Ruhe', () => {
		expect(keinKassenbon(ECHTER_BON_MIT_KARTE)).toBeNull();
	});

	it('laesst eine Rechnung in Ruhe', () => {
		const rechnung = 'Rechnung Nr. 4711\nArbeitszeit 2 Std 90,00\nMaterial 35,50\nSumme netto 125,50\nMwSt 19% 23,85\nGesamt 149,35';
		expect(keinKassenbon(rechnung)).toBeNull();
	});

	// Pruefung 27.09.2026: bei ein, zwei Artikeln ist Artikelpreis = Summe = Kartenbetrag —
	// die Zahl der Betraege allein trennt Kleinbon und Kartenbeleg nicht.
	it('laesst einen Baeckerbon mit einem Artikel und Kartenzahlung in Ruhe', () => {
		const bon = 'Baeckerei Beispiel\nLaugenbrezel 0,95\nSUMME EUR 0,95\ninkl. 7% MwSt\nKartenzahlung girocard\nTerminal-ID 12345678\nGenehmigung 123456';
		expect(keinKassenbon(bon)).toBeNull();
	});

	it('laesst einen Cafe-Bon mit kontaktloser Kartenzahlung in Ruhe', () => {
		const bon = 'Cafe Muster\nCappuccino 3,40\nGesamt 3,40\nVISA CONTACTLESS\nTrace-Nr 4711';
		expect(keinKassenbon(bon)).toBeNull();
	});

	it('laesst zwei gleiche Broetchen mit Karte in Ruhe', () => {
		const bon = 'Baeckerei Beispiel\n2 x Broetchen 0,45\n0,90\nSUMME 0,90\ngirocard kontaktlos\nTerminal 1';
		expect(keinKassenbon(bon)).toBeNull();
	});

	it('erkennt einen Kartenbeleg auch mit Summenzeile', () => {
		const beleg = 'Kundenbeleg\ngirocard kontaktlos\nTerminal-ID 12345678\nSumme EUR 23,40\nBetrag EUR 23,40\nGenehmigung 123456';
		expect(keinKassenbon(beleg)).toBe('kein_bon_kartenbeleg');
	});

	it('zaehlt 15 Zeichen ohne Leerraum als Text, 14 nicht', () => {
		expect(keinKassenbon('abcdefghijklmn')).toBe('kein_bon_leer');
		expect(keinKassenbon('abcdefghijklmno')).toBe('kein_bon_ohne_preise');
	});

	it('braucht zwei verschiedene Kartenwoerter', () => {
		expect(keinKassenbon('Terminal 3 an der Kasse\nBetrag 5,00')).toBeNull();
	});
});

describe('keinBonCode', () => {
	it('findet den Kein-Bon-Code unter den Beanstandungen', () => {
		expect(keinBonCode(['sum_mismatch', 'kein_bon_kartenbeleg'])).toBe('kein_bon_kartenbeleg');
	});
	it('liefert null ohne Code', () => {
		expect(keinBonCode(null)).toBeNull();
		expect(keinBonCode(['sum_mismatch'])).toBeNull();
	});
});
