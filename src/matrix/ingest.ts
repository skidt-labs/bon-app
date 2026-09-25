import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { storeReceiptImage } from '$lib/server/storage/images';
import { enqueueExtraction } from '$lib/server/queue/boss';
import { nutzerZuMatrixId } from '$lib/server/matrix/links';

/**
 * Synapse ist auf `max_upload_size: 512M` konfiguriert (für Dateifreigabe im Team).
 * Das ungeprüft in sharp zu schieben wäre ein Speicherproblem, das den Bot für alle
 * anderen lahmlegt. Ein Handyfoto liegt bei 2-12 MB; 25 MB lässt reichlich Luft und
 * bleibt weit unter dem, was dem Prozess wehtut. Anders als beim App-Upload (12 MB)
 * kommt hier das ORIGINAL an — die App verkleinert im Browser, Matrix nicht.
 */
export const MAX_BILD_BYTES = 25 * 1024 * 1024;

/**
 * Entwurf E4: unter dieser Breite liest Tesseract oft GAR NICHTS, und der Betreiber
 * kann einem Bild nicht ansehen, ob Element es kaputtkomprimiert hat.
 *
 * Gemessen am 2026-09-15, derselbe Bon über zwei Versandwege: als Foto (Galerie)
 * 297 px — kein einziges Feld lesbar; als Datei 1130 px — vollständig. Der
 * Umsetzungsbericht zu Aufgabe 1 hat einen ZWEITEN, unabhängigen Bon über Matrix bei
 * 366 px bereits vollständig gelesen; der Entwurf misst weitere volle Treffer bei
 * 383/395/448 px (Lidl) und 838 px (App-Upload).
 *
 * 350 px liegt zwischen dem EINZIGEN gemessenen Totalausfall (297) und dem
 * NIEDRIGSTEN gemessenen Volltreffer (366) — mit Marge zu beiden Seiten, aber näher
 * am Ausfall: eine Warnung, die sich im Nachhinein als unnötig erweist, kostet den
 * Betreiber eine Zeile Text; ein unbemerkter Leseausfall kostet einen ganzen Bon.
 */
export const MIN_BILD_BREITE_PX = 350;

/**
 * W2b (Korrekturrunde 2): Prüft die vom Absender ANGEKÜNDIGTE Grösse
 * (`content.info.size`), BEVOR überhaupt heruntergeladen wird — `downloadContent`
 * und `crypto.decryptMedia` puffern sonst das komplette Medium in einen `Buffer`,
 * bis zu Synapses `max_upload_size` von 512 MB, bevor diese Funktion hier je zu
 * sehen bekommt, was ankam.
 *
 * Restlücke, bewusst dokumentiert statt verschwiegen: `content.info.size` setzt der
 * SENDENDE Client und ist damit so wenig vertrauenswürdig wie `is_direct` (W2a) — ein
 * von Hand gebautes Ereignis kann eine kleine Zahl behaupten und trotzdem ein
 * riesiges Medium anhängen. Diese Prüfung fängt den ehrlichen Fall (normale Clients,
 * grosse aber harmlose Fotos) VOR dem teuren Download ab; den unehrlichen Fall
 * (gelogene Grösse) fängt weiterhin nur der echte Grössen-Check nach dem Download
 * (unten in `nimmBildAuf`) UND die Speichergrenze (`mem_limit` in `compose.yaml`,
 * W2c) — DAS ist dort der harte Deckel, nicht diese Funktion.
 *
 * `undefined` (Feld fehlt) heisst: wir wissen es nicht, es wird trotzdem geladen —
 * ohne Patches an matrix-bot-sdks `downloadContent` (puffert immer komplett, kein
 * Streaming-Hook nach aussen) liesse sich ein Abbruch mitten im Herunterladen nicht
 * ohne Verrenkungen einbauen.
 */
export function pruefeAngekuendigteGroesse(size: number | undefined): AufnahmeErgebnis | null {
	if (typeof size === 'number' && size > MAX_BILD_BYTES) {
		return { art: 'zu_gross', bytes: size, grenze: MAX_BILD_BYTES };
	}
	return null;
}

export type EingehendesBild = {
	eventId: string;
	senderMatrixId: string;
	roomId: string;
	bytes: Buffer;
	gesendetAm: Date;
};

export type AufnahmeErgebnis =
	| { art: 'aufgenommen'; receiptId: string }
	// Entwurf E4: das Bild ist schmaler als MIN_BILD_BREITE_PX — der Bon wird
	// TROTZDEM gespeichert und eingereiht (nichts wird weggeworfen), aber der
	// Betreiber soll wissen, dass die Auslesung deshalb womöglich nichts findet.
	| { art: 'aufgenommen_zu_klein'; receiptId: string; breite: number }
	| { art: 'schon_bekannt'; receiptId: string }
	| { art: 'nicht_gekoppelt' }
	| { art: 'zu_gross'; bytes: number; grenze: number }
	| { art: 'kein_bild'; grund: string }
	| { art: 'nicht_eingereiht'; receiptId: string; grund: string }
	| { art: 'fehler'; grund: string };

export type AufnahmeDeps = {
	nutzerZuMatrixId: typeof nutzerZuMatrixId;
	storeReceiptImage: typeof storeReceiptImage;
	enqueueExtraction: typeof enqueueExtraction;
	findeBonZuEreignis: (eventId: string) => Promise<string | null>;
	legeBonAn: (werte: {
		householdId: string;
		uploadedBy: string;
		imagePath: string;
		thumbPath: string;
		source: 'matrix';
		matrixEventId: string;
	}) => Promise<string>;
	markiereFehlgeschlagen: (receiptId: string, grund: string) => Promise<void>;
};

const echteDeps: AufnahmeDeps = {
	nutzerZuMatrixId,
	storeReceiptImage,
	enqueueExtraction,
	async findeBonZuEreignis(eventId) {
		const [zeile] = await db
			.select({ id: receipts.id })
			.from(receipts)
			.where(eq(receipts.matrixEventId, eventId));
		return zeile?.id ?? null;
	},
	async legeBonAn(werte) {
		const [zeile] = await db.insert(receipts).values(werte).returning({ id: receipts.id });
		return zeile.id;
	},
	async markiereFehlgeschlagen(receiptId, grund) {
		await db
			.update(receipts)
			.set({ status: 'failed', failureReason: grund.slice(0, 500) })
			.where(eq(receipts.id, receiptId));
	}
};

export async function nimmBildAuf(
	bild: EingehendesBild,
	ueberschreibungen: Partial<AufnahmeDeps> = {}
): Promise<AufnahmeErgebnis> {
	const d = { ...echteDeps, ...ueberschreibungen };

	// Zuerst die Idempotenz: billiger als alles andere, und nach einem Neustart der
	// häufigste Fall. Ein Fehler HIER bedeutet nicht "neues Ereignis", sondern "wir
	// wissen es gerade nicht" — nimmBildAuf darf das nicht in einen harmloseren
	// Ausgang umdeuten und schon gar nicht werfen: Aufgabe 5 bekäme sonst gar keine
	// Antwort (kein Text, keine Reaktion, kein Alarm) statt wenigstens 'fehler'. Der
	// technische Grund geht ins Log, nicht als Behauptung in die Antwort.
	let bekannt: string | null;
	try {
		bekannt = await d.findeBonZuEreignis(bild.eventId);
	} catch (err) {
		console.error('[matrix/ingest] Idempotenzprüfung fehlgeschlagen', err);
		return { art: 'fehler', grund: err instanceof Error ? err.message : String(err) };
	}
	if (bekannt) return { art: 'schon_bekannt', receiptId: bekannt };

	// Dann die Zugangskontrolle. Ein nicht gekoppelter Absender löst NICHTS aus —
	// kein Bild auf der Platte, kein Bon, kein Job. Auch hier gilt: ein
	// Datenbankfehler ist kein "nicht gekoppelt" — sonst würde eine Störung einen
	// echten, gekoppelten Nutzer unbemerkt abweisen.
	let nutzer: { userId: string; householdId: string; displayName: string } | null;
	try {
		nutzer = await d.nutzerZuMatrixId(bild.senderMatrixId);
	} catch (err) {
		console.error('[matrix/ingest] Zugangskontrolle fehlgeschlagen', err);
		return { art: 'fehler', grund: err instanceof Error ? err.message : String(err) };
	}
	if (!nutzer) return { art: 'nicht_gekoppelt' };

	if (bild.bytes.byteLength > MAX_BILD_BYTES) {
		return { art: 'zu_gross', bytes: bild.bytes.byteLength, grenze: MAX_BILD_BYTES };
	}

	let pfade: { imagePath: string; thumbPath: string; width: number };
	try {
		pfade = await d.storeReceiptImage(bild.bytes, bild.gesendetAm);
	} catch (err) {
		// W4 (Korrekturrunde 2): Zwei ganz verschiedene Ursachen landeten hier bisher
		// im selben Topf. `storeReceiptImage` schreibt zwei Dateien (Original,
		// Vorschaubild) UND lässt sharp zweimal dekodieren — eine volle Platte
		// (ENOSPC) lässt `writeFile` genauso scheitern wie ein kaputtes Bild sharp
		// scheitern lässt. Beide endeten als 'kein_bild', und der Nutzer bekam "das
		// sieht nicht nach einem lesbaren Bild aus" — eine Behauptung über SEINEN
		// Fehler, obwohl bei ENOSPC unserer vorliegt. Node-Dateisystemfehler tragen
		// einen `.code` wie 'ENOSPC'/'EACCES'/'EROFS'; ein sharp-Dekodierfehler ist ein
		// gewöhnlicher `Error` ohne dieses Feld — das unterscheidet zuverlässig
		// zwischen "unser Speicher" und "sein Bild".
		if (istSystemFehler(err)) {
			console.error('[matrix/ingest] Bildspeicherung fehlgeschlagen (Systemfehler, kein Bildproblem)', err);
			return { art: 'fehler', grund: err instanceof Error ? err.message : String(err) };
		}
		// sharp wirft hier, wenn es kein Bild ist oder es kaputt ist. Kein Bon, kein
		// Job — und der Anrufer sagt dem Nutzer, was los ist.
		console.error('[matrix/ingest] Bild unbrauchbar', err);
		return { art: 'kein_bild', grund: err instanceof Error ? err.message : String(err) };
	}

	let receiptId: string;
	try {
		receiptId = await d.legeBonAn({
			householdId: nutzer.householdId,
			uploadedBy: nutzer.userId,
			imagePath: pfade.imagePath,
			thumbPath: pfade.thumbPath,
			source: 'matrix',
			matrixEventId: bild.eventId
		});
	} catch (err) {
		// Wettlauf: ein zweiter, gleichzeitiger Aufruf für DASSELBE Ereignis (z. B.
		// ein erneut zugestelltes /sync nach einem Neustart) kann hier ankommen,
		// obwohl findeBonZuEreignis oben noch nichts fand — der andere Aufruf hat
		// seinen INSERT nur schneller committet. Der Unique-Constraint auf
		// matrix_event_id verhindert den Doppel-Bon auf Datenbankebene; ohne diese
		// Sonderbehandlung würde das hier als 'fehler' gemeldet, Aufgabe 5 antwortete
		// mit "bitte erneut versuchen", der Nutzer schickte das Foto NOCHMAL mit
		// einer NEUEN Ereignis-ID — und genau der Doppel-Bon entstünde, den der
		// Idempotenz-Schlüssel eigentlich verhindern soll.
		if (istEreignisKonflikt(err)) {
			let vorhanden: string | null;
			try {
				vorhanden = await d.findeBonZuEreignis(bild.eventId);
			} catch (nachschlagFehler) {
				console.error(
					'[matrix/ingest] Nachschlagen nach Ereignis-Konflikt fehlgeschlagen',
					nachschlagFehler
				);
				return {
					art: 'fehler',
					grund:
						nachschlagFehler instanceof Error ? nachschlagFehler.message : String(nachschlagFehler)
				};
			}
			// Kann in der Theorie leer bleiben (Constraint hat ausgelöst, die fremde
			// Transaktion ist aber noch nicht sichtbar) — dann ehrlich 'fehler' statt
			// eine Bon-ID zu erfinden. Fällt unten durch.
			if (vorhanden) return { art: 'schon_bekannt', receiptId: vorhanden };
		}
		// W4 (Korrekturrunde 2): bisher ohne console.error — der einzige Fehlergrund in
		// dieser Funktion, der spurlos blieb (keine Log-Zeile, keine DB-Zeile, kein
		// Alarm; die Antwort an den Nutzer nennt den technischen Grund bewusst nicht).
		console.error('[matrix/ingest] Bon anlegen fehlgeschlagen', err);
		return { art: 'fehler', grund: err instanceof Error ? err.message : String(err) };
	}

	try {
		await d.enqueueExtraction(receiptId);
	} catch (err) {
		// Der Bon EXISTIERT samt Bild. Fehlgeschlagen ist nur der Hintergrundauftrag,
		// und den bringt ein erneutes Aufnehmen nicht zurück — es erzeugte nur einen
		// Doppel-Bon. Sichtbar über Status `failed` im Posteingang — SOFERN das
		// folgende markiereFehlgeschlagen selbst durchläuft (W3, Korrekturrunde 2:
		// vorher ein leerer, protokollloser catch — scheitert ausgerechnet dieses
		// UPDATE, z. B. weil dieselbe nicht erreichbare Datenbank auch pg-boss lahmlegt,
		// blieb der Bon auf 'pending' stehen, während die Antwort behauptete, er stehe
		// als 'failed' im Posteingang; siehe die entschärfte Antwort in antworten.ts).
		const grund = err instanceof Error ? err.message : String(err);
		await d.markiereFehlgeschlagen(receiptId, grund).catch((markierFehler) => {
			console.error(
				'[matrix/ingest] Bon konnte nicht als fehlgeschlagen markiert werden — bleibt auf "pending" stehen',
				markierFehler
			);
		});
		return { art: 'nicht_eingereiht', receiptId, grund };
	}

	// Entwurf E4: die Breite entscheidet, ob Tesseract später überhaupt etwas lesen
	// kann — der Bon ist an dieser Stelle bereits gespeichert und eingereiht, das
	// hier ändert daran nichts, nur die Antwort an den Nutzer wird eine andere.
	if (pfade.width < MIN_BILD_BREITE_PX) {
		return { art: 'aufgenommen_zu_klein', receiptId, breite: pfade.width };
	}
	return { art: 'aufgenommen', receiptId };
}

/**
 * Erkennt die Verletzung des Unique-Constraints auf `matrix_event_id` (Postgres
 * SQLSTATE 23505) am Namen des Constraints — dasselbe Muster wie
 * `eindeutigkeitsGrund()` in `pairing.ts`. Jede andere 23505 (z. B. ein anderer
 * Constraint) ist KEIN Ereignis-Konflikt und fällt durch auf 'fehler'.
 */
function istEreignisKonflikt(err: unknown): boolean {
	if (!err || typeof err !== 'object' || (err as { code?: unknown }).code !== '23505') {
		return false;
	}
	return (err as { constraint?: unknown }).constraint === 'receipts_matrix_event_id_unique';
}

/**
 * W4 (Korrekturrunde 2): unterscheidet einen Node-Dateisystemfehler (ENOSPC, EACCES,
 * EROFS, EMFILE, …) von einem gewöhnlichen sharp-Dekodierfehler. Node setzt bei
 * Systemfehlern zuverlässig `.code` auf einen dieser Errno-Namen; sharp wirft bei
 * einem kaputten/unbrauchbaren Bild einen reinen `Error` ohne dieses Feld — verifiziert
 * gegen die installierte sharp-Fassung (kein `.code` bei "Input buffer contains
 * unsupported image format" & Co.). Keine abschliessende Liste der Errno-Codes nötig:
 * jedes `.code`, das wie ein Errno aussieht (Grossbuchstaben, mit E beginnend), ist ein
 * Systemfehler — ein neuer, hier nicht bedachter Errno-Code fiele also auf der
 * sicheren Seite (Alarm + 'fehler') und nicht auf der stillen (kein_bild) durch.
 */
function istSystemFehler(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const code = (err as { code?: unknown }).code;
	return typeof code === 'string' && /^E[A-Z]+$/.test(code);
}
