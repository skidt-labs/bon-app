import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
import { eingabeAusFormular } from './ki';

const formular = (werte: Record<string, string>) => {
	const f = new FormData();
	const basis = { name: 'MLX', weg: 'text', baseUrl: 'https://mlx.invalid/v1', modell: 'qwen', zeitlimitS: '60', preisEin: '', preisAus: '' };
	for (const [k, v] of Object.entries({ ...basis, ...werte })) f.set(k, v);
	return f;
};
const eingabe = (werte: Record<string, string> = {}) => {
	const r = eingabeAusFormular(formular(werte));
	if (!r.ok) throw new Error(r.grund);
	return r.eingabe;
};

describe('eingabeAusFormular', () => {
	it('entfernt einen Schraegstrich am Ende der Basis-URL', () => {
		expect(eingabe({ baseUrl: 'https://mlx.invalid/v1/' }).baseUrl).toBe('https://mlx.invalid/v1');
	});
	it('nimmt das Zeitlimit in Sekunden an und speichert Millisekunden', () => {
		expect(eingabe({ zeitlimitS: '60' }).zeitlimitMs).toBe(60_000);
	});
	it('lehnt ein Zeitlimit unter einer Sekunde ab', () => {
		expect(eingabeAusFormular(formular({ zeitlimitS: '0' })).ok).toBe(false);
	});
	it('macht aus einem leeren Preisfeld null, aus „0" eine 0', () => {
		expect(eingabe({ preisEin: '', preisAus: '0' })).toMatchObject({ preisEinMicro: null, preisAusMicro: 0 });
	});
	it('lehnt einen negativen oder unlesbaren Preis ab', () => {
		expect(eingabeAusFormular(formular({ preisEin: '-1' })).ok).toBe(false);
		expect(eingabeAusFormular(formular({ preisEin: 'teuer' })).ok).toBe(false);
	});
	it('lehnt einen Preis mit Tausendertrennzeichen ab, statt ihn stillschweigend zu verkleinern', () => {
		expect(eingabeAusFormular(formular({ preisEin: '150.000' })).ok).toBe(false);
		expect(eingabeAusFormular(formular({ preisEin: '150,000' })).ok).toBe(false);
	});
	it('lehnt Exponentenschreibweise ab', () => {
		expect(eingabeAusFormular(formular({ preisEin: '1e3' })).ok).toBe(false);
	});
	it('lehnt einen Preis ueber dem Postgres-Integer-Maximum ab, nimmt das Maximum selbst an', () => {
		expect(eingabeAusFormular(formular({ preisEin: '2147483648' })).ok).toBe(false);
		expect(eingabe({ preisEin: '2147483647' }).preisEinMicro).toBe(2147483647);
	});
	it('verlangt http oder https', () => {
		expect(eingabeAusFormular(formular({ baseUrl: 'ftp://x' })).ok).toBe(false);
	});
	it('laesst ein leeres Schluesselfeld als „nicht aendern" durch', () => {
		expect(eingabe({ schluessel: '' })).toMatchObject({ schluessel: null, schluesselEntfernen: false });
	});
	it('kennt nur die beiden Wege', () => {
		expect(eingabeAusFormular(formular({ weg: 'magie' })).ok).toBe(false);
	});
});
