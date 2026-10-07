import { describe, it, expect } from 'vitest';
import { randHinweis } from './rand';

describe('randHinweis', () => {
	it('erkannt: Chip „Rand gefunden“, keine Warnung', () => {
		expect(randHinweis('erkannt')).toEqual({ chip: 'Rand gefunden – bitte prüfen', warnung: null });
	});
	it('nicht erkannt: Warnung, kein Chip', () => {
		const h = randHinweis('unsicher');
		expect(h.chip).toBeNull();
		expect(h.warnung).toContain('Rand nicht sicher erkannt');
	});
	// 2.14e: Nach einem Zug hat der Mensch entschieden — keine Warnung mehr.
	it('von Hand: Chip „Ecken von Hand gesetzt“, keine Warnung', () => {
		expect(randHinweis('vonHand')).toEqual({ chip: 'Ecken von Hand gesetzt', warnung: null });
	});
});
