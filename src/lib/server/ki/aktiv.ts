import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { instanz, kiAnbieter } from '$lib/server/db/schema';
import {
	baueProvider,
	bildwegIstBestaetigt,
	konfigAusEnv,
	textZielAus,
	type KiWeg,
	type ProviderKonfig
} from '$lib/server/extraction';
import type { TextModellZiel } from '$lib/server/extraction/ocr-text-provider';
import { modellAufrufMitReserve, type Leser, type UmschaltDeps } from './umschalten';
import { echteUmschaltDeps } from './reserve';
import type { ExtractionProvider } from '$lib/server/extraction/types';
import { entschluesseln } from './geheimnis';
import { BildwegNichtFreigegeben, KiKonfigurationFehler, KiSchluesselUnlesbar } from './fehler';
import { preiseAusEnv, type Preise } from './preise';

/**
 * Welcher KI-Anbieter JETZT gilt — fuer den Worker, pro Auftrag.
 *
 * Ohne aktiven Anbieter: die .env, wie vor der Oberflaeche. Mit aktivem Anbieter: dessen
 * Zeile, entschluesselt. Der gebaute Anbieter wird gemerkt, bis `instanz.ki_stand` sich
 * aendert — pro Auftrag kostet das eine kleine Abfrage.
 *
 * KEIN STILLER RUECKFALL: ist ein Anbieter aktiv und unbrauchbar (Schluessel unlesbar,
 * Zeile weg, Bildweg nicht freigegeben), wird geworfen, nicht die .env genommen. Ein
 * Rueckfall, den niemand bemerken kann, ist in diesem Projekt selbst ein Defekt.
 */

export type KiAnbieterRoh = {
	id: string;
	name: string;
	weg: KiWeg;
	baseUrl: string;
	modell: string;
	schluesselEnc: Buffer | null;
	zeitlimitMs: number;
	preisEinMicro: number | null;
	preisAusMicro: number | null;
};

export type AktiverProvider = {
	provider: ExtractionProvider;
	weg: KiWeg;
	kiAnbieterId: string | null;
	name: string;
	quelle: 'oberflaeche' | 'env';
	preise: Preise;
	/** Die Konfiguration des Hauptanbieters — fuer den Zeitplan-Auftrag, der ihn anfragt. */
	konfig: ProviderKonfig;
	/** Die Cloud-Reserve, wenn eine eingerichtet ist UND wirken kann (beide Textweg). */
	reserve: { kiAnbieterId: string; name: string } | null;
	/** Wer den letzten Bon gelesen hat (Hauptanbieter oder Reserve); vor dem ersten: der Hauptanbieter. */
	letzterLeser(): Leser;
	/**
	 * Ein neuer Auftrag beginnt: zurueck auf den Hauptanbieter. Sonst erbte ein Bon, der VOR dem
	 * Modellaufruf scheitert, die Rolle des vorigen (Abschlusspruefung 02.10.2026).
	 */
	neuerAuftrag(): void;
};

export type AufloeserDeps = {
	leseStand(): Promise<{ stand: number; aktivId: string | null; reserveId?: string | null }>;
	leseAnbieter(id: string): Promise<KiAnbieterRoh | null>;
	bauen?: typeof baueProvider;
	env?: NodeJS.ProcessEnv;
	log?: (zeile: string) => void;
	/** Was „umschalten" im Betrieb bedeutet (Zustand, Matrix, Protokoll). Fehlt es: keine Reserve. */
	umschalten?: (reserve: { kiAnbieterId: string; name: string }) => UmschaltDeps;
};

/** Zeile → Konfiguration. Entschluesselt; wirft KiSchluesselUnlesbar statt irgendetwas anderem. */
export function konfigAusZeile(z: KiAnbieterRoh, env: NodeJS.ProcessEnv = process.env): ProviderKonfig {
	let apiKey = '';
	if (z.schluesselEnc) {
		try {
			apiKey = entschluesseln(z.schluesselEnc, z.id, env);
		} catch (err) {
			// entschluesseln() wirft bei einem unbrauchbaren SECRETS_KEY nicht immer
			// KiSchluesselUnlesbar — ein SchluesselFehlt (nicht gesetzt) oder ein
			// plain Error (falsche Laenge, siehe geheimnis.ts:schluessel()) waeren
			// sonst ein normaler Error, den istVoruebergehenderFehler nicht als
			// voruebergehend erkennt und der Auftrag endgueltig scheitern liesse.
			// Schon eine KiKonfigurationFehler-Unterklasse (z. B. KiSchluesselUnlesbar
			// aus entschluesseln selbst) traegt ihre eigene, treffendere Meldung und
			// wird deshalb unveraendert weitergereicht.
			if (err instanceof KiKonfigurationFehler) {
				throw err;
			}
			throw new KiSchluesselUnlesbar(
				`Der KI-Anbieter „${z.name}" hat einen Schluessel, aber SECRETS_KEY ist unbrauchbar.`
			);
		}
	}
	return { weg: z.weg, baseUrl: z.baseUrl, apiKey, model: z.modell, timeoutMs: z.zeitlimitMs };
}

/**
 * Jeder Fehler beim Lesen oder Bauen der Konfiguration ist ein KONFIGURATIONSfehler: eine
 * unvollstaendige .env (etwa nach „Zurueck auf .env"), eine kaputte OCR-Einstellung. Als
 * gewoehnliches Error hielte istVoruebergehenderFehler ihn fuer endgueltig, und jeder Bon
 * scheiterte, statt nach der Reparatur durchzulaufen. Die Meldung bleibt, die Ursache
 * haengt als `cause` daran.
 */
function alsKonfigurationFehler(err: unknown): KiKonfigurationFehler {
	if (err instanceof KiKonfigurationFehler) return err;
	return new KiKonfigurationFehler(err instanceof Error ? err.message : String(err), { cause: err });
}

export function erzeugeAufloeser(deps: AufloeserDeps): () => Promise<AktiverProvider> {
	const bauen = deps.bauen ?? baueProvider;
	const env = deps.env ?? process.env;
	const log = deps.log ?? ((z: string) => console.log(z));
	let gemerkt: { schluessel: string; wert: AktiverProvider } | null = null;

	return async () => {
		const { stand, aktivId, reserveId = null } = await deps.leseStand();
		const schluessel = `${stand}:${aktivId ?? 'env'}:${reserveId ?? '-'}`;

		if (!gemerkt || gemerkt.schluessel !== schluessel) {
			const pruefe = <T>(f: () => T): T => {
				try {
					return f();
				} catch (err) {
					throw alsKonfigurationFehler(err);
				}
			};
			let k: ProviderKonfig;
			let kopf: Pick<AktiverProvider, 'kiAnbieterId' | 'name' | 'quelle' | 'preise'>;
			if (aktivId === null) {
				k = pruefe(() => konfigAusEnv(env));
				kopf = { kiAnbieterId: null, name: '.env', quelle: 'env', preise: preiseAusEnv(env) };
			} else {
				const z = await deps.leseAnbieter(aktivId);
				if (!z) throw new KiKonfigurationFehler(`Der aktive KI-Anbieter ${aktivId} fehlt in der Datenbank.`);
				k = pruefe(() => konfigAusZeile(z, env));
				kopf = { kiAnbieterId: z.id, name: z.name, quelle: 'oberflaeche', preise: { einMicro: z.preisEinMicro, ausMicro: z.preisAusMicro } };
			}
			const haupt: Leser = {
				rolle: 'haupt',
				name: kopf.name,
				modell: k.model,
				kiAnbieterId: kopf.kiAnbieterId,
				preise: kopf.preise,
				ziel: () => textZielAus(k)
			};
			// Wer zuletzt gelesen hat — je gebautem Anbieter; der Worker arbeitet einen Auftrag nach
			// dem anderen ab (batchSize 1), also stimmt der Wert nach jedem extract.
			let zuletzt: Leser = haupt;
			let reserve: AktiverProvider['reserve'] = null;
			let overrides: Parameters<typeof baueProvider>[1];
			if (reserveId && deps.umschalten) {
				const r = k.weg === 'text' ? await deps.leseAnbieter(reserveId) : null;
				// Ohne Preise zaehlten ihre Laeufe 0 € — die Monatsgrenze griffe nie (Abschlusspruefung 02.10.).
				const mitPreisen = r !== null && r.preisEinMicro !== null && r.preisAusMicro !== null;
				if (r && r.weg === 'text' && mitPreisen) {
					const reserveLeser: Leser = {
						rolle: 'reserve',
						name: r.name,
						modell: r.modell,
						kiAnbieterId: r.id,
						preise: { einMicro: r.preisEinMicro, ausMicro: r.preisAusMicro },
						// Faul: ein unlesbarer Reserve-Schluessel wirft erst, wenn die Reserve gefragt
						// wird — er haelt den Mac nicht auf.
						ziel: () => textZielAus(konfigAusZeile(r, env))
					};
					overrides = {
						modellAufruf: modellAufrufMitReserve(haupt, reserveLeser, deps.umschalten({ kiAnbieterId: r.id, name: r.name }), (l) => {
							zuletzt = l;
						})
					};
					reserve = { kiAnbieterId: r.id, name: r.name };
				} else {
					const warum =
						k.weg !== 'text'
							? 'der Hauptanbieter nutzt den Bildweg'
							: !r
								? 'die Reserve-Karte fehlt'
								: r.weg !== 'text'
									? 'die Reserve-Karte nutzt den Bildweg'
									: 'an der Reserve-Karte fehlen die Preise, die Monatsgrenze liesse sich nicht pruefen';
					log(`[worker] Reserve wirkungslos: ${warum}`);
				}
			}
			const wert: AktiverProvider = {
				provider: pruefe(() => bauen(k, overrides, env)),
				weg: k.weg,
				...kopf,
				konfig: k,
				reserve,
				letzterLeser: () => zuletzt,
				neuerAuftrag: () => {
					zuletzt = haupt;
				}
			};
			if (gemerkt) log(`[worker] KI gewechselt auf ${wert.name}/${wert.provider.model} (aus ${wert.quelle === 'env' ? '.env' : 'Oberflaeche'})`);
			gemerkt = { schluessel, wert };
		}

		// Bei JEDEM Aufruf, auch aus dem Zwischenspeicher: die Regel soll an einer Stelle
		// offensichtlich sein, und sie kostet nichts.
		if (gemerkt.wert.weg === 'bild' && !bildwegIstBestaetigt(env)) {
			throw new BildwegNichtFreigegeben(
				`Der aktive KI-Anbieter „${gemerkt.wert.name}" schickt Fotos, aber EXTRACTION_BILDWEG_BESTAETIGT ist nicht ja.`
			);
		}
		return gemerkt.wert;
	};
}

export const aktuellerProvider = erzeugeAufloeser({
	async leseStand() {
		const [z] = await db
			.select({ stand: instanz.kiStand, aktivId: instanz.aktiverKiAnbieter, reserveId: instanz.reserveKiAnbieter })
			.from(instanz)
			.where(eq(instanz.id, 1));
		return { stand: z?.stand ?? 0, aktivId: z?.aktivId ?? null, reserveId: z?.reserveId ?? null };
	},
	umschalten: (r) => echteUmschaltDeps(r),
	async leseAnbieter(id) {
		const [z] = await db
			.select({
				id: kiAnbieter.id,
				name: kiAnbieter.name,
				weg: kiAnbieter.weg,
				baseUrl: kiAnbieter.baseUrl,
				modell: kiAnbieter.modell,
				schluesselEnc: kiAnbieter.schluesselEnc,
				zeitlimitMs: kiAnbieter.zeitlimitMs,
				preisEinMicro: kiAnbieter.preisEinMicro,
				preisAusMicro: kiAnbieter.preisAusMicro
			})
			.from(kiAnbieter)
			.where(eq(kiAnbieter.id, id));
		return z ?? null;
	}
});

export type WechselnderProvider = ExtractionProvider & {
	readonly kiAnbieterId: string | null;
	readonly preise: Preise;
	readonly kiRolle: 'haupt' | 'reserve';
	/** Wohin der Kategorien-Aufruf geht: an das Modell, das den Bon gelesen hat. */
	readonly kategorienZiel: TextModellZiel;
	/** Zu Beginn jedes Auftrags (handleExtractJobs): die Rolle steht wieder auf dem Hauptanbieter. */
	neuerAuftrag(): void;
};

/**
 * Sieht fuer handleExtractJobs aus wie ein gewoehnlicher Anbieter. Vor jedem `extract`
 * wird neu aufgeloest; `id`, `model`, `kiAnbieterId` und `preise` zeigen danach auf den
 * Anbieter, der diesen Bon WIRKLICH gelesen hat. Das stimmt, weil der Worker genau einen
 * Auftrag nach dem anderen verarbeitet (batchSize 1, assertBatchSizeOne).
 *
 * Wirft das Aufloesen, wirft `extract` — und der Fehler laeuft durch dieselbe
 * Wiederholungslogik wie ein nicht erreichbares Modell.
 */
export function wechselnderProvider(
	aufloesen: () => Promise<AktiverProvider>,
	start: AktiverProvider
): WechselnderProvider {
	let aktuell = start;
	return {
		get id() {
			return aktuell.provider.id;
		},
		get model() {
			return aktuell.letzterLeser().modell;
		},
		get kiAnbieterId() {
			return aktuell.letzterLeser().kiAnbieterId;
		},
		get preise() {
			return aktuell.letzterLeser().preise;
		},
		get kiRolle() {
			return aktuell.letzterLeser().rolle;
		},
		get kategorienZiel() {
			return aktuell.letzterLeser().ziel();
		},
		neuerAuftrag() {
			aktuell.neuerAuftrag();
		},
		async extract(image, signal, opts) {
			aktuell.neuerAuftrag();
			aktuell = await aufloesen();
			aktuell.neuerAuftrag();
			return aktuell.provider.extract(image, signal, opts);
		}
	};
}
