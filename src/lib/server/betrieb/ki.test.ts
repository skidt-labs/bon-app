import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
import { eingabeAusFormular, reserveGrund, grenzeAusFormular } from './ki';

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

// Cloud-Reserve (Entwurf 2026-10-01): wann eine Karte Reserve werden darf — und warum nicht.
describe('reserveGrund', () => {
	const karte = (teil: Partial<Parameters<typeof reserveGrund>[0]> = {}) => ({
		weg: 'text' as const,
		testOk: true as boolean | null,
		preisEinMicro: 300_000 as number | null,
		preisAusMicro: 2_500_000 as number | null,
		aktiv: false,
		...teil
	});

	it('erlaubt eine getestete Textweg-Karte mit Preisen', () => {
		expect(reserveGrund(karte(), 'text')).toBeNull();
	});

	it('nennt die Gruende in dieser Reihenfolge', () => {
		expect(reserveGrund(karte({ weg: 'bild' }), 'text')).toBe('Nur Textweg-Anbieter können Reserve sein.');
		expect(reserveGrund(karte({ aktiv: true }), 'text')).toBe('Das ist der aktive Hauptanbieter.');
		expect(reserveGrund(karte(), 'bild')).toBe('Der Hauptanbieter nutzt den Bildweg — die Reserve braucht den Textweg.');
		expect(reserveGrund(karte(), null)).toBe('Der Hauptanbieter ist nicht vollständig eingerichtet.');
		expect(reserveGrund(karte({ testOk: false }), 'text')).toBe('Erst testen.');
		expect(reserveGrund(karte({ testOk: null }), 'text')).toBe('Erst testen.');
		expect(reserveGrund(karte({ preisAusMicro: null }), 'text')).toBe('Preise fehlen — ohne sie lässt sich die Monatsgrenze nicht prüfen.');
	});

	it('nennt bei zwei Gruenden den ersten', () => {
		expect(reserveGrund(karte({ weg: 'bild', testOk: false }), 'text')).toBe('Nur Textweg-Anbieter können Reserve sein.');
		expect(reserveGrund(karte({ testOk: false, preisEinMicro: null }), 'text')).toBe('Erst testen.');
	});
});

describe('grenzeAusFormular', () => {
	it('liest Euro mit Komma oder ganz', () => {
		expect(grenzeAusFormular('5')).toBe(5_000_000);
		expect(grenzeAusFormular('5,00')).toBe(5_000_000);
		expect(grenzeAusFormular('0,5')).toBe(500_000);
		expect(grenzeAusFormular(' 12,30 ')).toBe(12_300_000);
		expect(grenzeAusFormular('1000')).toBe(1_000_000_000);
	});

	it('lehnt Leeres, Null, Negatives, zu Grosses und zu viele Nachkommastellen ab', () => {
		for (const x of ['', '  ', '0', '0,00', '-1', '1000,01', '1,234', 'abc', '5.00', '1e3']) {
			expect(grenzeAusFormular(x), x).toBeNull();
		}
	});
});
