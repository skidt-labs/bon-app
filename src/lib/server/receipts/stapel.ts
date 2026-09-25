import { and, asc, eq, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * „Bon 3 von 8" mit ‹ › — damit ein Stapel Bons am Schreibtisch in einem Zug
 * durchgeht, ohne Umweg ueber den Posteingang.
 *
 * Die Reihenfolge ist AELTESTE OFFENE ZUERST: wer einen Stapel abarbeitet, faengt
 * vorne an. Sortiert wird nach Kaufzeit, ersatzweise nach Eingang — ein Bon, der noch
 * gelesen wird, hat noch kein purchased_at.
 */
export type Stapel = {
	position: number;
	gesamt: number;
	voriger: string | null;
	naechster: string | null;
};

/** Rein, damit die Randfaelle ohne Datenbank pruefbar sind. */
export function stapelAus(offene: { id: string }[], aktuelleId: string): Stapel {
	const i = offene.findIndex((b) => b.id === aktuelleId);
	if (i === -1) return { position: 0, gesamt: offene.length, voriger: null, naechster: null };
	return {
		position: i + 1,
		gesamt: offene.length,
		voriger: i > 0 ? offene[i - 1].id : null,
		naechster: i + 1 < offene.length ? offene[i + 1].id : null
	};
}

/**
 * Der Stapel fuehrt durch die offenen Bons. Er darf nur die enthalten, die der Mensch
 * auch sehen darf — sonst spraenge "Naechster" auf einen Bon, den die App danach mit 404
 * verweigert.
 */
export async function stapelLaden(
	db: typeof Db,
	k: Zugriffskontext,
	aktuelleId: string
): Promise<Stapel> {
	const offene = await db
		.select({ id: receipts.id })
		.from(receipts)
		.where(and(sichtbareBons(k), eq(receipts.status, 'review')))
		// Die id als zweites Sortierfeld ist kein Schmuck: zwei Bons desselben Einkaufs
		// tragen dieselbe Kaufzeit, und ohne eindeutige Ordnung darf Postgres sie bei
		// jedem Aufruf anders anordnen. „Naechster" spraenge dann hin und her, und wer
		// den Stapel durchgeht, bekaeme denselben Bon zweimal und einen nie.
		.orderBy(asc(sql`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`), asc(receipts.id));
	return stapelAus(offene, aktuelleId);
}
