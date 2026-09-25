import { betraegeInCent, buchstaben, abweichungInZeile } from '$lib/bons/betraege';

// Umgezogen nach $lib/bons/betraege (2026-09-17, Oberflaeche 3.4). Hier weiter
// exportiert, damit bestehende Importe und Tests unveraendert bleiben.
export { abweichungInZeile };

/**
 * Ordnet jeder Position eines Bons die OCR-Zeile zu, in der sie im Bild steht — oder
 * null, wenn das nicht eindeutig geht. Rein: keine Datenbank, kein Zustand. Der Worker
 * ruft sie nach der Modellantwort, die Pruefansicht liest das Ergebnis aus
 * `receipt_items.ocr_zeile`.
 *
 * Die Zuordnung ist eine HILFE ZUM SEHEN, keine Wahrheit: sie aendert weder Betraege
 * noch Status. Deshalb im Zweifel null — eine falsche Hervorhebung im Bild waere
 * schlimmer als keine, denn sie saehe aus wie ein Beleg.
 *
 * Betrag und Name zaehlen als zwei Belege (Abweichung vom Entwurf §4, dort "erst Betrag,
 * dann Name"). Grund, am 17.09. an einem echten Bon gemessen: PaddleOCR legt Name und
 * Preis in GETRENNTE Kaesten ("BIO ERDNUSSMUS" / "1,65€1"), Tesseract in eine Zeile. Eine
 * reine Betragssuche faende bei PaddleOCR nur den Preiskasten — und bei zwei gleichen
 * Artikeln zwei gleiche Preiskaesten ohne jeden Namen. Mit dem Namen als Beleg landet die
 * Position auf ihrer Namenszeile, also dort, wo ein Mensch sie im Bild sucht.
 */
export type ZuordnungsPosition = { lineNo: number; rawText: string; totalPriceCents: number };

/** Ab dieser Aehnlichkeit gilt ein Name allein als Beleg. Unter 0,34 teilen zwei Woerter kaum ein Drittel ihrer Trigramme. */
const NAMENS_SCHWELLE = 0.34;

/**
 * Punkte fuer eine Zeile, die NUR den Betrag traegt.
 *
 * Bewusst unter `1 + NAMENS_SCHWELLE` (= 1,34), damit ein Name oberhalb der Schwelle
 * IMMER gewinnt. Vorher stand hier 1,5, und damit schlug ein blosser Betrag jeden
 * Namen mit Aehnlichkeit unter 0,5.
 *
 * Gemessen am Lidl-Bon vom 17.09.: PaddleOCR las „Gr.Oliv.Zitr.Kraeuter" als
 * „Gr.0liy.Zitr.Kraeuter" (Null statt O, y statt v) — Aehnlichkeit 0,48. Die Namenszeile
 * kam damit auf 1,48 und verlor gegen zwei Preiskaesten „1,79 A", die beide 1,5 zaehlten;
 * weil es zwei waren, blieb die Position ganz ohne Zuordnung. Genau der Fall, fuer den
 * der Name als Beleg eingefuehrt wurde: Betraege wiederholen sich auf einem Bon staendig
 * (zwei Olivenprodukte zu 1,79, drei Rabatte zu -0,18), Namen fast nie.
 */
const NUR_BETRAG_PUNKTE = 1.3;

function trigramme(s: string): Set<string> {
	const t = new Set<string>();
	for (let i = 0; i + 3 <= s.length; i++) t.add(s.slice(i, i + 3));
	return t;
}

/** Trigramm-Anteil ueber die Buchstaben beider Texte: 0 (fremd) bis 1 (gleich). */
export function aehnlichkeit(a: string, b: string): number {
	const ta = trigramme(buchstaben(a));
	const tb = trigramme(buchstaben(b));
	if (ta.size === 0 || tb.size === 0) return 0;
	let schnitt = 0;
	for (const g of ta) if (tb.has(g)) schnitt++;
	return schnitt / (ta.size + tb.size - schnitt);
}

export function ordneZeilenZu(
	positionen: ZuordnungsPosition[],
	zeilen: { text: string }[]
): Map<number, number | null> {
	const ergebnis = new Map<number, number | null>();
	const betraegeJeZeile = zeilen.map((z) => betraegeInCent(z.text));
	const vergeben = new Set<number>();

	for (const p of positionen) {
		const betrag = Math.abs(p.totalPriceCents);
		let beste = 0;
		let kandidaten: number[] = [];
		for (let i = 0; i < zeilen.length; i++) {
			if (vergeben.has(i)) continue;
			const hatBetrag = betrag > 0 && betraegeJeZeile[i].includes(betrag);
			const s = aehnlichkeit(p.rawText, zeilen[i].text);
			let punkte = 0;
			if (hatBetrag && s > 0) punkte = 2 + s;
			else if (hatBetrag) punkte = NUR_BETRAG_PUNKTE;
			else if (s >= NAMENS_SCHWELLE) punkte = 1 + s;
			if (punkte === 0) continue;
			if (punkte > beste) {
				beste = punkte;
				kandidaten = [i];
			} else if (punkte === beste) {
				kandidaten.push(i);
			}
		}
		// Nur der Betrag, und den tragen mehrere Zeilen: nichts unterscheidet sie.
		if (beste === 0 || (beste === NUR_BETRAG_PUNKTE && kandidaten.length > 1)) {
			ergebnis.set(p.lineNo, null);
			continue;
		}
		// Gleichstand mit Namen (zwei gleiche Artikel): die erste freie Zeile, in
		// Bon-Reihenfolge — die naechste gleiche Position bekommt dann die naechste.
		const gewaehlt = kandidaten[0];
		vergeben.add(gewaehlt);
		ergebnis.set(p.lineNo, gewaehlt);
	}
	return ergebnis;
}

/**
 * Der Betrag, der im Bild steht, wenn er vom gelesenen abweicht — sonst null.
 *
 * Grundlage fuer den Hinweis "Im Bild steht 1,79 — gelesen wurde 1,29" und den Knopf
 * "1,79 uebernehmen" (Etappe 3). Nur wenn GENAU EIN Betrag in Frage kommt: der
 * Einzelpreis der Zeile faellt vorher heraus (bei "1,204 kg x 1,49/kg 1,79 A" bleibt
 * 1,79). Bleiben zwei, ist es null — raten waere eine Behauptung. Hat die Zeile keinen
 * Betrag, zaehlt der NAECHSTE Kasten, sofern er nur Zahlen traegt (PaddleOCR legt den
 * Preis in einen eigenen Kasten); ein Kasten mit Buchstaben ist schon der naechste Artikel.
 */

