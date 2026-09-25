import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { darfTopfAendern } from '$lib/server/zugriff/kontext';
import {
	aenderungSchema,
	betragSetzen,
	budgetLoeschen,
	budgetUmbenennen,
	kategorieLoesen,
	kategorieZuordnen,
	topfLaden,
	KategorieBelegt
} from '$lib/server/budgets/verwaltung';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { aktuellerMonat } from '$lib/server/zeit';
import type { RequestHandler } from './$types';

/**
 * Der Topf muss diesem Haushalt gehoeren. Geprueft wird das bei JEDEM Zugriff, nicht
 * einmal beim Laden der Seite: die Adresse ist ratbar, und Budgets sind die Stelle, an
 * der ein fremder Haushalt seine Zahlen stehen haette.
 */
async function eigenerTopf(k: Zugriffskontext, id: string) {
	const topf = await topfLaden(db, k, id);
	if (!topf) error(404, 'Budget nicht gefunden');
	// Sehen und Aendern sind zwei Fragen. Ein Mitglied SIEHT die gemeinsamen Toepfe —
	// es soll ja wissen, wie voll sie sind —, aendern darf sie nur der Verwalter. Den
	// eigenen privaten Topf darf es dagegen vollstaendig verwalten.
	if (!darfTopfAendern(k, topf)) {
		error(403, 'Gemeinsame Töpfe verwaltet die Person, die den Haushalt verwaltet.');
	}
	return topf;
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const k = locals.zugriff!;
	await eigenerTopf(k, params.id);

	const geparst = aenderungSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Ungültige Änderung');
	const a = geparst.data;

	try {
		if (a.art === 'umbenennen') await budgetUmbenennen(db, params.id, a.name);
		else if (a.art === 'betrag') await betragSetzen(db, params.id, a.monat, a.amountCents);
		else if (a.art === 'zuordnen') await kategorieZuordnen(db, k, params.id, a.categoryId, a.abMonat);
		else await kategorieLoesen(db, k, params.id, a.categoryId, a.abMonat);
	} catch (err) {
		// Die Datenbank hat abgelehnt, weil die Kategorie schon vergeben ist. Die Meldung
		// nennt den Topf — „schon vergeben" allein liesse den Menschen suchen.
		if (err instanceof KategorieBelegt) error(409, err.message);
		throw err;
	}
	return json({ ok: true });
};

/**
 * Loeschen heisst beenden, nicht entfernen: Name und Betraege bleiben, damit vergangene
 * Berichte unveraendert bleiben. Ohne Angabe gilt der laufende Monat — ein Topf, den man
 * heute loescht, soll heute nicht mehr gelten.
 */
export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const k = locals.zugriff!;
	await eigenerTopf(k, params.id);
	const abMonat = url.searchParams.get('abMonat') ?? aktuellerMonat();
	if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(abMonat)) error(400, 'Monat als JJJJ-MM angeben');
	await budgetLoeschen(db, k, params.id, abMonat);
	return json({ ok: true });
};
