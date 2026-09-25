import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { berichtLaden } from '$lib/server/berichte/abfragen';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse } from '$lib/berichte/filter';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	// Unbrauchbares in der Adresse faellt auf eine Vorgabe zurueck UND sagt es — still zu
	// raten waere schlimmer als zu antworten (dieselbe Regel wie in der Bon-Liste).
	const heute = heutigerTag();
	const { filter, hinweise } = filterAusAdresse(url.searchParams, heute);
	const bericht = await berichtLaden(db, locals.zugriff!, filter, heute);
	return { ...bericht, filter, heute, hinweise: [...new Set([...hinweise, ...bericht.hinweise])] };
};
