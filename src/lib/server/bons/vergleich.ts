/**
 * Zwei Bons gegenueberstellen und waehlen, welcher bleibt (Entwurf 2026-11-06-doppel-vergleich).
 *
 * Der andere geht NIE endgueltig weg, sondern ueber den Papierkorb-Weg — 30 Tage zurueckholbar.
 * Gelesen wird nur, was `sichtbareBons` zeigt; verwerfen darf, wer den Bon hochgeladen hat, oder
 * der Verwalter — dieselbe Regel wie beim Verwerfen.
 */
import { and, count, desc, eq, ilike, ne, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts, receiptItems, users } from '$lib/server/db/schema';
import { bonLaden, type ReceiptStatus } from '$lib/server/bons/liste';
import { inPapierkorbLegen, type PapierkorbErgebnis } from '$lib/server/bons/papierkorb';
import { darfBonVerwerfen, type Zugriffskontext } from '$lib/server/zugriff/kontext';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import { DOPPEL_GRUND } from '$lib/bons/beanstandungen';
import { parseAmountToCents } from '$lib/money';

type Verbindung = typeof Db;
type Bon = NonNullable<Awaited<ReturnType<typeof bonLaden>>>;

export type VergleichFehler = { ok: false; status: 403 | 404 | 409; meldung: string };

export const NICHT_GEFUNDEN: VergleichFehler = { ok: false, status: 404, meldung: 'Bon nicht gefunden' };
export const NICHT_BERECHTIGT: VergleichFehler = {
	ok: false,
	status: 403,
	meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.'
};

export const GEAENDERT: VergleichFehler = {
	ok: false,
	status: 409,
	meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.'
};

/** Welchen Status die Seite bei den Bons gesehen hat — Id → Status. */
export type Erwartet = Partial<Record<string, ReceiptStatus>>;

/**
 * Hat sich seit dem Laden der Seite ein Status geaendert (Abschlusspruefung 0.12.0, Wichtig 1)?
 * Sonst ginge ein inzwischen in einem anderen Tab bestaetigter Bon ohne Satz in den Papierkorb —
 * und fiele still aus Berichten und Budgets. Ohne Erwartung (aeltere Seite) wird nicht geprueft.
 */
export function passtErwartung(erwartet: Erwartet | undefined, ...bons: Pick<Bon, 'id' | 'status'>[]): VergleichFehler | null {
	if (!erwartet) return null;
	for (const b of bons) {
		const soll = erwartet[b.id];
		if (soll !== undefined && soll !== b.status) return GEAENDERT;
	}
	return null;
}

/** Was beide Handlungen gleich pruefen: nicht derselbe, keiner liest noch, keiner im Papierkorb. */
export function pruefePaar(a: Pick<Bon, 'id' | 'status'>, b: Pick<Bon, 'id' | 'status'>): VergleichFehler | null {
	if (a.id === b.id) return { ok: false, status: 409, meldung: 'Ein Bon lässt sich nicht mit sich selbst vergleichen.' };
	const liest = (s: ReceiptStatus) => s === 'pending' || s === 'extracting';
	if (liest(a.status) || liest(b.status)) return { ok: false, status: 409, meldung: 'Einer der beiden Bons wird noch gelesen.' };
	if (a.status === 'verworfen' || b.status === 'verworfen') {
		return { ok: false, status: 409, meldung: 'Einer der beiden Bons liegt schon im Papierkorb.' };
	}
	return null;
}

export async function vergleichLaden(
	d: Verbindung,
	k: Zugriffskontext,
	aId: string,
	bId: string
): Promise<{ ok: true; a: Bon; b: Bon } | VergleichFehler> {
	const [a, b] = await Promise.all([bonLaden(d, k, aId), bonLaden(d, k, bId)]);
	if (!a || !b) return NICHT_GEFUNDEN;
	return { ok: true, a, b };
}

/** Was die Gegenueberstellung je Bon zeigt (Seite `/receipts/[id]/vergleich/[anderer]`). */
export type VergleichBon = Pick<
	Bon,
	'id' | 'status' | 'merchantNameRaw' | 'purchasedAt' | 'totalGrossCents' | 'thumbPath' | 'imagePath' | 'createdAt'
> & { anzahlPositionen: number; hochgeladenVon: string | null; darfVerwerfen: boolean };

/** Ergaenzt einen schon sichtbar geladenen Bon um Zahl der Positionen, Anzeigename und Recht. */
export async function vergleichBon(d: Verbindung, k: Zugriffskontext, bon: Bon): Promise<VergleichBon> {
	const [[pos], [wer]] = await Promise.all([
		d.select({ n: count() }).from(receiptItems).where(eq(receiptItems.receiptId, bon.id)),
		d.select({ name: users.displayName }).from(users).where(eq(users.id, bon.uploadedBy))
	]);
	return {
		id: bon.id,
		status: bon.status,
		merchantNameRaw: bon.merchantNameRaw,
		purchasedAt: bon.purchasedAt,
		totalGrossCents: bon.totalGrossCents,
		thumbPath: bon.thumbPath,
		imagePath: bon.imagePath,
		createdAt: bon.createdAt,
		anzahlPositionen: Number(pos?.n ?? 0),
		hochgeladenVon: wer?.name ?? null,
		darfVerwerfen: darfBonVerwerfen(k, bon.uploadedBy)
	};
}

/** Bricht die Transaktion ab und traegt das Ergebnis heraus, das der Aufrufer zurueckgibt. */
class Abbruch extends Error {
	constructor(readonly ergebnis: VergleichFehler) {
		super(ergebnis.meldung);
	}
}

/**
 * „Diesen behalten": der behaltene kommt aus `doppelt` zurueck in die Pruefung, ein auf den
 * anderen zeigender Doppel-Hinweis ist erledigt, und der andere geht in den Papierkorb — alles in
 * EINER Transaktion. Die Rueckfrage der Gegenueberstellung ersetzt die Extra-Rueckfrage fuer
 * bestaetigte Bons (`bestaetigtWegnehmen: true`).
 */
export async function behalten(
	d: Verbindung,
	k: Zugriffskontext,
	behaltenId: string,
	wegId: string,
	deps: { papierkorb?: typeof inPapierkorbLegen; erwartet?: Erwartet } = {}
): Promise<{ ok: true } | VergleichFehler> {
	const papierkorb = deps.papierkorb ?? inPapierkorbLegen;
	const geladen = await vergleichLaden(d, k, behaltenId, wegId);
	if (!geladen.ok) return geladen;
	const { a: bleibt, b: weg } = geladen;
	const fehler = passtErwartung(deps.erwartet, bleibt, weg) ?? pruefePaar(bleibt, weg);
	if (fehler) return fehler;
	if (!darfBonVerwerfen(k, weg.uploadedBy)) return NICHT_BERECHTIGT;

	try {
		await d.transaction(async (tx) => {
			const dieser = and(eq(receipts.id, bleibt.id), sichtbareBons(k));
			if (bleibt.status === 'doppelt') {
				await tx.update(receipts).set({ status: 'review' }).where(and(dieser, eq(receipts.status, 'doppelt')));
			}
			if (bleibt.vermutetesOriginalId === weg.id) {
				await tx
					.update(receipts)
					.set({
						vermutetesOriginalId: null,
						needsReviewReason: sql`nullif(${receipts.needsReviewReason} - ${DOPPEL_GRUND}::text, '[]'::jsonb)`
					})
					.where(and(dieser, eq(receipts.vermutetesOriginalId, weg.id)));
			}
			const r: PapierkorbErgebnis = await papierkorb(tx as never, k, weg.id, true);
			if (!r.ok) throw new Abbruch({ ok: false, status: r.status, meldung: r.meldung });
		});
	} catch (err) {
		if (err instanceof Abbruch) return err.ergebnis;
		throw err;
	}
	return { ok: true };
}

export type Vorschlag = {
	id: string;
	merchantNameRaw: string | null;
	purchasedAt: Date | null;
	totalGrossCents: number | null;
	status: ReceiptStatus;
	thumbPath: string;
	createdAt: Date;
};

const HOECHSTENS = 20;
const NUR_SUMME = /^\d+([.,]\d{1,2})?$/;

/**
 * Kandidaten fuer „Mit anderem Bon vergleichen": sichtbar, nicht im Papierkorb, nicht er selbst.
 * Reihenfolge: gleiche Endsumme, dann Abstand der Kaufzeit, dann gleicher Laden, dann neueste.
 * Eine Suche aus Ziffern ist eine Summe („31,46"), sonst ein Stueck vom Ladennamen.
 */
export async function vorschlaege(d: Verbindung, k: Zugriffskontext, bonId: string, suche?: string): Promise<Vorschlag[]> {
	const x = await bonLaden(d, k, bonId);
	if (!x) return [];
	const s = suche?.trim() ?? '';
	const filter = s === '' ? undefined : NUR_SUMME.test(s) ? eq(receipts.totalGrossCents, parseAmountToCents(s)) : ilike(receipts.merchantNameRaw, `%${s}%`);

	const ordnung = [];
	if (x.totalGrossCents !== null) ordnung.push(sql`(${receipts.totalGrossCents} = ${x.totalGrossCents}) desc nulls last`);
	if (x.purchasedAt !== null) {
		ordnung.push(sql`abs(extract(epoch from (${receipts.purchasedAt} - ${x.purchasedAt.toISOString()}::timestamptz))) asc nulls last`);
	}
	if (x.merchantId !== null) ordnung.push(sql`(${receipts.merchantId} = ${x.merchantId}) desc nulls last`);
	ordnung.push(desc(receipts.createdAt));

	return d
		.select({
			id: receipts.id,
			merchantNameRaw: receipts.merchantNameRaw,
			purchasedAt: receipts.purchasedAt,
			totalGrossCents: receipts.totalGrossCents,
			status: receipts.status,
			thumbPath: receipts.thumbPath,
			createdAt: receipts.createdAt
		})
		.from(receipts)
		.where(and(sichtbareBons(k), ne(receipts.status, 'verworfen'), ne(receipts.id, x.id), filter))
		.orderBy(...ordnung)
		.limit(HOECHSTENS);
}
