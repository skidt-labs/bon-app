import { formatCents } from '$lib/money';
import { hatFilter, wirktAufPositionen, type BerichtFilter } from '$lib/berichte/filter';
import { filterZusammenfassung, type FilterNamen } from '$lib/berichte/merkmale';
import { vergleichText, zeitraumName, type Vergleich } from '$lib/berichte/zeitleiste';

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
	const { summe, bons } = b.kennzahlen;
	const zeilen = [
		`Bericht ${haushalt} — ${zeitraumName(b.filter.zeitraum)}`,
		`${b.filter.umfang === 'meine' ? 'Nur meine Bons' : 'Ganzer Haushalt'} · ${hatFilter(b.filter) ? filterZusammenfassung(b.filter, b.namen).join(' · ') : 'ohne Filter'}`,
		`Ausgaben: ${formatCents(summe)} € in ${bons} ${bons === 1 ? 'Bon' : 'Bons'} (${wirktAufPositionen(b.filter) ? 'Summe der passenden Positionen' : 'Summe der Bons'})`,
		...b.vergleiche.map(vergleichText)
	];
	const groesster = b.kategorien.filter((k) => k.id !== null).sort((x, y) => y.cents - x.cents)[0];
	if (groesster) zeilen.push(`Größter Posten: ${groesster.name} (${formatCents(groesster.cents)} €)`);
	zeilen.push('Nur bestätigte Bons.');
	if (link) zeilen.push(link);
	return zeilen.join('\n');
}
