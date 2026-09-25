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
	if (receipt.status !== 'review') {
		error(
			409,
			receipt.status === 'confirmed'
				? 'Dieser Bon ist bereits bestätigt.'
				: 'Dieser Bon ist noch nicht ausgelesen und kann darum nicht bestätigt werden.'
		);
	}

	// Offener Doppel-Hinweis (bons/doppelt.ts): erst entscheiden, dann bestaetigen. Sonst
	// stuende derselbe Einkauf zweimal im Haushaltsbuch.
	if (receipt.vermutetesOriginalId) {
		error(409, 'Dieser Bon sieht aus wie ein schon erfasster. Bitte erst entscheiden: doppelt oder eigener Einkauf.');
	}

	const geparst = korrekturenSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Ungültige Korrekturen');
	const geprueft = pruefeKorrekturen(geparst.data);
	if (!geprueft.ok) error(400, geprueft.grund);

	let gelernt: Gelerntes[] = [];
	try {
		gelernt = await db.transaction((tx) =>
			korrekturenAnwenden(tx, receipt.id, geparst.data, { bestaetigen: true, userId: locals.user!.id })
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
