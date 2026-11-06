/**
 * Woerter raten: „Etsbergsalat“ → „Eisbergsalat“ (Rueckmeldung 06.11.2026).
 *
 * Gelernt wird nur aus den EIGENEN bestaetigten Bons (Entwurf 2026-11-06-pruefhilfen, §2a):
 * was ein Mensch vor dem Bestaetigen verbessert hat, steht dann im Wortschatz und wird beim
 * naechsten Bon vorgeschlagen. Kein Woerterbuch von aussen — ein Bon spricht seine eigene
 * Sprache („H-MILCH“, „KNOBL.BAG“), und die kennt nur der Bestand.
 *
 * Rein, kein Netz. Liegt in $lib/bons: der Server baut den Wortschatz, die Pruefansicht raet.
 */

/** Wort (klein geschrieben) → wie oft es in bestaetigten Positionen vorkam. */
export type Wortschatz = Map<string, number>;

export type WortVorschlag = { von: string; nach: string; sicher: boolean };

const WORT = /[a-zäöüß]+/gi;
const MIN_LAENGE = 4;
/**
 * Gleich eingesetzt wird nur eine einzelne typische Verwechslung (halber Schritt). Ein echter
 * Schritt kann ein anderes, noch nie gesehenes Wort sein („BITTER“ ist kein verlesenes
 * „BUTTER“) — das wird nur angeboten.
 */
const SICHER_BIS = 0.5;

/** Zeichen, die PaddleOCR gern verwechselt: kosten nur einen halben Schritt. */
const VERWECHSLUNG = new Set(['i|t', 'i|l', 'l|t', 'l|1', 'i|1', 'o|0', 'e|c', 'n|u']);
const verwechselt = (a: string, b: string) => VERWECHSLUNG.has(`${a}|${b}`) || VERWECHSLUNG.has(`${b}|${a}`);
/** Zwei Zeichen, die als eines gelesen werden (und umgekehrt). */
const FOLGEN: [string, string][] = [
	['rn', 'm'],
	['ii', 'ü']
];

/** Die Woerter eines Texts, klein geschrieben, ab 4 Buchstaben. */
export function woerterIn(text: string): string[] {
	return (text.match(WORT) ?? []).filter((w) => w.length >= MIN_LAENGE).map((w) => w.toLowerCase());
}

export function wortschatzAus(texte: string[]): Wortschatz {
	const ws: Wortschatz = new Map();
	for (const t of texte) {
		for (const w of t.match(WORT) ?? []) {
			if (w.length < MIN_LAENGE) continue;
			const k = w.toLowerCase();
			ws.set(k, (ws.get(k) ?? 0) + 1);
		}
	}
	return ws;
}

/**
 * Editierabstand (Damerau, benachbarte Vertauschung) auf Kleinbuchstaben. Ersetzen,
 * Einfuegen, Loeschen, Vertauschen kosten 1; eine typische OCR-Verwechslung und die Folgen
 * „rn“↔„m“, „ii“↔„ü“ kosten 0,5.
 *
 * Mit `grenze`: sobald feststeht, dass der Abstand groesser wird, `Infinity` — die Ansicht
 * rechnet bei jedem Tastendruck, und fast alle Kandidaten scheiden frueh aus (Abschluss-
 * pruefung 0.13.0, I4). Drei rollende Zeilen statt einer Tabelle.
 */
export function abstand(a: string, b: string, grenze = Infinity): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	const n = y.length;
	let vorvor = new Float64Array(n + 1);
	let vor = Float64Array.from({ length: n + 1 }, (_, j) => j);
	let jetzt = new Float64Array(n + 1);
	let minVor = 0;
	for (let i = 1; i <= x.length; i++) {
		jetzt[0] = i;
		let minJetzt = i;
		const xi = x[i - 1];
		for (let j = 1; j <= n; j++) {
			const yj = y[j - 1];
			const ersetzen = xi === yj ? 0 : verwechselt(xi, yj) ? 0.5 : 1;
			let best = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + ersetzen);
			if (i > 1 && j > 1 && xi === y[j - 2] && x[i - 2] === yj) best = Math.min(best, vorvor[j - 2] + 1);
			for (const [lang, kurz] of FOLGEN) {
				if (i >= 2 && x[i - 2] === lang[0] && xi === lang[1] && yj === kurz) best = Math.min(best, vorvor[j - 1] + 0.5);
				if (j >= 2 && y[j - 2] === lang[0] && yj === lang[1] && xi === kurz) best = Math.min(best, vor[j - 2] + 0.5);
			}
			jetzt[j] = best;
			if (best < minJetzt) minJetzt = best;
		}
		// Kuenftige Werte stammen aus dieser Zeile (+0) oder der davor (+0,5 ueber eine Folge).
		if (minJetzt > grenze && minVor + 0.5 > grenze) return Infinity;
		minVor = minJetzt;
		[vorvor, vor, jetzt] = [vor, jetzt, vorvor];
	}
	return vor[n];
}

/** Die Schreibweise von `vorbild` auf `wort` uebertragen: GROSS, Erster gross, sonst klein. */
function schreibweise(vorbild: string, wort: string): string {
	if (vorbild === vorbild.toUpperCase()) return wort.toUpperCase();
	if (vorbild[0] === vorbild[0].toUpperCase()) return wort[0].toUpperCase() + wort.slice(1);
	return wort;
}

/**
 * Das bekannte Wort mit dem kleinsten Abstand, sonst null. Hoechstens 1 bei 4–7 Zeichen,
 * hoechstens 2 ab 8. Bei Gleichstand gewinnt das haeufigere; ist auch das gleich, wird nicht
 * geraten. `sicher`: eine typische Verwechslung (≤ 0,5) und mindestens zweimal gesehen — dann
 * setzt die Ansicht es gleich ein (mit „zurück“), sonst bietet sie es nur an.
 */
export function wortVorschlag(wort: string, ws: Wortschatz, getippt?: Set<string>): WortVorschlag | null {
	const w = wort.toLowerCase();
	let gemerkt = MERKER.get(ws);
	if (!gemerkt) MERKER.set(ws, (gemerkt = new Map()));
	let treffer = gemerkt.get(w);
	if (treffer === undefined) {
		treffer = besterKandidat(w, ws);
		gemerkt.set(w, treffer);
	}
	if (!treffer) return null;
	// Gleich eingesetzt wird nur ein Wort, das ein Mensch getippt hat (Abschlusspruefung 0.13.0,
	// I5): ein unkorrigiert bestaetigter Lesefehler steht sonst ebenso im Wortschatz und wuerde
	// richtige Woerter ins Falsche „verbessern“.
	const sicher = treffer.sicher && (getippt === undefined || getippt.has(treffer.wort));
	return { von: wort, nach: schreibweise(wort, treffer.wort), sicher };
}

/**
 * Gemerkte Ergebnisse je Wortschatz und Wort (klein). Die Ansicht rechnet bei jedem
 * Tastendruck ALLE Zeilen neu; so kostet das nur das Wort, das sich gerade aendert
 * (Abschlusspruefung 0.13.0, I4). WeakMap: ein neuer Wortschatz (anderer Bon) faengt leer an.
 */
const MERKER = new WeakMap<Wortschatz, Map<string, { wort: string; sicher: boolean } | null>>();

function besterKandidat(w: string, ws: Wortschatz): { wort: string; sicher: boolean } | null {
	if (w.length < MIN_LAENGE || ws.has(w)) return null;
	const grenze = w.length >= 8 ? 2 : 1;
	let best: { wort: string; d: number; n: number } | null = null;
	let gleichstand = false;
	for (const [kandidat, n] of ws) {
		if (Math.abs(kandidat.length - w.length) > grenze) continue;
		// „TOMATE“/„TOMATEN“, „KNOBL“/„KNOBLAUCH“: Wortform oder Abkuerzung, kein Lesefehler.
		if (kandidat.startsWith(w) || w.startsWith(kandidat)) continue;
		const d = abstand(w, kandidat, grenze);
		if (d === 0 || d > grenze) continue;
		if (!best || d < best.d || (d === best.d && n > best.n)) {
			best = { wort: kandidat, d, n };
			gleichstand = false;
		} else if (d === best.d && n === best.n) gleichstand = true;
	}
	if (!best || gleichstand) return null;
	return { wort: best.wort, sicher: best.d <= SICHER_BIS && best.n >= 2 };
}

/** Alle Wortvorschlaege eines Texts angewandt; null, wenn es keinen gibt. */
export function textVorschlag(
	text: string,
	ws: Wortschatz,
	getippt?: Set<string>
): { text: string; woerter: WortVorschlag[] } | null {
	const woerter: WortVorschlag[] = [];
	const neu = text.replace(WORT, (w) => {
		const v = wortVorschlag(w, ws, getippt);
		if (!v) return w;
		woerter.push(v);
		return v.nach;
	});
	return woerter.length > 0 ? { text: neu, woerter } : null;
}
