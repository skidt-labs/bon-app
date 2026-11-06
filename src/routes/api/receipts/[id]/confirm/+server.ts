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
 * Speichern UND bestaetigen. Seit der Oberflaechen-Umstellung (2026-09-17) nimmt dieser
 * Endpunkt denselben vollstaendigen Rumpf wie PUT — vorher waren es nur Betrag und Art
 * je Zeile, mehr konnte die alte Ansicht nicht aendern. Statuswaechter und Trefferzahl-
 * Pruefung sind von dort uebernommen: eine Korrektur, die keine Zeile trifft, darf den
 * Bon nicht still bestaetigen.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');

	const receipt = await bonLaden(db, locals.zugriff!, params.id);
	if (!receipt) error(404, 'Bon nicht gefunden');
	// `failed` darf auch: ein Mensch hat den Bon von Hand eingetragen, weil das Auslesen
	// scheiterte (27.09.2026). Das Bild ist da, und wer bestaetigt, hat es angesehen.
	if (receipt.status !== 'review' && receipt.status !== 'failed') {
		ablehnen('bestaetigen', receipt.id, statusSperrText(receipt.status), 'status');
	}

	// Offener Doppel-Hinweis (bons/doppelt.ts): erst entscheiden, dann bestaetigen. Sonst
	// stuende derselbe Einkauf zweimal im Haushaltsbuch.
	if (receipt.vermutetesOriginalId) {
		ablehnen('bestaetigen', receipt.id, 'Dieser Bon sieht aus wie ein schon erfasster. Bitte erst entscheiden: doppelt oder eigener Einkauf.', 'doppel');
	}

	const geparst = korrekturenSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Ungültige Korrekturen');
	const geprueft = pruefeKorrekturen(geparst.data);
	if (!geprueft.ok) error(400, geprueft.grund);
	// Die Seite hat den Bon mit einem anderen Status geladen (anderes Fenster): nichts schreiben.
	if (geparst.data.erwartet !== undefined && geparst.data.erwartet !== receipt.status) {
		ablehnen('bestaetigen', receipt.id, `geladen als ${geparst.data.erwartet}, jetzt ${receipt.status}`, 'status', statusSperrText(receipt.status));
	}
	// Beim ausgelesenen Bon meldet ein fehlender Betrag der Worker ('missing_total'). Ein
	// von Hand eingetragener Fehlschlag haette ohne Endsumme in den Berichten 0 EUR.
	if (receipt.status === 'failed' && geparst.data.receipt.totalGrossCents === null) {
		error(400, 'Ohne Endsumme lässt sich ein von Hand eingetragener Bon nicht bestätigen.');
	}

	// Sieht er aus wie ein schon erfasster Bon, wird er NICHT bestaetigt, sondern landet mit
	// dem Doppel-Hinweis in der Pruefung — dieselbe Entscheidung wie bei einem gelesenen.
	const doppelVon = await originalBeimEintragen(receipt, geparst.data);

	let gelernt: Gelerntes[] = [];
	try {
		gelernt = await db.transaction((tx) =>
			korrekturenAnwenden(tx, receipt.id, geparst.data, {
				bestaetigen: doppelVon === null,
				userId: locals.user!.id,
				ausStatus: receipt.status,
				doppelVon,
				beimUeberschreiben: (z) => ueberschriebenProtokollieren('bestaetigen', receipt.id, z)
			})
		);
	} catch (err) {
		if (err instanceof KorrekturVerfehlt) {
			// Status geaendert: nur Neuladen hilft. Zeilen passen nicht: die Seite bietet
			// „Meine Fassung speichern“ an (ueberschreiben, Entwurf 2026-11-06-pruefhilfen, §4b).
			if (err.art === 'status') ablehnen('bestaetigen', receipt.id, err.message, 'status', 'Dieser Bon hat sich gerade geändert. Bitte die Seite neu laden.');
			ablehnen('bestaetigen', receipt.id, err.message, 'veraltet', 'Dieser Bon wurde inzwischen anderswo geändert — vielleicht in einem anderen Fenster.');
		}
		throw err;
	}

	// Erst jetzt, mit abgeschlossener Transaktion: aus jeder Hand-Zuordnung wird eine
	// Regel, damit derselbe Artikel beim naechsten Bon ohne Modellaufruf einsortiert wird.
	await lernenNachtragen(receipt.id, gelernt);

	return json(doppelVon ? { ok: true, doppelt: true } : { ok: true });
};
