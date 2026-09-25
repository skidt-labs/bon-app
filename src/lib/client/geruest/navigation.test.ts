import { describe, it, expect } from 'vitest';
import { aktiveSeite, leisteUntenSichtbar, SEITEN, HANDY_ZIELE } from './navigation';

describe('aktiveSeite', () => {
	it('ordnet jeden Weg der richtigen Seite zu', () => {
		// Die Eingangstuer: am Handy die Kamera, am Schreibtisch der Ueberblick. Die
		// Leiste unten gibt es nur am Handy, also ist „Scannen" hier die richtige Antwort.
		expect(aktiveSeite('/')).toBe('scannen');
		expect(aktiveSeite('/scan')).toBe('scannen');
		expect(aktiveSeite('/dashboard')).toBe('start');
		expect(aktiveSeite('/inbox')).toBe('posteingang');
		expect(aktiveSeite('/receipts')).toBe('bons');
		expect(aktiveSeite('/receipts/3f2a0b7c-1111-2222-3333-444444444444')).toBe('bons');
		expect(aktiveSeite('/reports')).toBe('berichte');
		expect(aktiveSeite('/reports?month=2026-09')).toBe('berichte');
		expect(aktiveSeite('/settings/household')).toBe('einstellungen');
		expect(aktiveSeite('/settings/budgets')).toBe('einstellungen');
	});

	// Auf /auth/* gibt es keinen angemeldeten Nutzer, also auch kein Geruest. Und ein
	// unbekannter Weg darf nicht still als "scannen" durchgehen — null ist die Leerstelle.
	it('kennt keine Seite fuer Anmeldung und Unbekanntes', () => {
		expect(aktiveSeite('/auth/login')).toBeNull();
		expect(aktiveSeite('/auth/callback?code=x')).toBeNull();
		expect(aktiveSeite('/irgendwas')).toBeNull();
	});
});

describe('leisteUntenSichtbar', () => {
	// Die Pruefansicht hat auf dem Handy ihren eigenen festen Fuss (Summe, Bestaetigen).
	// Eine Leiste darunter deckte ihn ab. Sie bleibt weg, bis Etappe 4 die Ansicht neu baut.
	it('blendet die Leiste auf der Pruefansicht aus, sonst nicht', () => {
		expect(leisteUntenSichtbar('/receipts/3f2a0b7c-1111-2222-3333-444444444444')).toBe(false);
		expect(leisteUntenSichtbar('/receipts')).toBe(true);
		expect(leisteUntenSichtbar('/inbox')).toBe(true);
		expect(leisteUntenSichtbar('/auth/login')).toBe(false);
	});
});

describe('SEITEN', () => {
	it('sind sechs, und die vier Handy-Ziele sind darunter', () => {
		expect(SEITEN.map((s) => s.id)).toEqual([
			'start',
			'scannen',
			'posteingang',
			'bons',
			'berichte',
			'einstellungen'
		]);
		for (const z of HANDY_ZIELE) expect(SEITEN.some((s) => s.id === z)).toBe(true);
		// Scannen bleibt am Handy dabei — dort sitzt der erhoehte Kamera-Knopf, und die
		// Kamera ist am Handy das Wichtigste (Entscheidung des Betreibers, 17.09.2026).
		expect(HANDY_ZIELE).toContain('scannen');
	});

	// Die Leiste unten ist ein Raster mit fester Spaltenzahl (LeisteUnten.svelte). Kommt
	// ein Ziel dazu, ohne dass das Raster mitwaechst, rutschen die Knoepfe uebereinander.
	it('hat genau so viele Handy-Ziele, wie das Raster Spalten hat', () => {
		expect(HANDY_ZIELE).toHaveLength(4);
	});
});
