/**
 * Ist das ueberhaupt ein Kassenbon? Erkannt am gelesenen Text, ohne Modell (Entwurf
 * docs/superpowers/specs/2026-09-27-kein-bon-design.md). Drei Faelle, sonst null:
 * kaum Text (ein Foto), Text ohne Preise (ein Brief), ein Kartenbeleg vom Terminal.
 *
 * Der Kartenbeleg braucht DREI Bedingungen: typische Woerter, hoechstens zwei verschiedene
 * Betraege, und KEINE Artikelzeile — jede Zeile mit einem Betrag traegt ein Zahlungs-,
 * Summen- oder Steuerwort. Die dritte kam nach der Pruefung vom 27.09.2026 dazu: bei einem
 * Baeckerbon mit einem Artikel ist Artikelpreis = Summe = Kartenbetrag, die Zahl der
 * Betraege trennt ihn nicht vom Kartenbeleg — die Zeile „Laugenbrezel 0,95" schon.
 * Rechnungen sind Ausgaben wie Bons (Entscheidung 27.09.2026) und werden nie markiert.
 */
import { betraegeInCent } from './qualitaet';
import type { KeinBonCode } from '$lib/bons/beanstandungen';

const MIN_ZEICHEN = 15;
const KARTENWOERTER = [
	'girocard',
	'kartenzahlung',
	'terminal',
	'kopie für kunde',
	'kundenbeleg',
	'genehmigung',
	'autorisierung',
	'kontaktlos',
	'contactless',
	'trace',
	'ta-nr',
	'beleg-nr',
	'visa',
	'mastercard',
	'maestro',
	'ec-karte',
	'debit'
];

/** Woerter, die eine Zeile mit Betrag als Summen-, Zahlungs- oder Steuerzeile ausweisen. */
const ZAHLWOERTER = ['summe', 'betrag', 'total', 'gesamt', 'zu zahlen', 'mwst', 'netto', 'brutto', 'trinkgeld', 'gegeben', 'ust', 'steuer'];

/** Traegt eine Zeile einen Betrag, aber kein Zahl- oder Kartenwort, ist sie eine Artikelzeile. */
function hatArtikelzeile(text: string): boolean {
	return text.split('\n').some((zeile) => {
		if (betraegeInCent(zeile).length === 0) return false;
		const klein = zeile.toLowerCase();
		return !ZAHLWOERTER.some((w) => klein.includes(w)) && !KARTENWOERTER.some((w) => klein.includes(w));
	});
}

export function keinKassenbon(text: string): KeinBonCode | null {
	if (text.replace(/\s/g, '').length < MIN_ZEICHEN) return 'kein_bon_leer';
	const betraege = betraegeInCent(text);
	if (betraege.length === 0) return 'kein_bon_ohne_preise';
	const klein = text.toLowerCase();
	const woerter = KARTENWOERTER.filter((w) => klein.includes(w)).length;
	if (woerter >= 2 && new Set(betraege).size <= 2 && !hatArtikelzeile(text)) return 'kein_bon_kartenbeleg';
	return null;
}
