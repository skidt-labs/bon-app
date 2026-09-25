import { describe, it, expect } from 'vitest';
import { kennzahlen, median, bericht, beanstandungCode } from './vergleich';
import type { Messpunkt } from './vergleich';

function punkt(over: Partial<Messpunkt> = {}): Messpunkt {
	return {
		bonId: 'aaaaaaaa-1111-2222-3333-444444444444',
		engine: 'tesseract',
		bildBreite: 838,
		bildHoehe: 2000,
		ocr: { status: 'gelesen', dauerMs: 1000, zeilen: 50, zeichen: 1200, confidence: 92 },
		tuersteher: { brauchbar: true, anzahlBetraege: 12, hatSummenzeile: true },
		modell: { status: 'gelesen', dauerMs: 30_000, positionen: 12, beanstandungen: [] },
		gegenBestaetigt: null,
		...over
	};
}

describe('median', () => {
	it('nimmt bei gerader Anzahl das Mittel der beiden mittleren', () => {
		// Sonst haenge das Ergebnis davon ab, ob zufaellig ein Bon mehr gemessen wurde.
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(median([3, 1, 2])).toBe(2);
		expect(median([])).toBe(0);
	});
});

describe('kennzahlen', () => {
	it('zaehlt nur die Messpunkte der gefragten Engine', () => {
		const k = kennzahlen([punkt(), punkt({ engine: 'paddleocr' })], 'paddleocr');
		expect(k.bons).toBe(1);
	});

	// Die wichtigste Zahl, solange es keinen geprueften Sollwert gibt: widerspricht
	// sich der ausgelesene Bon selbst? Das braucht niemanden, der ihn nachrechnet.
	it('zaehlt "Positionen passen zur Endsumme" nur unter den gelungenen Modellaufrufen', () => {
		const k = kennzahlen(
			[
				punkt(),
				punkt({ modell: { status: 'gelesen', dauerMs: 1, positionen: 3, beanstandungen: ['sum_mismatch'] } }),
				punkt({ modell: { status: 'gescheitert', dauerMs: 1, fehler: 'Zeitlimit' } })
			],
			'tesseract'
		);
		expect(k.modellGelesen).toBe(2);
		expect(k.summeStimmig).toBe(1);
	});

	// Ein Bon ohne gepruefte Werte darf nicht als "stimmt nicht" zaehlen — er hat
	// schlicht keinen Sollwert. Die Leerstelle ist null, nicht 0.
	it('liefert null statt einer Null, wenn kein Bon gepruefte Werte hat', () => {
		expect(kennzahlen([punkt()], 'tesseract').gegenBestaetigt).toBeNull();
	});

	it('rechnet gegen gepruefte Werte nur ueber die Bons, die welche haben', () => {
		const k = kennzahlen(
			[
				punkt(),
				punkt({
					gegenBestaetigt: { summeStimmt: true, positionenSoll: 10, positionenIst: 10, betraegeGetroffen: 1 }
				}),
				punkt({
					gegenBestaetigt: { summeStimmt: false, positionenSoll: 10, positionenIst: 8, betraegeGetroffen: 0.8 }
				})
			],
			'tesseract'
		);
		expect(k.gegenBestaetigt).toEqual({ bons: 2, summeStimmt: 1, betraegeGetroffenMittel: 0.9 });
	});

	it('laesst die Confidence null, wenn keine Engine eine meldet', () => {
		const k = kennzahlen(
			[punkt({ ocr: { status: 'gelesen', dauerMs: 1, zeilen: 1, zeichen: 1, confidence: null } })],
			'tesseract'
		);
		expect(k.confidenceMittel).toBeNull();
	});
});

describe('beanstandungCode', () => {
	it('laesst einen Code unveraendert', () => {
		for (const c of ['sum_mismatch', 'vat_mismatch', 'no_items', 'duplicate_line_no']) {
			expect(beanstandungCode(c)).toBe(c);
		}
	});

	// Der Anlass: im ersten Vergleichslauf stand die volle Anbieter-Meldung im Bericht,
	// samt Artikelname und Betrag der entfernten Zeile. Harmlos bei "Pfand", nicht
	// harmlos beim naechsten Bon — und der Bericht liegt in docs/ und laeuft ins Backup.
	it('macht aus einem ganzen Satz einen Code, damit kein Bontext in den Bericht kommt', () => {
		const meldung =
			'Position 8 ("Bio Kiwi Gold", Pfand 0,25 EUR, lineType "deposit") entfernt: kein ' +
			'positiver Beleg im OCR-Text.';
		expect(beanstandungCode(meldung)).toBe('anbieter_korrektur');
		expect(beanstandungCode(meldung)).not.toContain('Kiwi');
	});
});

describe('bericht', () => {
	const stand = { datum: '2026-09-16', modell: 'testmodell' };

	// Der Bericht landet in docs/, und docs/ laeuft ins Backup. Echte Artikelnamen,
	// Haendler oder Einzelbetraege haben darin nichts verloren.
	it('enthaelt keinen Bontext, nur Kennzahlen und Kennungen', () => {
		const text = bericht([punkt(), punkt({ engine: 'paddleocr' })], stand);
		expect(text).not.toMatch(/Broccoli|LIDL|Jack Wolfskin/i);
		// Die Bon-Kennung steht gekuerzt drin, damit man einen Ausreisser wiederfindet.
		expect(text).toContain('aaaaaaaa');
	});

	// Der Kern: eine Trefferquote gegen einen geprueften Sollwert und eine Stimmigkeit
	// gegen die eigene Endsumme sehen in einer Tabelle gleich aus. Der Bericht MUSS
	// sagen, wenn es gar keinen Sollwert gibt — sonst liest jemand die Stimmigkeit als
	// Richtigkeit.
	it('sagt ausdruecklich, wenn es keinen geprueften Sollwert gibt', () => {
		const text = bericht([punkt()], stand);
		expect(text).toContain('keinen geprueften Sollwert');
		expect(text).not.toContain('## Gegen geprueften Sollwert');
	});

	it('zeigt den Sollwert-Abschnitt, sobald es gepruefte Bons gibt', () => {
		const text = bericht(
			[punkt({ gegenBestaetigt: { summeStimmt: true, positionenSoll: 3, positionenIst: 3, betraegeGetroffen: 1 } })],
			stand
		);
		expect(text).toContain('## Gegen geprueften Sollwert');
		expect(text).toContain('1 von 1 Bons haben gepruefte Sollwerte');
	});

	it('hebt einen durchgefallenen Tuersteher und einen gescheiterten Lauf hervor', () => {
		const text = bericht(
			[
				punkt({
					tuersteher: { brauchbar: false, anzahlBetraege: 0, hatSummenzeile: false },
					modell: { status: 'gescheitert', dauerMs: 5, fehler: 'Bon unlesbar' }
				})
			],
			stand
		);
		expect(text).toContain('**nein**');
		expect(text).toContain('**gescheitert**');
	});
});
