/**
 * Mengenzeilen — „2 x 1,29“ oder „0,532 kg x 2,99 EUR/kg“ — und zu welcher Ware sie gehoeren.
 *
 * Auf manchen Bons steht die Mengenzeile UNTER der Ware, auf anderen DARUEBER, auf manchen
 * traegt sie den Betrag selbst (Rueckmeldung 06.11.2026). Die Lage sagt also nichts; der
 * Preis sagt alles: Menge × Einzelpreis muss der Randbetrag der Ware sein. Passt genau ein
 * Nachbar, gehoert die Mengenzeile zu ihm. Passen beide oder keiner, wird nicht geraten.
 *
 * Rein, kein Netz, keine Datenbank. Liegt in $lib/bons, weil der Worker (Nachbesserung,
 * `extraction/mengenzeilen.ts`) und die Pruefansicht (Knopf „2 × 1,29 übernehmen“)
 * dieselbe Regel brauchen.
 */
import { randBetrag, reihen as alleBonReihen, type Kasten } from './reihen';

export type MengenAngabe = {
	/** Wie das Modell sie schreibt (Prompt): „2“, „0.532“. */
	menge: string;
	einheit: 'kg' | 'stk';
	einzelCents: number;
	/** Menge × Einzelpreis, auf ganze Cent gerundet. */
	produktCents: number;
};

/** Wo die Partnerreihe von der Mengenreihe aus liegt. */
export type Partner = { reihe: number[]; randCents: number; richtung: 'oben' | 'unten' | 'selbst' };

/** Nur beim Gewicht wird gerundet und darf einen Cent kosten; Stueck × Preis geht genau auf. */
const spielraum = (a: MengenAngabe) => (a.einheit === 'kg' ? 1 : 0);

const MAL = String.raw`\s*[x×X*]\s*`;
const PREIS = String.raw`(\d{1,4}[.,]\d{2})`;
const GEWICHT = new RegExp(String.raw`^\s*(\d{1,3}[.,]\d{1,3})\s*kg${MAL}${PREIS}\s*(?:EUR|€)?\s*/\s*kg`, 'i');
const STUECK = new RegExp(String.raw`^\s*(\d{1,3})\s*(?:stk\.?|st\.?)?${MAL}${PREIS}(?!\s*(?:EUR|€)?\s*/)`, 'i');

const cent = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

/** Die Mengenangabe am Anfang eines Reihentexts, sonst null. */
export function mengeAusText(text: string): MengenAngabe | null {
	const g = GEWICHT.exec(text);
	if (g) {
		const menge = Number(g[1].replace(',', '.'));
		const einzel = cent(g[2]);
		if (menge <= 0 || einzel <= 0) return null;
		return { menge: String(menge), einheit: 'kg', einzelCents: einzel, produktCents: Math.round(menge * einzel) };
	}
	const s = STUECK.exec(text);
	if (s) {
		const menge = Number(s[1]);
		const einzel = cent(s[2]);
		if (menge <= 0 || einzel <= 0) return null;
		return { menge: String(menge), einheit: 'stk', einzelCents: einzel, produktCents: menge * einzel };
	}
	return null;
}

/** Der Text einer Reihe, Kaesten links nach rechts. */
export function reihenText(kaesten: Kasten[], reihe: number[]): string {
	return reihe.map((i) => kaesten[i].text).join(' ');
}

const passt = (rand: number | null, a: MengenAngabe) =>
	rand !== null && Math.abs(Math.abs(rand) - a.produktCents) <= spielraum(a);

/**
 * Die Partnerreihe der Mengenreihe `reihen[i]`, sonst null.
 *
 * Traegt die Mengenreihe selbst einen Randbetrag, der zum Produkt passt, ist sie es selbst.
 * Sonst die naechste Reihe darueber und darunter, die je einen Randbetrag hat und selbst
 * keine Mengenreihe ist: passt genau eine, ist sie der Partner.
 */
export function partnerFuerMengenreihe(kaesten: Kasten[], reihen: number[][], i: number): Partner | null {
	const angabe = mengeAusText(reihenText(kaesten, reihen[i]));
	if (!angabe) return null;
	const eigener = randBetrag(kaesten, reihen[i]);
	if (passt(eigener, angabe)) return { reihe: reihen[i], randCents: Math.abs(eigener!), richtung: 'selbst' };

	const nachbar = (schritt: -1 | 1): { reihe: number[]; rand: number } | null => {
		for (let j = i + schritt; j >= 0 && j < reihen.length; j += schritt) {
			if (mengeAusText(reihenText(kaesten, reihen[j]))) continue;
			const rand = randBetrag(kaesten, reihen[j]);
			if (rand !== null) return { reihe: reihen[j], rand };
		}
		return null;
	};
	const oben = nachbar(-1);
	const unten = nachbar(1);
	const obenPasst = oben !== null && passt(oben.rand, angabe);
	const untenPasst = unten !== null && passt(unten.rand, angabe);
	if (obenPasst === untenPasst) return null;
	const p = obenPasst ? oben! : unten!;
	return { reihe: p.reihe, randCents: Math.abs(p.rand), richtung: obenPasst ? 'oben' : 'unten' };
}

/**
 * Fuer die Pruefansicht: Steht neben der Bildzeile einer Position (oder in ihr) eine
 * Mengenzeile, die eindeutig zu ihr gehoert und deren Produkt zu ihrem Betrag passt?
 * `richtung` sagt, wo die Mengenzeile von der Position aus steht.
 */
export function mengenVorschlag(
	kaesten: Kasten[],
	ocrZeile: number,
	totalCents: number
): (MengenAngabe & { richtung: 'oben' | 'unten' | 'selbst' }) | null {
	const rs = alleBonReihen(kaesten);
	const r = rs.findIndex((reihe) => reihe.includes(ocrZeile));
	if (r < 0) return null;
	const betrag = Math.abs(totalCents);
	const treffer: (MengenAngabe & { richtung: 'oben' | 'unten' | 'selbst' })[] = [];
	for (const [m, richtung] of [
		[r, 'selbst'],
		[r - 1, 'oben'],
		[r + 1, 'unten']
	] as const) {
		if (m < 0 || m >= rs.length) continue;
		const angabe = mengeAusText(reihenText(kaesten, rs[m]));
		if (!angabe || Math.abs(angabe.produktCents - betrag) > spielraum(angabe)) continue;
		const p = partnerFuerMengenreihe(kaesten, rs, m);
		if (!p) continue;
		// Gehoert sie zu genau dieser Reihe — oder traegt sie den Betrag selbst und steht direkt daneben?
		// Traegt sie den Betrag selbst, gehoert sie nur zu einer Nachbarreihe OHNE eigenen Betrag
		// (dem Namen) — eine Reihe mit Betrag ist eine andere Ware (Abschlusspruefung 0.13.0, I2).
		const eigeneOhneBetrag = m === r || randBetrag(kaesten, rs[r]) === null;
		if (p.reihe === rs[r] || (p.richtung === 'selbst' && eigeneOhneBetrag)) treffer.push({ ...angabe, richtung });
	}
	return treffer.length === 1 ? treffer[0] : null;
}
