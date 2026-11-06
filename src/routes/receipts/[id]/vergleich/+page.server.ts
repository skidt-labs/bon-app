import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonLaden } from '$lib/server/bons/liste';
import { vergleichBon, vorschlaege } from '$lib/server/bons/vergleich';
import type { PageServerLoad } from './$types';

/** Auswahl „Mit anderem Bon vergleichen": Vorschlaege aus den sichtbaren Bons, Suche ueber `?suche=`. */
export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const k = locals.zugriff!;
	const bon = await bonLaden(db, k, params.id);
	if (!bon) error(404, 'Bon nicht gefunden');
	const suche = url.searchParams.get('suche') ?? '';
	const [dieser, liste] = await Promise.all([vergleichBon(db, k, bon), vorschlaege(db, k, bon.id, suche || undefined)]);
	return { bon: dieser, vorschlaege: liste, suche };
};
