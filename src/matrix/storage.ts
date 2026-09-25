import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { matrixBotState } from '$lib/server/db/schema';

const ZEILE = 1;

/**
 * Hält den Sync-Token in der Datenbank statt in einer Datei im Container. Läge er
 * lokal, begänne der Bot nach jedem `docker compose up` von vorn und arbeitete den
 * ganzen Verlauf noch einmal durch — dank der Ereignis-ID folgenlos, aber langsam
 * und laut.
 *
 * matrix-bot-sdk ruft get/set synchron auf, Postgres ist asynchron. Deshalb einmal
 * `laden()` beim Start, danach im Speicher halten und mit `sichern()` fortschreiben.
 */
export class PostgresStorageProvider {
	private token: string | null = null;
	private gefiltert = new Map<string, string>();

	async laden(): Promise<void> {
		const [zeile] = await db.select().from(matrixBotState).where(eq(matrixBotState.id, ZEILE));
		this.token = zeile?.sinceToken ?? null;
	}

	async sichern(): Promise<void> {
		const werte = { id: ZEILE, sinceToken: this.token, lastSyncAt: new Date() };
		await db.insert(matrixBotState).values(werte).onConflictDoUpdate({
			target: matrixBotState.id,
			set: { sinceToken: werte.sinceToken, lastSyncAt: werte.lastSyncAt }
		});
	}

	getSyncToken(): string | null {
		return this.token;
	}

	setSyncToken(token: string | null): void {
		this.token = token;
	}

	// matrix-bot-sdk verlangt diese vier. Sie betreffen nur die Filter-Zwischenablage
	// und dürfen im Arbeitsspeicher liegen: geht sie verloren, legt das SDK den Filter
	// beim nächsten Start neu an.
	getFilter() {
		return this.gefiltert.get('filter') ?? null;
	}
	setFilter(f: unknown) {
		this.gefiltert.set('filter', JSON.stringify(f));
	}
	readValue(key: string) {
		return this.gefiltert.get(key) ?? null;
	}
	storeValue(key: string, value: string) {
		this.gefiltert.set(key, value);
	}
}
