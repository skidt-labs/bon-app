import { describe, it, expect } from 'vitest';
import { oidcFehlerMeldung } from './oidc-fehler';

describe('oidcFehlerMeldung', () => {
	it('sagt bei access_denied, dass das Konto nicht freigeschaltet ist', () => {
		const m = oidcFehlerMeldung('access_denied');
		expect(m.status).toBe(403);
		expect(m.text).toMatch(/nicht dafür freigeschaltet/);
	});

	// Genau der Fall vom 14.09.: der OAuth-Provider hatte grant_types=[], Authentik
	// antwortete mit invalid_request. Das ist KEIN Nutzerfehler — die Meldung darf
	// nicht so tun, als läge es an ihm oder als hülfe ein weiterer Versuch.
	it('schiebt invalid_request nicht dem Nutzer zu', () => {
		const m = oidcFehlerMeldung('invalid_request');
		expect(m.status).toBe(502);
		expect(m.text).toMatch(/nicht bei dir/);
	});

	it('behandelt unbekannte Codes wie Serverfehler, statt zu raten', () => {
		expect(oidcFehlerMeldung('voellig_neuer_code').status).toBe(502);
	});

	// Der eigentliche Grund für dieses Modul: nichts aus der URL darf in die Ausgabe.
	// Deshalb wird nicht geprüft, dass bestimmte Zeichen fehlen, sondern dass der Text
	// IMMER einer aus einer festen, kleinen Menge ist — ein Durchreichen fiele damit
	// auf, egal wie es aussieht.
	it('gibt ausschliesslich eigene, feste Texte zurueck', () => {
		const erlaubt = new Set(
			['access_denied', 'login_required', 'server_error'].map((c) => oidcFehlerMeldung(c).text)
		);
		for (const code of [
			'access_denied"><script>alert(1)</script>',
			'Sitzung abgelaufen, Passwort hier eingeben',
			'',
			'temporarily_unavailable'
		]) {
			expect(erlaubt.has(oidcFehlerMeldung(code).text), code).toBe(true);
		}
	});
});
