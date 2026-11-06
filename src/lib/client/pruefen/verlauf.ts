/**
 * „Rückgängig“ in der Pruefansicht (Entwurf 2026-11-06-pruefhilfen, §3).
 *
 * Ein Stapel von Staenden, rein im Browser, bis zum Speichern. Jeder Handgriff legt den Stand
 * VOR sich ab; ein Feld einmal je Besuch — zehn getippte Buchstaben sind ein Schritt, nicht
 * zehn. `geloescht` gehoert zum Stand: sonst loeschte der Server nach dem Zuruecknehmen eine
 * Zeile, die wieder zu sehen ist.
 *
 * Rein, ohne Svelte: die Seite fuehrt `anzahl` in einem eigenen $state nach.
 */
import type { EditorZeile, Kopf } from './editor';

export type Stand = { zeilen: EditorZeile[]; kopf: Kopf; geloescht: string[] };

export class Verlauf {
	#schritte: { stand: Stand; beschreibung: string }[] = [];
	#besucht = new Set<string>();

	constructor(private readonly grenze = 50) {}

	/** Legt eine Kopie des Stands ab. Der aelteste faellt heraus, wenn die Grenze erreicht ist. */
	merken(stand: Stand, beschreibung: string): void {
		this.#schritte.push({ stand: structuredClone(stand), beschreibung });
		if (this.#schritte.length > this.grenze) this.#schritte.shift();
	}

	zurueck(): { stand: Stand; beschreibung: string } | null {
		return this.#schritte.pop() ?? null;
	}

	get kannZurueck(): boolean {
		return this.#schritte.length > 0;
	}

	get anzahl(): number {
		return this.#schritte.length;
	}

	leeren(): void {
		this.#schritte = [];
		this.#besucht.clear();
	}

	/** true nur beim ERSTEN Aufruf je Feld seit dem letzten `feldVerlassen`. */
	feldBesuch(schluessel: string): boolean {
		if (this.#besucht.has(schluessel)) return false;
		this.#besucht.add(schluessel);
		return true;
	}

	feldVerlassen(): void {
		this.#besucht.clear();
	}
}

/**
 * Der Stand, den Rueckgaengig herstellt — mit dem JETZIGEN Schalter „privat behalten“. Der
 * Schalter steht ausserhalb der Felder und ist kein Schritt; ein zurueckgesprungener Schalter
 * teilte beim naechsten Bestaetigen still einen Bon, der privat bleiben sollte
 * (Abschlusspruefung 0.13.0, I1 — dieselbe Fehlerart wie Befund R22).
 */
export function wiederherstellen(stand: Stand, jetzt: Kopf): Stand {
	return { ...stand, kopf: { ...stand.kopf, privatBehalten: jetzt.privatBehalten } };
}

const KEIN_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color']);

/**
 * Steht der Fokus in einem Feld, das sein eigenes Rueckgaengig hat (Strg+Z des Browsers)?
 * Dort darf die Seite nicht den ganzen Zeilenstand zurueckspringen lassen.
 */
export function istTextfeld(el: Element | null): boolean {
	if (!el) return false;
	if ((el as HTMLElement).isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (tag === 'INPUT') return !KEIN_TEXT.has(((el as HTMLInputElement).type ?? 'text').toLowerCase());
	return false;
}

/**
 * Soll Strg/⌘+Z den Verlauf zuruecknehmen? Nicht im Feld (dort hat der Browser sein eigenes
 * Rueckgaengig), nicht hinter einem offenen Dialog (Rueckfrage, Konflikt, Bild bearbeiten,
 * Vollbild) und nur, wenn die Felder offen sind und es etwas zurueckzunehmen gibt.
 */
export function strgZ(
	e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
	lage: { offen: boolean; dialogOffen: boolean; schritte: number; imTextfeld: boolean }
): boolean {
	if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return false;
	return lage.offen && !lage.dialogOffen && lage.schritte > 0 && !lage.imTextfeld;
}
