import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonsZuFilter } from '$lib/server/berichte/bons';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse } from '$lib/berichte/filter';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	const heute = heutigerTag();
	const { filter, hinweise } = filterAusAdresse(url.searchParams, heute);
	const ansicht: 'bon' | 'position' = url.searchParams.get('ansicht') === 'position' ? 'position' : 'bon';
	// Die Kacheln der Zeitwahl bleiben hier ohne Betraege — sie sind Wegweiser, keine Zahlen.
	const monatsSummen: Record<string, number> = {};

	if (filter.kategorie.length === 0 && filter.laden.length === 0) {
		return { filter, heute, ansicht, monatsSummen, liste: null, hinweise: [...hinweise, 'Wähle im Bericht eine Kategorie oder einen Laden.'] };
	}
	const liste = await bonsZuFilter(db, locals.zugriff!, filter);
	return { filter, heute, ansicht, monatsSummen, liste, hinweise: [...new Set([...hinweise, ...liste.hinweise])] };
};
