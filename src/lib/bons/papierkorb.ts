/** Wie lange ein verworfener Bon wiederherstellbar bleibt (Entscheidung 27.09.2026). */
export const PAPIERKORB_TAGE = 30;
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Wann der Worker den Papierkorb leert: taeglich 04:30 Berliner Zeit. Steht so in
 * src/worker/zeitplaene.ts (ZEITPLAENE.papierkorb) — dort von hier aus nicht importierbar
 * ($lib/server), deshalb haelt zeitplaene.test.ts beide Angaben gegeneinander.
 */
export const LEEREN_UM = { stunde: 4, minute: 30, zeitzone: 'Europe/Berlin' } as const;

const ortsuhr = new Intl.DateTimeFormat('en-US', {
	timeZone: LEEREN_UM.zeitzone,
	hourCycle: 'h23',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	second: 'numeric'
});

/** Ortszeit als Teile: Jahr, Monat (1–12), Tag, Stunde, Minute, Sekunde. */
type Teile = [jahr: number, monat: number, tag: number, stunde: number, minute: number, sekunde: number];
function ortszeit(ms: number): Teile {
	const t: Record<string, number> = {};
	for (const p of ortsuhr.formatToParts(new Date(ms))) t[p.type] = Number(p.value);
	return [t.year, t.month, t.day, t.hour, t.minute, t.second];
}

/** Um wie viele ms die Ortszeit zum Zeitpunkt `ms` vor UTC liegt (Sommerzeit: 2 h). */
function versatz(ms: number): number {
	const [j, m, d, h, min, s] = ortszeit(ms);
	return Date.UTC(j, m - 1, d, h, min, s) - Math.floor(ms / 1000) * 1000;
}

/** Der Lauf am Ortskalendertag j-m-d. 04:30 liegt nie in der Umstellungsstunde. */
function laufAm(j: number, m: number, d: number): number {
	const orts = Date.UTC(j, m - 1, d, LEEREN_UM.stunde, LEEREN_UM.minute);
	const erst = orts - versatz(orts);
	return orts - versatz(erst);
}

/** Der erste Lauf STRENG nach `t` — wie pg-boss ihn ausloest (previewSchedule, `from`). */
export function naechsterLeerlauf(t: Date): Date {
	const ms = t.getTime();
	const [j, m, d] = ortszeit(ms);
	const heute = laufAm(j, m, d);
	return new Date(heute > ms ? heute : laufAm(j, m, d + 1));
}

/**
 * Wie viele naechtliche Laeufe der Bon im Papierkorb noch uebersteht. 0: der naechste Lauf
 * loescht ihn („heute Nacht"). Geloescht wird beim ersten Lauf nach verworfenAm + 30 Tagen
 * (server/bons/papierkorb.ts, abgelaufeneBons). Gerundet wegen der 23-/25-Stunden-Tage.
 */
export function restTage(verworfenAm: Date | string, jetzt: Date): number {
	const ende = new Date(new Date(verworfenAm).getTime() + PAPIERKORB_TAGE * TAG_MS);
	const loescht = naechsterLeerlauf(ende).getTime();
	const naechster = naechsterLeerlauf(jetzt).getTime();
	return Math.max(0, Math.round((loescht - naechster) / TAG_MS));
}

/** Die Restfrist als Text (Sammelfassung 2.1). */
export function restTageText(n: number): string {
	if (n <= 0) return 'wird heute Nacht gelöscht';
	return n === 1 ? 'noch 1 Tag' : `noch ${n} Tage`;
}
