import { describe, it, expect } from 'vitest';
import { stapelAus } from './stapel';

const bons = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('stapelAus', () => {
	it('zaehlt von 1 und kennt Nachbarn', () => {
		expect(stapelAus(bons, 'b')).toEqual({ position: 2, gesamt: 3, voriger: 'a', naechster: 'c' });
	});

	it('hat am Anfang keinen vorigen, am Ende keinen naechsten', () => {
		expect(stapelAus(bons, 'a').voriger).toBeNull();
		expect(stapelAus(bons, 'c').naechster).toBeNull();
	});

	// Ein bereits bestaetigter Bon steht nicht mehr im Stapel — die Ansicht zeigt dann
	// keine Zaehlung, statt eine falsche Position zu behaupten.
	it('meldet Position 0, wenn der Bon nicht im Stapel steht', () => {
		expect(stapelAus(bons, 'z')).toEqual({ position: 0, gesamt: 3, voriger: null, naechster: null });
	});

	it('kommt mit einem leeren Stapel zurecht', () => {
		expect(stapelAus([], 'a')).toEqual({ position: 0, gesamt: 0, voriger: null, naechster: null });
	});

	it('kennt bei einem einzigen Bon weder vorigen noch naechsten', () => {
		expect(stapelAus([{ id: 'a' }], 'a')).toEqual({
			position: 1,
			gesamt: 1,
			voriger: null,
			naechster: null
		});
	});
});
