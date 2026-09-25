import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { db as Db } from '$lib/server/db';
import {
	budgets,
	budgetBetraege,
	budgetKategorien,
	categories,
	merchants,
	receipts,
	receiptItems
} from '$lib/server/db/schema';
import { budgetsFuerMonat } from '$lib/server/budgets/aufloesung';
import { monatszahlenLaden } from './monatszahlen';
import { kennzahlen, nachHaendler, nachKategorie, verlauf, budgetstand, direkteCentsJeKategorie } from './rechnung';
import { vorherigerMonat, naechsterMonat, aktuellerMonat } from '$lib/server/zeit';
import { sichtbareBons, sichtbareToepfe } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import type { CsvZeile } from './csv';

/** So viele Monate zeigt der Verlauf, den laufenden eingeschlossen. */
const VERLAUF_MONATE = 6;

/** Die Monate der Verlaufsachse, aeltester zuerst. */
export function achsenMonate(bis: string, anzahl = VERLAUF_MONATE): string[] {
	const liste = [bis];
	for (let i = 1; i < anzahl; i++) {
		const vor = vorherigerMonat(liste[0]);
		if (!vor) break;
		liste.unshift(vor);
	}
	return liste;
}

/**
 * Wohin „‹" und „›" neben dem Monat fuehren: Vormonat und Folgemonat.
 *
 * Bewusst NICHT aus der Verlaufsachse abgelesen. Bis 0.3.0 tat die Seite das — „‹" landete
 * am Anfang der Achse (fuenf Monate zurueck) und „›" auf dem vorletzten Achsenmonat, also
 * ebenfalls zurueck. Jeder Tipp fuehrte tiefer in die Vergangenheit.
 *
 * „vor" gibt es nur bis zum laufenden Monat: ein Bericht ueber die Zukunft ist leer, und
 * ein Knopf dorthin waere ein Weg ins Nichts.
 */
export function monatsNachbarn(
	monat: string,
	laufend: string
): { zurueck: string | null; vor: string | null } {
	const vor = naechsterMonat(monat);
	return { zurueck: vorherigerMonat(monat), vor: vor && vor <= laufend ? vor : null };
}

/**
 * Alles, was ein Monatsbericht braucht — in einem Zug geladen und mit den reinen
 * Funktionen aus rechnung.ts gerechnet.
 *
 * Zwei verschiedene Summen, mit Absicht: die KOPFZAHL kommt aus `total_gross_cents`,
 * also dem, was auf den Bons gedruckt steht. Die Aufschluesselung nach Kategorien
 * kommt aus den Positionen. Weichen sie voneinander ab, ist das keine Ungenauigkeit,
 * sondern ein Befund — er steht als `differenzCents` im Ergebnis, damit die Seite ihn
 * zeigen kann, statt dass sich zwei Zahlen stillschweigend widersprechen.
 */
export async function berichtLaden(db: typeof Db, k: Zugriffskontext, monat: string) {
	const monate = achsenMonate(monat);
	const vormonat = vorherigerMonat(monat);
	const alsMonat = sql<string>`to_char(coalesce(${receipts.purchasedAt}, ${receipts.createdAt}) at time zone 'Europe/Berlin', 'YYYY-MM')`;

	const [bonsImZeitraum, kategorien, toepfe, betraege, zuordnungen, zahlen] = await Promise.all([
		// Alle bestaetigten Bons der Verlaufsachse auf einmal: daraus werden Kopfzahl,
		// Vormonatsvergleich und Verlauf gerechnet, ohne drei aehnliche Abfragen.
		db
			.select({
				id: receipts.id,
				monat: alsMonat,
				cents: receipts.totalGrossCents,
				sichtbarkeit: receipts.sichtbarkeit,
				haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`
			})
			.from(receipts)
			.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
			.where(and(sichtbareBons(k), eq(receipts.status, 'confirmed'), gte(alsMonat, monate[0]))),
		db
			.select({ id: categories.id, name: categories.name, parentId: categories.parentId })
			.from(categories)
			.orderBy(asc(categories.sort), asc(categories.name)),
		db
			.select({
				id: budgets.id,
				name: budgets.name,
				sichtbarkeit: budgets.sichtbarkeit,
				geloeschtAb: budgets.geloeschtAb
			})
			.from(budgets)
			.where(sichtbareToepfe(k)),
		db
			.select({
				budgetId: budgetBetraege.budgetId,
				giltAb: budgetBetraege.giltAb,
				amountCents: budgetBetraege.amountCents
			})
			.from(budgetBetraege)
			.innerJoin(budgets, eq(budgets.id, budgetBetraege.budgetId))
			.where(sichtbareToepfe(k)),
		db
			// Nur die Zuordnungen SICHTBARER Toepfe: sonst kaeme die Zuordnung eines
			// fremden privaten Topfs mit und verdraengte in der Aufloesung die eigene
			// (Befund R20). Der Eigentuemer wird mitgelesen, weil die Aufloesung die
			// Bereiche daran auseinanderhaelt.
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
		// Der Vorbehalt: was noch ungeprueft danebenliegt (Etappe 3b).
		monatszahlenLaden(db, k, monat)
	]);

	const imMonat = bonsImZeitraum.filter((b) => b.monat === monat);
	const imVormonat = vormonat === null ? [] : bonsImZeitraum.filter((b) => b.monat === vormonat);

	// Die Positionen NUR der Bons dieses Monats. Ohne Bons keine Abfrage — ein leeres
	// inArray() ist in SQL kein leeres Ergebnis, sondern ein Syntaxfehler.
	const positionen =
		imMonat.length === 0
			? []
			: await db
					.select({
						receiptId: receiptItems.receiptId,
						categoryId: receiptItems.categoryId,
						lineType: sql<string>`${receiptItems.lineType}`,
						totalPriceCents: receiptItems.totalPriceCents
					})
					.from(receiptItems)
					.where(
						inArray(
							receiptItems.receiptId,
							imMonat.map((b) => b.id)
						)
					);

	const centsOderNull = (b: { cents: number | null }) => ({ cents: b.cents ?? 0 });
	const kategorien_ = nachKategorie(positionen, kategorien);
	const erster = `${monat}-01`;
	// Ein geloeschter Topf verschwindet erst ab dem Monat seiner Loeschung — nicht zu
	// verwechseln mit sichtbareToepfe() aus zugriff/sichtbar.ts, die auf den Haushalt filtert.
	const gueltigeToepfe = toepfe.filter((t) => t.geloeschtAb === null || t.geloeschtAb > erster);
	const aufgeloest = budgetsFuerMonat(gueltigeToepfe, betraege, zuordnungen, kategorien, monat);

	// Ausgaben je EINZELNER Kategorie, direkt gebucht — der Budgetstand summiert daraus
	// seine Toepfe. Siehe direkteCentsJeKategorie: die Elternsummen enthalten ihre Kinder
	// bereits, und beide Ebenen zu addieren zaehlte jede Ausgabe doppelt.
	//
	// ZWEI Summen, nicht eine: ein geteilter Topf zaehlt die geteilten Ausgaben, ein
	// privater nur die eigenen. `kategorien_` oben bleibt davon unberuehrt — die Aufteilung
	// in der ANZEIGE zeigt weiterhin alles, was der Anfragende sehen darf.
	const geteilteBons = new Set(imMonat.filter((b) => b.sichtbarkeit === 'geteilt').map((b) => b.id));
	const centsJeKategorie = {
		geteilt: direkteCentsJeKategorie(
			nachKategorie(
				positionen.filter((p) => geteilteBons.has(p.receiptId)),
				kategorien
			)
		),
		privat: direkteCentsJeKategorie(
			nachKategorie(
				positionen.filter((p) => !geteilteBons.has(p.receiptId)),
				kategorien
			)
		)
	};

	const kopf = kennzahlen(imMonat.map(centsOderNull), imVormonat.map(centsOderNull));
	const ausPositionen = kategorien_.reduce((s, p) => s + p.cents, 0);

	return {
		monat,
		nachbarn: monatsNachbarn(monat, aktuellerMonat()),
		kennzahlen: kopf,
		kategorien: kategorien_,
		haendler: nachHaendler(imMonat.map((b) => ({ haendler: b.haendler, cents: b.cents ?? 0 }))),
		verlauf: verlauf(
			bonsImZeitraum.map((b) => ({ monat: b.monat, cents: b.cents ?? 0 })),
			monate
		),
		budgets: budgetstand(aufgeloest.budgets, centsJeKategorie),
		/** Positionssumme minus gedruckte Endsummen. 0 = die beiden sind sich einig. */
		differenzCents: ausPositionen - kopf.summe,
		/** Bons ohne gelesene Endsumme — sie zaehlen als Bon, aber nicht als Betrag. */
		ohneBetrag: imMonat.filter((b) => b.cents === null).length,
		rueckstand: zahlen.rueckstand
	};
}

/**
 * Eine Zeile je Position, fuer den CSV-Export eines Monats — nur bestaetigte Bons, wie
 * im Bericht: was noch niemand geprueft hat, ist keine Zahl, mit der man rechnen sollte.
 *
 * `grenzen.bis` ist AUSSCHLIESSLICH (so liefert es monatsgrenzen): Bis 0.3.2 stand hier
 * `<=`, und ein Bon um genau 00:00 Uhr am Ersten landete in zwei Monatsexporten.
 */
export async function exportZeilenLaden(
	db: typeof Db,
	k: Zugriffskontext,
	grenzen: { von: Date; bis: Date }
): Promise<CsvZeile[]> {
	const ober = alias(categories, 'ober');
	const wann = sql<Date>`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`;

	return db
		.select({
			datum: sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`,
			haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`,
			bonId: receipts.id,
			lineNo: receiptItems.lineNo,
			rawText: receiptItems.rawText,
			lineType: sql<string>`${receiptItems.lineType}`,
			quantity: receiptItems.quantity,
			unit: receiptItems.unit,
			unitPriceCents: receiptItems.unitPriceCents,
			totalPriceCents: receiptItems.totalPriceCents,
			kategorie: categories.name,
			oberkategorie: ober.name
		})
		.from(receiptItems)
		.innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
		.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
		.leftJoin(categories, eq(categories.id, receiptItems.categoryId))
		.leftJoin(ober, eq(ober.id, categories.parentId))
		.where(and(sichtbareBons(k), eq(receipts.status, 'confirmed'), gte(wann, grenzen.von), lt(wann, grenzen.bis)))
		.orderBy(asc(wann), asc(receipts.id), asc(receiptItems.lineNo));
}
