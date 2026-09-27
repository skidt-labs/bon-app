import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { ausPapierkorbHolen } from '$lib/server/bons/papierkorb';
import type { RequestHandler } from './$types';

/** Aus dem Papierkorb zurueck in den Status von vorher; ein beim Lesen verworfener wird neu gelesen. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const r = await ausPapierkorbHolen(db, locals.zugriff!, params.id);
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
