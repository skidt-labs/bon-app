import { describe, it, expect, afterEach } from 'vitest';
import { parseBonZeit } from './zeit';

// Jeder Test setzt TZ explizit auf einen "falschen" Wert und stellt danach den
// Ausgangszustand wieder her — das beweist, dass parseBonZeit nicht mehr von
// process.env.TZ abhaengt (anders als ein blankes new Date(...) das täte).
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('parseBonZeit', () => {
  it('legt eine Sommerzeit-Wanduhrzeit ohne Offset auf Europe/Berlin (MESZ) um', () => {
    process.env.TZ = 'UTC';
    // 2026-03-16 liegt VOR der Zeitumstellung (letzter Sonntag im März 2026 = 29.03.).
    // Berlin ist an diesem Tag also noch in der Winterzeit (MEZ, +1h), nicht in MESZ
    // (+2h) — die reale IANA-Regel, per Intl abgefragt, nicht eine angenommene.
    // Ergebnis daher 17:16Z, nicht 16:16Z. Siehe Bericht: der Fix-Runde-Auftrag hatte
    // dieses Beispiel als "(CEST, summer)" mit 16:16Z erwartet; das ist fuer 2026
    // nicht korrekt (siehe Bericht, Abschnitt F6).
    expect(parseBonZeit('2026-03-16T18:16:00')?.toISOString()).toBe('2026-03-16T17:16:00.000Z');
  });

  it('legt eine Winterzeit-Wanduhrzeit ohne Offset auf Europe/Berlin (MEZ) um', () => {
    process.env.TZ = 'UTC';
    expect(parseBonZeit('2026-01-15T12:00:00')?.toISOString()).toBe('2026-01-15T11:00:00.000Z');
  });

  it('respektiert einen expliziten Offset unveraendert, auch wenn er nicht zur Jahreszeit passt', () => {
    process.env.TZ = 'UTC';
    expect(parseBonZeit('2026-03-16T18:16:00+02:00')?.toISOString()).toBe('2026-03-16T16:16:00.000Z');
  });

  it('lehnt unmoegliche Kalendertage auch mit explizitem Offset ab', () => {
    expect(parseBonZeit('2026-02-30T12:00:00Z')).toBeNull();
    expect(parseBonZeit('2026-04-31T12:00:00+02:00')).toBeNull();
  });

  it('gibt null zurueck fuer eine Wanduhrzeit in der Fruehjahrs-Umstellungsluecke', () => {
    process.env.TZ = 'UTC';
    // Nacht vom 28. auf den 29.03.2026: um 02:00 MEZ springt die Uhr auf 03:00 MESZ.
    // 02:30 Uhr hat an diesem Tag in Europe/Berlin nie existiert.
    expect(parseBonZeit('2026-03-29T02:30:00')).toBeNull();
  });

  it('gibt null zurueck fuer Text, der kein Datum ist', () => {
    process.env.TZ = 'UTC';
    expect(parseBonZeit('gestern')).toBeNull();
  });

  it('gibt null zurueck fuer null/undefined/leeren String', () => {
    expect(parseBonZeit(null)).toBeNull();
    expect(parseBonZeit(undefined)).toBeNull();
    expect(parseBonZeit('')).toBeNull();
  });

  it('ist unabhaengig von process.env.TZ, solange kein Offset im String steht', () => {
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — ein absichtlich extremer Wert
    const a = parseBonZeit('2026-01-15T12:00:00')?.toISOString();
    process.env.TZ = 'America/Anchorage'; // UTC-9
    const b = parseBonZeit('2026-01-15T12:00:00')?.toISOString();
    expect(a).toBe('2026-01-15T11:00:00.000Z');
    expect(b).toBe('2026-01-15T11:00:00.000Z');
  });
});
