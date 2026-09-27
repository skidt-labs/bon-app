import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { dochEinBon } from '$lib/server/bons/kein-bon-entscheidung';
import type { RequestHandler } from './$types';

/** „Doch ein Bon, lesen": fehlgeschlagen → neu ohne Vorpruefung, gelesen → Hinweis weg. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const r = await dochEinBon(db, locals.zugriff!, params.id);
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
