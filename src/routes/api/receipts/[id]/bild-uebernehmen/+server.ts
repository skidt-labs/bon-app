import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bildUebernehmen, BildSpeicherFehler } from '$lib/server/bons/bild';
import { leseErwartet } from '$lib/server/bons/erwartet';
import type { RequestHandler } from './$types';

/**
 * „Nur das Bild uebernehmen" (Doppel vergleichen): dieser Bon (bestaetigt) bekommt das Bild von
 * `quelle`, die in den Papierkorb geht (bons/bild.ts). Speicherfehler wie bei „Bild bearbeiten".
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const rumpf = (await request.json().catch(() => null)) as { quelle?: unknown; erwartet?: unknown } | null;
	const quelle = rumpf?.quelle;
	const erwartet = leseErwartet(rumpf?.erwartet);
	if (typeof quelle !== 'string' || quelle === '') error(400, 'Feld "quelle" fehlt');
	let r;
	try {
		r = await bildUebernehmen(db, locals.zugriff!, params.id, quelle, undefined, erwartet);
	} catch (err) {
		if (err instanceof BildSpeicherFehler) {
			if (err.systemfehler) console.error('[api/receipts/bild-uebernehmen] Systemfehler beim Speichern', err);
			error(err.systemfehler ? 503 : 422, err.message);
		}
		throw err;
	}
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
