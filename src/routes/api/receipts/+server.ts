import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonAnlegen, bonAlsFehlgeschlagenMarkieren } from '$lib/server/bons/liste';
import { storeReceiptImage, istSystemfehler } from '$lib/server/storage/images';
import { enqueueExtraction } from '$lib/server/queue/boss';
import type { RequestHandler } from './$types';

const MAX_BYTES = 12 * 1024 * 1024;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');

	const form = await request.formData();
	const file = form.get('image');
	if (!(file instanceof File)) error(400, 'Feld "image" fehlt');
	if (file.size === 0) error(400, 'Leere Datei');
	if (file.size > MAX_BYTES) error(413, 'Bild zu groß (max. 12 MB)');

	// Woher der Bon kam. Ein Bon pro Aufruf — mehrere ausgewählte Fotos schickt
	// der Client einzeln durch die Outbox, damit jedes seinen eigenen Job bekommt.
	const rawSource = form.get('source');
	const source = rawSource === 'upload' ? 'upload' : 'camera';

	const buf = Buffer.from(await file.arrayBuffer());

	// storeReceiptImage wirft einen einfachen Error ohne .code für jedes Bild, das
	// sharp nicht lesen kann (kaputt, abgeschnitten, nicht unterstütztes Format wie
	// HEIC) — sharps Fehlertext ist keine stabile Schnittstelle zum Auswerten, das
	// bleibt weiterhin ein endgültiges 422 (ein erneuter Versuch mit demselben Bild
	// hilft nie).
	//
	// ABER: ein Dateisystemfehler (volle Platte ENOSPC, fehlende Schreibrechte
	// EACCES, ...) sagt nichts über das Bild aus, sondern über UNSERE Infrastruktur.
	// Die Outbox löscht ihre einzige Kopie des Fotos, sobald sie ein 422 sieht
	// (siehe outbox.ts, PERMANENTLY_REJECTED) — ein per ENOSPC ausgelöstes 422 hätte
	// also ein unversehrtes Foto endgültig vernichtet (Befund R03). istSystemfehler()
	// unterscheidet zuverlässig über den Fehlercode, nicht über den Text. 503 statt
	// 500: der Fehler ist voraussichtlich vorübergehend, die Outbox soll das Foto
	// behalten und später erneut versuchen.
	let imagePath: string;
	let thumbPath: string;
	try {
		({ imagePath, thumbPath } = await storeReceiptImage(buf, new Date()));
	} catch (err) {
		if (istSystemfehler(err)) {
			console.error('[api/receipts] Systemfehler beim Speichern des Bilds', err);
			error(503, 'Bild konnte gerade nicht gespeichert werden');
		}
		error(422, 'Bild nicht verarbeitbar');
	}

	const id = await bonAnlegen(db, locals.zugriff!, { imagePath, thumbPath, source });

	try {
		await enqueueExtraction(id);
	} catch (err) {
		// Der Bon liegt bereits in der Datenbank, nur der Job fehlt. Ohne diese
		// Markierung bliebe er für immer unsichtbar auf "pending" stehen, und ein
		// Wiederholungsversuch des Nutzers erzeugte einen Doppeleintrag.
		const reason = err instanceof Error ? err.message : String(err);
		await bonAlsFehlgeschlagenMarkieren(db, id, reason);
		console.error('[api/receipts] enqueue fehlgeschlagen', err);
		// KEIN 503 mehr. Der Bon liegt samt Bild auf dem Server — ein Fehlerstatus
		// hiesse für die Offline-Warteschlange "später erneut versuchen", und der
		// nächste Durchgang lüde DASSELBE Foto ein zweites Mal hoch: ein Doppel-Bon
		// zusätzlich zur Karteileiche. Was hier fehlgeschlagen ist, ist der
		// Hintergrundauftrag, und den bringt ein erneuter Upload nicht zurück.
		// 201 mit `queued: false` sagt stattdessen die Wahrheit: angekommen, aber die
		// Auswertung läuft nicht an. Sichtbar bleibt es über den Status `failed` im
		// Posteingang — überleben und markieren, nicht verwerfen.
		return json({ id, queued: false }, { status: 201 });
	}

	return json({ id, queued: true }, { status: 201 });
};
