/**
 * Schluessel, unter dem eine Bonzeile im Lerngedaechtnis wiedererkannt wird.
 *
 * Die Gratwanderung: Zu grob, und „Butter 250g" und „Butter 500g" werden ein Produkt —
 * der Preisvergleich in Phase 4 waere wertlos. Zu fein, und „BUTTER 250G" lernt nichts
 * ueber „Butter 250g". Deshalb bleiben Zahlen und Einheiten ERHALTEN, waehrend
 * Schreibweise, Leerraum und Bon-Beiwerk vereinheitlicht werden.
 *
 * Umlaute bleiben: „Käse" und „Kase" sind nicht dasselbe Wort, und ein Zusammenwerfen
 * waere nicht mehr zu trennen. Aus demselben Grund NICHT zusammengefuehrt: eine
 * ausgeschriebene Variante wie „Moehren" fuer „Möhren". Es gibt keine allgemeine Regel,
 * die "oe"/"ae"/"ue" sicher als Umlaut-Ersatz erkennt, ohne anderswo etwas kaputtzumachen
 * (z. B. ein Produkt, das tatsaechlich "oe" im Namen traegt) — dieselbe Abgrenzung wie bei
 * "dm" vs. "dm-drogerie markt" in normalisiereHaendler(): Raten gehoert in eine spaetere,
 * manuell gepflegte Alias-Verwaltung, nicht in die Normalisierung gleichwertiger
 * Schreibweisen DESSELBEN Textes.
 *
 * Reihenfolge bewusst ANDERS als in normalisiereHaendler(): dort werden Bindestriche VOR
 * der Wortgrenzen-Pruefung zu Leerzeichen, damit ein per Bindestrich angehaengtes
 * Zusatzwort ("Vertriebs-GmbH") als eigenes Token erkannt wird. Hier waere das falsch.
 * Deutsche Handelsmarken haengen ein einzelnes Kennbuchstaben-Praefix oft per Bindestrich
 * an einen Gattungsnamen: "H-Milch" (laenger haltbar), "K-Classic" (Kaufland-Eigenmarke),
 * "M-Budget" (Migros). Wuerde der Bindestrich zuerst zu einem Leerzeichen, faende die
 * Wortgrenzen-Pruefung darunter ein eigenstaendiges "h"/"k"/"m" und striche es als
 * vermeintliches Steuerkennzeichen — "H-Milch" und "Milch" fielen dann auf denselben
 * Schluessel: der GEGENTEILIGE Fehler ("zu gierig") zu dem, den diese Reihenfolge bei
 * Haendlernamen gerade verhindert. Nachgerechnet fuer den Bericht zu Aufgabe 4: mit
 * vorgezogener Bindestrich-Ersetzung besteht
 * `normalisiereRohtext('H-Milch 1,5%') !== normalisiereRohtext('Milch 1,5%')` NICHT mehr.
 * Deshalb bleibt hier die im Auftrag vorgegebene Reihenfolge: Wortgrenzen-Pruefung VOR der
 * allgemeinen Satzzeichen-Ersetzung. Kehrseite: ein hypothetischer, per Bindestrich OHNE
 * Leerzeichen angeklebter Steuermarker ("Butter 250g-A") wuerde NICHT erkannt. Dafuer gibt
 * es in den echten Kassenbons dieses Betreibers keinen Beleg (Steuerkennzeichen stehen dort
 * immer durch ein Leerzeichen abgetrennt, z. B. "Pfand 0,25 M"), waehrend Praefix-Marken wie
 * "H-Milch" Standard sind — siehe Bericht, Abschnitt „Befund".
 */
export function normalisiereRohtext(text: string): string {
	const s = text
		.toLowerCase()
		// NFC nach toLowerCase — siehe die ausfuehrliche Begruendung in merchants.ts.
		// Ohne diese Zeile wird aus "Möhren" in NFD-Form "mo hren": zwei Schluessel fuer
		// denselben Artikel, und das Lerngedaechtnis lernt nie etwas. (Pruefung Aufgabe 4)
		.normalize('NFC')
		// Sternchen und Rauten: Bon-Beiwerk (Rabattmarker, Wiegeartikel-Kennzeichen), nie
		// Teil des Produktnamens. Bewusst VOR der Wortgrenzen-Pruefung, siehe Testfall
		// "*Butter 250g".
		.replace(/[*#]/g, ' ')
		// Einzelne Buchstaben, die alleine zwischen Wortgrenzen stehen, sind
		// Steuerkennzeichen oder Rabattmarker (z. B. "Butter 250g A"), kein Produktname.
		// Bewusst nur an Wortgrenzen (^|\s)…(\s|$) statt \b: ein per Bindestrich
		// angehaengtes Praefix wie in "H-Milch" ist dadurch KEINE Wortgrenze und bleibt
		// erhalten (siehe Kommentar oben).
		.replace(/(^|\s)[a-z](\s|$)/g, ' ')
		// Komma und Punkt in Zahlen vereinheitlichen: "1,5l" und "1.5l" sind dieselbe Menge.
		.replace(/(\d),(\d)/g, '$1.$2')
		// Alles ausser Buchstaben, Ziffern, Punkt und Leerzeichen wird zu Leerzeichen:
		// Bindestriche, Et-Zeichen, Prozent- und Pluszeichen, Kommas ausserhalb von Zahlen.
		// Der Punkt bleibt bewusst erhalten (Dezimalpunkt UND Abkuerzungspunkt, z. B.
		// "Gr.Peperoni mit Fri.") — beides sind legitime, unveraenderliche Bestandteile des
		// gedruckten Textes.
		.replace(/[^\p{L}\p{N}. ]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	// Ein Schluessel ohne einen einzigen Buchstaben oder eine Ziffer ist kein Produktname,
	// sondern uebriggebliebene Interpunktion (z. B. eine Zeile, die nur aus "." oder "- + %"
	// besteht — der Punkt bleibt oben bewusst erhalten und wuerde sonst als eigener,
	// nichtssagender Schluessel gelernt). Dieselbe Falle wie bei normalisiereHaendler()
	// ("- & -" ergab dort vor der Korrektur "&").
	if (!/[\p{L}\p{N}]/u.test(s)) return '';
	return s;
}
