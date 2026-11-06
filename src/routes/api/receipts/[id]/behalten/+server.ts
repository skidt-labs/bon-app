import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { behalten } from '$lib/server/bons/vergleich';
import { leseErwartet } from '$lib/server/bons/erwartet';
import type { RequestHandler } from './$types';

/** „Diesen behalten" (Doppel vergleichen): dieser bleibt, `weg` geht in den Papierkorb (bons/vergleich.ts). */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const rumpf = (await request.json().catch(() => null)) as { weg?: unknown; erwartet?: unknown } | null;
	const weg = rumpf?.weg;
	if (typeof weg !== 'string' || weg === '') error(400, 'Feld "weg" fehlt');
	const erwartet = leseErwartet(rumpf?.erwartet);
	const r = await behalten(db, locals.zugriff!, params.id, weg, { erwartet });
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
