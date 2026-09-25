import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { instanz, kiAnbieter } from '$lib/server/db/schema';
import {
	baueProvider,
	bildwegIstBestaetigt,
	konfigAusEnv,
	type KiWeg,
	type ProviderKonfig
} from '$lib/server/extraction';
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
};

export type AufloeserDeps = {
	leseStand(): Promise<{ stand: number; aktivId: string | null }>;
	leseAnbieter(id: string): Promise<KiAnbieterRoh | null>;
	bauen?: typeof baueProvider;
	env?: NodeJS.ProcessEnv;
	log?: (zeile: string) => void;
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
		const { stand, aktivId } = await deps.leseStand();
		const schluessel = `${stand}:${aktivId ?? 'env'}`;

		if (!gemerkt || gemerkt.schluessel !== schluessel) {
			let wert: AktiverProvider;
			const pruefe = <T>(f: () => T): T => {
				try {
					return f();
				} catch (err) {
					throw alsKonfigurationFehler(err);
				}
			};
			if (aktivId === null) {
				const k = pruefe(() => konfigAusEnv(env));
				wert = {
					provider: pruefe(() => bauen(k, undefined, env)),
					weg: k.weg,
					kiAnbieterId: null,
					name: '.env',
					quelle: 'env',
					preise: preiseAusEnv(env)
				};
			} else {
				const z = await deps.leseAnbieter(aktivId);
				if (!z) throw new KiKonfigurationFehler(`Der aktive KI-Anbieter ${aktivId} fehlt in der Datenbank.`);
				wert = {
					provider: pruefe(() => bauen(konfigAusZeile(z, env), undefined, env)),
					weg: z.weg,
					kiAnbieterId: z.id,
					name: z.name,
					quelle: 'oberflaeche',
					preise: { einMicro: z.preisEinMicro, ausMicro: z.preisAusMicro }
				};
			}
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
			.select({ stand: instanz.kiStand, aktivId: instanz.aktiverKiAnbieter })
			.from(instanz)
			.where(eq(instanz.id, 1));
		return { stand: z?.stand ?? 0, aktivId: z?.aktivId ?? null };
	},
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
			return aktuell.provider.model;
		},
		get kiAnbieterId() {
			return aktuell.kiAnbieterId;
		},
		get preise() {
			return aktuell.preise;
		},
		async extract(image, signal) {
			aktuell = await aufloesen();
			return aktuell.provider.extract(image, signal);
		}
	};
}
