import { json, error } from '@sveltejs/kit';
import { statusSperrText } from '$lib/bons/sperrtext';
import { db } from '$lib/server/db';
import { bonLaden } from '$lib/server/bons/liste';
import {
	korrekturenSchema,
	pruefeKorrekturen,
	korrekturenAnwenden,
	lernenNachtragen,
	originalBeimEintragen,
	KorrekturVerfehlt,
	type Gelerntes
} from '$lib/server/receipts/korrekturen';
import { ablehnen, ueberschriebenProtokollieren } from '$lib/server/receipts/ablehnung';
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
	//
	// Ein FEHLGESCHLAGENER Bon darf ebenfalls hinein: das Bild ist da, nur das Auslesen
	// ging schief, und dann traegt ihn eben ein Mensch ein (27.09.2026). Beim Speichern
	// wird er zu einem Bon in Pruefung (korrekturenAnwenden).
	if (receipt.status !== 'review' && receipt.status !== 'confirmed' && receipt.status !== 'failed') {
		ablehnen('speichern', receipt.id, statusSperrText(receipt.status), 'status');
	}

	const geparst = korrekturenSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Ungültige Korrekturen');
	const geprueft = pruefeKorrekturen(geparst.data);
	if (!geprueft.ok) error(400, geprueft.grund);
	// Die Seite hat den Bon mit einem anderen Status geladen (anderes Fenster): nichts schreiben.
	if (geparst.data.erwartet !== undefined && geparst.data.erwartet !== receipt.status) {
		ablehnen('speichern', receipt.id, `geladen als ${geparst.data.erwartet}, jetzt ${receipt.status}`, 'status', statusSperrText(receipt.status));
	}

	const doppelVon = await originalBeimEintragen(receipt, geparst.data);

	let gelernt: Gelerntes[] = [];
	try {
		gelernt = await db.transaction((tx) =>
			korrekturenAnwenden(tx, receipt.id, geparst.data, {
				bestaetigen: false,
				userId: locals.user!.id,
				// Nur ein bereits bestaetigter Bon laesst hier die Sichtbarkeit aendern.
				// Bei einem ungeprueften bliebe sie ohnehin 'privat' — er wird erst beim
				// Bestaetigen geteilt.
				warBestaetigt: receipt.status === 'confirmed',
				ausStatus: receipt.status,
				doppelVon,
				beimUeberschreiben: (z) => ueberschriebenProtokollieren('speichern', receipt.id, z)
			})
		);
	} catch (err) {
		if (err instanceof KorrekturVerfehlt) {
			// Status geaendert: nur Neuladen hilft. Zeilen passen nicht: die Seite bietet
			// „Meine Fassung speichern“ an (ueberschreiben, Entwurf 2026-11-06-pruefhilfen, §4b).
			if (err.art === 'status') ablehnen('speichern', receipt.id, err.message, 'status', 'Dieser Bon hat sich gerade geändert. Bitte die Seite neu laden.');
			ablehnen('speichern', receipt.id, err.message, 'veraltet', 'Dieser Bon wurde inzwischen anderswo geändert — vielleicht in einem anderen Fenster.');
		}
		throw err;
	}

	// Erst jetzt, mit abgeschlossener Transaktion: aus jeder Hand-Zuordnung wird eine
	// Regel, damit derselbe Artikel beim naechsten Bon ohne Modellaufruf einsortiert wird.
	await lernenNachtragen(receipt.id, gelernt);

	return json({ ok: true });
};
