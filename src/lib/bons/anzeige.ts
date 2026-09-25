/**
 * Reine Helfer fuer die Bon-Liste: Klartexte, Datumsformat, Tagesgruppen, Filterlinks.
 * Keine Svelte-Abhaengigkeit — die Komponenten lesen hier nur ab.
 */
const STATUS: Record<string, string> = {
	pending: 'Wartet',
	extracting: 'Wird gelesen',
	review: 'Prüfen',
	confirmed: 'Bestätigt',
	failed: 'Fehlgeschlagen',
	doppelt: 'Doppelt'
};

const QUELLE: Record<string, string> = {
	camera: 'Handy',
	upload: 'Hochladen',
	email: 'E-Mail',
	matrix: 'Bot'
};

/** Faellt auf den rohen Wert zurueck, damit Unbekanntes sich wenigstens selbst zeigt. */
export function statusText(status: string): string {
	return STATUS[status] ?? status;
}

export function quelleText(source: string): string {
	return QUELLE[source] ?? source;
}

/**
 * Festes Datumsformat, kein "heute"/"gestern": das braeuchte einen Vergleich mit der
 * Uhrzeit beim Rendern, der auf dieser serverseitig geladenen Liste nach Mitternacht
 * veralten wuerde, ohne dass die Seite neu laedt.
 */
export function formatWann(datum: Date | string | null): string {
	if (!datum) return '';
	const d = datum instanceof Date ? datum : new Date(datum);
	return d.toLocaleString('de-DE', {
		timeZone: 'Europe/Berlin',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

function tagesname(d: Date): string {
	return d.toLocaleDateString('de-DE', {
		timeZone: 'Europe/Berlin',
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/** Gruppiert nach Berliner Kalendertag der Kaufzeit (sonst des Eingangs); Reihenfolge bleibt. */
export function tagesgruppen<T extends { purchasedAt: Date | null; createdAt: Date }>(
	bons: T[]
): { tag: string; bons: T[] }[] {
	const gruppen: { tag: string; bons: T[] }[] = [];
	for (const b of bons) {
		const tag = tagesname(b.purchasedAt ?? b.createdAt);
		const letzte = gruppen[gruppen.length - 1];
		if (letzte && letzte.tag === tag) letzte.bons.push(b);
		else gruppen.push({ tag, bons: [b] });
	}
	return gruppen;
}

/** Ein Link, der EINEN Filter aendert und die uebrigen behaelt. `null` entfernt den Wert. */
export function filterLink(aktuell: URLSearchParams, aenderung: Record<string, string | null>): string {
	const p = new URLSearchParams(aktuell);
	for (const [k, v] of Object.entries(aenderung)) {
		if (v === null) p.delete(k);
		else p.set(k, v);
	}
	return '?' + p.toString();
}
