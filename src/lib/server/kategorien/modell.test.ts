import { describe, it, expect, vi } from 'vitest';
import { ordneMitModell, auswahlliste } from './modell';
import type { ZuOrdnendeZeile } from './kaskade';

const zeilen: ZuOrdnendeZeile[] = [
	{ id: 'i1', rawText: 'BIO MILCH 1L', lineType: 'article' },
	{ id: 'i2', rawText: 'SPUELMITTEL', lineType: 'article' }
];

function antwort(inhalt: unknown) {
	return vi.fn(async () => ({
		text: JSON.stringify(inhalt),
		usage: { inputTokens: 100, outputTokens: 50 }
	}));
}

describe('auswahlliste', () => {
	it('nennt jede Unterkategorie mit ihrem Slug und ihrer Oberkategorie', () => {
		const liste = auswahlliste();
		expect(liste).toContain('lebensmittel-milch-eier');
		expect(liste).toContain('Milchprodukte & Eier');
		// Der Baum ist die einzige Quelle — die Liste wird aus ihm erzeugt, nicht daneben
		// gepflegt. Sonst schlaegt das Modell Kategorien vor, die es nicht gibt.
		expect(liste.split('\n').length).toBeGreaterThan(20);
	});
});

describe('ordneMitModell', () => {
	it('fragt EINMAL fuer alle offenen Zeilen, nicht je Zeile', async () => {
		const frag = antwort({ '1': 'lebensmittel-milch-eier', '2': 'haushalt-reinigung' });
		const r = await ordneMitModell(zeilen, { frageModell: frag });
		expect(frag).toHaveBeenCalledTimes(1);
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier', i2: 'haushalt-reinigung' });
	});

	// Bei 14 Positionen waere ein Aufruf je Zeile der Unterschied zwischen 0,6 und 8 Cent
	// — und vierzehnmal die Wartezeit.
	it('fragt gar nicht, wenn nichts offen ist', async () => {
		const frag = antwort({});
		const r = await ordneMitModell([], { frageModell: frag });
		expect(frag).not.toHaveBeenCalled();
		expect(r.vorschlaege).toEqual({});
		expect(r.usage).toBeNull();
	});

	/**
	 * Die zweite Regel: das Modell darf keine Kategorien erfinden. Ein unbekannter Slug
	 * wird verworfen, die Zeile bleibt offen und faellt auf Unsortiert — statt eine
	 * erfundene Kategorie in die Auswertung zu tragen.
	 */
	it('verwirft erfundene Kategorien und nennt sie beim Namen', async () => {
		const frag = antwort({ '1': 'lebensmittel-milch-eier', '2': 'haushalt-katzenstreu' });
		const r = await ordneMitModell(zeilen, { frageModell: frag });
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier' });
		// Verworfenes verschwindet NICHT still: ein Rueckfall, den niemand bemerken kann,
		// ist selbst ein Defekt.
		expect(r.verworfen).toEqual([{ itemId: 'i2', slug: 'haushalt-katzenstreu' }]);
	});

	it('verwirft Antworten zu Nummern, die es nicht gibt — und den Muell-Schluessel "."', async () => {
		const frag = antwort({ '1': 'lebensmittel-milch-eier', '9': 'haushalt-reinigung', '.': 'haushalt-reinigung' });
		const r = await ordneMitModell(zeilen, { frageModell: frag });
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier' });
	});

	it('nimmt auch eine Oberkategorie an — sie steht so im Baum', async () => {
		const frag = antwort({ '1': 'lebensmittel' });
		const r = await ordneMitModell([zeilen[0]], { frageModell: frag });
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel' });
	});

	it('vertraegt einen Code-Zaun um die Antwort', async () => {
		const frag = vi.fn(async () => ({
			text: '```json\n{"1":"lebensmittel-milch-eier"}\n```',
			usage: null
		}));
		const r = await ordneMitModell([zeilen[0]], { frageModell: frag });
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier' });
	});

	// Unlesbare Antwort: keine Vorschlaege, aber die Zeilen bleiben offen und fallen auf
	// Unsortiert. Der Grund geht nach aussen, statt zu verschwinden.
	it('meldet eine unlesbare Antwort, statt sie als leeres Ergebnis auszugeben', async () => {
		const frag = vi.fn(async () => ({ text: 'Klar, gerne! Hier:', usage: null }));
		const r = await ordneMitModell([zeilen[0]], { frageModell: frag });
		expect(r.vorschlaege).toEqual({});
		expect(r.fehler).toMatch(/Antwort/i);
	});

	it('nimmt einen Wert, der kein Text ist, nicht an', async () => {
		const frag = antwort({ '1': 42, '2': null });
		const r = await ordneMitModell(zeilen, { frageModell: frag });
		expect(r.vorschlaege).toEqual({});
	});

	it('reicht die Verbrauchszahlen des Aufrufs durch', async () => {
		const frag = antwort({ '1': 'lebensmittel-milch-eier' });
		const r = await ordneMitModell([zeilen[0]], { frageModell: frag });
		expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
	});
});
