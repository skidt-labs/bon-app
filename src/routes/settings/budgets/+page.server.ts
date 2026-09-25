import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { budgetsSeiteLaden } from '$lib/server/budgets/verwaltung';
import { aktuellerMonat } from '$lib/server/zeit';
import type { PageServerLoad } from './$types';

const MONAT = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	// Ein unbrauchbarer Monat in der Adresse faellt auf den laufenden zurueck — und sagt
	// das auch. Still zu raten waere schlimmer als zu antworten.
	const gewuenscht = url.searchParams.get('monat');
	const monat = gewuenscht && MONAT.test(gewuenscht) ? gewuenscht : aktuellerMonat();
	const hinweis = gewuenscht && !MONAT.test(gewuenscht) ? `„${gewuenscht}" ist kein Monat — gezeigt wird ${monat}.` : null;

	const { kategorien, budgets, ausserhalb, positionen } = await budgetsSeiteLaden(db, locals.zugriff!, monat);

	return {
		monat,
		hinweis,
		kategorien,
		budgets,
		ausserhalb,
		positionen,
		// Die Oberflaeche braucht die Rolle, um zu erklaeren statt nur auszugrauen.
		// Die Entscheidung faellt trotzdem am Server — hier geht es nur darum, was
		// dem Menschen gezeigt wird.
		istVerwalter: locals.zugriff!.rolle === 'verwalter'
	};
};
