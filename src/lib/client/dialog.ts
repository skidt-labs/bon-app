/**
 * Die drei Dialoge der Pruefansicht — Rueckfrage, Bild-Ueberlagerung, Vollbild — als
 * Svelte-Aktion statt nativem <dialog>: sie sind gebaut und gestylt, die Aktion ist kleiner
 * als der Umbau (Entwurf 2026-10-07, Bereich 1).
 *
 * Beim Oeffnen merkt sie sich den Knopf, der den Dialog geoeffnet hat, und setzt den Fokus
 * auf `[data-autofocus]` (sonst den ersten Knopf). Tab bleibt im Dialog. Escape schliesst
 * nur, solange `gesperrt` nicht gesetzt ist — waehrend der Arbeit (Verwerfen, Vorbereiten,
 * Hochladen) gilt der Dialog als festgehalten. Beim Schliessen geht der Fokus an den
 * Ausloeser zurueck.
 */
import { escapeSchliesst } from './berichte/menue';

export type DialogOptionen = { onschliessen: () => void; gesperrt: boolean };

const FOKUSSIERBAR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Wohin Tab springt: im Kreis; von ausserhalb (`aktuell` -1) aufs erste bzw. letzte Element; ohne Elemente -1. */
export function naechsterFokus(anzahl: number, aktuell: number, rueckwaerts: boolean): number {
	if (anzahl <= 0) return -1;
	if (aktuell < 0 || aktuell >= anzahl) return rueckwaerts ? anzahl - 1 : 0;
	return (aktuell + (rueckwaerts ? anzahl - 1 : 1)) % anzahl;
}

/** Sichtbare, bedienbare Elemente im Dialog (ein verborgenes zaehlt nicht mit). */
function fokussierbare(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOKUSSIERBAR)].filter((el) => el.getClientRects().length > 0);
}

function startZiel(node: HTMLElement): HTMLElement {
	const auto = node.querySelector<HTMLElement>('[data-autofocus]');
	if (auto && !(auto as HTMLButtonElement).disabled) return auto;
	const liste = fokussierbare(node);
	return liste.find((el) => el.tagName === 'BUTTON') ?? liste[0] ?? node;
}

export function dialog(node: HTMLElement, optionen: DialogOptionen) {
	let o = optionen;
	const vorher = document.activeElement as HTMLElement | null;
	if (!node.hasAttribute('tabindex')) node.tabIndex = -1;
	// Einen Rahmen spaeter: der Hauptknopf von BildBearbeiten wird erst nach dessen erstem
	// Effekt frei (vorher fehlt das Viereck), ein gesperrter Knopf nimmt keinen Fokus an.
	const rahmen = requestAnimationFrame(() => {
		if (!node.contains(document.activeElement)) startZiel(node).focus();
	});

	function taste(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (!escapeSchliesst(e.target, e.defaultPrevented)) return;
			// Auch gesperrt verbraucht: ein Menue dahinter soll nicht an seiner Stelle zugehen.
			e.preventDefault();
			if (!o.gesperrt) o.onschliessen();
			return;
		}
		if (e.key !== 'Tab') return;
		e.preventDefault();
		const liste = fokussierbare(node);
		const i = naechsterFokus(liste.length, liste.indexOf(document.activeElement as HTMLElement), e.shiftKey);
		(i < 0 ? node : liste[i]).focus();
	}
	// Einfangphase: vor dem Escape der Menues (menue.ts lauscht am document in der Blasenphase).
	document.addEventListener('keydown', taste, true);

	return {
		update(neu: DialogOptionen) {
			o = neu;
		},
		destroy() {
			cancelAnimationFrame(rahmen);
			document.removeEventListener('keydown', taste, true);
			// Zurueck an den Ausloeser — sofern es ihn noch gibt (nach einem Seitenwechsel nicht).
			if (vorher && vorher !== document.body && vorher.isConnected) vorher.focus();
		}
	};
}
