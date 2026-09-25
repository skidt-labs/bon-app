import { describe, it, expect } from 'vitest';
import { monatszahlenAus, type BonFuerZahlen } from './monatszahlen';

const b = (over: Partial<BonFuerZahlen>): BonFuerZahlen => ({
	monat: '2026-09',
	status: 'confirmed',
	totalGrossCents: 1000,
	...over
});

describe('monatszahlenAus', () => {
	it('ist bei leerem Bestand ueberall null, ohne etwas zu behaupten', () => {
		const z = monatszahlenAus([], '2026-09');
		expect(z.bestaetigt).toEqual({ bons: 0, cent: 0, ohneBetrag: 0 });
		expect(z.offen).toEqual({ bons: 0, cent: 0, ohneBetrag: 0 });
		expect(z.rueckstand).toEqual({ bons: 0, cent: 0, ohneBetrag: 0 });
		// Kein Vormonat mit bestaetigten Bons heisst „kein Vergleich", nicht „0 %".
		expect(z.vormonat).toBeNull();
	});

	it('zaehlt bestaetigte und offene Bons des Monats getrennt', () => {
		const z = monatszahlenAus(
			[
				b({ totalGrossCents: 1278 }),
				b({ totalGrossCents: 1300 }),
				b({ status: 'review', totalGrossCents: 5000 }),
				b({ status: 'extracting', totalGrossCents: 700 })
			],
			'2026-09'
		);
		expect(z.bestaetigt).toEqual({ bons: 2, cent: 2578, ohneBetrag: 0 });
		expect(z.offen).toEqual({ bons: 2, cent: 5700, ohneBetrag: 0 });
	});

	it('laesst andere Monate aus den Monatszahlen heraus', () => {
		const z = monatszahlenAus(
			[b({ monat: '2026-08', totalGrossCents: 30388, status: 'review' }), b({ totalGrossCents: 100 })],
			'2026-09'
		);
		expect(z.bestaetigt.cent).toBe(100);
		expect(z.offen.bons).toBe(0);
	});

	// Der Rueckstand geht ueber ALLE Monate: die Monatssumme ist nur so wahr, wie wenig
	// daneben ungeprueft liegt. Sechs Augustbons ueber 303,88 EUR wuerden den September
	// sonst als gepruefte Wahrheit erscheinen lassen.
	it('zaehlt den Rueckstand ueber alle Monate, nicht nur den gezeigten', () => {
		const z = monatszahlenAus(
			[
				b({ monat: '2026-08', status: 'review', totalGrossCents: 30388 }),
				b({ status: 'review', totalGrossCents: 13823 }),
				b({ totalGrossCents: 2578 })
			],
			'2026-09'
		);
		expect(z.rueckstand).toEqual({ bons: 2, cent: 44211, ohneBetrag: 0 });
	});

	it('nimmt den Vormonat nur, wenn dort bestaetigte Bons liegen', () => {
		const mit = monatszahlenAus(
			[b({ monat: '2026-08', totalGrossCents: 5000 }), b({ totalGrossCents: 2578 })],
			'2026-09'
		);
		expect(mit.vormonat).toEqual({ bons: 1, cent: 5000, ohneBetrag: 0 });

		const ohne = monatszahlenAus(
			[b({ monat: '2026-08', status: 'review', totalGrossCents: 5000 }), b({ totalGrossCents: 2578 })],
			'2026-09'
		);
		expect(ohne.vormonat).toBeNull();
	});

	it('findet den Vormonat auch ueber den Jahreswechsel', () => {
		const z = monatszahlenAus([b({ monat: '2025-12', totalGrossCents: 900 })], '2026-01');
		expect(z.vormonat).toEqual({ bons: 1, cent: 900, ohneBetrag: 0 });
	});

	// Ein Bon ohne erkannte Endsumme ist eine Leerstelle, keine Null: er wird gezaehlt,
	// aber nicht als 0,00 EUR in die Summe gerechnet — sonst sieht der Monat billiger aus,
	// als er war, und nichts weist darauf hin.
	it('zaehlt Bons ohne Endsumme gesondert, statt sie als null Euro zu verrechnen', () => {
		const z = monatszahlenAus(
			[b({ totalGrossCents: 2578 }), b({ totalGrossCents: null }), b({ status: 'review', totalGrossCents: null })],
			'2026-09'
		);
		expect(z.bestaetigt).toEqual({ bons: 2, cent: 2578, ohneBetrag: 1 });
		expect(z.offen).toEqual({ bons: 1, cent: 0, ohneBetrag: 1 });
	});

	it('zaehlt fehlgeschlagene Bons nicht zum Rueckstand — sie sind kein Geld, sondern Arbeit', () => {
		const z = monatszahlenAus([b({ status: 'failed', totalGrossCents: 999 })], '2026-09');
		expect(z.rueckstand).toEqual({ bons: 0, cent: 0, ohneBetrag: 0 });
		expect(z.offen).toEqual({ bons: 0, cent: 0, ohneBetrag: 0 });
	});
});
