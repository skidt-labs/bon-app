import { formatCents } from '$lib/money';
import { MONETAER, mitVorzeichen, type LineType } from '$lib/bons/zeilenarten';
import { alleReihen, ortImBild, randStelle, type Kasten } from '$lib/bons/reihen';
import { aehnlichkeit } from '$lib/server/ocr/zuordnung';

/** Ab dieser Aehnlichkeit gilt eine Reihe als die Zeile der Position (Messung 06.11.2026). */
const REIHEN_SCHWELLE = 0.6;

type Position = { rawText: string; lineType: LineType; totalPriceCents: number };

/**
 * Bessert Preise des Modells nach, die so nicht im Bild stehen.
 *
 * Nur wenn der Modell-Preis einer Geldposition NIRGENDS oder nur in der ZEILENMITTE
 * steht (Menge × Einzelpreis, Gewicht, €/kg) und es eine Reihe gibt, deren linker Text
 * zum Artikeltext passt (Aehnlichkeit ≥ 0,6): dann gilt ihr Randbetrag, mit Vorzeichen
 * nach der Zeilenart, und eine Warnung geht in den Leselauf. Steht der Preis am Rand
 * irgendeiner Reihe, bleibt er — auch wenn es die falsche Reihe ist; das zeigt der Hinweis
 * in der Pruefansicht, weil an dieser Stelle zu oft ein richtiger Preis kippen wuerde.
 *
 * Gemessen an den bestaetigten Bons (06.11.2026): 9 richtig ersetzt, 2 falsch (vorher
 * schon falsch), 0 richtige Preise veraendert. Wiederholbar mit `lernprobe.run.test.ts`.
 */
export function randPreiseAnwenden<T extends Position>(
	items: T[],
	kaesten: Kasten[]
): { items: T[]; warnungen: string[] } {
	const warnungen: string[] = [];
	const reihen = alleReihen(kaesten).map((reihe) => {
		const rand = randStelle(kaesten, reihe);
		// Linker Text: alles ausser Randkasten und Steuerkennzeichen. Ist der Randkasten
		// der einzige (eine ganze Zeile in einem Kasten), zaehlt sein eigener Text — die
		// Aehnlichkeit liest ohnehin nur Buchstaben.
		const links = rand ? reihe.slice(0, rand.stelle) : reihe;
		const text = (links.length > 0 ? links : reihe).map((i) => kaesten[i].text).join(' ');
		return { text, rand: rand?.cents ?? null };
	});

	const ergebnis = items.map((item) => {
		if (!MONETAER.includes(item.lineType)) return item;
		if (ortImBild(kaesten, item.totalPriceCents) === 'rand') return item;

		let beste: (typeof reihen)[number] | null = null;
		let besteAehnlichkeit = 0;
		for (const r of reihen) {
			const a = aehnlichkeit(item.rawText, r.text);
			if (a > besteAehnlichkeit) {
				besteAehnlichkeit = a;
				beste = r;
			}
		}
		if (!beste || besteAehnlichkeit < REIHEN_SCHWELLE || beste.rand === null) return item;

		const neu = mitVorzeichen(item.lineType, beste.rand);
		if (neu === item.totalPriceCents) return item;
		warnungen.push(
			`„${item.rawText || 'ohne Namen'}“: Preis von ${formatCents(item.totalPriceCents)} auf ${formatCents(neu)} korrigiert (Betrag am rechten Rand der Zeile)`
		);
		return { ...item, totalPriceCents: neu };
	});

	return { items: ergebnis, warnungen };
}
