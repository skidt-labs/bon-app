import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { exportZeilenLaden } from '$lib/server/berichte/abfragen';
import { alsCsv } from '$lib/server/berichte/csv';
import { monatsgrenzen } from '$lib/server/zeit';
import type { RequestHandler } from './$types';

const MONAT = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * Ein Monat als CSV, eine Zeile je Position — zum Weiterrechnen in der Tabelle.
 *
 * Ausgefuehrt werden NUR bestaetigte Bons, wie im Bericht: was noch niemand geprueft
 * hat, ist keine Zahl, mit der man rechnen sollte.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const monat = url.searchParams.get('monat') ?? '';
	if (!MONAT.test(monat)) error(400, 'Monat als JJJJ-MM angeben');
	const grenzen = monatsgrenzen(monat);
	if (!grenzen) error(400, 'Monat als JJJJ-MM angeben');

	const zeilen = await exportZeilenLaden(db, locals.zugriff!, grenzen);

	// Byte-Reihenfolge-Marke voran: ohne sie liest Excel die Datei als Latin-1, und aus
	// „Gemüse" wird „GemÃ¼se". Ein Ausfuhrformat, das der Empfaenger nachbearbeiten muss,
	// ist keines.
	const inhalt = '﻿' + alsCsv(zeilen) + '\r\n';
	return new Response(inhalt, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="bons-${monat}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
