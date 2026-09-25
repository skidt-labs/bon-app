import { describe, it, expect } from 'vitest';
import { normalisiereRohtext } from './normalisieren';

describe('normalisiereRohtext', () => {
	it('vereint Gross- und Kleinschreibung und Leerraum', () => {
		const a = normalisiereRohtext('BIO MILCH 1L');
		expect(normalisiereRohtext('Bio Milch 1l')).toBe(a);
		expect(normalisiereRohtext('  bio   milch  1l ')).toBe(a);
	});

	// Mengenangaben MUESSEN erhalten bleiben: "Butter 250g" und "Butter 500g" sind
	// verschiedene Produkte mit verschiedenen Preisen. Sie zusammenzuwerfen macht
	// jeden Preisvergleich in Phase 4 wertlos.
	it('haelt verschiedene Mengen auseinander', () => {
		expect(normalisiereRohtext('Butter 250g')).not.toBe(normalisiereRohtext('Butter 500g'));
		expect(normalisiereRohtext('Milch 1l')).not.toBe(normalisiereRohtext('Milch 1,5l'));
	});

	// Bons drucken Sternchen, Steuerkennzeichen und Rabattmarker an die Zeile. Die
	// gehoeren nicht zum Produkt.
	it('entfernt Bon-Beiwerk', () => {
		const butter = normalisiereRohtext('Butter 250g');
		expect(normalisiereRohtext('Butter 250g *')).toBe(butter);
		expect(normalisiereRohtext('Butter 250g  A')).toBe(butter);
		expect(normalisiereRohtext('*Butter 250g')).toBe(butter);
	});

	it('vereinheitlicht Komma und Punkt in Mengen', () => {
		expect(normalisiereRohtext('Milch 1.5l')).toBe(normalisiereRohtext('Milch 1,5l'));
	});

	it('behaelt Umlaute', () => {
		expect(normalisiereRohtext('Käse')).not.toBe(normalisiereRohtext('Kase'));
	});

	it('ergibt fuer eine leere Zeile einen leeren Schluessel', () => {
		expect(normalisiereRohtext('')).toBe('');
		expect(normalisiereRohtext('   * ')).toBe('');
	});

	// ---------------------------------------------------------------------------
	// Eigene Grenzfaelle aus echten deutschen Kassenbons (Aufgabenbrief, Korrektur 3):
	// Faelle fuer BEIDE Fehlerrichtungen, nicht nur die vom Auftrag vorgegebenen.
	// ---------------------------------------------------------------------------

	// "Zu zaghaft": Grossschreibung an der Kasse (Bondrucker) darf keinen neuen
	// Schluessel erzeugen, auch nicht bei einer eingedruckten Mengenangabe.
	it('Mengenangabe in Grossschreibung faellt mit Kleinschreibung zusammen', () => {
		expect(normalisiereRohtext('BUTTER 250G')).toBe(normalisiereRohtext('Butter 250g'));
		expect(normalisiereRohtext('BUTTER 250G')).not.toBe(normalisiereRohtext('BUTTER 500G'));
	});

	// "Zu gierig" vermeiden: ein Fettgehalt in Prozent ist Teil der Produktidentitaet
	// (Gouda 45% und Gouda 48% sind unterschiedliche Artikel), Gross-/Kleinschreibung
	// bleibt dabei egal. Beleg aus echten Bondaten (Schritt 5): "Gouda Scheiben 48%".
	it('unterscheidet Produkte anhand des Fettgehalts (Prozent), ignoriert aber die Schreibweise', () => {
		expect(normalisiereRohtext('Gouda Scheiben 48%')).not.toBe(
			normalisiereRohtext('Gouda Scheiben 45%')
		);
		expect(normalisiereRohtext('Joghurt mild 3,5%')).toBe(
			normalisiereRohtext('JOGHURT MILD 3,5%')
		);
	});

	// Bewusste Entscheidung (siehe Bericht): eine ausgeschriebene Umlaut-Ersatzschreibung
	// ("oe" statt "ö") wird NICHT mit der Umlaut-Schreibweise zusammengefuehrt. Es gibt
	// keine allgemeine Regel, die "oe" sicher als Umlaut-Ersatz erkennt, ohne andernorts
	// echte "oe"-Schreibweisen zu verfaelschen — dieselbe Abgrenzung wie "dm" vs.
	// "dm-drogerie markt" in normalisiereHaendler(). Das gehoert in eine spaetere,
	// manuell gepflegte Alias-Verwaltung, nicht in diese Funktion.
	it('fuehrt Umlaut und ausgeschriebene Ersatzschreibung NICHT zusammen (bewusst)', () => {
		expect(normalisiereRohtext('MÖHREN')).not.toBe(normalisiereRohtext('MOEHREN'));
	});

	// Beleg aus echten Bondaten: "Möhren" und "Bio Möhren" sind im Bestand des Betreibers
	// zwei getrennte Zeilen. Das ist kein Normalisierungsfehler, sondern richtig so: Bio
	// und konventionell unterscheiden sich in Herkunft und Preis.
	it('unterscheidet Bio-Praefix vom Grundprodukt', () => {
		expect(normalisiereRohtext('Bio Möhren')).not.toBe(normalisiereRohtext('Möhren'));
	});

	// "Zu gierig" vermeiden: Handelsmarken-Praefixe, die per Bindestrich an einen
	// Gattungsnamen gehaengt werden, sind in deutschen Supermaerkten Standard ("H-Milch"
	// = laenger haltbare Milch, "K-Classic" = Kaufland-Eigenmarke). Ein einzelner
	// Kennbuchstabe VOR einem Bindestrich darf deshalb nicht wie ein angehaengtes
	// Steuerkennzeichen behandelt werden — siehe Kommentar in normalisieren.ts.
	it('behaelt ein per Bindestrich angehaengtes Marken-Praefix (H-Milch, K-Classic)', () => {
		expect(normalisiereRohtext('H-Milch 1,5%')).not.toBe(normalisiereRohtext('Milch 1,5%'));
		expect(normalisiereRohtext('K-Classic Butter 250g')).not.toBe(
			normalisiereRohtext('Butter 250g')
		);
	});

	// Abkuerzungspunkte auf dem Bon (abgeschnittene Artikelbezeichnungen) bleiben
	// erhalten und sind Gross-/Kleinschreibungs-unabhaengig. Beleg aus echten Bondaten:
	// "Gr.Peperoni mit Fri.".
	it('behaelt Abkuerzungspunkte, unabhaengig von der Schreibweise', () => {
		expect(normalisiereRohtext('Gr.Peperoni mit Fri.')).toBe(
			normalisiereRohtext('GR.PEPERONI MIT FRI.')
		);
	});

	// "Zu gierig" vermeiden: ein an den Artikelnamen angehaengter Code (z. B. eine
	// Modell- oder Artikelnummer) unterscheidet echte Varianten. Beleg aus echten
	// Bondaten: "Tefal Jamie -0481345".
	it('unterscheidet Artikel anhand eines angehaengten Codes', () => {
		expect(normalisiereRohtext('Tefal Jamie -0481345')).not.toBe(
			normalisiereRohtext('Tefal Jamie -0481346')
		);
	});

	// "Zu zaghaft" vermeiden: ob vor dem Bindestrich ein Leerzeichen gedruckt wird oder
	// nicht, ist reine Formatierung derselben Zeile und darf keinen neuen Schluessel
	// erzeugen.
	it('ist unabhaengig davon, ob vor dem Bindestrich ein Leerzeichen steht', () => {
		expect(normalisiereRohtext('Tefal Jamie -0481345')).toBe(
			normalisiereRohtext('Tefal Jamie-0481345')
		);
	});

	// Eine Zeile, die nach der Normalisierung keinen einzigen Buchstaben und keine
	// einzige Ziffer enthaelt, ist Rauschen, kein Produktname — der Punkt bleibt
	// bewusst als Abkuerzungs-/Dezimalzeichen erhalten (siehe oben) und darf deshalb
	// nicht als eigener, nichtssagender Schluessel durchrutschen.
	it('ergibt fuer reines Satzzeichen-Rauschen einen leeren Schluessel', () => {
		expect(normalisiereRohtext('.')).toBe('');
		expect(normalisiereRohtext('- + %')).toBe('');
	});

	// Derselbe Text kann in zwei Unicode-Formen ankommen: "ö" als ein Zeichen (NFC) oder
	// als "o" plus kombinierendes Trema (NFD). Ohne Vereinheitlichung faellt das Trema
	// nicht unter \p{L}, wird wie ein Satzzeichen behandelt und reisst das Wort
	// auseinander — aus "möhren" wird "mo hren". Zwei Schluessel fuer denselben Artikel,
	// ohne dass es irgendwo auffaellt. Ueber 15 % der echten Bonzeilen enthalten Umlaute.
	it('liefert fuer beide Unicode-Formen denselben Schluessel', () => {
		expect(normalisiereRohtext('Möhren'.normalize('NFD'))).toBe(
			normalisiereRohtext('Möhren'.normalize('NFC'))
		);
		expect(normalisiereRohtext('Möhren'.normalize('NFD'))).toBe('möhren');
		expect(normalisiereRohtext('Crème Fraiche'.normalize('NFD'))).toBe(
			normalisiereRohtext('Crème Fraiche'.normalize('NFC'))
		);
	});
});
