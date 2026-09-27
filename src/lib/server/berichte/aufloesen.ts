import { asc, eq, inArray } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { budgets, budgetBetraege, budgetKategorien, categories, householdMembers, merchants, users } from '$lib/server/db/schema';
import { sichtbareToepfe } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { LADEN_UNBEKANNT, UNSORTIERT, type BerichtFilter } from '$lib/berichte/filter';
import type { FilterNamen } from '$lib/berichte/merkmale';
import { kategorienAufloesen } from './rechnung';
import { topfKategorienJeMonat, type PositionsKriterien } from './kriterien';

export type Stammdaten = {
	kategorien: { id: string; name: string; parentId: string | null; slug: string }[];
	toepfe: { id: string; name: string; sichtbarkeit: 'geteilt' | 'privat'; geloeschtAb: string | null }[];
	betraege: { budgetId: string; giltAb: string; amountCents: number }[];
	zuordnungen: { budgetId: string; categoryId: string; giltAb: string; giltBis: string | null; eigentuemerId: string | null }[];
	mitglieder: { id: string; name: string }[];
};

/** Was jeder Bericht an Stammdaten braucht — Toepfe nur, soweit dieser Mensch sie sehen darf. */
export async function stammdatenLaden(db: typeof Db, k: Zugriffskontext): Promise<Stammdaten> {
	const [kategorien, toepfe, betraege, zuordnungen, mitglieder] = await Promise.all([
		db
			.select({ id: categories.id, name: categories.name, parentId: categories.parentId, slug: categories.slug })
			.from(categories)
			.orderBy(asc(categories.sort), asc(categories.name)),
		db
			.select({ id: budgets.id, name: budgets.name, sichtbarkeit: budgets.sichtbarkeit, geloeschtAb: budgets.geloeschtAb })
			.from(budgets)
			.where(sichtbareToepfe(k)),
		db
			.select({ budgetId: budgetBetraege.budgetId, giltAb: budgetBetraege.giltAb, amountCents: budgetBetraege.amountCents })
			.from(budgetBetraege)
			.innerJoin(budgets, eq(budgets.id, budgetBetraege.budgetId))
			.where(sichtbareToepfe(k)),
		db
			// Nur die Zuordnungen SICHTBARER Toepfe (Befund R20), mit Eigentuemer.
			.select({
				budgetId: budgetKategorien.budgetId,
				categoryId: budgetKategorien.categoryId,
				giltAb: budgetKategorien.giltAb,
				giltBis: budgetKategorien.giltBis,
				eigentuemerId: budgetKategorien.eigentuemerId
			})
			.from(budgetKategorien)
			.innerJoin(budgets, eq(budgets.id, budgetKategorien.budgetId))
			.where(sichtbareToepfe(k)),
		db
			.select({ id: users.id, name: users.displayName })
			.from(householdMembers)
			.innerJoin(users, eq(users.id, householdMembers.userId))
			.where(eq(householdMembers.householdId, k.haushaltId))
			.orderBy(asc(users.displayName))
	]);
	return { kategorien, toepfe, betraege, zuordnungen, mitglieder };
}

/**
 * Macht aus dem Filter der Adresse (oder eines gespeicherten Berichts) den wirksamen:
 * Ids, die es nicht (mehr) gibt oder die dieser Mensch nicht sehen darf, werden MIT
 * Hinweis weggelassen — nie still, nie als Fehler. Ein fremder privater Topf ist fuer
 * diesen Menschen schlicht „nicht da": er verraet weder Namen noch Kategorien.
 */
export async function filterAufloesen(
	db: typeof Db,
	k: Zugriffskontext,
	f: BerichtFilter,
	stamm: Stammdaten,
	monate: string[]
): Promise<{ filter: BerichtFilter; namen: FilterNamen; hinweise: string[]; kriterien: PositionsKriterien }> {
	const hinweise: string[] = [];
	const namen: FilterNamen = { laden: {}, kategorie: {}, person: {}, topf: {} };

	const ladenIds = f.laden.filter((x) => x !== LADEN_UNBEKANNT);
	const laeden =
		ladenIds.length === 0
			? []
			: await db.select({ id: merchants.id, name: merchants.name }).from(merchants).where(inArray(merchants.id, ladenIds));
	for (const l of laeden) namen.laden[l.id] = l.name;
	const laden = f.laden.filter((x) => x === LADEN_UNBEKANNT || namen.laden[x] !== undefined);
	if (laden.length < f.laden.length) hinweise.push('Einen der gewählten Läden gibt es nicht (mehr) — weggelassen.');

	const slugs = f.kategorie.filter((s) => s !== UNSORTIERT);
	const aufgeloest = kategorienAufloesen(slugs, stamm.kategorien);
	for (const s of aufgeloest.unbekannt) hinweise.push(`Die Kategorie „${s}" gibt es nicht — weggelassen.`);
	const kategorie = f.kategorie.filter((s) => !aufgeloest.unbekannt.includes(s));
	for (const c of stamm.kategorien) if (kategorie.includes(c.slug)) namen.kategorie[c.slug] = c.name;

	for (const m of stamm.mitglieder) if (f.person.includes(m.id)) namen.person[m.id] = m.name;
	const person = f.person.filter((id) => namen.person[id] !== undefined);
	if (person.length < f.person.length) hinweise.push('Eine der gewählten Personen gehört nicht (mehr) zum Haushalt — weggelassen.');

	for (const t of stamm.toepfe) if (f.topf.includes(t.id)) namen.topf[t.id] = t.name;
	const topf = f.topf.filter((id) => namen.topf[id] !== undefined);
	if (topf.length < f.topf.length) hinweise.push('Einen der gewählten Töpfe gibt es nicht (mehr) — weggelassen.');

	const filter: BerichtFilter = { ...f, laden, kategorie, person, topf };
	const kriterien: PositionsKriterien = {
		kategorieIds: kategorie.some((s) => s !== UNSORTIERT) ? aufgeloest.ids : null,
		unsortiert: kategorie.includes(UNSORTIERT),
		topfJeMonat:
			topf.length === 0
				? null
				: topfKategorienJeMonat(topf, stamm.toepfe, stamm.betraege, stamm.zuordnungen, stamm.kategorien, monate),
		suche: f.suche
	};
	return { filter, namen, hinweise, kriterien };
}
