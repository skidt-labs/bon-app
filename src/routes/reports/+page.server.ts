import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { berichtLaden } from '$lib/server/berichte/abfragen';
import { aktuellerMonat } from '$lib/server/zeit';
import type { PageServerLoad } from './$types';

const MONAT = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	// Ein unbrauchbarer Monat in der Adresse faellt auf den laufenden zurueck UND sagt
	// es. Still zu raten waere schlimmer als zu antworten — dieselbe Regel wie in der
	// Bon-Liste (Etappe 1) und auf der Budgetseite.
	const gewuenscht = url.searchParams.get('monat');
	const monat = gewuenscht && MONAT.test(gewuenscht) ? gewuenscht : aktuellerMonat();
	const hinweis =
		gewuenscht && !MONAT.test(gewuenscht)
			? `„${gewuenscht}" ist kein Monat — gezeigt wird ${monat}.`
			: null;

	return { hinweis, ...(await berichtLaden(db, locals.zugriff!, monat)) };
};
