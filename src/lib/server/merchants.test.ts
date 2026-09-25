import { describe, it, expect } from 'vitest';
import { normalisiereHaendler } from './merchants';

describe('normalisiereHaendler', () => {
	// Bons drucken denselben Laden in vielen Schreibweisen. Ohne Normalisierung
	// entstuenden fuer "LIDL", "Lidl Dienstleistung GmbH" und "lidl  musterstadt" drei
	// verschiedene Haendler — und drei getrennte Lerngedaechtnisse.
	it('fasst Schreibweisen desselben Haendlers zusammen', () => {
		const erwartet = normalisiereHaendler('Lidl');
		for (const schreibweise of ['LIDL', 'lidl', '  Lidl  ', 'Lidl.']) {
			expect(normalisiereHaendler(schreibweise), schreibweise).toBe(erwartet);
		}
	});

	it('entfernt Rechtsformen und Filialzusaetze', () => {
		const lidl = normalisiereHaendler('Lidl');
		expect(normalisiereHaendler('Lidl Dienstleistung GmbH & Co. KG')).toBe(lidl);
		expect(normalisiereHaendler('ALDI SÜD GmbH')).toBe(normalisiereHaendler('Aldi Süd'));
	});

	it('haelt verschiedene Haendler auseinander', () => {
		expect(normalisiereHaendler('Aldi Süd')).not.toBe(normalisiereHaendler('Aldi Nord'));
		expect(normalisiereHaendler('Edeka')).not.toBe(normalisiereHaendler('Rewe'));
	});

	// Umlaute duerfen nicht verschwinden: "Muller" und "Müller" sind verschiedene Laeden.
	it('behaelt Umlaute als unterscheidendes Merkmal', () => {
		expect(normalisiereHaendler('Müller')).not.toBe(normalisiereHaendler('Muller'));
	});

	it('ergibt fuer einen leeren Namen einen leeren Schluessel', () => {
		expect(normalisiereHaendler('   ')).toBe('');
		expect(normalisiereHaendler('GmbH')).toBe('');
	});

	// Review Task 1, Befund 2: Bindestrich/Gedankenstrich und Et-Zeichen-Abstand
	// wurden bisher nicht vereinheitlicht — dieselbe Bug-Klasse wie beim Punkt-Problem,
	// nur an anderer Stelle. Ein direkt per Bindestrich angehaengtes Zusatzwort war ein
	// einziges Token und traf die ZUSAETZE-Wortgrenzen-Erkennung nie.
	it('vereinheitlicht Bindestrich vor einem Rechtsform-Zusatz (Lidl-Fall aus dem Review)', () => {
		// Echter Zusatz auf deutschen Lidl-Kassenbons: Rechtsform per Bindestrich an
		// den Namen angehaengt statt mit Leerzeichen.
		expect(normalisiereHaendler('Lidl Vertriebs-GmbH & Co. KG')).toBe(normalisiereHaendler('Lidl'));
	});

	it('vereinheitlicht Bindestrich-Gedankenstrich-Schreibweisen ("real,- GmbH")', () => {
		expect(normalisiereHaendler('real,- GmbH')).toBe(normalisiereHaendler('real'));
	});

	it('behandelt "H&M" und "H & M" gleich', () => {
		expect(normalisiereHaendler('H&M')).toBe(normalisiereHaendler('H & M'));
	});

	it('behandelt "Aldi-Süd" und "Aldi Süd" gleich', () => {
		expect(normalisiereHaendler('Aldi-Süd')).toBe(normalisiereHaendler('Aldi Süd'));
	});

	// Ausdruecklich NICHT Teil dieser Behebung (siehe Kommentar bei ZUSAETZE_ROH in
	// merchants.ts): eine Kurzform auf einen Rechtsnamen abzubilden ist Raten, keine
	// Normalisierung. Das gehoert in eine spaetere Alias-Verwaltung.
	it('bildet "dm-drogerie markt" NICHT auf die Kurzform "dm" ab', () => {
		expect(normalisiereHaendler('dm-drogerie markt')).not.toBe(normalisiereHaendler('dm'));
	});

	// Gegenprobe: der Bindestrich-Fix darf die Normalisierung nicht zu gierig machen.
	// Diese Faelle muessen nach dem Fix weiterhin auseinandergehalten werden.
	it('haelt Bindestrich-Varianten verschiedener Haendler weiterhin auseinander', () => {
		expect(normalisiereHaendler('Aldi-Süd')).not.toBe(normalisiereHaendler('Aldi-Nord'));
		expect(normalisiereHaendler('Edeka-Müller Musterstadt')).not.toBe(normalisiereHaendler('Edeka'));
		expect(normalisiereHaendler('Rewe-Center')).not.toBe(normalisiereHaendler('Rewe'));
		expect(normalisiereHaendler('Netto Marken-Discount')).not.toBe(normalisiereHaendler('Netto'));
	});

	// Ein Name, der nach Entfernen aller Zusaetze leer wuerde, darf auch mit
	// Bindestrich-Schreibweise keinen Haendler-Schluessel ergeben — sonst koennte
	// haendlerAufloesen() daraus faelschlich eine Zeile anlegen.
	it('ergibt fuer einen reinen Zusatz mit Bindestrich weiterhin einen leeren Schluessel', () => {
		expect(normalisiereHaendler('Vertriebs-GmbH')).toBe('');
		expect(normalisiereHaendler('Vertriebs-GmbH & Co. KG')).toBe('');
	});

	// Ein Schluessel, der nur aus Interpunktion besteht, darf keinen Haendler ergeben:
	// haendlerAufloesen() legt sonst eine Zeile an, an der spaeter Kategorien haengen.
	it('ergibt fuer reine Interpunktion einen leeren Schluessel', () => {
		expect(normalisiereHaendler('- & -')).toBe('');
		expect(normalisiereHaendler('&')).toBe('');
		expect(normalisiereHaendler('...')).toBe('');
	});

	// Dieselbe Unicode-Falle wie in normalisiereRohtext, hier aber noch heimtueckischer:
	// beide Ergebnisse schreiben sich "müller" und sind doch verschieden. Das ergaebe
	// zwei merchants-Zeilen mit optisch identischem Namen, die niemand auseinanderhalten
	// kann — und das Lerngedaechtnis zerfiele in zwei Haelften.
	it('liefert fuer beide Unicode-Formen denselben Schluessel', () => {
		expect(normalisiereHaendler('Müller Markt'.normalize('NFD'))).toBe(
			normalisiereHaendler('Müller Markt'.normalize('NFC'))
		);
		expect(normalisiereHaendler('Müller Markt'.normalize('NFD'))).toBe('müller');
	});
});
