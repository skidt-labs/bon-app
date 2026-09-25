/**
 * Abfragen OHNE Zugriffskontext. Jeder Aufruf braucht eine Begruendung im Aufrufer.
 *
 * Es gibt genau zwei rechtmaessige Faelle: der Extraktions-Worker und der Matrix-Bot.
 * Beide laufen ohne Anfrage, also ohne angemeldeten Nutzer. Beide arbeiten an einem Bon,
 * dessen Id sie bereits haben — sie suchen nie ueber Fremdes, sie schreiben an einem
 * bestimmten Datensatz weiter.
 *
 * Wer hier eine dritte Funktion ergaenzen will, sollte zuerst pruefen, ob der Aufrufer
 * nicht doch einen Kontext haben koennte. Diese Datei ist die einzige Stelle, an der das
 * Tor nicht gilt — sie soll klein und langweilig bleiben.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';

/** Nur fuer Worker und Bot: der Bon ist per Id bekannt, ein Filter waere sinnlos. */
export async function bonOhneKontext(bonId: string) {
	const [bon] = await db.select().from(receipts).where(eq(receipts.id, bonId));
	return bon ?? null;
}
