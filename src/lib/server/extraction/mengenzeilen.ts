import { formatCents } from '$lib/money';
import { MONETAER, mitVorzeichen, type LineType } from '$lib/bons/zeilenarten';
import { randBetrag, reihen as bonReihen, type Kasten } from '$lib/bons/reihen';
import { mengeAusText, partnerFuerMengenreihe, reihenText, type MengenAngabe } from '$lib/bons/mengenzeilen';
import { mengeAlsZahl, rechenprobe } from '$lib/bons/rechenprobe';
import { aehnlichkeit } from '$lib/server/ocr/zuordnung';

/** Ab dieser Aehnlichkeit gilt eine Reihe als die Zeile der Position — wie bei den Randpreisen. */
const REIHEN_SCHWELLE = 0.6;

type Position = {
	rawText: string;
	lineType: LineType;
	quantity: string | null;
	unit: string | null;
	unitPriceCents: number | null;
	totalPriceCents: number;
};

const traegt = (item: Position, a: MengenAngabe) =>
	mengeAlsZahl(item.quantity) === Number(a.menge) && item.unitPriceCents !== null && Math.abs(item.unitPriceCents) === a.einzelCents;

const name = (item: Position) => `„${item.rawText || 'ohne Namen'}“`;

/**
 * Bessert Menge, Einheit und Einzelpreis nach, wo das Modell die Mengenzeile der falschen
 * Ware zugeschlagen oder sie uebersehen hat (Entwurf 2026-11-06-pruefhilfen, §1).
 *
 * Je Mengenreihe mit eindeutigem Partner (`partnerFuerMengenreihe`): die Geldposition, deren
 * Betrag genau der Randbetrag des Partners ist und deren Text dem der Partnerzeile am
 * aehnlichsten ist (≥ 0,6, eindeutig). Sie bekommt die Angabe. Traegt eine ANDERE Position genau diese
 * Angabe und geht ihre Rechenprobe damit nicht auf, hat sie sie geerbt: sie wird zum
 * Einzelartikel (Menge 1, Einzelpreis = Gesamtbetrag), wie der Prompt es fuer Einzelartikel
 * vorgibt. Es kommen keine Positionen hinzu, und es fallen keine weg.
 */
export function mengenzeilenAnwenden<T extends Position>(items: T[], kaesten: Kasten[]): { items: T[]; warnungen: string[] } {
	const warnungen: string[] = [];
	const ergebnis = [...items];
	const rs = bonReihen(kaesten);

	rs.forEach((reihe, i) => {
		const angabe = mengeAusText(reihenText(kaesten, reihe));
		if (!angabe) return;
		const partner = partnerFuerMengenreihe(kaesten, rs, i);
		if (!partner) return;

		const kandidaten = ergebnis
			.map((item, j) => ({ item, j }))
			.filter(({ item }) => MONETAER.includes(item.lineType) && Math.abs(item.totalPriceCents) === partner.randCents);
		// Immer ueber den Text: der Betrag allein trifft sonst eine Ware irgendwo im Bon, die
		// zufaellig gleich viel kostet (Mengenprobe 06.11.2026: 3 richtige Angaben veraendert).
		// Bei der Mengenzeile mit eigenem Betrag steht der Name in einer Nachbarreihe.
		// Nur Nachbarreihen OHNE eigenen Betrag: die mit Betrag ist eine andere Ware, die zufaellig
		// gleich viel kosten kann (Abschlusspruefung 0.13.0, I2).
		const texte =
			partner.richtung === 'selbst'
				? [rs[i - 1], rs[i + 1]]
						.filter((r) => r !== undefined && randBetrag(kaesten, r) === null)
						.map((r) => reihenText(kaesten, r))
				: [reihenText(kaesten, partner.reihe)];
		const wertung = kandidaten
			.map(({ item, j }) => ({ j, a: Math.max(0, ...texte.map((t) => aehnlichkeit(item.rawText, t))) }))
			.sort((x, y) => y.a - x.a);
		let ziel: number | null = null;
		if (wertung.length > 0 && wertung[0].a >= REIHEN_SCHWELLE && (wertung.length < 2 || wertung[1].a < wertung[0].a)) {
			ziel = wertung[0].j;
		}
		if (ziel === null) return;

		const z = ergebnis[ziel];
		if (!traegt(z, angabe)) {
			ergebnis[ziel] = {
				...z,
				quantity: angabe.menge,
				unit: angabe.einheit,
				unitPriceCents: mitVorzeichen(z.lineType, angabe.einzelCents)
			};
			warnungen.push(
				`${name(z)}: Menge ${angabe.menge} ${angabe.einheit} × ${formatCents(angabe.einzelCents)} aus der Mengenzeile ${
					partner.richtung === 'oben' ? 'darunter' : partner.richtung === 'unten' ? 'darüber' : 'mit dem Betrag'
				} übernommen`
			);
		}

		ergebnis.forEach((andere, j) => {
			if (j === ziel || !MONETAER.includes(andere.lineType) || !traegt(andere, angabe)) return;
			if (rechenprobe(andere) === null) return;
			ergebnis[j] = { ...andere, quantity: '1', unit: 'stk', unitPriceCents: andere.totalPriceCents };
			warnungen.push(`${name(andere)}: Menge ${angabe.menge} × ${formatCents(angabe.einzelCents)} gehört zu einer anderen Ware — als Einzelartikel gesetzt`);
		});
	});

	return { items: ergebnis, warnungen };
}
