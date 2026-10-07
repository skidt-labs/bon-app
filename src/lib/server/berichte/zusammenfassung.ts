import { formatCents } from '$lib/money';
import { hatFilter, wirktAufPositionen, type BerichtFilter } from '$lib/berichte/filter';
import { filterZusammenfassung, type FilterNamen } from '$lib/berichte/merkmale';
import { vergleichText, zeitraumName, type Vergleich } from '$lib/berichte/zeitleiste';

/**
 * Laenger nimmt bon-matrix keinen Bericht an — src/matrix/bericht.ts liest die Grenze von
 * hier. Die EINE Stelle fuer diese Zahl (Sammelfassung 3.10).
 */
export const TEXT_HOECHSTENS = 4000;
/** Waere der Text zu lang, nennt jedes Merkmal nur so viele Namen („… und 57 weitere"). */
export const NAMEN_GEKUERZT = 3;
export const OHNE_LINK = 'Ohne Link — mit so vielen Filtern wäre die Adresse für eine Nachricht zu lang.';

export type FuerZusammenfassung = {
	filter: BerichtFilter;
	namen: FilterNamen;
	kennzahlen: { summe: number; bons: number };
	vergleiche: Vergleich[];
	kategorien: { id: string | null; name: string; cents: number }[];
};

/**
 * Der Text fuer den eigenen Matrix-Direktchat: NUR die Zusammenfassung — Zeitraum, Filter in
 * Worten, Summe, Bonzahl, Vergleiche, groesster eingeordneter Posten, optional ein Link.
 * Bewusst keine Positionen und keine Betraege einzelner Bons: eine Chatnachricht wird
 * weitergeleitet, zitiert, auf dem Sperrbildschirm angezeigt.
 */
export function matrixZusammenfassung(b: FuerZusammenfassung, haushalt: string, link: string | null): string {
	const bauen = (namenHoechstens: number | undefined, mitLink: boolean) => {
		const { summe, bons } = b.kennzahlen;
		const zeilen = [
			`Bericht ${haushalt} — ${zeitraumName(b.filter.zeitraum)}`,
			`${b.filter.umfang === 'meine' ? 'Nur meine Bons' : 'Ganzer Haushalt'} · ${hatFilter(b.filter) ? filterZusammenfassung(b.filter, b.namen, namenHoechstens).join(' · ') : 'ohne Filter'}`,
			`Ausgaben: ${formatCents(summe)} € in ${bons} ${bons === 1 ? 'Bon' : 'Bons'} (${wirktAufPositionen(b.filter) ? 'Summe der passenden Positionen' : 'Summe der Bons'})`,
			...b.vergleiche.map((v) => vergleichText(v, b.filter))
		];
		const groesster = b.kategorien.filter((k) => k.id !== null).sort((x, y) => y.cents - x.cents)[0];
		if (groesster) zeilen.push(`Größter Posten: ${groesster.name} (${formatCents(groesster.cents)} €)`);
		zeilen.push('Nur bestätigte Bons.');
		if (link) zeilen.push(mitLink ? link : OHNE_LINK);
		return zeilen.join('\n');
	};
	// Erst voll; sonst Namen kuerzen; passt der Link dann noch nicht, entfaellt er mit Hinweis.
	const voll = bauen(undefined, true);
	if (voll.length <= TEXT_HOECHSTENS) return voll;
	const gekuerzt = bauen(NAMEN_GEKUERZT, true);
	if (gekuerzt.length <= TEXT_HOECHSTENS) return gekuerzt;
	return bauen(NAMEN_GEKUERZT, false);
}
