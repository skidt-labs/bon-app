import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { exportLaden } from '$lib/server/berichte/export';
import { alsCsv, exportDateiname } from '$lib/server/berichte/csv';
import { heutigerTag } from '$lib/server/zeit';
import { filterAusAdresse, hatFilter, wirktAufPositionen } from '$lib/berichte/filter';
import { filterZusammenfassung } from '$lib/berichte/merkmale';
import { zeitraumName } from '$lib/berichte/zeitleiste';
import { tagName } from '$lib/berichte/kalender';
import type { RequestHandler } from './$types';

/**
 * Ein Bericht als CSV, eine Zeile je Position — zum Weiterrechnen in der Tabelle. Dieselbe
 * Adresse wie der Bericht (auch die Altform ?monat=), dieselbe Rechnung.
 *
 * Ausgefuehrt werden NUR bestaetigte Bons, wie im Bericht.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const heute = heutigerTag();
	const gelesen = filterAusAdresse(url.searchParams, heute);
	// Eine Datei kann keinen Hinweis zeigen. Statt still etwas anderes auszufuehren als
	// verlangt (etwa den laufenden Monat statt eines vertippten): ablehnen und sagen, warum.
	if (gelesen.hinweise.length > 0) error(400, gelesen.hinweise.join(' '));

	const aus = await exportLaden(db, locals.zugriff!, gelesen.filter);
	const kopf: [string, string][] = [
		['Zeitraum', zeitraumName(aus.filter.zeitraum)],
		['Umfang', aus.filter.umfang === 'meine' ? 'Nur meine Bons' : 'Ganzer Haushalt'],
		['Filter', hatFilter(aus.filter) ? filterZusammenfassung(aus.filter, aus.namen).join(' · ') : 'keine'],
		['Zeilen', wirktAufPositionen(aus.filter) ? 'nur die passenden Positionen' : 'alle Positionen der Bons'],
		['Stand', `nur bestätigte Bons · erstellt am ${tagName(heute)}`],
		// Unbekanntes aus einem alten Lesezeichen wurde weggelassen — das steht in der Datei.
		...aus.hinweise.map((h): [string, string] => ['Hinweis', h])
	];

	// Byte-Reihenfolge-Marke voran: ohne sie liest Excel die Datei als Latin-1, und aus
	// „Gemüse" wird „GemÃ¼se".
	const inhalt = '﻿' + alsCsv(aus.zeilen, kopf) + '\r\n';
	return new Response(inhalt, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${exportDateiname(aus.filter.zeitraum)}"`,
			'cache-control': 'no-store'
		}
	});
};
