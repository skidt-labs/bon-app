import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { budgetAnlegen, budgetSchema } from '$lib/server/budgets/verwaltung';
import { darfGeteiltesVerwalten } from '$lib/server/zugriff/kontext';
import type { RequestHandler } from './$types';

/** Einen neuen Topf anlegen. Betrag und Kategorien kommen danach ueber PATCH. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Nicht angemeldet');
	const geparst = budgetSchema.safeParse(await request.json());
	if (!geparst.success) error(400, 'Der Topf braucht einen Namen.');
	// Einen GEMEINSAMEN Topf legt nur der Verwalter an; seinen eigenen privaten darf
	// jeder. Bis 18.09.2026 fehlte diese Pruefung ganz (Befund R14) — die Rollenmatrix
	// im Entwurf stand nur auf dem Papier.
	if (!geparst.data.privat && !darfGeteiltesVerwalten(locals.zugriff!)) {
		error(403, 'Gemeinsame Töpfe verwaltet die Person, die den Haushalt verwaltet.');
	}
	const id = await budgetAnlegen(db, locals.zugriff!, geparst.data.name, geparst.data.privat);
	return json({ id }, { status: 201 });
};
