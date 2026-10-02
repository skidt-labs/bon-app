import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * „Der Betreiber verwaltet, er sieht nicht hinein" — auch bei der Reserve. Die Betriebsseite
 * zeigt ihren Verbrauch, und `betrieb/` darf `extractionRuns` nicht importieren
 * (grenze.lint.test.ts). Die Summe kommt deshalb aus ki/reserve.ts, und dieses Modul darf aus
 * den Laeufen nur lesen, was Kosten und Zeitpunkt sind — keinen OCR-Text, keine Rohantwort,
 * keine Bon-Id.
 */
const DATEI = 'src/lib/server/ki/reserve.ts';
const ERLAUBTE_SPALTEN = new Set(['kiRolle', 'costMicroEuros', 'kategorienKostenMicro', 'createdAt']);

describe('Was ki/reserve.ts aus den Laeufen lesen darf', () => {
	it('nur Rolle, Kosten und Zeitpunkt', () => {
		const text = readFileSync(DATEI, 'utf8');
		const benutzt = [...text.matchAll(/\bextractionRuns\.(\w+)/g)].map((m) => m[1]);
		expect(benutzt.filter((s) => !ERLAUBTE_SPALTEN.has(s))).toEqual([]);
	});

	it('importiert aus dem Schema nur instanz und extractionRuns', () => {
		const text = readFileSync(DATEI, 'utf8');
		const importe = text.match(/import\s*\{([^}]*)\}\s*from\s*'\$lib\/server\/db\/schema'/s);
		const namen = (importe?.[1] ?? '').split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean);
		expect(namen.filter((x) => x !== 'instanz' && x !== 'extractionRuns')).toEqual([]);
	});
});
