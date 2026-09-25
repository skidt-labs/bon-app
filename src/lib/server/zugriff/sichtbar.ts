import { and, eq, or, type SQL } from 'drizzle-orm';
import { receipts, budgets } from '$lib/server/db/schema';
import type { Zugriffskontext } from './kontext';

/**
 * ACHTUNG: In diesen beiden Funktionen darf `k.rolle` NIE vorkommen.
 * Ein Verwalter sieht nicht mehr als ein Mitglied — er darf nur mehr tun.
 * Ein Test in sichtbar.test.ts haelt das fest, indem er die erzeugten Bedingungen fuer
 * Verwalter und Mitglied auf Gleichheit prueft.
 */

/**
 * Welche Bons dieser Mensch sehen darf.
 *
 * Zwei Achsen, keine dritte: der Haushalt (harte Mandantengrenze) UND die Sichtbarkeit.
 * Ein Bon ist sichtbar, wenn er geteilt ist ODER wenn er dem Anfragenden selbst gehoert.
 * `uploaded_by` ist der Eigentuemer — auch fuer den eigenen, noch nicht bestaetigten Bon,
 * der ja bis zum Bestaetigen 'privat' ist.
 *
 * Die Rolle kommt hier nicht vor. Das ist keine Nachlaessigkeit, sondern die ganze Regel:
 * ein Verwalter sieht die privaten Bons seiner Mitglieder nicht.
 */
export function sichtbareBons(k: Zugriffskontext): SQL {
	return and(
		eq(receipts.householdId, k.haushaltId),
		or(eq(receipts.sichtbarkeit, 'geteilt'), eq(receipts.uploadedBy, k.nutzerId))
	)!;
}

/**
 * Welche Toepfe dieser Mensch sehen darf — dieselbe Form wie bei den Bons.
 *
 * Anders ist nur die Vorgabe beim Anlegen: ein Topf ist von Haus aus 'geteilt' (siehe
 * Kommentar am Schema). Die Bedingung hier kennt diesen Unterschied nicht und soll ihn
 * auch nicht kennen — sie liest nur, was dasteht.
 *
 * Auch hier: keine Rolle. Ein Verwalter sieht die privaten Toepfe seiner Mitglieder nicht.
 */
export function sichtbareToepfe(k: Zugriffskontext): SQL {
	return and(
		eq(budgets.householdId, k.haushaltId),
		or(eq(budgets.sichtbarkeit, 'geteilt'), eq(budgets.eigentuemerId, k.nutzerId))
	)!;
}
