/**
 * Uebergabe der in der Leiste unten gewaehlten Fotos an die Scannen-Seite.
 *
 * Die Knoepfe Kamera und Datei (LeisteUnten.svelte) oeffnen die Auswahl direkt —
 * ein Klick statt zwei (Wunsch der Nutzerin, 06.11.2026). Die Fotos liegen dann als
 * `File` im Speicher; die Scannen-Seite holt sie nach der Navigation EINMAL ab und
 * geht damit denselben Weg wie ihre eigenen Eingaenge (Zuschneiden, Outbox).
 *
 * Bewusst nur im Speicher des Tabs: nichts davon soll einen Reload ueberleben — ein
 * neu geladenes /scan darf keine alte Auswahl wieder vorlegen.
 */
export type Quelle = 'camera' | 'upload';

let bereit: { dateien: File[]; quelle: Quelle } | null = null;

export function uebergeben(dateien: File[], quelle: Quelle): void {
	bereit = dateien.length > 0 ? { dateien: [...dateien], quelle } : null;
}

export function abholen(): { dateien: File[]; quelle: Quelle } | null {
	const b = bereit;
	bereit = null;
	return b;
}
