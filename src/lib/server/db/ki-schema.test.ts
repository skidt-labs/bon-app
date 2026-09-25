import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { kiAnbieter, kiWeg, betriebsprotokoll, instanz, extractionRuns } from './schema';

describe('KI-Anbieter im Schema', () => {
	it('legt ki_anbieter mit den beiden Wegen an', () => {
		expect(getTableName(kiAnbieter)).toBe('ki_anbieter');
		expect(kiWeg.enumValues).toEqual(['text', 'bild']);
	});

	it('speichert den Schluessel nur verschluesselt', () => {
		// Es gibt KEINE Spalte fuer den Klartext — nur den Chiffretext und die letzten
		// vier Zeichen fuer die Anzeige.
		expect(kiAnbieter.schluesselEnc.getSQLType()).toBe('bytea');
		expect(Object.keys(kiAnbieter)).not.toContain('schluessel');
		expect(Object.keys(kiAnbieter)).not.toContain('apiKey');
	});

	it('laesst Preise leer zu — leer heisst unbekannt, nicht kostenlos', () => {
		expect(kiAnbieter.preisEinMicro.notNull).toBe(false);
		expect(kiAnbieter.preisAusMicro.notNull).toBe(false);
	});

	it('merkt sich an der Instanz den aktiven Anbieter und einen Stand', () => {
		expect(instanz.aktiverKiAnbieter.notNull).toBe(false);
		expect(instanz.kiStand.notNull).toBe(true);
	});

	it('haengt jeden Lauf an seinen Anbieter, leer heisst .env', () => {
		expect(extractionRuns.kiAnbieterId.notNull).toBe(false);
	});

	it('legt das Betriebsprotokoll an', () => {
		expect(getTableName(betriebsprotokoll)).toBe('betriebsprotokoll');
		expect(betriebsprotokoll.aktion.notNull).toBe(true);
	});
});
