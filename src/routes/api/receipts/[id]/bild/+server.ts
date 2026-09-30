import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bildErsetzen, BildSpeicherFehler } from '$lib/server/bons/bild';
import type { RequestHandler } from './$types';

/** Dieselbe Grenze wie beim Hochladen (api/receipts/+server.ts). */
const MAX_BYTES = 12 * 1024 * 1024;

/** Bearbeitetes Bild uebernehmen und neu lesen (bons/bild.ts). */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const form = await request.formData();
	const file = form.get('image');
	if (!(file instanceof File)) error(400, 'Feld "image" fehlt');
	if (file.size === 0) error(400, 'Leere Datei');
	if (file.size > MAX_BYTES) error(413, 'Bild zu groß (max. 12 MB)');
	const buf = Buffer.from(await file.arrayBuffer());
	let r;
	try {
		r = await bildErsetzen(db, locals.zugriff!, params.id, buf);
	} catch (err) {
		if (err instanceof BildSpeicherFehler) {
			if (err.systemfehler) console.error('[api/receipts/bild] Systemfehler beim Speichern', err);
			error(err.systemfehler ? 503 : 422, err.message);
		}
		throw err;
	}
	if (!r.ok) error(r.status, r.meldung);
	return json({ ok: true });
};
