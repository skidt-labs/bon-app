import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { filterAusQuery, listeLaden } from '$lib/server/bons/liste';
import { aktuellerMonat } from '$lib/server/zeit';
import type { PageServerLoad } from './$types';

/** Das Archiv: dieselbe Liste wie /inbox, Vorfilter "alle, dieser Monat". */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const { filter, hinweise } = filterAusQuery(url.searchParams, { status: 'alle', monat: aktuellerMonat() });
	const { bons, zaehler } = await listeLaden(db, locals.zugriff!, filter);
	return { bons, zaehler, filter, hinweise };
};
