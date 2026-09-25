// pg-boss 12.31 exportiert PgBoss als benannten Export (nicht als default) —
// `import PgBoss from 'pg-boss'` sieht plausibel aus, scheitert aber beim
// Vite-SSR-Build ("does not provide an export named 'default'"). Gegen
// node_modules/pg-boss/dist/index.js verifiziert.
import { PgBoss } from 'pg-boss';
import { AUFTRAG_VERFAELLT_SEKUNDEN } from './fristen';
import { datenbankUrl } from '$lib/server/db/url';

export const QUEUE_EXTRACT = 'extract-receipt';

export type ExtractJob = { receiptId: string };

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function start(): Promise<PgBoss> {
	// Dieselbe Quelle wie $lib/server/db: das Passwort kommt aus einer Datei, nicht aus
	// der Umgebung. pg-boss haelt eine EIGENE Verbindung — wer nur db/index.ts umstellt,
	// laesst hier eine zweite Zeichenfolge zurueck, und der Worker startet nicht mehr.
	const boss = new PgBoss(datenbankUrl());
	boss.on('error', (err) => console.error('[pg-boss]', err));
	try {
		await boss.start();
		// In pg-boss 12 muss jede Queue existieren, bevor gesendet werden darf.
	// createQueue ist idempotent (CREATE TABLE/INSERT ... ON CONFLICT intern), daher
	// ist es unschädlich, wenn bon-web und bon-worker das beim Kaltstart gleichzeitig
	// aufrufen (siehe Task-7-Report für die Begründung).
		await boss.createQueue(QUEUE_EXTRACT);
	} catch (err) {
		// Scheitert createQueue, ist boss.start() bereits durch: die Instanz hält einen
		// offenen Pool und laufende Intervalle. Ohne dieses stop() bliebe bei JEDEM
		// Fehlversuch ein Zombie zurück, und getBoss() lädt ausdrücklich zum Wiederholen ein.
		await boss.stop({ graceful: false }).catch(() => {});
		throw err;
	}
	return boss;
}

export async function getBoss(): Promise<PgBoss> {
	if (instance) return instance;
	if (!starting) {
		starting = start().catch((err) => {
			// Fehlgeschlagenen Start nicht zwischenspeichern, damit der nächste Aufruf
			// es erneut versuchen kann statt für immer denselben Fehler zu werfen.
			starting = null;
			throw err;
		});
	}
	instance = await starting;
	return instance;
}

/**
 * Aufgabe 4, Teil B: das Wiederholungsbudget muss einen Mac übersteben, der über
 * Nacht aus ist — die alten Werte (retryLimit 3, retryDelay 30s, Backoff) gaben nach
 * rund 3,5 Minuten (30s/60s/120s) auf und liessen den Bon danach auf 'extracting'
 * ("wird ausgelesen") stehen (siehe Task-3-Bericht, gemeldetes Restrisiko).
 *
 * pg-bosses Backoff-Formel (node_modules/pg-boss/dist/plans.js, failJobsBody):
 *   delay(retryCount) = min(retryDelayMax, retryDelay * 2^retryCount * (1 + zufall))
 * — zufall in [0,1), retryCount 0-basiert (0 beim ERSTEN Fehlschlag). Mit
 * retryDelay=300s (5 Min), retryDelayMax=3600s (1 Std) ergibt das eine Reihe von
 * grob 5, 10, 20, 40, dann bei 60 Minuten gedeckelten Wartezeiten — häufige Prüfung
 * kurz nach dem ersten Fehlschlag, danach stündlich, nicht öfter (kein Grund, den
 * abwesenden Mac im 5-Minuten-Takt zu "pollen").
 *
 * retryLimit=15 ergibt damit im Mittel rund 12-13 Stunden Gesamtbudget (5+10+20+40
 * Minuten + 11×60 Minuten ≈ 12,7 Std, siehe Task-4-Bericht für die genaue Rechnung)
 * — genug für "abends aus, morgens wieder an" mit Marge, ohne beliebig lang zu
 * werden (retryDelayMax deckelt die letzten Versuche auf 1 Std/Versuch statt einer
 * ungebremsten Exponentialkurve, die ohne Deckel binnen 15 Versuchen auf Wochen
 * anwachsen würde).
 *
 * WARUM das jetzt gefahrlos ist, obwohl retryLimit vervierfacht wurde: bis
 * Aufgabe 4 liess `handleExtractJobs` (src/worker/extract-receipt.ts) JEDEN
 * Fehlschlag — auch einen DAUERHAFTEN (Schema-Fehler, unlesbarer Bon, ...) — an
 * pg-boss durchreichen, das ihn dann bis retryLimit-mal wiederholt hätte (derselbe,
 * bereits im Task-3-Bericht angesprochene Zielkonflikt). Seit dieser Aufgabe reicht
 * handleExtractJobs nur noch GENAU DIE Fehlschläge durch, für die ein weiterer
 * pg-boss-Antritt tatsächlich sinnvoll ist (ein noch nicht ausgeschöpfter
 * vorübergehender Fehler) — ein dauerhafter Fehler wird sofort (und ein
 * erschöpfter vorübergehender Fehler beim letzten erlaubten Antritt) terminal als
 * 'failed' markiert und NICHT mehr an pg-boss zur Wiederholung gereicht. Ein
 * höheres retryLimit wiederholt also nur noch echte "Mac gerade nicht da"-Fälle
 * öfter, keine dauerhaften.
 */
export async function enqueueExtraction(receiptId: string): Promise<void> {
	const boss = await getBoss();
	await boss.send(QUEUE_EXTRACT, { receiptId } satisfies ExtractJob, {
		retryLimit: 15,
		retryDelay: 300,
		retryBackoff: true,
		retryDelayMax: 3600,
		// Muss ueber dem Zeitlimit der Anfrage liegen, sonst laeuft ein zweiter Versuch
		// an, waehrend der erste noch unterwegs ist — siehe fristen.ts.
		expireInSeconds: AUFTRAG_VERFAELLT_SEKUNDEN
	});
}
