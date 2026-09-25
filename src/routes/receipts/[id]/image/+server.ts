import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { db } from '$lib/server/db';
import { bonLaden } from '$lib/server/bons/liste';
import { receiptPathFor } from '$lib/server/storage/images';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const row = await bonLaden(db, locals.zugriff!, params.id);
	if (!row) error(404, 'Bon nicht gefunden');

	// storeReceiptImage (Task 6) schreibt das Original ausnahmslos als .webp — kein
	// Content-Type-Sniffing nötig, der Header ist so verlässlich wie die Spalte selbst.
	let buf: Buffer;
	try {
		buf = await readFile(receiptPathFor(row.imagePath));
	} catch {
		// Die DB-Zeile existiert, die Datei auf der Platte nicht (mehr) — z. B. nach
		// einem Restore ohne die zugehörigen Bilddateien. Das ist ein Betriebsfehler,
		// kein falscher Zugriff: 404 statt 500, aber mit eigenem Text, damit man beide
		// Fälle im Log unterscheiden kann.
		error(404, 'Bilddatei nicht auffindbar');
	}
	return new Response(new Uint8Array(buf), {
		headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000' }
	});
};
