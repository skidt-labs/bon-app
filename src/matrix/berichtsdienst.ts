/**
 * Die Berichte (Stufe 3) in bon-matrix — Sammelfassung 4.7.
 *
 * pg-boss ist fuer den Bot nur der Weg der Berichte. Bis 0.10.0 stand sein Start ungeschuetzt
 * hinter `client.start()`: scheiterte er, beendete sich der ganze Prozess — und mit ihm die
 * Fotoannahme. Jetzt laeuft der Bot eingeschraenkt weiter (Fotos ja, Berichte nein), meldet
 * das EINMAL an Matrix und versucht es mit wachsendem Abstand erneut; klappt es, meldet er die
 * Rueckkehr. Berichte, die in der Zeit angefordert werden, warten in der Warteschlange.
 *
 * Beim Beenden wird pg-boss sauber gestoppt (`graceful`): ohne stop() blieb ein gerade
 * laufender Bericht „aktiv", pg-boss liess ihn verfallen und stellte ihn nach dem Neustart ein
 * zweites Mal zu.
 */
import { setTimeout as schlafen } from 'node:timers/promises';
import { schwaerzeFehler } from './schwaerzen';

/** Abstand vor dem n-ten neuen Versuch (0-basiert); danach bleibt es beim letzten Wert. */
export const BOSS_ABSTAENDE_MS = [10_000, 30_000, 60_000, 120_000, 300_000] as const;

/**
 * Obergrenze fuer das ganze Beenden: unter `stop_grace_period: 30s` (compose.yaml), danach
 * schickt Docker SIGKILL. Die Kette darf davon bis 20 s brauchen (SHUTDOWN_KETTE_TIMEOUT_MS
 * in client.ts), pg-boss bekommt den Rest — aber nie weniger als 1 s (pg-boss selbst rundet
 * kleinere Werte ebenfalls auf 1 s auf).
 */
export const SHUTDOWN_GESAMT_MS = 25_000;

export const TEXT_BERICHTE_AUS =
	'Bon-Bot: pg-boss startet nicht — Fotos nimmt der Bot weiter an, Berichte warten. Neuer Versuch mit wachsendem Abstand.';
export const TEXT_BERICHTE_WIEDER = 'Bon-Bot: pg-boss läuft wieder — Berichte werden zugestellt.';

export type Stoppbar = { stop(opts: { graceful: boolean; timeout: number }): Promise<void> };

export type BerichtsdienstDeps = {
	/** pg-boss holen und den Berichts-Arbeiter anmelden; wirft, wenn das nicht geht. */
	starten: () => Promise<Stoppbar>;
	melden: (text: string) => Promise<void>;
	/** Wartet `ms`, bricht mit dem Signal ab (wirft dann). Vorgabe: node:timers/promises. */
	warten?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type Berichtsdienst = {
	/** true, sobald pg-boss laeuft; false, wenn vorher beendet wurde. Wird nie abgelehnt. */
	bereit: Promise<boolean>;
	/** Bricht weitere Versuche ab und stoppt einen laufenden pg-boss sauber. Wirft nie. */
	beenden: (fristMs: number) => Promise<void>;
};

export function bossAbstand(versuch: number): number {
	return BOSS_ABSTAENDE_MS[Math.min(versuch, BOSS_ABSTAENDE_MS.length - 1)];
}

/** Was pg-boss beim Beenden noch bekommt, wenn seit dem Signal `vergangenMs` vergangen sind. */
export function stoppFrist(vergangenMs: number): number {
	return Math.max(1_000, SHUTDOWN_GESAMT_MS - vergangenMs);
}

async function stoppen(boss: Stoppbar, fristMs: number): Promise<void> {
	try {
		await boss.stop({ graceful: true, timeout: fristMs });
		console.log('[matrix] pg-boss gestoppt');
	} catch (err) {
		console.error('[matrix] pg-boss liess sich nicht sauber stoppen', schwaerzeFehler(err));
	}
}

export function berichtsdienstStarten(deps: BerichtsdienstDeps): Berichtsdienst {
	const ende = new AbortController();
	const warten = deps.warten ?? ((ms: number, signal: AbortSignal) => schlafen(ms, undefined, { signal }));
	const melden = (text: string) =>
		deps.melden(text).catch((err) => console.error('[matrix] Meldung an Matrix gescheitert', schwaerzeFehler(err)));
	let laufend: Stoppbar | null = null;
	let frist = 1_000;

	const bereit = (async (): Promise<boolean> => {
		for (let versuch = 0; ; versuch++) {
			try {
				const boss = await deps.starten();
				// Beendet, waehrend der Start noch lief: gleich wieder stoppen statt weiterlaufen.
				if (ende.signal.aborted) {
					await stoppen(boss, frist);
					return false;
				}
				laufend = boss;
				if (versuch > 0) await melden(TEXT_BERICHTE_WIEDER);
				return true;
			} catch (err) {
				const ms = bossAbstand(versuch);
				console.error(
					`[matrix] pg-boss startet nicht — Fotos laufen weiter, Berichte nicht. Neuer Versuch in ${ms / 1000} s`,
					schwaerzeFehler(err)
				);
				if (versuch === 0) await melden(TEXT_BERICHTE_AUS);
				if (ende.signal.aborted) return false;
				try {
					await warten(ms, ende.signal);
				} catch {
					return false;
				}
				if (ende.signal.aborted) return false;
			}
		}
	})();

	return {
		bereit,
		async beenden(fristMs) {
			frist = fristMs;
			ende.abort();
			if (laufend) await stoppen(laufend, fristMs);
		}
	};
}
