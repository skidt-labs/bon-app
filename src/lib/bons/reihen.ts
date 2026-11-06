/**
 * Bon-Zeilen aus OCR-Kaesten — und der Betrag an ihrem rechten Rand.
 *
 * Ein Eintrag von PaddleOCR ist ein TEXTKASTEN, nicht die Bon-Zeile: „MILCH 1,5%“, „1,09“
 * und „A“ sind drei Kaesten nebeneinander. Gemessen an den bestaetigten Bons (06.11.2026):
 * jeder von Hand eingetragene Preis steht am rechten Rand seiner Bon-Zeile; von 33
 * Preis-Korrekturen hatte das Modell 17-mal den Randbetrag einer anderen Zeile, 12-mal
 * einen Betrag, der nirgends steht, 3-mal eine Zahl aus der Zeilenmitte.
 *
 * Rein, kein Netz, keine Datenbank. Liegt in $lib/bons, weil die Pruefansicht (Hinweis
 * „Im Bild steht …“) und der Worker (Nachbesserung) dieselbe Regel brauchen.
 */
import { betraegeInCent, betraegeMitStelle } from './betraege';

/** Ein OCR-Kasten. `OcrZeileKurz` ist damit vertraeglich; Rahmen [x, y, Breite, Hoehe]. */
export type Kasten = { text: string; box?: [number, number, number, number] };

/** Ein Steuerkennzeichen ganz rechts („A“, „B“, „*“) — kein Betrag, zaehlt nicht als Rand. */
const STEUERKENNZEICHEN = /^\s*[A-Z0-9*]{1,2}\s*$/;

/**
 * PaddleOCR klebt das Steuerkennzeichen oft an den Preis: „1,99A“, „2,49AW“, „0,99EUR“.
 * `BETRAG_REGEX` verlangt hinter den zwei Nachkommastellen eine Wortgrenze und fand darin
 * KEINEN Betrag — an den bestaetigten Bons (06.11.2026) gemessen: 43 Kaesten „…A“, 12
 * „…B“, 4 „…AW/BW“, 4 „…EUR“; von 15 Preisen, die angeblich nirgends standen, steckten 14
 * in genau so einem Kasten. Hier wird nur fuer die Reihen ein Leerzeichen dazwischen
 * gesetzt; die Regex selbst (und damit der Torwaechter) bleibt, wie sie gemessen ist.
 */
function kastenText(text: string): string {
	return text.replace(/(\d\s*[.,]\s*\d{2})(?=(?:[A-C]W?|EUR)\b)/g, '$1 ');
}

/** Betraege eines Kastens in Cent, mit angeklebtem Steuerkennzeichen gelesen. */
function betraegeImKasten(text: string): number[] {
	return betraegeInCent(kastenText(text));
}

/**
 * Indizes je Bon-Zeile, von oben nach unten, innerhalb links nach rechts. Nur Kaesten
 * mit Rahmen. Ein Kasten gehoert zur laufenden Reihe, wenn seine Mitte weniger als die
 * halbe Hoehe (die groessere von Kasten und Reihe) von der Reihenmitte entfernt liegt —
 * das haelt den leicht versetzten Preiskasten eines schief fotografierten Bons in seiner
 * Zeile, ohne die naechste Zeile zu schlucken.
 */
export function reihen(kaesten: Kasten[]): number[][] {
	const mitRahmen = kaesten
		.map((k, i) => ({ i, box: k.box }))
		.filter((e): e is { i: number; box: [number, number, number, number] } => e.box !== undefined)
		.map((e) => ({ i: e.i, x: e.box[0], mitte: e.box[1] + e.box[3] / 2, h: e.box[3] }))
		.sort((a, b) => a.mitte - b.mitte || a.x - b.x);

	const ergebnis: { glieder: typeof mitRahmen; mitte: number; h: number }[] = [];
	for (const e of mitRahmen) {
		const letzte = ergebnis.at(-1);
		if (letzte && Math.abs(e.mitte - letzte.mitte) < Math.max(e.h, letzte.h) * 0.5) {
			letzte.glieder.push(e);
			const n = letzte.glieder.length;
			letzte.mitte = letzte.glieder.reduce((s, g) => s + g.mitte, 0) / n;
			letzte.h = letzte.glieder.reduce((s, g) => s + g.h, 0) / n;
		} else {
			ergebnis.push({ glieder: [e], mitte: e.mitte, h: e.h });
		}
	}
	return ergebnis.map((r) => [...r.glieder].sort((a, b) => a.x - b.x).map((g) => g.i));
}

/** Die Reihe, die `index` enthaelt. Ohne Rahmen: nur `[index]`. */
export function reiheVon(kaesten: Kasten[], index: number): number[] {
	if (!kaesten[index]?.box) return [index];
	return reihen(kaesten).find((r) => r.includes(index)) ?? [index];
}

/**
 * Der Randkasten einer Reihe (Stelle in `reihe`) und sein Betrag in Cent, sonst null.
 * Der rechteste Kasten; ist er ein Steuerkennzeichen, der davor. Darin der LETZTE Betrag;
 * ein Minus direkt davor oder dahinter („-0,50“, „0,25-“) macht ihn negativ.
 */
export function randStelle(kaesten: Kasten[], reihe: number[]): { stelle: number; cents: number } | null {
	if (reihe.length === 0) return null;
	let stelle = reihe.length - 1;
	const rechts = kaesten[reihe[stelle]].text;
	if (stelle > 0 && STEUERKENNZEICHEN.test(rechts) && betraegeImKasten(rechts).length === 0) stelle--;
	const text = kastenText(kaesten[reihe[stelle]].text);
	const letzter = betraegeMitStelle(text).at(-1);
	if (!letzter) return null;
	const negativ = /^\s*-/.test(text.slice(letzter.ende)) || /-\s*$/.test(text.slice(0, letzter.start));
	return { stelle, cents: negativ ? -letzter.cent : letzter.cent };
}

/** Der Betrag am rechten Rand der Reihe in Cent (negativ bei Minus), sonst null. */
export function randBetrag(kaesten: Kasten[], reihe: number[]): number | null {
	return randStelle(kaesten, reihe)?.cents ?? null;
}

/** Alle Reihen: die mit Rahmen, dazu jeder Kasten ohne Rahmen als eigene Reihe. */
export function alleReihen(kaesten: Kasten[]): number[][] {
	const ohne = kaesten.flatMap((k, i) => (k.box ? [] : [[i]]));
	return [...reihen(kaesten), ...ohne];
}

/**
 * Wo ein Betrag (ohne Vorzeichen) im Bild steht: als Randbetrag irgendeiner Reihe, sonst
 * irgendwo in einem Kasten (Zeilenmitte: Einzelpreis, Gewicht, €/kg), sonst nirgends.
 */
export function ortImBild(kaesten: Kasten[], cents: number): 'rand' | 'mitte' | 'nirgends' {
	const betrag = Math.abs(cents);
	for (const r of alleReihen(kaesten)) {
		const rand = randBetrag(kaesten, r);
		if (rand !== null && Math.abs(rand) === betrag) return 'rand';
	}
	if (kaesten.some((k) => betraegeImKasten(k.text).includes(betrag))) return 'mitte';
	return 'nirgends';
}
