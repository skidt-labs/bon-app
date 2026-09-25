import { describe, it, expect } from 'vitest';
import { statusText, quelleText, tagesgruppen, filterLink, formatWann } from './anzeige';

describe('statusText und quelleText', () => {
	it('uebersetzen jeden Wert und lassen Unbekanntes sichtbar', () => {
		expect(statusText('review')).toBe('Prüfen');
		expect(statusText('failed')).toBe('Fehlgeschlagen');
		expect(statusText('extracting')).toBe('Wird gelesen');
		expect(statusText('pending')).toBe('Wartet');
		expect(statusText('confirmed')).toBe('Bestätigt');
		// Ein kuenftiger, hier unbekannter Wert verschwindet nicht stumm.
		expect(statusText('irgendwas')).toBe('irgendwas');
		expect(quelleText('camera')).toBe('Handy');
		expect(quelleText('upload')).toBe('Hochladen');
		expect(quelleText('matrix')).toBe('Bot');
		expect(quelleText('email')).toBe('E-Mail');
	});
});

describe('tagesgruppen', () => {
	// Feste Daten, kein "heute"/"gestern": die Liste wird serverseitig gerendert und
	// veraltete nach Mitternacht, ohne dass die Seite neu laedt (Begruendung aus dem
	// bisherigen Posteingang, hier uebernommen). Gruppiert wird nach Berliner Kalendertag.
	it('gruppiert nach Berliner Kalendertag, Kaufzeit vor Eingang', () => {
		const bons = [
			{ id: 'a', purchasedAt: new Date('2026-09-16T22:30:00Z'), createdAt: new Date('2026-09-17T05:00:00Z') }, // 17.09. 00:30 Berlin
			{ id: 'b', purchasedAt: new Date('2026-09-16T15:00:00Z'), createdAt: new Date('2026-09-16T15:05:00Z') }, // 16.09.
			{ id: 'c', purchasedAt: null, createdAt: new Date('2026-09-16T09:00:00Z') } // 16.09., nach Eingang
		];
		const g = tagesgruppen(bons);
		expect(g).toHaveLength(2);
		expect(g[0].tag).toContain('17.09.2026');
		expect(g[1].tag).toContain('16.09.2026');
		expect(g[1].bons.map((b) => b.id)).toEqual(['b', 'c']);
	});

	it('ist ohne Bons leer', () => {
		expect(tagesgruppen([])).toEqual([]);
	});
});

describe('filterLink', () => {
	it('aendert einen Wert und behaelt die anderen', () => {
		const aktuell = new URLSearchParams('status=alle&monat=2026-09&suche=milch');
		expect(filterLink(aktuell, { status: 'bestaetigt' })).toBe('?status=bestaetigt&monat=2026-09&suche=milch');
	});
	it('entfernt einen Wert mit null', () => {
		const aktuell = new URLSearchParams('status=alle&monat=2026-09');
		expect(filterLink(aktuell, { monat: null })).toBe('?status=alle');
	});
	it('ergibt ohne Werte einen leeren Link', () => {
		expect(filterLink(new URLSearchParams('monat=2026-09'), { monat: null })).toBe('?');
	});
});

describe('formatWann', () => {
	it('zeigt Datum und Uhrzeit deutsch in Berliner Zeit, leer fuer null', () => {
		expect(formatWann(null)).toBe('');
		expect(formatWann(new Date('2026-09-16T15:42:00Z'))).toMatch(/16\.09\.2026, 17:42/);
	});
});
