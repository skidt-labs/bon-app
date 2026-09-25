import { db } from './db';
import { merchants } from './db/schema';

/**
 * Rechtsformen und Zusaetze, die auf deutschen Bons stehen und den Laden nicht
 * unterscheiden. Bewusst eine feste Liste statt einer Heuristik: ein zu gieriges
 * Muster wuerde "Aldi Süd" zu "Aldi" verkuerzen und zwei verschiedene Ketten
 * zusammenwerfen.
 *
 * Hier ROH (mit Punkten wie im Original, z. B. "e.k."), weil sie so am ehesten
 * lesbar sind — auf die tatsaechlich verglichene Form wird weiter unten mit
 * `saeubern()` gebracht, siehe Kommentar bei ZUSAETZE.
 *
 * BEWUSST NICHT in dieser Liste: Kurzformen wie "dm" fuer "dm-drogerie markt".
 * "dm-drogerie markt" bleibt nach der Normalisierung "dm drogerie" und damit
 * UNGLEICH "dm" — das ist Absicht, keine Luecke. Eine Kurzform auf den Rechtsnamen
 * abzubilden ist Raten (es gibt keine allgemeine Regel, die "dm" aus "dm-drogerie
 * markt" ableitet, ohne anderswo etwas kaputtzumachen), keine Normalisierung
 * gleichwertiger Schreibweisen desselben Textes. Das gehoert in eine spaetere
 * Alias-Verwaltung (manuell gepflegte Zuordnung), nicht hierher. NICHT versehentlich
 * "reparieren" (Review Task 1, Befund 2 — bewusste Abgrenzung, siehe Aufgabenbrief).
 */
const ZUSAETZE_ROH = [
	'gmbh & co. kg',
	'gmbh & co kg',
	'gmbh',
	'ag & co. kg',
	'ag',
	'kg',
	'ohg',
	'e.k.',
	'se',
	'dienstleistung',
	'vertriebs',
	'filiale',
	'markt'
];

/** Kleinschreibung ist hier bereits vorausgesetzt.
 *
 * Reihenfolge ist wichtig: Bindestrich/Gedankenstriche und Et-Zeichen-Abstaende
 * werden VOR der allgemeinen Satzzeichen-Ersetzung vereinheitlicht. Grund: ein per
 * Bindestrich direkt angehaengtes Zusatzwort ("Vertriebs-GmbH") ist sonst EIN Token
 * und die ZUSAETZE-Erkennung (Wortgrenzen `(^|\s)…(\s|$)`) trifft nie — derselbe
 * Bug wie beim Punkt-Problem oben, nur an anderer Stelle (Review Task 1, Befund 2).
 * Belegter Fall: "Lidl Vertriebs-GmbH & Co. KG" muss auf denselben Schluessel wie
 * "Lidl" fallen.
 *
 * "-", "–" (Halbgeviertstrich) und "—" (Geviertstrich) werden alle zu Leerzeichen:
 * Kassenbons drucken je nach Kasse/Schriftart unterschiedliche Strichlaengen fuer
 * denselben Zweck. "&" wird MIT umgebenden Leerzeichen ersetzt (nicht entfernt),
 * damit "H&M" und "H & M" auf denselben Token-Strom fallen, ohne dass "H" und "M"
 * zu einem Wort verschmelzen.
 *
 * Danach wie bisher: Satzzeichen -> Leerzeichen, mehrfache Leerzeichen zu einem
 * zusammenziehen, aussen trimmen. */
function saeubern(s: string): string {
	return s
		.replace(/[-–—]/g, ' ')
		.replace(/&/g, ' & ')
		.replace(/[.,;:!?"'`´]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// Auf dieselbe Form gebracht wie der Text, gegen den sie antreten sollen — sonst
// verhindert ein Punkt in der Liste (z. B. "e.k.", "gmbh & co. kg"), dass der
// Eintrag JE zutrifft: saeubern() hat den Punkt im Eingabetext zu diesem Zeitpunkt
// laengst durch ein Leerzeichen ersetzt. Ohne diesen Schritt bestand
// normalisiereHaendler('Lidl Dienstleistung GmbH & Co. KG') NICHT den eigenen Test
// ("lidl & co" statt "lidl") — per Node-Script nachgemessen, siehe Bericht.
// Set() entfernt die dadurch entstehenden Duplikate (beide "co kg"-Varianten fallen
// zusammen); die Reihenfolge (lange Wortgruppen vor kurzen) bleibt erhalten.
const ZUSAETZE = [...new Set(ZUSAETZE_ROH.map(saeubern))].filter((z) => z.length > 0);

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Schluessel, unter dem ein Haendler wiedererkannt wird.
 *
 * Umlaute bleiben erhalten: "Müller" und "Muller" sind verschiedene Laeden, und ein
 * Zusammenwerfen waere nicht mehr zu trennen. Kleinschreibung und das Entfernen von
 * Satzzeichen genuegen, um die ueblichen Druckvarianten zu vereinen.
 */
export function normalisiereHaendler(name: string): string {
	// NFC ZUERST, und zwar NACH toLowerCase: derselbe Text kann als vorgesetztes "ö"
	// (NFC) oder als "o" plus kombinierendes Trema (NFD) ankommen, und toLowerCase kann
	// selbst kombinierende Zeichen erzeugen. Ohne Vereinheitlichung faellt das Trema
	// nicht unter \p{L}, wird als Satzzeichen behandelt und reisst das Wort auseinander.
	// Das Ergebnis sieht dann identisch aus und ist es nicht — die schlimmste Sorte
	// Fehler, weil sie beim Draufschauen unsichtbar bleibt. (Prüfung Aufgabe 4)
	let s = saeubern(name.toLowerCase().normalize('NFC'));
	for (const z of ZUSAETZE) {
		// (^|\s) … (\s|$) statt \b: \b kennt bei Umlauten keine verlaessliche
		// Wortgrenze, und wir wollen ohnehin nur an Leerzeichen oder Rand trennen.
		s = saeubern(s.replace(new RegExp(`(^|\\s)${escapeRegExp(z)}(\\s|$)`, 'g'), ' '));
	}
	// Ein Schluessel ohne einen einzigen Buchstaben oder eine Ziffer ist kein
	// Ladenname, sondern uebriggebliebene Interpunktion ("&", "-"). Ohne diese
	// Pruefung legt haendlerAufloesen() ihn als echten Haendler an, und er waere ab
	// dann ein Anker fuers Kategorie-Lernen — eine Behauptung an einer Stelle, an
	// die eine Leerstelle gehoert. Beim Nachrechnen des Bindestrich-Fixes
	// aufgefallen: "- & -" ergab vorher "&".
	if (!/[\p{L}\p{N}]/u.test(s)) return '';
	return s;
}

/**
 * Liefert die Id des Haendlers und legt ihn an, falls er fehlt.
 *
 * Wettlauffest ueber den eindeutigen `normalized_name`: zwei Bons desselben Ladens,
 * die gleichzeitig verarbeitet werden, duerfen nicht zwei Haendler erzeugen — sonst
 * zerfaellt das Lerngedaechtnis in zwei Haelften, ohne dass irgendwo ein Fehler
 * auftaucht. Dasselbe Muster wie `ensureDefaultHousehold` in `household.ts`: kein
 * "nachsehen, dann einfuegen", sondern ein Upsert mit `DO UPDATE` (No-Op) auf die
 * eindeutige Spalte, damit RETURNING auch im Kollisionsfall eine Zeile liefert.
 *
 * `null` heisst „kein Name gelesen" und ist eine Leerstelle, keine Behauptung — die
 * Kaskade faellt dann auf Stufe 2 zurueck, die ohne Haendler auskommt.
 *
 * `ausfuehrer`: wer den Upsert ausfuehrt — voreingestellt die Datenbank selbst, aus
 * einer Transaktion heraus aber DEREN Handle. Sonst laeuft der Upsert ueber eine
 * andere Verbindung am Transaktionsrahmen vorbei und bleibt stehen, wenn die
 * Transaktion zurueckgerollt wird (receipts/korrekturen.ts).
 */
export type HaendlerAusfuehrer = Pick<typeof db, 'insert'>;

export async function haendlerAufloesen(
	rohName: string | null,
	ausfuehrer: HaendlerAusfuehrer = db
): Promise<string | null> {
	if (!rohName) return null;
	const schluessel = normalisiereHaendler(rohName);
	if (schluessel === '') return null;

	const [zeile] = await ausfuehrer
		.insert(merchants)
		.values({ name: rohName.trim(), normalizedName: schluessel })
		.onConflictDoUpdate({
			target: merchants.normalizedName,
			set: { normalizedName: schluessel } // No-op, damit RETURNING greift
		})
		.returning({ id: merchants.id });
	return zeile.id;
}
