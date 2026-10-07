/** Woher das Viereck in „Bild bearbeiten" stammt (Sammelfassung 2.14e). */
export type Rand = 'erkannt' | 'unsicher' | 'vonHand';

export function randHinweis(rand: Rand): { chip: string | null; warnung: string | null } {
	if (rand === 'erkannt') return { chip: 'Rand gefunden – bitte prüfen', warnung: null };
	// Nach einem Zug hat der Mensch entschieden; vorher kam die Warnung nach jedem Zug wieder.
	if (rand === 'vonHand') return { chip: 'Ecken von Hand gesetzt', warnung: null };
	return {
		chip: null,
		warnung:
			'Rand nicht sicher erkannt — zieh die vier Ecken an die Ecken des Bons. Auf dunklem Untergrund klappt es von selbst besser.'
	};
}
