import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bonLaden, bonReaktivieren, bonAlsFehlgeschlagenMarkieren } from '$lib/server/bons/liste';
import { enqueueExtraction } from '$lib/server/queue/boss';
import type { RequestHandler } from './$types';

/**
 * Aufgabe 4, Teil B, Punkt 3: der Weg zurück in die Warteschlange. Bisher kannte
 * `src/routes/api/receipts/[id]/` nur `confirm` — ein Bon, der wegen eines
 * abwesenden Mac liegengeblieben ist (Status 'failed', siehe extract-receipt.ts),
 * hatte keinen Weg zurück ausser einem direkten Datenbankzugriff.
 *
 * Statuswächter genauso streng wie bei `confirm/+server.ts`, aber mit einer
 * zusätzlichen Sicherung, die dort nicht nötig war: die ÜBERGANGSPRÜFUNG selbst
 * (status = 'failed') UND die zugehörige SCHREIBUNG laufen in EINEM einzigen
 * UPDATE ... WHERE ... RETURNING statt in einem SELECT gefolgt von einem separaten
 * UPDATE. Ein SELECT-dann-UPDATE hätte ein Zeitfenster: zwei nahezu gleichzeitige
 * Reprocess-Aufrufe könnten beide den SELECT mit status='failed' bestehen, bevor
 * einer von beiden den Status ändert — und der Bon landete zweimal in der
 * Warteschlange. Das atomare UPDATE lässt nur den ERSTEN Aufruf eine Zeile treffen;
 * der zweite sieht (egal wie knapp danach) bereits status='pending' und geht leer
 * aus, genau wie bei `confirm/+server.ts`s Trefferzahl-Prüfung auf receipt_items.
 *
 * Nur 'failed' ist als Startzustand erlaubt (nicht auch 'review', wie es Entwurf E8
 * für einen künftigen Cloud-gegen-lokal-Vergleich vorsieht) — das ist eine bewusste
 * Einschränkung auf genau den in der Aufgabenstellung beschriebenen Fall, siehe
 * Task-4-Bericht. 'pending'/'extracting' würden doppelt einreihen, 'confirmed' würde
 * eine bereits geprüfte Fassung überschreiben — beides schliesst die Whitelist auf
 * genau EINEN erlaubten Ausgangszustand strukturell aus, ohne dass eine der beiden
 * Bedingungen einzeln geprüft werden muss.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const k = locals.zugriff!;

	const reactivated = await bonReaktivieren(db, k, params.id);

	if (!reactivated) {
		// Das atomare UPDATE oben unterscheidet nicht, WARUM es keine Zeile getroffen
		// hat (nicht gefunden vs. falscher Status) — dafür jetzt ein reines SELECT,
		// nur für eine hilfreiche Fehlermeldung, ohne selbst etwas zu schreiben.
		const receipt = await bonLaden(db, k, params.id);

		if (!receipt) error(404, 'Bon nicht gefunden');

		if (receipt.status === 'confirmed') {
			error(409, 'Dieser Bon ist bereits bestätigt und wird nicht erneut ausgelesen.');
		}
		if (receipt.status === 'pending' || receipt.status === 'extracting') {
			error(409, 'Dieser Bon wird bereits verarbeitet.');
		}
		if (receipt.status === 'review') {
			error(409, 'Dieser Bon ist bereits ausgelesen und wartet auf Bestätigung.');
		}
		// Sollte praktisch nie erreicht werden (z. B. ein Bon, dessen Status sich
		// zwischen dem UPDATE oben und diesem SELECT durch einen zweiten,
		// gleichzeitigen Aufruf bereits geändert hat) — kein stummer Fehlschlag.
		error(409, `Dieser Bon kann derzeit nicht erneut ausgelesen werden (Status: ${receipt.status}).`);
	}

	try {
		await enqueueExtraction(reactivated.id);
	} catch (err) {
		// Derselbe Fehlerpfad wie beim ursprünglichen Upload (src/routes/api/receipts/
		// +server.ts): der Bon ist bereits auf 'pending' gesetzt, nur der Job fehlt.
		// Ohne diese Markierung bliebe er unsichtbar auf "pending" stehen, als würde
		// noch etwas passieren.
		const reason = err instanceof Error ? err.message : String(err);
		await bonAlsFehlgeschlagenMarkieren(db, reactivated.id, reason);
		console.error('[api/receipts/reprocess] enqueue fehlgeschlagen', err);
		return json({ id: reactivated.id, queued: false });
	}

	return json({ id: reactivated.id, queued: true });
};
