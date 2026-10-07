import { describe, it, expect } from 'vitest';
import { statusSperrText } from './sperrtext';

describe('statusSperrText', () => {
	it('nennt beim Papierkorb den Papierkorb, nicht das Lesen (2.2)', () => {
		expect(statusSperrText('verworfen')).toBe('Dieser Bon liegt im Papierkorb.');
	});
	it('sagt bei wartenden und laufenden Bons „wird gerade gelesen"', () => {
		expect(statusSperrText('pending')).toBe('Dieser Bon wird gerade gelesen.');
		expect(statusSperrText('extracting')).toBe('Dieser Bon wird gerade gelesen.');
	});
	it('sagt beim Doppel weiter, dass er gesperrt ist, und bei der Bestaetigung, dass sie schon war', () => {
		expect(statusSperrText('doppelt')).toBe('Dieser Bon ist als Doppel markiert und lässt sich darum nicht bearbeiten.');
		expect(statusSperrText('confirmed')).toBe('Dieser Bon ist bereits bestätigt.');
	});
	it('zeigt nie einen technischen Statusnamen', () => {
		for (const s of ['review', 'failed', 'quatsch']) {
			const t = statusSperrText(s);
			expect(t).toBe('Dieser Bon hat sich gerade geändert. Bitte die Seite neu laden.');
			expect(t).not.toContain(s);
		}
	});
});
