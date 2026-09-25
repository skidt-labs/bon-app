import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonLaden } from '$lib/server/bons/liste';
import {
	korrekturenSchema,
	pruefeKorrekturen,
	korrekturenAnwenden,
	lernenNachtragen,
	KorrekturVerfehlt,
	type Gelerntes
} from '$lib/server/receipts/korrekturen';
import type { RequestHandler } from './$types';

/**
 * Speichern ohne bestaetigen: der Bon bleibt in `review`. Gebraucht fuer "Spaeter" und
 * "Am Schreibtisch weiter" — wer mitten in der Pruefung aufhoert, soll nichts verlieren.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');

	const receipt = await bonLaden(db, locals.zugriff!, params.id);
	if (!receipt) error(404, 'Bon nicht gefunden');
	// Auch ein BESTAETIGTER Bon darf hier noch geaendert werden, und er bleibt dabei
	// bestaetigt (korrekturenAnwenden ruehrt den Status nur beim Bestaetigen an).
	//
	// Die Sperre war urspruenglich auf `review` eingeengt. Das fror die Daten ein: ein
	// Fehler faellt oft erst Wochen spaeter auf, und dann gab es keinen Weg mehr hinein
	// — am 17.09.2026 stand so ein Bon mit 6,22 EUR statt 2,49 EUR dauerhaft als
	// geprueft in den Auswertungen. Verhindern soll die Sperre eine DOPPELTE
	// Bestaetigung, nicht die spaetere Korrektur; deshalb bleibt sie in confirm/ eng
	// und ist hier weit.
	if (receipt.status !== 'review' && receipt.status !== 'confirmed') {
		error(409, 'Dieser Bon ist noch nicht ausgelesen und kann darum nicht geändert werden.');
	}

	const geparst = korrekturenSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Ungültige Korrekturen');
	const geprueft = pruefeKorrekturen(geparst.data);
	if (!geprueft.ok) error(400, geprueft.grund);

	let gelernt: Gelerntes[] = [];
	try {
		gelernt = await db.transaction((tx) =>
			korrekturenAnwenden(tx, receipt.id, geparst.data, {
				bestaetigen: false,
				userId: locals.user!.id,
				// Nur ein bereits bestaetigter Bon laesst hier die Sichtbarkeit aendern.
				// Bei einem ungeprueften bliebe sie ohnehin 'privat' — er wird erst beim
				// Bestaetigen geteilt.
				warBestaetigt: receipt.status === 'confirmed'
			})
		);
	} catch (err) {
		if (err instanceof KorrekturVerfehlt) {
			error(409, 'Die Korrekturen passen nicht zu diesem Bon. Bitte die Seite neu laden.');
		}
		throw err;
	}

	// Erst jetzt, mit abgeschlossener Transaktion: aus jeder Hand-Zuordnung wird eine
	// Regel, damit derselbe Artikel beim naechsten Bon ohne Modellaufruf einsortiert wird.
	await lernenNachtragen(receipt.id, gelernt);

	return json({ ok: true });
};
