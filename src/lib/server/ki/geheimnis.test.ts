import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { verschluesseln, entschluesseln, geheimnisVorhanden, schluesselEnde, SchluesselFehlt } from './geheimnis';
import { KiSchluesselUnlesbar, KiKonfigurationFehler } from './fehler';

const env = (key = randomBytes(32).toString('base64')) => ({ SECRETS_KEY: key }) as NodeJS.ProcessEnv;

describe('geheimnis', () => {
	it('gibt nach dem Entschluesseln genau den Klartext zurueck', () => {
		const e = env();
		const blob = verschluesseln('sk-test-geheim-a3f9', 'anbieter-1', e);
		expect(blob.includes(Buffer.from('sk-test-geheim'))).toBe(false);
		expect(entschluesseln(blob, 'anbieter-1', e)).toBe('sk-test-geheim-a3f9');
	});

	it('verschluesselt denselben Klartext jedes Mal anders (frischer IV)', () => {
		const e = env();
		expect(verschluesseln('x', 'a', e).equals(verschluesseln('x', 'a', e))).toBe(false);
	});

	it('laesst einen in eine andere Zeile kopierten Chiffretext nicht entschluesseln', () => {
		const e = env();
		const blob = verschluesseln('sk-1', 'anbieter-1', e);
		expect(() => entschluesseln(blob, 'anbieter-2', e)).toThrow(KiSchluesselUnlesbar);
	});

	it('bemerkt ein verfaelschtes Byte', () => {
		const e = env();
		const blob = verschluesseln('sk-1', 'a', e);
		blob[blob.length - 1] ^= 0xff;
		expect(() => entschluesseln(blob, 'a', e)).toThrow(KiSchluesselUnlesbar);
	});

	it('scheitert mit einem anderen SECRETS_KEY laut, als Konfigurationsfehler', () => {
		const blob = verschluesseln('sk-1', 'a', env());
		const fehler = (() => {
			try {
				entschluesseln(blob, 'a', env());
			} catch (err) {
				return err;
			}
		})();
		expect(fehler).toBeInstanceOf(KiSchluesselUnlesbar);
		expect(fehler).toBeInstanceOf(KiKonfigurationFehler);
	});

	it('verweigert einen SECRETS_KEY, der nicht 32 Bytes ergibt — kein Kuerzen, kein Auffuellen', () => {
		expect(() => verschluesseln('x', 'a', env(randomBytes(16).toString('base64')))).toThrow(/32 Bytes/);
	});

	it('meldet einen fehlenden SECRETS_KEY als eigene Klasse', () => {
		expect(() => verschluesseln('x', 'a', {} as NodeJS.ProcessEnv)).toThrow(SchluesselFehlt);
		expect(geheimnisVorhanden({} as NodeJS.ProcessEnv)).toBe(false);
		expect(geheimnisVorhanden(env())).toBe(true);
	});

	it('zeigt nur die letzten vier Zeichen', () => {
		expect(schluesselEnde('sk-abcdefa3f9')).toBe('a3f9');
		expect(schluesselEnde('ab')).toBe('ab');
	});
});
