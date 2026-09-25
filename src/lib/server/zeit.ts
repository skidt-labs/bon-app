import { istTag, tagPlus } from '$lib/berichte/kalender';

// Formatter einmal angelegt statt pro Aufruf: liest die Wanduhrzeit einer gegebenen
// UTC-Instanz in Europe/Berlin aus (Jahr/Monat/Tag/Stunde/Minute/Sekunde als Zahlen).
const berlinParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function readBerlinWallClock(instant: Date): WallClock {
  const parts = Object.fromEntries(berlinParts.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second)
  };
}

/**
 * Der Offset (in ms, Ost von UTC positiv), den Europe/Berlin an einer gegebenen
 * UTC-Instanz tatsächlich anwendet (+1h MEZ oder +2h MESZ). Ermittelt durch Vergleich
 * der von Intl gelesenen Wanduhrzeit gegen dieselbe Wanduhrzeit, als wäre sie UTC.
 */
function berlinOffsetMs(instant: Date): number {
  const p = readBerlinWallClock(instant);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - instant.getTime();
}

const OFFSET_RE = /Z$|[+-]\d{2}:?\d{2}$/;
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Liest einen Bon-Zeitstempel. Enthält er eine Zeitzone, gilt diese. Fehlt sie —
 * was der System-Prompt für reine Datumsangaben ausdrücklich so vorsieht — wird
 * Europe/Berlin angenommen, und zwar mit dem für DIESES Datum gültigen Offset.
 * Bewusst nicht über process.env.TZ: Die Bedeutung der Daten darf nicht an einer
 * Umgebungsvariablen hängen, deren Wegfall niemandem auffiele.
 */
export function parseBonZeit(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const trimmed = iso.trim();

  // Ein Offset im String ist eindeutig — kein Grund, Europe/Berlin zu raten.
  if (OFFSET_RE.test(trimmed)) {
    // Date normalisiert z. B. den 30. Februar still zum 2. Maerz. Der Kalendertag
    // muss deshalb vor dem Parsen geprueft werden, auch wenn ein Offset vorliegt.
    const datum = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (datum) {
      const jahr = Number(datum[1]);
      const monat = Number(datum[2]);
      const tag = Number(datum[3]);
      const probe = new Date(0);
      probe.setUTCFullYear(jahr, monat - 1, tag);
      if (probe.getUTCFullYear() !== jahr || probe.getUTCMonth() !== monat - 1 || probe.getUTCDate() !== tag) {
        return null;
      }
    }
    const withOffset = new Date(trimmed);
    return Number.isFinite(withOffset.getTime()) ? withOffset : null;
  }

  const m = trimmed.match(WALL_CLOCK_RE);
  if (!m) return null; // "gestern", "13.09." & Co. — kein Datum, das wir kennen.

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;

  // Henne-Ei-Problem: um den Offset zu kennen, braucht man schon einen ungefähren
  // Zeitpunkt, aber den kennt man erst nach Abzug des Offsets. Lösung: die Wanduhrzeit
  // zunächst NAIV als UTC deuten (Schätzung, höchstens 2h daneben, weil Europe/Berlin
  // nur +1h/+2h kennt), den dortigen Offset nachschlagen, und einmal korrigieren. Ein
  // zweiter Durchlauf fängt die Fälle ab, in denen die erste Schätzung noch auf der
  // falschen Seite einer Umstellung lag (z. B. kurz vor/nach der Zeitumstellung).
  // Herbst-Umstellung (z. B. 2026-10-25, 03:00 MESZ -> 02:00 MEZ): die Wanduhrzeit
  // 02:30 existiert an diesem Tag ZWEIMAL, einmal in MESZ (offset1, zuerst gefunden)
  // und einmal eine Stunde später in MEZ. Diese Korrekturschleife konvergiert dabei
  // auf die ZWEITE (spätere, MEZ) Instanz, nicht auf die erste. Anders als bei der
  // Frühjahrslücke (dort existiert die Wanduhrzeit gar nicht, siehe Rückprobe unten)
  // sind hier beide Instanzen real — es gibt keinen falschen Wert, nur eine stille
  // Wahl zwischen zwei richtigen. Vertretbar (die Abweichung beträgt höchstens eine
  // Stunde), aber ohne diesen Kommentar eine Falle für den nächsten Leser.
  const guessAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset1 = berlinOffsetMs(new Date(guessAsUtc));
  let instantMs = guessAsUtc - offset1;
  const offset2 = berlinOffsetMs(new Date(instantMs));
  if (offset2 !== offset1) {
    instantMs = guessAsUtc - offset2;
  }

  // Rückprobe: wandelt der gefundene Zeitpunkt tatsächlich in die angefragte
  // Wanduhrzeit zurück? Das schlägt genau dann fehl, wenn die Wanduhrzeit in
  // Europe/Berlin gar nicht existiert — die Frühjahrs-Umstellungslücke (z. B.
  // 2026-03-29, 02:00–03:00 Uhr übersprungen). Die Offset-Suche oszilliert dort
  // zwischen MEZ und MESZ, ohne je zu konvergieren. Statt eine der beiden falschen
  // Stunden zu erfinden, geben wir null zurück — date_unparsable macht die Lücke
  // sichtbar, statt eine erfundene Instanz zu behaupten.
  const roundTrip = readBerlinWallClock(new Date(instantMs));
  if (roundTrip.y !== y || roundTrip.mo !== mo || roundTrip.d !== d ||
      roundTrip.h !== h || roundTrip.mi !== mi || roundTrip.s !== s) {
    return null;
  }

  return new Date(instantMs);
}

/** Um wie viele Minuten `zone` zum Zeitpunkt `utc` vor UTC liegt (Berlin: 60 oder 120). */
function zonenversatzMinuten(utc: Date, zone: string): number {
	const teile = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(utc);
	const t = Object.fromEntries(teile.map((p) => [p.type, p.value]));
	const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
	return Math.round((alsUtc - utc.getTime()) / 60_000);
}

/** Mitternacht am gegebenen Kalendertag in `zone`, als Zeitpunkt. */
function mitternachtIn(zone: string, jahr: number, monat: number, tag: number): Date {
	const grob = new Date(Date.UTC(jahr, monat - 1, tag, 0, 0, 0));
	const versatz = zonenversatzMinuten(grob, zone);
	const kandidat = new Date(grob.getTime() - versatz * 60_000);
	// Zweiter Durchgang: wechselt der Versatz genau an dieser Mitternacht, stimmt der
	// erste Kandidat um eine Stunde nicht. Fuer Berlin faellt der Wechsel auf Sonntag
	// 02:00/03:00 und nie auf Mitternacht — der Durchgang kostet nichts und schuetzt
	// gegen Zonen, bei denen es anders ist.
	const versatz2 = zonenversatzMinuten(kandidat, zone);
	return versatz2 === versatz ? kandidat : new Date(grob.getTime() - versatz2 * 60_000);
}

/**
 * Anfang (einschliesslich) und Ende (ausschliesslich) eines Monats `YYYY-MM` in `zone`.
 * `null` fuer alles, was kein Monat ist — der Aufrufer sagt dem Menschen, was er
 * stattdessen zeigt. Ein stiller Rueckfall auf "alle" wuerde eine Filterung vortaeuschen.
 *
 * Bons werden nach Berliner Zeit dem Monat zugeordnet, in dem sie gekauft wurden;
 * `purchased_at` ist ein Zeitpunkt (timestamptz), und die UTC-Mitternacht liegt um
 * eine oder zwei Stunden daneben.
 */
export function monatsgrenzen(monat: string, zone = 'Europe/Berlin'): { von: Date; bis: Date } | null {
	const m = /^(\d{4})-(\d{2})$/.exec(monat);
	if (!m) return null;
	const jahr = Number(m[1]);
	const mon = Number(m[2]);
	if (mon < 1 || mon > 12) return null;
	const von = mitternachtIn(zone, jahr, mon, 1);
	const bis = mon === 12 ? mitternachtIn(zone, jahr + 1, 1, 1) : mitternachtIn(zone, jahr, mon + 1, 1);
	return { von, bis };
}

/** Der laufende Monat als `YYYY-MM` in `zone`. */
export function aktuellerMonat(jetzt: Date = new Date(), zone = 'Europe/Berlin'): string {
	const teile = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(jetzt);
	const t = Object.fromEntries(teile.map((p) => [p.type, p.value]));
	return `${t.year}-${t.month}`;
}

/**
 * Der Monat davor, als 'YYYY-MM'. `null`, wenn die Eingabe kein Monat ist.
 *
 * Reine Zeichenkettenrechnung ueber die Monatszahl, ohne Date: ein `new Date(jahr, monat-1)`
 * haette eine Zeitzone im Ruecken, und der Vormonat eines Monats ist keine Frage von
 * Sommerzeit.
 */
export function vorherigerMonat(monat: string): string | null {
	const m = /^(\d{4})-(\d{2})$/.exec(monat);
	if (!m) return null;
	const jahr = Number(m[1]);
	const nr = Number(m[2]);
	if (nr < 1 || nr > 12) return null;
	return nr === 1
		? `${jahr - 1}-12`
		: `${jahr}-${String(nr - 1).padStart(2, '0')}`;
}

/** Der Monat danach, als 'YYYY-MM' — das Gegenstueck zu `vorherigerMonat`, gleiche Regeln. */
export function naechsterMonat(monat: string): string | null {
	const m = /^(\d{4})-(\d{2})$/.exec(monat);
	if (!m) return null;
	const jahr = Number(m[1]);
	const nr = Number(m[2]);
	if (nr < 1 || nr > 12) return null;
	return nr === 12
		? `${jahr + 1}-01`
		: `${jahr}-${String(nr + 1).padStart(2, '0')}`;
}

/**
 * Anfang (einschliesslich) und Ende (AUSSCHLIESSLICH) einer Tagesspanne in `zone`;
 * `bis` ist der letzte Tag, der noch dazugehoert. `null` fuer alles, was keine gueltige
 * Spanne ist — der Aufrufer entscheidet, was er stattdessen zeigt.
 */
export function tagesgrenzen(von: string, bis: string, zone = 'Europe/Berlin'): { von: Date; bis: Date } | null {
	if (!istTag(von) || !istTag(bis) || von > bis) return null;
	const [vj, vm, vt] = von.split('-').map(Number);
	const [nj, nm, nt] = tagPlus(bis, 1).split('-').map(Number);
	return { von: mitternachtIn(zone, vj, vm, vt), bis: mitternachtIn(zone, nj, nm, nt) };
}

/** Anfang (einschliesslich) und Ende (ausschliesslich) eines Kalenderjahres in `zone`. */
export function jahresgrenzen(jahr: number, zone = 'Europe/Berlin'): { von: Date; bis: Date } | null {
	if (!Number.isInteger(jahr)) return null;
	return { von: mitternachtIn(zone, jahr, 1, 1), bis: mitternachtIn(zone, jahr + 1, 1, 1) };
}

/** Der heutige Kalendertag als 'YYYY-MM-DD' in `zone`. */
export function heutigerTag(jetzt: Date = new Date(), zone = 'Europe/Berlin'): string {
	const teile = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(jetzt);
	const t = Object.fromEntries(teile.map((p) => [p.type, p.value]));
	return `${t.year}-${t.month}-${t.day}`;
}
