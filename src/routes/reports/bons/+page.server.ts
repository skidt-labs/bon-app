import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonsZuFilter } from '$lib/server/berichte/bons';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse } from '$lib/berichte/filter';
import { zurueckZumBericht } from '$lib/berichte/zeitleiste';
import type { PageServerLoad } from './$types';
import { monatsSummenLaden } from '$lib/server/berichte/abfragen';

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	const heute = heutigerTag();
	const gelesen = filterAusAdresse(url.searchParams, heute);
	// Leer (`?ansicht=`) heisst „nicht angegeben" — kein Hinweis mit leeren Anfuehrungszeichen (3.1).
	const ansichtRoh = url.searchParams.get('ansicht')?.trim() || null;
	const ansicht: 'bon' | 'position' = ansichtRoh === 'position' ? 'position' : 'bon';
	const hinweise = [...gelesen.hinweise];
	if (ansichtRoh !== null && ansichtRoh !== 'bon' && ansichtRoh !== 'position') {
		hinweise.push(`„${ansichtRoh}" ist keine Ansicht — gezeigt wird „Nach Bon".`);
	}
	const [liste, monatsSummen] = await Promise.all([
		bonsZuFilter(db, locals.zugriff!, gelesen.filter),
		// Dieselben Betraege wie auf der Berichtsseite: Kacheln und Jahresliste der Zeitwahl.
		monatsSummenLaden(db, locals.zugriff!, gelesen.filter)
	]);
	const rueckweg = url.searchParams.get('zurueck');
	return {
		filter: liste.filter,
		heute,
		ansicht,
		monatsSummen,
		liste,
		hinweise: [...new Set([...hinweise, ...liste.hinweise])],
		/** Der Link zurueck zum Bericht, von dem man kam — geprueft wie jede Adresse. */
		zumBericht: zurueckZumBericht(rueckweg, liste.filter, heute),
		rueckweg
	};
};
