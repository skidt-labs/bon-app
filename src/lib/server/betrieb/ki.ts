import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { betriebsprotokoll, instanz, kiAnbieter } from '$lib/server/db/schema';
import { MAX_ZEITLIMIT_MS } from '$lib/server/queue/fristen';
import { bildwegIstBestaetigt, konfigAusEnv, type KiWeg } from '$lib/server/extraction';
import { leseReserveZustand, verbrauchImMonat, type Verbrauch } from '$lib/server/ki/reserve';
import { entschluesseln, geheimnisVorhanden, schluesselEnde, SchluesselFehlt, verschluesseln } from '$lib/server/ki/geheimnis';
import { BildwegNichtFreigegeben } from '$lib/server/ki/fehler';
import { protokolliere } from './protokoll';

/**
 * Die KI-Anbieter der Instanz verwalten.
 *
 * Wie ueberall unter betrieb/: keine Inhalte. Diese Datei kennt Anbieter und die eine
 * Instanzzeile, sonst nichts. Ein Schluessel geht hinein und wird nur hier (fuer
 * „lesbar?") und im Testknopf entschluesselt — er verlaesst diese Datei nie.
 */

export class AnbieterNichtGefunden extends Error {}
export class NichtGetestet extends Error {}
export class AnbieterAktiv extends Error {}
/** Die Reserve-Karte laesst sich nicht loeschen, solange sie Reserve ist. */
export class AnbieterIstReserve extends Error {}
/** Eine Karte darf nicht Reserve werden; `grund` steht so auch auf der Karte. */
export class ReserveNichtMoeglich extends Error {
	constructor(readonly grund: string) {
		super(grund);
	}
}

type Verbindung = typeof db;

export type AnbieterEingabe = {
	name: string;
	weg: 'text' | 'bild';
	baseUrl: string;
	modell: string;
	zeitlimitMs: number;
	preisEinMicro: number | null;
	preisAusMicro: number | null;
	schluessel: string | null;
	schluesselEntfernen: boolean;
};

// Leer = null (unbekannt), „0" = 0 (kostenlos). Siehe preisAusEnv — dieselbe Regel.
//
// Bewusst NUR /^\d+$/: kein Punkt, kein Komma, kein Vorzeichen, keine Exponentschreibweise,
// kein Hex. Ein Tausendertrennzeichen ("150.000" oder "150,000") waere sonst still als
// 150 gelesen worden — ein Faktor-1000-Fehler ohne jede Fehlermeldung. Die Obergrenze ist
// Postgres' `integer`-Maximum; ohne sie wuerde ein zu grosser Wert erst beim Schreiben mit
// einer rohen DB-Fehlermeldung scheitern statt mit einer verstaendlichen.
const POSTGRES_INTEGER_MAX = 2147483647;
const preis = z
	.string()
	.trim()
	.transform((s, ctx) => {
		if (s === '') return null;
		if (!/^\d+$/.test(s) || Number(s) > POSTGRES_INTEGER_MAX) {
			ctx.addIssue({
				code: 'custom',
				message: 'Preise sind ganze Millionstel Euro je Million Tokens — nur Ziffern, ohne Punkt oder Komma.'
			});
			return z.NEVER;
		}
		return Number(s);
	});

const formularSchema = z.object({
	name: z.string().trim().min(1, 'Der Anbieter braucht einen Namen.'),
	weg: z.enum(['text', 'bild'], { message: 'Unbekannter Weg.' }),
	baseUrl: z
		.string()
		.trim()
		.regex(/^https?:\/\/\S+$/, 'Die Basis-URL muss mit http:// oder https:// beginnen.')
		.transform((u) => u.replace(/\/+$/, '')),
	modell: z.string().trim().min(1, 'Das Modell fehlt.'),
	zeitlimitS: z.coerce
		.number()
		.int('Das Zeitlimit ist eine ganze Zahl von Sekunden.')
		.min(1, 'Das Zeitlimit muss mindestens eine Sekunde sein.')
		.max(Math.floor(MAX_ZEITLIMIT_MS / 1000), `Hoechstens ${Math.floor(MAX_ZEITLIMIT_MS / 1000)} Sekunden.`),
	preisEin: preis,
	preisAus: preis,
	schluessel: z.string().optional(),
	schluesselEntfernen: z.string().optional()
});

export function eingabeAusFormular(f: FormData): { ok: true; eingabe: AnbieterEingabe } | { ok: false; grund: string } {
	const roh = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
	const r = formularSchema.safeParse(roh);
	if (!r.success) return { ok: false, grund: r.error.issues[0].message };
	const d = r.data;
	const schluessel = d.schluessel?.trim() ? d.schluessel.trim() : null;
	return {
		ok: true,
		eingabe: {
			name: d.name,
			weg: d.weg,
			baseUrl: d.baseUrl,
			modell: d.modell,
			zeitlimitMs: d.zeitlimitS * 1000,
			preisEinMicro: d.preisEin,
			preisAusMicro: d.preisAus,
			schluessel,
			schluesselEntfernen: d.schluesselEntfernen === 'ja'
		}
	};
}

export type AnbieterKarte = {
	id: string;
	name: string;
	weg: 'text' | 'bild';
	baseUrl: string;
	modell: string;
	hatSchluessel: boolean;
	schluesselEnde: string | null;
	/** null = kein Schluessel hinterlegt. false = hinterlegt, aber nicht entschluesselbar. */
	schluesselLesbar: boolean | null;
	zeitlimitMs: number;
	preisEinMicro: number | null;
	preisAusMicro: number | null;
	zuletztGetestet: Date | null;
	testOk: boolean | null;
	testErgebnis: string | null;
	aktiv: boolean;
	/** Ist diese Karte die Cloud-Reserve? */
	reserve: boolean;
	/** Warum sie nicht Reserve werden kann — null: sie kann (oder ist es schon). */
	reserveGrund: string | null;
};

export async function kiStandLesen(): Promise<{ aktivId: string | null; stand: number }> {
	const [z] = await db
		.select({ aktivId: instanz.aktiverKiAnbieter, stand: instanz.kiStand })
		.from(instanz)
		.where(eq(instanz.id, 1));
	return { aktivId: z?.aktivId ?? null, stand: z?.stand ?? 0 };
}

export async function anbieterListe(env: NodeJS.ProcessEnv = process.env): Promise<AnbieterKarte[]> {
	const { aktivId } = await kiStandLesen();
	const [zeilen, { reserveId }, haupt] = await Promise.all([
		db.select().from(kiAnbieter).orderBy(kiAnbieter.angelegtAm),
		leseReserveZustand(),
		hauptWeg(env)
	]);
	// Die Karte wird FELD FUER FELD gebaut, nicht per Spread: so kann `schluesselEnc`
	// nicht versehentlich mitwandern, wenn die Tabelle eine Spalte dazubekommt.
	return zeilen.map((z) => {
		let lesbar: boolean | null = null;
		if (z.schluesselEnc) {
			try {
				entschluesseln(z.schluesselEnc, z.id, env);
				lesbar = true;
			} catch {
				lesbar = false;
			}
		}
		return {
			id: z.id,
			name: z.name,
			weg: z.weg,
			baseUrl: z.baseUrl,
			modell: z.modell,
			hatSchluessel: z.schluesselEnc !== null,
			schluesselEnde: z.schluesselEnde,
			schluesselLesbar: lesbar,
			zeitlimitMs: z.zeitlimitMs,
			preisEinMicro: z.preisEinMicro,
			preisAusMicro: z.preisAusMicro,
			zuletztGetestet: z.zuletztGetestet,
			testOk: z.testOk,
			testErgebnis: z.testErgebnis,
			aktiv: z.id === aktivId,
			reserve: z.id === reserveId,
			reserveGrund: z.id === reserveId ? null : reserveGrund({ ...z, aktiv: z.id === aktivId }, haupt)
		};
	});
}

function felder(e: AnbieterEingabe) {
	return {
		name: e.name,
		weg: e.weg,
		baseUrl: e.baseUrl,
		modell: e.modell,
		zeitlimitMs: e.zeitlimitMs,
		preisEinMicro: e.preisEinMicro,
		preisAusMicro: e.preisAusMicro
	};
}

const BILDWEG_GESPERRT = 'Der Bildweg ist in der .env nicht freigegeben.';

/**
 * Wirft SchluesselFehlt, wenn ein Schluessel eingegeben wurde, SECRETS_KEY aber fehlt, und
 * BildwegNichtFreigegeben fuer einen neuen Bildweg-Anbieter ohne Freigabe in der .env.
 */
export async function anbieterAnlegen(e: AnbieterEingabe, userId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
	if (e.weg === 'bild' && !bildwegIstBestaetigt(env)) throw new BildwegNichtFreigegeben(BILDWEG_GESPERRT);
	const id = randomUUID();
	const schluessel = e.schluessel
		? { schluesselEnc: verschluesseln(e.schluessel, id, env), schluesselEnde: schluesselEnde(e.schluessel) }
		: { schluesselEnc: null, schluesselEnde: null };
	await db.transaction(async (tx) => {
		await tx.insert(kiAnbieter).values({ id, ...felder(e), ...schluessel });
		await protokolliere(tx, { userId, aktion: 'ki.angelegt', ziel: e.name, details: { anbieterId: id, weg: e.weg, modell: e.modell } });
	});
	return id;
}

/**
 * Jede Aenderung setzt `test_ok` zurueck. Ist der Anbieter gerade aktiv, wirkt die
 * Aenderung SOFORT (ki_stand steigt) — sonst liesse sich ein abgelaufener Schluessel nicht
 * schnell tauschen. Die Testpflicht gilt fuers Aktivieren, nicht fuers Weiterlaufen.
 * Leeres Schluesselfeld = alter Schluessel bleibt; nur `schluesselEntfernen` loescht ihn.
 *
 * Auf den Bildweg UMSTELLEN geht nur mit Freigabe (BildwegNichtFreigegeben). Ein Anbieter,
 * der schon `bild` ist, bleibt dagegen bearbeitbar — sonst liesse sich etwa sein Schluessel
 * nicht tauschen, solange die Freigabe fehlt. Laufen darf er ohne Freigabe trotzdem nicht:
 * das verhindern Aktivieren und baueProvider.
 */
export async function anbieterAendern(
	id: string,
	e: AnbieterEingabe,
	userId: string,
	env: NodeJS.ProcessEnv = process.env,
	d: Verbindung = db
): Promise<void> {
	const schluessel = e.schluessel
		? { schluesselEnc: verschluesseln(e.schluessel, id, env), schluesselEnde: schluesselEnde(e.schluessel) }
		: e.schluesselEntfernen
			? { schluesselEnc: null, schluesselEnde: null }
			: {};
	await d.transaction(async (tx) => {
		const [alt] = await tx.select({ weg: kiAnbieter.weg }).from(kiAnbieter).where(eq(kiAnbieter.id, id));
		if (!alt) throw new AnbieterNichtGefunden();
		if (e.weg === 'bild' && alt.weg !== 'bild' && !bildwegIstBestaetigt(env)) {
			throw new BildwegNichtFreigegeben(BILDWEG_GESPERRT);
		}
		const getroffen = await tx
			.update(kiAnbieter)
			.set({ ...felder(e), ...schluessel, testOk: null, testErgebnis: null, geaendertAm: new Date() })
			.where(eq(kiAnbieter.id, id))
			.returning({ id: kiAnbieter.id });
		if (getroffen.length === 0) throw new AnbieterNichtGefunden();
		await tx
			.update(instanz)
			.set({ kiStand: sql`${instanz.kiStand} + 1` })
			// Auch die Reserve: ein neuer Schluessel muss beim naechsten Auftrag gelten.
			.where(sql`${instanz.id} = 1 and (${instanz.aktiverKiAnbieter} = ${id} or ${instanz.reserveKiAnbieter} = ${id})`);
		await protokolliere(tx, { userId, aktion: 'ki.geaendert', ziel: e.name, details: { anbieterId: id } });
		if (e.schluessel || e.schluesselEntfernen) {
			await protokolliere(tx, {
				userId,
				aktion: 'ki.schluessel_geaendert',
				ziel: e.name,
				details: { anbieterId: id, entfernt: !e.schluessel }
			});
		}
	});
}

export async function anbieterAktivieren(id: string, userId: string, env: NodeJS.ProcessEnv = process.env, d: Verbindung = db): Promise<void> {
	await d.transaction(async (tx) => {
		const [z] = await tx
			.select({ name: kiAnbieter.name, weg: kiAnbieter.weg, testOk: kiAnbieter.testOk })
			.from(kiAnbieter)
			.where(eq(kiAnbieter.id, id));
		if (!z) throw new AnbieterNichtGefunden();
		if (z.testOk !== true) throw new NichtGetestet();
		if (z.weg === 'bild' && !bildwegIstBestaetigt(env)) {
			throw new BildwegNichtFreigegeben(BILDWEG_GESPERRT);
		}
		const [alt] = await tx
			.select({ aktivId: instanz.aktiverKiAnbieter, reserveId: instanz.reserveKiAnbieter })
			.from(instanz)
			.where(eq(instanz.id, 1));
		// Die Reserve zum Hauptanbieter zu machen, liesse sie beides zugleich sein — jeder Bon
		// ginge in die Cloud (Cloud-Reserve, beim Bau gefunden 01.10.2026).
		if (alt?.reserveId === id) throw new AnbieterIstReserve();
		await tx
			.insert(instanz)
			.values({ id: 1, aktiverKiAnbieter: id, kiStand: 1 })
			.onConflictDoUpdate({
				target: instanz.id,
				set: { aktiverKiAnbieter: id, kiStand: sql`${instanz.kiStand} + 1`, geaendertAm: new Date() }
			});
		await protokolliere(tx, {
			userId,
			aktion: 'ki.aktiviert',
			ziel: z.name,
			details: { alt: alt?.aktivId ?? null, neu: id }
		});
	});
}

export async function zurueckAufEnv(userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [alt] = await tx.select({ aktivId: instanz.aktiverKiAnbieter }).from(instanz).where(eq(instanz.id, 1));
		await tx
			.insert(instanz)
			.values({ id: 1, aktiverKiAnbieter: null, kiStand: 1 })
			.onConflictDoUpdate({
				target: instanz.id,
				set: { aktiverKiAnbieter: null, kiStand: sql`${instanz.kiStand} + 1`, geaendertAm: new Date() }
			});
		await protokolliere(tx, { userId, aktion: 'ki.zurueck_auf_env', ziel: '.env', details: { alt: alt?.aktivId ?? null } });
	});
}

export async function anbieterLoeschen(id: string, userId: string, d: Verbindung = db): Promise<void> {
	await d.transaction(async (tx) => {
		const [stand] = await tx
			.select({ aktivId: instanz.aktiverKiAnbieter, reserveId: instanz.reserveKiAnbieter })
			.from(instanz)
			.where(eq(instanz.id, 1));
		if (stand?.aktivId === id) throw new AnbieterAktiv();
		if (stand?.reserveId === id) throw new AnbieterIstReserve();
		const weg = await tx.delete(kiAnbieter).where(eq(kiAnbieter.id, id)).returning({ name: kiAnbieter.name });
		if (weg.length === 0) throw new AnbieterNichtGefunden();
		await protokolliere(tx, { userId, aktion: 'ki.geloescht', ziel: weg[0].name, details: { anbieterId: id } });
	});
}

/**
 * Schreibt das Testergebnis NUR, wenn die Zeile noch den getesteten Stand hat
 * (`stand` = `geaendert_am::text`, beim Lesen vor dem Test gemerkt). Wurde der Anbieter
 * waehrend des Tests geaendert, wird nichts geschrieben und nichts protokolliert —
 * Rueckgabe false. Der Vergleich laeuft in Postgres (`::timestamptz`), damit keine
 * Mikrosekunden verloren gehen, die ein JS-Date nicht haelt.
 */
export async function testErgebnisSpeichern(
	id: string,
	ok: boolean,
	text: string,
	userId: string,
	stand: string
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [z] = await tx
			.update(kiAnbieter)
			.set({ testOk: ok, testErgebnis: text, zuletztGetestet: new Date() })
			.where(and(eq(kiAnbieter.id, id), sql`${kiAnbieter.geaendertAm} = ${stand}::timestamptz`))
			.returning({ name: kiAnbieter.name });
		if (!z) {
			const [da] = await tx.select({ id: kiAnbieter.id }).from(kiAnbieter).where(eq(kiAnbieter.id, id));
			if (!da) throw new AnbieterNichtGefunden();
			return false;
		}
		await protokolliere(tx, { userId, aktion: 'ki.getestet', ziel: z.name, details: { anbieterId: id, ok } });
		return true;
	});
}

// Die Route importiert beides von HIER, nicht aus ki/geheimnis — dort wacht geheimnis.lint.test.ts.
/** Welchen Weg der Hauptanbieter nimmt: die aktive Karte, sonst die .env; null = unvollstaendig. */
async function hauptWeg(env: NodeJS.ProcessEnv, d: Verbindung = db): Promise<KiWeg | null> {
	const [z] = await d
		.select({ weg: kiAnbieter.weg })
		.from(instanz)
		.innerJoin(kiAnbieter, eq(kiAnbieter.id, instanz.aktiverKiAnbieter))
		.where(eq(instanz.id, 1));
	if (z) return z.weg;
	try {
		return konfigAusEnv(env).weg;
	} catch {
		return null;
	}
}

/**
 * Darf diese Karte Reserve werden? null = ja; sonst der erste Grund dagegen, in dieser
 * Reihenfolge (Entwurf 2026-10-01, „Regeln fuer die Reserve").
 */
export function reserveGrund(
	k: { weg: KiWeg; testOk: boolean | null; preisEinMicro: number | null; preisAusMicro: number | null; aktiv: boolean },
	hauptWeg: KiWeg | null
): string | null {
	if (k.weg !== 'text') return 'Nur Textweg-Anbieter können Reserve sein.';
	if (k.aktiv) return 'Das ist der aktive Hauptanbieter.';
	if (hauptWeg === 'bild') return 'Der Hauptanbieter nutzt den Bildweg — die Reserve braucht den Textweg.';
	if (hauptWeg === null) return 'Der Hauptanbieter ist nicht vollständig eingerichtet.';
	if (k.testOk !== true) return 'Erst testen.';
	if (k.preisEinMicro === null || k.preisAusMicro === null) {
		return 'Preise fehlen — ohne sie lässt sich die Monatsgrenze nicht prüfen.';
	}
	return null;
}

/** „5", „5,00", „0,5" → Millionstel Euro; mehr als 0 und hoechstens 1000 €, sonst null. */
export function grenzeAusFormular(text: string): number | null {
	const m = /^(\d{1,4})(?:,(\d{1,2}))?$/.exec(text.trim());
	if (!m) return null;
	const cent = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
	if (cent <= 0 || cent > 100_000) return null;
	return cent * 10_000;
}

async function instanzSetzen(tx: Pick<Verbindung, 'insert'>, werte: Partial<typeof instanz.$inferInsert>, standErhoehen: boolean) {
	await tx
		.insert(instanz)
		.values({ id: 1, ...werte, ...(standErhoehen ? { kiStand: 1 } : {}) })
		.onConflictDoUpdate({
			target: instanz.id,
			set: { ...werte, ...(standErhoehen ? { kiStand: sql`${instanz.kiStand} + 1` } : {}), geaendertAm: new Date() }
		});
}

export async function reserveFestlegen(id: string, userId: string, env: NodeJS.ProcessEnv = process.env, d: Verbindung = db): Promise<void> {
	await d.transaction(async (tx) => {
		const [z] = await tx
			.select({ name: kiAnbieter.name, weg: kiAnbieter.weg, testOk: kiAnbieter.testOk, preisEinMicro: kiAnbieter.preisEinMicro, preisAusMicro: kiAnbieter.preisAusMicro })
			.from(kiAnbieter)
			.where(eq(kiAnbieter.id, id));
		if (!z) throw new AnbieterNichtGefunden();
		const [alt] = await tx
			.select({ aktivId: instanz.aktiverKiAnbieter, reserveId: instanz.reserveKiAnbieter })
			.from(instanz)
			.where(eq(instanz.id, 1));
		const grund = reserveGrund({ ...z, aktiv: alt?.aktivId === id }, await hauptWeg(env, tx as never));
		if (grund) throw new ReserveNichtMoeglich(grund);
		await instanzSetzen(tx, { reserveKiAnbieter: id, reserveAktivSeit: null }, true);
		await protokolliere(tx, { userId, aktion: 'ki.reserve_gesetzt', ziel: z.name, details: { alt: alt?.reserveId ?? null, neu: id } });
	});
}

export async function reserveEntfernen(userId: string, d: Verbindung = db): Promise<void> {
	await d.transaction(async (tx) => {
		const [alt] = await tx.select({ reserveId: instanz.reserveKiAnbieter }).from(instanz).where(eq(instanz.id, 1));
		await instanzSetzen(tx, { reserveKiAnbieter: null, reserveAktivSeit: null }, true);
		await protokolliere(tx, { userId, aktion: 'ki.reserve_entfernt', ziel: 'Reserve', details: { alt: alt?.reserveId ?? null } });
	});
}

/** Die Monatsgrenze. Der Worker liest sie je Auftrag; eine neue Grenze darf neu gemeldet werden. */
export async function reserveGrenzeSpeichern(micro: number, userId: string, d: Verbindung = db): Promise<void> {
	await d.transaction(async (tx) => {
		const [alt] = await tx.select({ grenze: instanz.reserveGrenzeMicro }).from(instanz).where(eq(instanz.id, 1));
		await instanzSetzen(tx, { reserveGrenzeMicro: micro, reserveGrenzeGemeldet: null }, false);
		await protokolliere(tx, { userId, aktion: 'ki.reserve_grenze', ziel: 'Reserve', details: { alt: alt?.grenze ?? null, neu: micro } });
	});
}

export type ReserveStand = {
	zustand: 'keine' | 'bereit' | 'aktiv' | 'grenze' | 'wirkungslos';
	name: string | null;
	modell: string | null;
	aktivSeit: Date | null;
	/** Warum zuletzt umgeschaltet wurde (aus dem Betriebsprotokoll). */
	grund: string | null;
	verbrauch: Verbrauch;
	grenzeMicro: number;
};

export async function reserveStand(env: NodeJS.ProcessEnv = process.env, jetzt: Date = new Date(), d: Verbindung = db): Promise<ReserveStand> {
	const z = await leseReserveZustand(d);
	const verbrauch = await verbrauchImMonat(d, jetzt);
	const leer = { name: null, modell: null, aktivSeit: null, grund: null, verbrauch, grenzeMicro: z.grenzeMicro };
	if (!z.reserveId) return { zustand: 'keine', ...leer };
	const [karte] = await d
		.select({ name: kiAnbieter.name, modell: kiAnbieter.modell, weg: kiAnbieter.weg, preisEinMicro: kiAnbieter.preisEinMicro, preisAusMicro: kiAnbieter.preisAusMicro })
		.from(kiAnbieter)
		.where(eq(kiAnbieter.id, z.reserveId));
	const basis = { ...leer, name: karte?.name ?? null, modell: karte?.modell ?? null, aktivSeit: z.aktivSeit };
	// Dieselben Gruende, aus denen der Worker die Reserve nicht baut (ki/aktiv.ts) — die Seite soll
	// sagen, was wirklich geschieht, nicht, was einmal festgelegt wurde.
	if ((await hauptWeg(env, d)) === 'bild') {
		return { ...basis, zustand: 'wirkungslos', grund: 'Der Hauptanbieter nutzt den Bildweg. Die Reserve braucht den Textweg.' };
	}
	if (karte?.weg !== 'text') return { ...basis, zustand: 'wirkungslos', grund: 'Die Reserve-Karte nutzt den Bildweg.' };
	if (karte.preisEinMicro === null || karte.preisAusMicro === null) {
		return { ...basis, zustand: 'wirkungslos', grund: 'Preise fehlen — ohne sie lässt sich die Monatsgrenze nicht prüfen.' };
	}
	if (verbrauch.kostenMicro >= z.grenzeMicro) return { ...basis, zustand: 'grenze' };
	if (!z.aktivSeit) return { ...basis, zustand: 'bereit' };
	const [eintrag] = await d
		.select({ details: betriebsprotokoll.details })
		.from(betriebsprotokoll)
		.where(eq(betriebsprotokoll.aktion, 'ki.reserve_aktiv'))
		.orderBy(desc(betriebsprotokoll.zeit))
		.limit(1);
	const grund = (eintrag?.details as { grund?: unknown } | null)?.grund;
	return { ...basis, zustand: 'aktiv', grund: typeof grund === 'string' ? grund : null };
}

export { geheimnisVorhanden, SchluesselFehlt };
