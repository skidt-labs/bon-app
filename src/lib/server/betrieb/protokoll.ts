import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { betriebsprotokoll, users } from '$lib/server/db/schema';

/**
 * Was der Betreiber getan hat. `details` NIE mit Schluesseln oder Inhalten fuellen —
 * nur Namen, IDs, alt/neu. Es gibt bewusst keine Funktion zum Aendern oder Loeschen.
 */
export type ProtokollAktion =
	| 'ki.angelegt'
	| 'ki.geaendert'
	| 'ki.schluessel_geaendert'
	| 'ki.getestet'
	| 'ki.aktiviert'
	| 'ki.zurueck_auf_env'
	| 'ki.geloescht'
	| 'haushalt.angelegt'
	| 'haushalt.geloescht'
	| 'nutzer.gesperrt'
	| 'nutzer.entsperrt'
	| 'selbstbedienung';

/** Die Datenbank ODER eine laufende Transaktion — beide koennen einfuegen. */
export type Schreiber = Pick<typeof db, 'insert'>;

export async function protokolliere(
	s: Schreiber,
	e: { userId: string | null; aktion: ProtokollAktion; ziel?: string | null; details?: Record<string, unknown> }
): Promise<void> {
	await s.insert(betriebsprotokoll).values({
		userId: e.userId,
		aktion: e.aktion,
		ziel: e.ziel ?? null,
		details: e.details ?? null
	});
}

export type ProtokollZeile = {
	id: string;
	zeit: Date;
	wer: string | null;
	aktion: string;
	ziel: string | null;
	details: Record<string, unknown> | null;
};

export async function protokollLesen(grenze = 200): Promise<ProtokollZeile[]> {
	return db
		.select({
			id: betriebsprotokoll.id,
			zeit: betriebsprotokoll.zeit,
			wer: users.displayName,
			aktion: betriebsprotokoll.aktion,
			ziel: betriebsprotokoll.ziel,
			details: betriebsprotokoll.details
		})
		.from(betriebsprotokoll)
		.leftJoin(users, eq(users.id, betriebsprotokoll.userId))
		.orderBy(desc(betriebsprotokoll.zeit))
		.limit(grenze);
}
