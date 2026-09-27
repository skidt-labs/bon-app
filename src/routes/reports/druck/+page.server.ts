import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { berichtLaden } from '$lib/server/berichte/abfragen';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse } from '$lib/berichte/filter';
import type { PageServerLoad } from './$types';

/**
 * Die Druckansicht: dieselbe Adresse, dieselbe Rechnung wie /reports — nur fuers Papier
 * gesetzt. „Als PDF speichern" macht der Browser; keine Server-PDF, kein Headless-Browser
 * im Abbild.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const heute = heutigerTag();
	const { filter, hinweise } = filterAusAdresse(url.searchParams, heute);
	const bericht = await berichtLaden(db, locals.zugriff!, filter, heute);
	return { ...bericht, heute, hinweise: [...new Set([...hinweise, ...bericht.hinweise])] };
};
