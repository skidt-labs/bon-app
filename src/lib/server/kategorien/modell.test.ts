import { describe, it, expect, vi } from 'vitest';
import { ordneMitModell, ordneMitNachfrage, auswahlliste, echteModellDeps } from './modell';
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

describe('ordneMitNachfrage', () => {
	const drei: ZuOrdnendeZeile[] = [
		{ id: 'i1', rawText: 'BIO MILCH 1L', lineType: 'article' },
		{ id: 'i2', rawText: 'SPUELMITTEL', lineType: 'article' },
		{ id: 'i3', rawText: 'NEKTARINEN', lineType: 'article' }
	];
	const antworten = (...inhalte: unknown[]) => {
		const f = vi.fn<(p: string) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }>>();
		for (const i of inhalte) f.mockResolvedValueOnce({ text: JSON.stringify(i), usage: { inputTokens: 100, outputTokens: 50 } });
		return f;
	};

	it('fragt uebersprungene Zeilen ein zweites Mal — und nur sie', async () => {
		const frag = antworten({ '1': 'lebensmittel-milch-eier' }, { '1': 'haushalt-reinigung', '2': 'lebensmittel-obst-gemuese' });
		const r = await ordneMitNachfrage(drei, { frageModell: frag });
		expect(frag).toHaveBeenCalledTimes(2);
		// Der zweite Aufruf nennt nur die beiden offenen Posten, neu nummeriert.
		expect(frag.mock.calls[1][0]).toContain('1: SPUELMITTEL');
		expect(frag.mock.calls[1][0]).toContain('2: NEKTARINEN');
		expect(frag.mock.calls[1][0]).not.toContain('BIO MILCH');
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier', i2: 'haushalt-reinigung', i3: 'lebensmittel-obst-gemuese' });
		expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
		expect(r.fehler).toBeNull();
	});

	it('fragt auch nach, wenn das Modell eine Kategorie erfand', async () => {
		const frag = antworten(
			{ '1': 'lebensmittel-milch-eier', '2': 'putzkram', '3': 'lebensmittel-obst-gemuese' },
			{ '1': 'haushalt-reinigung' }
		);
		const r = await ordneMitNachfrage(drei, { frageModell: frag });
		expect(r.vorschlaege.i2).toBe('haushalt-reinigung');
		expect(r.verworfen).toEqual([]);
	});

	it('fragt nicht nach, was das Modell ausdruecklich unsortiert nannte', async () => {
		const frag = antworten({ '1': 'lebensmittel-milch-eier', '2': 'sonstiges-unsortiert', '3': 'lebensmittel-obst-gemuese' });
		await ordneMitNachfrage(drei, { frageModell: frag });
		expect(frag).toHaveBeenCalledTimes(1);
	});

	it('fragt nicht nach, wenn schon die erste Antwort unbrauchbar war', async () => {
		const frag = vi.fn(async () => ({ text: 'kein json', usage: null }));
		const r = await ordneMitNachfrage(drei, { frageModell: frag });
		expect(frag).toHaveBeenCalledTimes(1);
		expect(r.fehler).not.toBeNull();
	});

	it('behaelt die erste Antwort, wenn die Nachfrage scheitert', async () => {
		const frag = vi
			.fn<(p: string) => Promise<{ text: string; usage: null }>>()
			.mockResolvedValueOnce({ text: JSON.stringify({ '1': 'lebensmittel-milch-eier' }), usage: null })
			.mockRejectedValueOnce(new Error('Verbindung weg'));
		const r = await ordneMitNachfrage(drei, { frageModell: frag });
		expect(r.vorschlaege).toEqual({ i1: 'lebensmittel-milch-eier' });
		expect(r.fehler).toContain('Nachfrage');
	});
});

// Cloud-Reserve (Entwurf 2026-10-01): die Kategorien fragen das Modell, das den Bon gelesen
// hat — und lesen den Verbrauch in beiden Schreibweisen (der Abacus-Proxy meldet
// input_tokens/output_tokens; eine stille 0 hielte die Reserve fuer kostenlos).
describe('echteModellDeps', () => {
	const antwort = (usage: unknown) =>
		vi.fn<typeof fetch>(async () =>
			new Response(JSON.stringify({ choices: [{ message: { content: '{"zuordnung":[]}' } }], ...(usage === undefined ? {} : { usage }) }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

	it('fragt das uebergebene Ziel statt der .env', async () => {
		vi.stubEnv('EXTRACTION_BASE_URL', 'http://env.invalid/v1');
		vi.stubEnv('EXTRACTION_API_KEY', 'env-key');
		vi.stubEnv('EXTRACTION_MODEL', 'env-modell');
		const fetchImpl = antwort({ prompt_tokens: 1, completion_tokens: 1 });
		await echteModellDeps({ ziel: { id: 'r', baseUrl: 'http://reserve.invalid/v1', apiKey: 'r-key', model: 'flash' }, fetchImpl }).frageModell('x');
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('http://reserve.invalid/v1/chat/completions');
		expect((init?.headers as Record<string, string>).authorization).toBe('Bearer r-key');
		expect(JSON.parse(String(init?.body)).model).toBe('flash');
		vi.unstubAllEnvs();
	});

	it('nimmt ohne Ziel weiter die .env', async () => {
		vi.stubEnv('EXTRACTION_BASE_URL', 'http://env.invalid/v1');
		vi.stubEnv('EXTRACTION_API_KEY', 'env-key');
		vi.stubEnv('EXTRACTION_MODEL', 'env-modell');
		const fetchImpl = antwort({ prompt_tokens: 1, completion_tokens: 1 });
		await echteModellDeps({ fetchImpl }).frageModell('x');
		expect(fetchImpl.mock.calls[0][0]).toBe('http://env.invalid/v1/chat/completions');
		vi.unstubAllEnvs();
	});

	it('liest input_tokens/output_tokens', async () => {
		const r = await echteModellDeps({
			ziel: { id: 'r', baseUrl: 'http://r.invalid/v1', apiKey: 'k', model: 'm' },
			fetchImpl: antwort({ input_tokens: 120, output_tokens: 30 })
		}).frageModell('x');
		expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
	});

	it('ohne usage bleibt der Verbrauch unbekannt, nicht 0', async () => {
		const r = await echteModellDeps({
			ziel: { id: 'r', baseUrl: 'http://r.invalid/v1', apiKey: 'k', model: 'm' },
			fetchImpl: antwort(undefined)
		}).frageModell('x');
		expect(r.usage).toBeNull();
	});
});
