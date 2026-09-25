import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { bonLaden } from '$lib/server/bons/liste';
import { doppeltEntscheiden } from '$lib/server/bons/doppelt';
import type { RequestHandler } from './$types';

const rumpfSchema = z.object({ entscheidung: z.enum(['doppelt', 'eigenerEinkauf', 'wiederherstellen']) });

/**
 * Die Entscheidung zum Doppel-Hinweis: „doppelt" (verwerfen), „eigener Einkauf" (Hinweis
 * weg) oder „wiederherstellen" (ein verworfener Bon zurueck in die Pruefung). Die Regeln
 * stehen in bons/doppelt.ts; dort ist jede Entscheidung EIN atomares UPDATE.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const k = locals.zugriff!;

	const geparst = rumpfSchema.safeParse(await request.json().catch(() => null));
	if (!geparst.success) error(400, 'Unbekannte Entscheidung');

	if (await doppeltEntscheiden(db, k, params.id, geparst.data.entscheidung)) return json({ ok: true });

	// Keine Zeile getroffen. Nur jetzt, fuer eine ehrliche Meldung, ein lesender Blick —
	// wie bei reprocess: nicht sichtbar ist 404, falscher Zustand 409.
	const bon = await bonLaden(db, k, params.id);
	if (!bon) error(404, 'Bon nicht gefunden');
	error(409, 'Dazu ist schon entschieden worden. Bitte die Seite neu laden.');
};
