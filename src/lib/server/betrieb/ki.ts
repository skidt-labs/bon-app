import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { instanz, kiAnbieter } from '$lib/server/db/schema';
import { MAX_ZEITLIMIT_MS } from '$lib/server/queue/fristen';
import { bildwegIstBestaetigt } from '$lib/server/extraction';
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
	const zeilen = await db.select().from(kiAnbieter).orderBy(kiAnbieter.angelegtAm);
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
			aktiv: z.id === aktivId
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
	env: NodeJS.ProcessEnv = process.env
): Promise<void> {
	const schluessel = e.schluessel
		? { schluesselEnc: verschluesseln(e.schluessel, id, env), schluesselEnde: schluesselEnde(e.schluessel) }
		: e.schluesselEntfernen
			? { schluesselEnc: null, schluesselEnde: null }
			: {};
	await db.transaction(async (tx) => {
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
			.where(sql`${instanz.id} = 1 and ${instanz.aktiverKiAnbieter} = ${id}`);
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

export async function anbieterAktivieren(id: string, userId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
	await db.transaction(async (tx) => {
		const [z] = await tx
			.select({ name: kiAnbieter.name, weg: kiAnbieter.weg, testOk: kiAnbieter.testOk })
			.from(kiAnbieter)
			.where(eq(kiAnbieter.id, id));
		if (!z) throw new AnbieterNichtGefunden();
		if (z.testOk !== true) throw new NichtGetestet();
		if (z.weg === 'bild' && !bildwegIstBestaetigt(env)) {
			throw new BildwegNichtFreigegeben(BILDWEG_GESPERRT);
		}
		const [alt] = await tx.select({ aktivId: instanz.aktiverKiAnbieter }).from(instanz).where(eq(instanz.id, 1));
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

export async function anbieterLoeschen(id: string, userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const { aktivId } = await kiStandLesen();
		if (aktivId === id) throw new AnbieterAktiv();
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
export { geheimnisVorhanden, SchluesselFehlt };
