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
	doppelt: 'Doppelt',
	verworfen: 'Im Papierkorb'
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

/**
 * Versionskennung fuer Bildadressen (`?v=`): der Dateiname ohne Endung. Das Bild wird ein Jahr
 * zwischengespeichert; seit es sich bearbeiten laesst (bons/bild.ts), muss die Adresse sich
 * mit dem Bild aendern — sonst zeigte der Browser weiter das alte.
 */
export function bildVersion(pfad: string): string {
	const name = pfad.split('/').pop() ?? pfad;
	return name.replace(/\.[^.]+$/, '');
}

/**
 * Hat die Cloud-Reserve diesen Bon gelesen? Nur dann steht in der Pruefansicht der Vermerk
 * (Entwurf 2026-10-01-cloud-reserve). Ein gescheiterter oder wartender Bon wurde von niemandem
 * gelesen; liest der Mac ihn neu, traegt der neue Lauf `haupt`, und der Vermerk faellt weg.
 *
 * `lauf` ist der JUENGSTE Lauf, und er muss gelungen sein: ein gescheiterter, danach von Hand
 * eingetragener Bon traegt Zahlen eines Menschen, nicht der Reserve (Abschlusspruefung 02.10.).
 */
export function vonReserveGelesen(
	status: string,
	lauf: { kiRolle: string | null; error: string | null } | undefined
): boolean {
	return (status === 'review' || status === 'confirmed') && lauf?.error === null && lauf.kiRolle === 'reserve';
}
