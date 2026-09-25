import { and, eq, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { vorherigerMonat } from '$lib/server/zeit';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Die Zahlen der Startseite: was in einem Monat bestaetigt ist — und daneben, was noch
 * ungeprueft daliegt.
 *
 * Die beiden gehoeren zusammen und werden nie getrennt gezeigt. Am 17.09.2026 standen
 * 25,78 EUR bestaetigt im September, waehrend 442,11 EUR in zehn ungeprueften Bons
 * warteten. „25,78 EUR im September" allein waere keine Zahl, sondern eine Falschaussage.
 * Eine Auswertung ist nur so wahr, wie der Rueckstand klein ist, und das muss die Seite
 * sagen, statt es zu verschweigen.
 *
 * Etappe 6 (Berichte) baut hierauf auf, statt es zu ersetzen.
 */
export type MonatsSumme = {
	bons: number;
	cent: number;
	/**
	 * Bons, bei denen keine Endsumme gelesen wurde. Sie zaehlen als Bon, aber nicht als
	 * 0,00 EUR in `cent` — sonst saehe der Monat billiger aus, als er war, und nichts
	 * wiese darauf hin. null ist eine Leerstelle, keine Null.
	 */
	ohneBetrag: number;
};

export type MonatsZahlen = {
	monat: string;
	bestaetigt: MonatsSumme;
	/** Im selben Monat, aber noch nicht geprueft. */
	offen: MonatsSumme;
	/** Bestaetigt im Vormonat. `null` = dort liegt nichts Bestaetigtes, also kein Vergleich. */
	vormonat: MonatsSumme | null;
	/** Ungeprueft ueber ALLE Monate — der Vorbehalt zu jeder Monatszahl. */
	rueckstand: MonatsSumme;
};

export type BonFuerZahlen = {
	/** 'YYYY-MM' aus Kaufzeit, ersatzweise Eingang. */
	monat: string;
	status: string;
	totalGrossCents: number | null;
};

/**
 * Zaehlt zum Rueckstand: was auf eine menschliche Pruefung wartet. `failed` gehoert NICHT
 * dazu — ein Bon, der nicht gelesen werden konnte, ist offene Arbeit, aber kein Betrag,
 * den man gegen eine Monatssumme halten koennte. Er erscheint auf der Startseite in der
 * oberen Haelfte, bei den Aufgaben.
 */
const OFFEN = new Set(['pending', 'extracting', 'review']);

const LEER: MonatsSumme = { bons: 0, cent: 0, ohneBetrag: 0 };

function summiere(bons: BonFuerZahlen[]): MonatsSumme {
	return bons.reduce<MonatsSumme>(
		(s, b) => ({
			bons: s.bons + 1,
			cent: s.cent + (b.totalGrossCents ?? 0),
			ohneBetrag: s.ohneBetrag + (b.totalGrossCents === null ? 1 : 0)
		}),
		{ ...LEER }
	);
}

/** Rein, damit sich die Randfaelle ohne Datenbank pruefen lassen. */
export function monatszahlenAus(alle: BonFuerZahlen[], monat: string): MonatsZahlen {
	const vor = vorherigerMonat(monat);
	const imVormonat = vor === null ? [] : alle.filter((b) => b.monat === vor && b.status === 'confirmed');
	return {
		monat,
		bestaetigt: summiere(alle.filter((b) => b.monat === monat && b.status === 'confirmed')),
		offen: summiere(alle.filter((b) => b.monat === monat && OFFEN.has(b.status))),
		vormonat: imVormonat.length === 0 ? null : summiere(imVormonat),
		rueckstand: summiere(alle.filter((b) => OFFEN.has(b.status)))
	};
}

/**
 * Nimmt den Zugriffskontext, nicht bloss den Haushalt: die Monatszahlen stehen neben der
 * Liste auf derselben Seite. Zaehlten sie fremde private Bons mit, staende dort eine
 * Summe, die sich aus den sichtbaren Bons nicht nachrechnen laesst.
 */
export async function monatszahlenLaden(
	db: typeof Db,
	k: Zugriffskontext,
	monat: string
): Promise<MonatsZahlen> {
	// Kaufzeit, ersatzweise Eingang — dieselbe Regel wie in bons/liste.ts: ein Bon, der
	// noch gelesen wird, hat noch kein purchased_at und soll trotzdem im richtigen Monat
	// stehen. Die Monatsgrenze zieht Postgres in der Zone des Haushalts, nicht in UTC:
	// ein Einkauf am 1. um 00:30 Ortszeit gehoert in den neuen Monat.
	const zeilen = await db
		.select({
			monat: sql<string>`to_char(coalesce(${receipts.purchasedAt}, ${receipts.createdAt}) at time zone 'Europe/Berlin', 'YYYY-MM')`,
			status: sql<string>`${receipts.status}`,
			totalGrossCents: receipts.totalGrossCents
		})
		.from(receipts)
		.where(sichtbareBons(k));
	return monatszahlenAus(zeilen, monat);
}
