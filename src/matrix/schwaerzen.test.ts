import { describe, it, expect } from 'vitest';
import { schwaerzeFehler } from './schwaerzen';

describe('schwaerzeFehler', () => {
	it('lässt eine harmlose Error unverändert (kein Zeiger auf ein Token)', () => {
		const err = new Error('M_FORBIDDEN: Guest access not allowed');
		expect(schwaerzeFehler(err)).toBe(err);
	});

	it('schwärzt ein Bearer-Token in einer Error-Nachricht', () => {
		const err = new Error('Request failed: Authorization: Bearer syt_abcDEF123456_xyz789 rejected');
		const ergebnis = schwaerzeFehler(err) as Error;
		expect(ergebnis).toBeInstanceOf(Error);
		expect(ergebnis.message).not.toMatch(/syt_abcDEF123456_xyz789/);
		expect(ergebnis.message).toMatch(/Bearer \[REDACTED\]/);
	});

	// Die eigentliche Fundstelle des Prüfers: matrix-bot-sdk wirft bei einer
	// Nicht-2xx-Antwort ohne errcode das rohe `request`-Antwortobjekt, dessen
	// `.request.headers.Authorization` das Bot-Token trägt.
	it('lässt den Authorization-Header eines rohen HTTP-Antwortobjekts nicht durch', () => {
		const rohesResponseObjekt = {
			statusCode: 403,
			statusMessage: 'Forbidden',
			request: {
				method: 'PUT',
				href: 'https://matrix.example.org/_matrix/client/v3/rooms/!x:example.org/send/m.reaction/1',
				headers: {
					Authorization: 'Bearer syt_geheimesTokenDesBots_00000',
					'User-Agent': 'matrix-bot-sdk'
				}
			}
		};
		const ergebnis = schwaerzeFehler(rohesResponseObjekt);
		expect(JSON.stringify(ergebnis)).not.toMatch(/syt_geheimesTokenDesBots_00000/);
		// Für die Diagnose bleibt trotzdem etwas Nützliches übrig.
		expect(ergebnis).toMatchObject({ statusCode: 403, methode: 'PUT' });
	});

	it('schwärzt ein access_token in einer URL', () => {
		const ergebnis = schwaerzeFehler({
			statusCode: 401,
			request: { href: 'https://matrix.example.org/_matrix/client/v3/sync?access_token=syt_geheim123456' }
		});
		expect(JSON.stringify(ergebnis)).not.toMatch(/syt_geheim123456/);
	});

	it('kommt mit einem zirkulären Objekt klar, ohne zu werfen oder hängen zu bleiben', () => {
		const zirkulaer: Record<string, unknown> = { statusCode: 500 };
		zirkulaer.request = { response: zirkulaer };
		expect(() => schwaerzeFehler(zirkulaer)).not.toThrow();
	});

	it('lässt Werte, die kein Fehler und kein Objekt sind, unangetastet', () => {
		expect(schwaerzeFehler(42)).toBe(42);
		expect(schwaerzeFehler(null)).toBe(null);
		expect(schwaerzeFehler(undefined)).toBe(undefined);
	});
});
