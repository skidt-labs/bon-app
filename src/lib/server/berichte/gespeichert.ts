import { and, asc, eq } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { gespeicherteBerichte, users } from '$lib/server/db/schema';
import { darfGeteiltesVerwalten, type Zugriffskontext } from '$lib/server/zugriff/kontext';
import { filterAusAdresse, merkmalParameter, zeitraumParameter, type BerichtFilter } from '$lib/berichte/filter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NAME_HOECHSTENS = 60;

export type GespeicherterBericht = {
	id: string;
	name: string;
	parameter: Record<string, string>;
	zeitraum: Record<string, string> | null;
	erstellerName: string | null;
	darfAendern: boolean;
};

export type Ergebnis<T> = { ok: true; wert: T } | { ok: false; grund: string };

const NICHT_DA = 'Den Bericht gibt es nicht (mehr).';
const KEIN_RECHT = 'Ändern und löschen darf nur, wer ihn angelegt hat, oder ein Verwalter.';

/** Umbenennen, Aendern, Loeschen: der Ersteller oder ein Verwalter des Haushalts. */
function darfAendern(k: Zugriffskontext, erstelltVon: string | null): boolean {
	return erstelltVon === k.nutzerId || darfGeteiltesVerwalten(k);
}

/** Postgres 23505 — derselbe Name ist im Haushalt schon vergeben. */
function istEindeutigkeitsfehler(err: unknown): boolean {
	const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
	return code === '23505';
}

const NAME_VERGEBEN = 'Einen Bericht mit diesem Namen gibt es im Haushalt schon.';

/**
 * Vorher fragen statt nur auf die Eindeutigkeitsregel zu vertrauen: ein gescheitertes
 * INSERT bricht eine umgebende Transaktion ab (so laufen die DB-Tests). Die Regel in der
 * Datenbank bleibt als Absicherung, falls zwei gleichzeitig denselben Namen speichern.
 */
async function nameVergeben(db: typeof Db, k: Zugriffskontext, name: string, ausser: string | null): Promise<boolean> {
	const treffer = await db
		.select({ id: gespeicherteBerichte.id })
		.from(gespeicherteBerichte)
		.where(and(eq(gespeicherteBerichte.householdId, k.haushaltId), eq(gespeicherteBerichte.name, name)));
	return treffer.some((t) => t.id !== ausser);
}

function nameAus(roh: string): Ergebnis<string> {
	const name = roh.trim();
	if (name === '') return { ok: false, grund: 'Der Bericht braucht einen Namen.' };
	if (name.length > NAME_HOECHSTENS) return { ok: false, grund: `Der Name darf höchstens ${NAME_HOECHSTENS} Zeichen haben.` };
	return { ok: true, wert: name };
}

const spalten = {
	id: gespeicherteBerichte.id,
	name: gespeicherteBerichte.name,
	parameter: gespeicherteBerichte.filter,
	zeitraum: gespeicherteBerichte.zeitraum,
	erstelltVon: gespeicherteBerichte.erstelltVon,
	erstellerName: users.displayName
};

type Zeile = { id: string; name: string; parameter: Record<string, string>; zeitraum: Record<string, string> | null; erstelltVon: string | null; erstellerName: string | null };
const alsBericht = (k: Zugriffskontext, z: Zeile): GespeicherterBericht => ({
	id: z.id, name: z.name, parameter: z.parameter, zeitraum: z.zeitraum, erstellerName: z.erstellerName, darfAendern: darfAendern(k, z.erstelltVon)
});

/** Alle Berichte des eigenen Haushalts — gespeicherte Berichte sieht jeder im Haushalt. */
export async function gespeicherteListe(db: typeof Db, k: Zugriffskontext): Promise<GespeicherterBericht[]> {
	const zeilen = await db
		.select(spalten)
		.from(gespeicherteBerichte)
		.leftJoin(users, eq(users.id, gespeicherteBerichte.erstelltVon))
		.where(eq(gespeicherteBerichte.householdId, k.haushaltId))
		.orderBy(asc(gespeicherteBerichte.name));
	return zeilen.map((z) => alsBericht(k, z));
}

/** Ein Bericht des EIGENEN Haushalts; alles andere ist „nicht gefunden". */
export async function gespeichertLaden(db: typeof Db, k: Zugriffskontext, id: string): Promise<GespeicherterBericht | null> {
	if (!UUID.test(id)) return null;
	const [z] = await db
		.select(spalten)
		.from(gespeicherteBerichte)
		.leftJoin(users, eq(users.id, gespeicherteBerichte.erstelltVon))
		.where(and(eq(gespeicherteBerichte.id, id), eq(gespeicherteBerichte.householdId, k.haushaltId)));
	return z ? alsBericht(k, z) : null;
}

/**
 * Gespeichertes wird gelesen wie eine Adresse — dieselbe Pruefung, dieselben Hinweise.
 * Ohne gespeicherten Zeitraum oeffnet der Bericht den laufenden Monat.
 */
export function alsFilter(
	b: Pick<GespeicherterBericht, 'parameter' | 'zeitraum'>,
	heute: string
): { filter: BerichtFilter; hinweise: string[] } {
	return filterAusAdresse(new URLSearchParams({ ...(b.zeitraum ?? {}), ...b.parameter }), heute);
}

const sortiert = (r: Record<string, string>) => JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

/** Ob der gezeigte Filter vom gespeicherten abweicht („Änderungen speichern"). */
export function istGeaendert(b: Pick<GespeicherterBericht, 'parameter' | 'zeitraum'>, filter: BerichtFilter): boolean {
	if (sortiert(b.parameter) !== sortiert(merkmalParameter(filter))) return true;
	return b.zeitraum !== null && sortiert(b.zeitraum) !== sortiert(zeitraumParameter(filter.zeitraum));
}

export async function berichtSpeichern(
	db: typeof Db,
	k: Zugriffskontext,
	eingabe: { name: string; filter: BerichtFilter; mitZeitraum: boolean }
): Promise<Ergebnis<string>> {
	const name = nameAus(eingabe.name);
	if (!name.ok) return name;
	if (await nameVergeben(db, k, name.wert, null)) return { ok: false, grund: NAME_VERGEBEN };
	try {
		const [z] = await db
			.insert(gespeicherteBerichte)
			.values({
				householdId: k.haushaltId,
				name: name.wert,
				filter: merkmalParameter(eingabe.filter),
				zeitraum: eingabe.mitZeitraum ? zeitraumParameter(eingabe.filter.zeitraum) : null,
				erstelltVon: k.nutzerId
			})
			.returning({ id: gespeicherteBerichte.id });
		return { ok: true, wert: z.id };
	} catch (err) {
		if (istEindeutigkeitsfehler(err)) return { ok: false, grund: NAME_VERGEBEN };
		throw err;
	}
}

async function mitRecht(db: typeof Db, k: Zugriffskontext, id: string): Promise<Ergebnis<{ zeitraum: Record<string, string> | null }>> {
	if (!UUID.test(id)) return { ok: false, grund: NICHT_DA };
	const [z] = await db
		.select({ erstelltVon: gespeicherteBerichte.erstelltVon, zeitraum: gespeicherteBerichte.zeitraum })
		.from(gespeicherteBerichte)
		.where(and(eq(gespeicherteBerichte.id, id), eq(gespeicherteBerichte.householdId, k.haushaltId)));
	if (!z) return { ok: false, grund: NICHT_DA };
	if (!darfAendern(k, z.erstelltVon)) return { ok: false, grund: KEIN_RECHT };
	return { ok: true, wert: { zeitraum: z.zeitraum } };
}

/** Die Filter des gespeicherten Berichts durch die gezeigten ersetzen (Zeitraum nur, wenn er einen hatte). */
export async function berichtAendern(db: typeof Db, k: Zugriffskontext, id: string, filter: BerichtFilter): Promise<Ergebnis<string>> {
	const recht = await mitRecht(db, k, id);
	if (!recht.ok) return recht;
	await db
		.update(gespeicherteBerichte)
		.set({
			filter: merkmalParameter(filter),
			zeitraum: recht.wert.zeitraum === null ? null : zeitraumParameter(filter.zeitraum),
			geaendertAm: new Date()
		})
		.where(and(eq(gespeicherteBerichte.id, id), eq(gespeicherteBerichte.householdId, k.haushaltId)));
	return { ok: true, wert: id };
}

export async function berichtUmbenennen(db: typeof Db, k: Zugriffskontext, id: string, roh: string): Promise<Ergebnis<string>> {
	const name = nameAus(roh);
	if (!name.ok) return name;
	const recht = await mitRecht(db, k, id);
	if (!recht.ok) return recht;
	if (await nameVergeben(db, k, name.wert, id)) return { ok: false, grund: NAME_VERGEBEN };
	try {
		await db
			.update(gespeicherteBerichte)
			.set({ name: name.wert, geaendertAm: new Date() })
			.where(and(eq(gespeicherteBerichte.id, id), eq(gespeicherteBerichte.householdId, k.haushaltId)));
	} catch (err) {
		if (istEindeutigkeitsfehler(err)) return { ok: false, grund: NAME_VERGEBEN };
		throw err;
	}
	return { ok: true, wert: id };
}

export async function berichtLoeschen(db: typeof Db, k: Zugriffskontext, id: string): Promise<Ergebnis<string>> {
	const recht = await mitRecht(db, k, id);
	if (!recht.ok) return recht;
	await db.delete(gespeicherteBerichte).where(and(eq(gespeicherteBerichte.id, id), eq(gespeicherteBerichte.householdId, k.haushaltId)));
	return { ok: true, wert: id };
}
