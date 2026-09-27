import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { endgueltigLoeschen } from '$lib/server/bons/papierkorb';
import type { RequestHandler } from './$types';

/** Endgueltig loeschen — nur ein Bon, der schon im Papierkorb liegt. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const r = await endgueltigLoeschen(db, locals.zugriff!, params.id);
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
