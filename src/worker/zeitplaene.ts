/**
 * Die Zeitplaene des Workers — an EINER Stelle, mit Test (Sammelfassung 0.11.0, 4.4).
 *
 * Beide Warteschlangen bekommen einen Auftrag am Tag bzw. alle 5 Minuten. pg-boss fragt ohne
 * Angabe alle 2 s nach Arbeit — 43 200 Abfragen am Tag je Warteschlange. 30 s Verzug sind fuer
 * beide belanglos.
 */
import type { ProviderKonfig } from '$lib/server/extraction';
import { QUEUE_KI_PRUEFEN, QUEUE_PAPIERKORB } from '$lib/server/queue/boss';
import { hauptPruefen } from '$lib/server/ki/umschalten';

export const ZEITZONE = 'Europe/Berlin';
export const ZEITPLAN_ABFRAGE_SEKUNDEN = 30;

export const ZEITPLAENE = {
	/** Taeglich 04:30: Bons, die laenger als 30 Tage im Papierkorb liegen, endgueltig loeschen. */
	papierkorb: { queue: QUEUE_PAPIERKORB, cron: '30 4 * * *' },
	/** Alle 5 Minuten: solange die Reserve liest, den Mac anfragen (Entwurf 2026-10-01). */
	kiPruefen: { queue: QUEUE_KI_PRUEFEN, cron: '*/5 * * * *' }
} as const;

export type ZeitplanName = keyof typeof ZEITPLAENE;

/** Was davon an pg-boss gebraucht wird — schmal, damit der Test eine Attrappe geben kann. */
export type ZeitplanBoss = {
	schedule(name: string, cron: string, data: null, optionen: { tz: string }): Promise<void>;
	work(name: string, optionen: { pollingIntervalSeconds: number }, auftrag: () => Promise<void>): Promise<unknown>;
};

export async function zeitplaeneEinrichten(
	boss: ZeitplanBoss,
	auftraege: Record<ZeitplanName, () => Promise<void>>
): Promise<void> {
	for (const name of Object.keys(ZEITPLAENE) as ZeitplanName[]) {
		const { queue, cron } = ZEITPLAENE[name];
		// schedule() ist idempotent: ein Neustart schreibt denselben Zeitplan neu, es entsteht kein zweiter.
		await boss.schedule(queue, cron, null, { tz: ZEITZONE });
		await boss.work(queue, { pollingIntervalSeconds: ZEITPLAN_ABFRAGE_SEKUNDEN }, auftraege[name]);
	}
}

export type KiTaktDeps = {
	/** Wie der Worker die KI gerade aufloest — `reserve` null: keine eingerichtet ODER sie wirkt nicht. */
	aufloesen(): Promise<{ reserve: { kiAnbieterId: string; name: string } | null; konfig: ProviderKonfig }>;
	reserveAktivSeit(): Promise<Date | null>;
	probe(konfig: ProviderKonfig): Promise<boolean>;
	/** Mit Matrix-Meldung „Mac wieder da" (echteUmschaltDeps). */
	zurueckschalten(reserve: { kiAnbieterId: string; name: string }, anlass: string): Promise<void>;
	/** Ohne Matrix: leert „aktiv seit" bedingt und protokolliert (reserveZurueck). */
	aufraeumen(anlass: string): Promise<{ seit: Date } | null>;
	konsole: Pick<Console, 'log' | 'error'>;
};

export async function kiPruefenTakt(d: KiTaktDeps): Promise<'nichts' | 'zurueck' | 'weiter' | 'aufgeraeumt' | 'fehler'> {
	try {
		const a = await d.aufloesen();
		const reserve = a.reserve;
		if (!reserve) {
			// 4.6: Wirkt die Reserve nicht (Hauptanbieter jetzt Bildweg, Karte ohne Preise …), liest sie
			// auch nicht. Ein stehengebliebenes „aktiv seit" waere eine falsche Anzeige — und liesse den
			// naechsten Bon den Mac uebergehen, sobald sie wieder wirkt. Nur Protokoll, keine Matrix:
			// am Lesen hat sich nichts geaendert.
			const weg = await d.aufraeumen('Reserve wirkungslos');
			if (!weg) return 'nichts';
			d.konsole.log(`[worker] Reserve wirkt nicht, Zustand „liest seit ${weg.seit.toISOString()}" weggeraeumt`);
			return 'aufgeraeumt';
		}
		const ergebnis = await hauptPruefen({
			reserveAktivSeit: () => d.reserveAktivSeit(),
			probe: () => d.probe(a.konfig),
			zurueckschalten: (anlass) => d.zurueckschalten(reserve, anlass)
		});
		if (ergebnis === 'weiter') d.konsole.log('[worker] Mac weiter nicht erreichbar, die Reserve liest');
		return ergebnis;
	} catch (err) {
		// Ein Fehler hier darf nichts mitreissen — beim naechsten Takt geht es weiter.
		d.konsole.error('[worker] Pruefung des Hauptanbieters fehlgeschlagen', err instanceof Error ? err.message : String(err));
		return 'fehler';
	}
}
