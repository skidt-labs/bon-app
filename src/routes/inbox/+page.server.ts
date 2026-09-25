import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { filterAusQuery, listeLaden } from '$lib/server/bons/liste';
import type { PageServerLoad } from './$types';

/** Der Posteingang: dieselbe Liste wie /receipts, Vorfilter "braucht dich", alle Monate. */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const { filter, hinweise } = filterAusQuery(url.searchParams, { status: 'brauchtDich', monat: null });
	const { bons, zaehler } = await listeLaden(db, locals.zugriff!, filter);
	return { bons, zaehler, filter, hinweise };
};
