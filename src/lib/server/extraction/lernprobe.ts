import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import { abweichungInZeile } from '$lib/bons/betraege';
import type { Kasten } from '$lib/bons/reihen';
import { ordneZeilenZu } from '$lib/server/ocr/zuordnung';
import { randPreiseAnwenden } from './randpreise';

/**
 * Die Lernprobe: wiederholt die Messung vom 06.11.2026 an den bestaetigten Bons —
 * was haette die Nachbesserung (`randpreise.ts`) geaendert, und welche Hinweise haette
 * die Pruefansicht gezeigt, gemessen an dem, was ein Mensch bestaetigt hat.
 *
 * Rein: bekommt je Bon die Positionen des Modells (aus `raw_json`), die bestaetigten
 * Positionen und die OCR-Kaesten. Gibt NUR Zaehler zurueck — nie Texte oder Betraege,
 * damit die Ausgabe gefahrlos im Terminal stehen kann.
 */
export type LernBon = {
	modellItems: { rawText: string; lineType: LineType; totalPriceCents: number; unitPriceCents: number | null }[];
	items: { rawText: string; lineType: LineType; totalPriceCents: number }[];
	kaesten: Kasten[];
};

export type Zaehlung = {
	bons: number;
	/** Modell- und bestaetigte Position mit gleichem (normalisiertem) Text, beide Geldzeilen. */
	paare: number;
	/** Paare, deren Preis der Mensch geaendert hat. */
	preisKorrekturen: number;
	/** Eingriffe der Nachbesserung: richtig, falsch (war schon falsch), richtigen Preis veraendert. */
	automatisch: { richtig: number; falsch: number; richtigeVeraendert: number };
	/** Hinweise „Im Bild steht …“ nach der Nachbesserung: trifft den bestaetigten Preis, oder nicht. */
	hinweis: { richtig: number; ueberfluessig: number };
};

function normal(text: string): string {
	return text.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function lernprobe(bons: LernBon[]): Zaehlung {
	const z: Zaehlung = {
		bons: bons.length,
		paare: 0,
		preisKorrekturen: 0,
		automatisch: { richtig: 0, falsch: 0, richtigeVeraendert: 0 },
		hinweis: { richtig: 0, ueberfluessig: 0 }
	};

	for (const bon of bons) {
		const nachher = randPreiseAnwenden(bon.modellItems, bon.kaesten).items;

		// Paaren in Bon-Reihenfolge: gleicher Text, beide Geldzeilen, jede bestaetigte nur einmal.
		const vergeben = new Set<number>();
		const paare: { j: number; soll: number }[] = [];
		bon.modellItems.forEach((m, j) => {
			if (!MONETAER.includes(m.lineType)) return;
			const k = bon.items.findIndex(
				(b, i) => !vergeben.has(i) && MONETAER.includes(b.lineType) && normal(b.rawText) === normal(m.rawText)
			);
			if (k < 0) return;
			vergeben.add(k);
			paare.push({ j, soll: bon.items[k].totalPriceCents });
		});

		// Die Zuordnung zu den Kaesten wie im Worker: auf den nachgebesserten Positionen.
		const zuordnung = ordneZeilenZu(
			nachher.map((p, j) => ({ lineNo: j + 1, rawText: p.rawText, totalPriceCents: p.totalPriceCents })),
			bon.kaesten
		);

		for (const { j, soll } of paare) {
			z.paare++;
			const alt = bon.modellItems[j].totalPriceCents;
			const neu = nachher[j].totalPriceCents;
			if (alt !== soll) z.preisKorrekturen++;
			if (neu !== alt) {
				if (neu === soll) z.automatisch.richtig++;
				else if (alt === soll) z.automatisch.richtigeVeraendert++;
				else z.automatisch.falsch++;
			}

			const zeile = zuordnung.get(j + 1);
			if (zeile === null || zeile === undefined) continue;
			const imBild = abweichungInZeile(bon.kaesten, zeile, neu, nachher[j].unitPriceCents);
			if (imBild === null) continue;
			if (imBild === Math.abs(soll) && neu !== soll) z.hinweis.richtig++;
			else z.hinweis.ueberfluessig++;
		}
	}
	return z;
}
