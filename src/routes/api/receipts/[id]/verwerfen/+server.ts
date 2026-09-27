import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { inPapierkorbLegen } from '$lib/server/bons/papierkorb';
import type { RequestHandler } from './$types';

/** In den Papierkorb. Ein bestaetigter Bon nur mit `bestaetigtWegnehmen: true` (Rueckfrage in der Seite). */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const rumpf = (await request.json().catch(() => ({}))) as { bestaetigtWegnehmen?: unknown } | null;
	const r = await inPapierkorbLegen(db, locals.zugriff!, params.id, rumpf?.bestaetigtWegnehmen === true);
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
