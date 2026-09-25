import { describe, it, expect } from 'vitest';
import { istEinloesbar, letzterVerwalter } from './einladungen';

const jetzt = new Date('2026-09-18T10:00:00Z');

describe('istEinloesbar', () => {
	it('nimmt eine frische, unverbrauchte Einladung an', () => {
		expect(istEinloesbar({ laeuftAbAm: new Date('2026-09-25T10:00:00Z'), eingeloestAm: null }, jetzt))
			.toBe('ok');
	});
	it('lehnt eine abgelaufene ab', () => {
		expect(istEinloesbar({ laeuftAbAm: new Date('2026-09-17T10:00:00Z'), eingeloestAm: null }, jetzt))
			.toBe('abgelaufen');
	});
	it('lehnt eine bereits eingeloeste ab', () => {
		expect(istEinloesbar({ laeuftAbAm: new Date('2026-09-25T10:00:00Z'), eingeloestAm: jetzt }, jetzt))
			.toBe('verbraucht');
	});
});

describe('letzterVerwalter', () => {
	it('erkennt den einzigen Verwalter', () => {
		expect(letzterVerwalter([{ userId: 'u1', rolle: 'verwalter' }], 'u1')).toBe(true);
	});
	it('erkennt ihn nicht, wenn es einen zweiten gibt', () => {
		expect(letzterVerwalter(
			[{ userId: 'u1', rolle: 'verwalter' }, { userId: 'u2', rolle: 'verwalter' }], 'u1'
		)).toBe(false);
	});
	it('Mitglieder zaehlen nicht als Ersatz', () => {
		expect(letzterVerwalter(
			[{ userId: 'u1', rolle: 'verwalter' }, { userId: 'u2', rolle: 'mitglied' }], 'u1'
		)).toBe(true);
	});
});
