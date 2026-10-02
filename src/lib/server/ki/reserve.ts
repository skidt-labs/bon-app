/**
 * Die Cloud-Reserve: ihr Zustand, ihr Verbrauch, ihre Meldungen (Entwurf
 * docs/superpowers/specs/2026-10-01-cloud-reserve-design.md).
 *
 * Der Zustand steht in `instanz` und wird nur BEDINGT geschrieben: „aktiv seit" wird nur
 * gesetzt, wenn es noch leer ist, und nur genau der gelesene Stand wird wieder geleert. So
 * schaltet bei zwei gleichzeitigen Auftraegen genau einer um, und nur der meldet.
 *
 * Aus den Laeufen liest dieses Modul nur Rolle, Kosten und Zeitpunkt (reserve.lint.test.ts):
 * die Betriebsseite zeigt den Verbrauch, und der Betreiber sieht nicht in die Bons hinein.
 */
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { instanz, extractionRuns } from '$lib/server/db/schema';
import { protokolliere } from '$lib/server/betrieb/protokoll';
import { notifyMatrix } from '$lib/server/notify';
import type { UmschaltDeps } from './umschalten';

type Verbindung = typeof db;

export const STANDARD_GRENZE_MICRO = 5_000_000;

export type Verbrauch = { kostenMicro: number; laeufe: number };

export type ReserveZustand = {
	reserveId: string | null;
	aktivSeit: Date | null;
	grenzeMicro: number;
	gemeldet: string | null;
};

export async function leseReserveZustand(d: Verbindung = db): Promise<ReserveZustand> {
	const [z] = await d
		.select({
			reserveId: instanz.reserveKiAnbieter,
			aktivSeit: instanz.reserveAktivSeit,
			grenzeMicro: instanz.reserveGrenzeMicro,
			gemeldet: instanz.reserveGrenzeGemeldet
		})
		.from(instanz)
		.where(eq(instanz.id, 1));
	return z ?? { reserveId: null, aktivSeit: null, grenzeMicro: STANDARD_GRENZE_MICRO, gemeldet: null };
}

const MONAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' });

/** 'YYYY-MM' des Kalendermonats in Berliner Zeit. */
export function monatVon(jetzt: Date): string {
	const teile = MONAT.formatToParts(jetzt);
	const jahr = teile.find((t) => t.type === 'year')?.value;
	const monat = teile.find((t) => t.type === 'month')?.value;
	return `${jahr}-${monat}`;
}

/**
 * Summe beider Kostenspalten und Zahl der Reserve-Laeufe ab `ab`. Ein Lauf mit unbekannten
 * Kosten zaehlt 0 € — deshalb verlangt „Als Reserve festlegen" eingetragene Preise.
 */
async function verbrauchAb(d: Verbindung, ab: ReturnType<typeof sql>): Promise<Verbrauch> {
	const [z] = await d
		.select({
			kostenMicro: sql<number>`coalesce(sum(coalesce(${extractionRuns.costMicroEuros}, 0) + coalesce(${extractionRuns.kategorienKostenMicro}, 0)), 0)::int`,
			laeufe: sql<number>`count(*)::int`
		})
		.from(extractionRuns)
		.where(and(eq(extractionRuns.kiRolle, 'reserve'), gte(extractionRuns.createdAt, ab)));
	return { kostenMicro: z?.kostenMicro ?? 0, laeufe: z?.laeufe ?? 0 };
}

/** Verbrauch der Reserve im Kalendermonat (Berliner Zeit), in dem `jetzt` liegt. */
export async function verbrauchImMonat(d: Verbindung, jetzt: Date): Promise<Verbrauch> {
	return verbrauchAb(
		d,
		sql`(date_trunc('month', ${jetzt.toISOString()}::timestamptz at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')`
	);
}

/** Verbrauch der Reserve seit dem Umschalten — fuer die Meldung „Mac wieder da". */
export async function verbrauchSeit(d: Verbindung, seit: Date): Promise<Verbrauch> {
	return verbrauchAb(d, sql`${seit.toISOString()}::timestamptz`);
}

export async function grenzeErreicht(d: Verbindung, jetzt: Date): Promise<boolean> {
	const [z, v] = await Promise.all([leseReserveZustand(d), verbrauchImMonat(d, jetzt)]);
	return v.kostenMicro >= z.grenzeMicro;
}

/**
 * Schaltet auf die Reserve. true nur fuer den, der wirklich umgeschaltet hat. Mit `reserveId`
 * nur, wenn GENAU diese Karte noch die Reserve ist (Abschlusspruefung 02.10.2026).
 */
export async function reserveAktivieren(d: Verbindung, grund: string, reserveId?: string): Promise<boolean> {
	const getroffen = await d
		.update(instanz)
		.set({ reserveAktivSeit: sql`now()` })
		.where(
			and(
				eq(instanz.id, 1),
				isNull(instanz.reserveAktivSeit),
				reserveId ? eq(instanz.reserveKiAnbieter, reserveId) : isNotNull(instanz.reserveKiAnbieter)
			)
		)
		.returning({ id: instanz.id });
	if (getroffen.length === 0) return false;
	await protokolliere(d, { userId: null, aktion: 'ki.reserve_aktiv', ziel: 'Reserve', details: { grund } });
	return true;
}

/**
 * Zurueck zum Hauptanbieter. Leert nur genau den gelesenen Stand; null = nichts zu tun.
 *
 * Verglichen wird als TEXT (`::text`), nicht als Date: Postgres haelt `now()` auf die
 * Mikrosekunde, ein JavaScript-Date nur auf die Millisekunde — ein Vergleich mit dem gelesenen
 * Date traefe nie, und es wuerde nie zurueckgeschaltet (gefunden im DB-Test, 01.10.2026).
 * Dasselbe Muster wie testErgebnisSpeichern in betrieb/ki.ts.
 */
export async function reserveZurueck(d: Verbindung, anlass: string): Promise<{ seit: Date } | null> {
	const [z] = await d
		.select({ seit: instanz.reserveAktivSeit, stand: sql<string | null>`${instanz.reserveAktivSeit}::text` })
		.from(instanz)
		.where(eq(instanz.id, 1));
	if (!z?.seit || z.stand === null) return null;
	const aktivSeit = z.seit;
	const getroffen = await d
		.update(instanz)
		.set({ reserveAktivSeit: null })
		.where(and(eq(instanz.id, 1), sql`${instanz.reserveAktivSeit}::text = ${z.stand}`))
		.returning({ id: instanz.id });
	if (getroffen.length === 0) return null;
	await protokolliere(d, {
		userId: null,
		aktion: 'ki.reserve_zurueck',
		ziel: 'Hauptanbieter',
		details: { anlass, seit: aktivSeit.toISOString() }
	});
	return { seit: aktivSeit };
}

/** true hoechstens einmal je Monat — dann ist „Grenze erreicht" zu melden. */
export async function grenzeMeldungFaellig(d: Verbindung, monat: string): Promise<boolean> {
	const getroffen = await d
		.update(instanz)
		.set({ reserveGrenzeGemeldet: monat })
		.where(and(eq(instanz.id, 1), sql`${instanz.reserveGrenzeGemeldet} is distinct from ${monat}`))
		.returning({ id: instanz.id });
	if (getroffen.length === 0) return false;
	await protokolliere(d, { userId: null, aktion: 'ki.reserve_grenze_erreicht', ziel: 'Reserve', details: { monat } });
	return true;
}

export function euro(micro: number): string {
	return `${(Math.round(micro / 10_000) / 100).toFixed(2).replace('.', ',')} €`;
}

const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

export function uhrzeit(d: Date): string {
	return UHR.format(d);
}

export function textUmschalten(reserveName: string, grund: string): string {
	return `KI: Mac nicht erreichbar (${grund}) – Reserve „${reserveName}“ liest ab jetzt.`;
}

export function textZurueck(seit: Date, bis: Date, v: Verbrauch): string {
	const laeufe = v.laeufe === 1 ? '1 Lauf' : `${v.laeufe} Läufe`;
	return `KI: Mac wieder da – Reserve lief ${uhrzeit(seit)}–${uhrzeit(bis)}, ${laeufe}, ${euro(v.kostenMicro)}.`;
}

export function textGrenze(grenzeMicro: number): string {
	return `KI: Monatsgrenze der Reserve erreicht (${euro(grenzeMicro)}) – Bons warten auf den Mac.`;
}

/**
 * Was „umschalten" im Betrieb bedeutet — fuer GENAU eine Reserve-Karte. Gemeldet wird nur, wer
 * den Zustand wirklich geaendert hat (die bedingten Schreibungen oben) — bei zwei gleichzeitigen
 * Auftraegen also einmal. Ist die Karte nicht mehr die Reserve (entfernt oder ersetzt, waehrend
 * ein Mac-Aufruf hing), gibt es keine Freigabe: kein Text an eine Reserve, die es nicht mehr gibt
 * (Abschlusspruefung 02.10.2026). `notifyMatrix` wirft nie; scheitert die Meldung, steht der
 * Wechsel trotzdem im Protokoll.
 */
export function echteUmschaltDeps(reserve: { kiAnbieterId: string; name: string }, d: Verbindung = db): UmschaltDeps {
	const zustandDieserKarte = async () => {
		const z = await leseReserveZustand(d);
		return z.reserveId === reserve.kiAnbieterId ? z : null;
	};
	return {
		reserveAktivSeit: async () => (await zustandDieserKarte())?.aktivSeit ?? null,
		grenzeErreicht: () => grenzeErreicht(d, new Date()),
		async umschalten(grund) {
			if (await reserveAktivieren(d, grund, reserve.kiAnbieterId)) {
				console.warn(`[worker] Reserve „${reserve.name}" liest ab jetzt: ${grund}`);
				await notifyMatrix(textUmschalten(reserve.name, grund));
				return true;
			}
			// Ein anderer Auftrag war schneller: lesen darf dieser nur, wenn es noch DIESE Karte ist.
			return Boolean((await zustandDieserKarte())?.aktivSeit);
		},
		async zurueckschalten(anlass) {
			const r = await reserveZurueck(d, anlass);
			if (!r) return;
			const bis = new Date();
			const v = await verbrauchSeit(d, r.seit);
			console.log(`[worker] Hauptanbieter liest wieder (${anlass})`);
			await notifyMatrix(textZurueck(r.seit, bis, v));
		},
		async grenzeMelden() {
			if (await grenzeMeldungFaellig(d, monatVon(new Date()))) {
				const z = await leseReserveZustand(d);
				console.warn('[worker] Monatsgrenze der Reserve erreicht');
				await notifyMatrix(textGrenze(z.grenzeMicro));
			}
		}
	};
}
