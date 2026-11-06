import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { pruefePaar, vergleichBon, vergleichLaden } from '$lib/server/bons/vergleich';
import type { PageServerLoad } from './$types';

const LIEST = 'Einer der beiden Bons wird noch gelesen.';

/**
 * Gegenueberstellung zweier Bons; Bon 1 (`a`) ist der, von dem man kam. Fehlt einer, ist es
 * derselbe oder liegt einer im Papierkorb, zeigt die Seite einen Satz statt der Spalten
 * (`fehler`, kein 500). Liest einer noch, stehen die Spalten da, die Knoepfe sind gesperrt.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const k = locals.zugriff!;
	const geladen = await vergleichLaden(db, k, params.id, params.anderer);
	if (!geladen.ok) return { fehler: geladen.meldung, a: null, b: null, gesperrt: null };
	const paar = pruefePaar(geladen.a, geladen.b);
	if (paar && paar.meldung !== LIEST) return { fehler: paar.meldung, a: null, b: null, gesperrt: null };
	const [a, b] = await Promise.all([vergleichBon(db, k, geladen.a), vergleichBon(db, k, geladen.b)]);
	return { fehler: null, a, b, gesperrt: paar?.meldung ?? null };
};
