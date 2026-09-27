import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonsZuFilter } from '$lib/server/berichte/bons';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse } from '$lib/berichte/filter';
import { zurueckZumBericht } from '$lib/berichte/zeitleiste';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	const heute = heutigerTag();
	const gelesen = filterAusAdresse(url.searchParams, heute);
	const ansichtRoh = url.searchParams.get('ansicht');
	const ansicht: 'bon' | 'position' = ansichtRoh === 'position' ? 'position' : 'bon';
	const hinweise = [...gelesen.hinweise];
	if (ansichtRoh !== null && ansichtRoh !== 'bon' && ansichtRoh !== 'position') {
		hinweise.push(`„${ansichtRoh}" ist keine Ansicht — gezeigt wird „Nach Bon".`);
	}
	// Die Kacheln der Zeitwahl bleiben hier ohne Betraege — sie sind Wegweiser, keine Zahlen.
	const monatsSummen: Record<string, number> = {};

	const liste = await bonsZuFilter(db, locals.zugriff!, gelesen.filter);
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
