import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { originalWiederherstellen } from '$lib/server/bons/bild';
import type { RequestHandler } from './$types';

/** Das unbearbeitete Foto zurueckholen und neu lesen (bons/bild.ts). */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const r = await originalWiederherstellen(db, locals.zugriff!, params.id);
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
