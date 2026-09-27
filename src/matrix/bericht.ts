/**
 * Zustellung einer Berichtszusammenfassung (Berichte Stufe 3). Die Web-App baut den Text
 * und legt ihn in die Warteschlange; hier wird er zugestellt — NUR in den gemerkten
 * Direktchat des Anfragenden, und nur, solange darin genau der Bot und dieses Konto sitzen.
 * Ein Direktchat kann nachtraeglich weitere Mitglieder bekommen (siehe links.ts); dann ist
 * er keiner mehr, und dort wird nichts gesendet.
 */
export const TEXT_HOECHSTENS = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Zustellung = 'gesendet' | 'ungueltig' | 'nicht_gekoppelt' | 'kein_chat' | 'raum_nicht_privat';

export type ZustellDeps = {
	direktchatFuer(userId: string): Promise<{ matrixUserId: string; raum: string | null } | null>;
	mitglieder(raum: string): Promise<string[]>;
	botId(): Promise<string>;
	senden(raum: string, text: string): Promise<void>;
	/** Den gemerkten Raum vergessen, wenn er kein Direktchat mehr ist. */
	vergessen(matrixUserId: string, raum: string): Promise<void>;
};

export async function berichtZustellen(job: unknown, d: ZustellDeps): Promise<Zustellung> {
	if (typeof job !== 'object' || job === null) return 'ungueltig';
	const { userId, text } = job as { userId?: unknown; text?: unknown };
	if (typeof userId !== 'string' || !UUID.test(userId)) return 'ungueltig';
	if (typeof text !== 'string' || text.trim() === '' || text.length > TEXT_HOECHSTENS) return 'ungueltig';

	const chat = await d.direktchatFuer(userId);
	if (!chat) return 'nicht_gekoppelt';
	if (!chat.raum) return 'kein_chat';

	const [bot, mitglieder] = await Promise.all([d.botId(), d.mitglieder(chat.raum)]);
	const erwartet = [bot, chat.matrixUserId].sort();
	const tatsaechlich = [...new Set(mitglieder)].sort();
	if (tatsaechlich.length !== 2 || tatsaechlich[0] !== erwartet[0] || tatsaechlich[1] !== erwartet[1]) {
		// Sonst scheiterte jede weitere Anfrage still, und die App zeigte weiter „bereit".
		// Vergessen macht daraus „schreib dem Bon-Bot einmal im Direktchat".
		await d.vergessen(chat.matrixUserId, chat.raum);
		return 'raum_nicht_privat';
	}

	await d.senden(chat.raum, text);
	return 'gesendet';
}
