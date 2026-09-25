import { describe, it, expect, vi } from 'vitest';
import { aliasKandidatenQuery, ordneAusGedaechtnis, type ZuOrdnendeZeile } from './kaskade';

const zeile = (id: string, rawText: string, lineType = 'article'): ZuOrdnendeZeile => ({
	id,
	rawText,
	lineType
});

function deps(treffer: Record<string, { productId: string; categoryId: string; merchantId: string | null }> = {}) {
	return {
		aliasSuchen: vi.fn(async (schluessel: string) => treffer[schluessel] ?? null),
		slugAufloesen: vi.fn(async () => 'cat-unsortiert')
	};
}

describe('ordneAusGedaechtnis', () => {
	it('ordnet eine Zeile zu, deren Alias beim SELBEN Haendler gelernt wurde', async () => {
		const d = deps({ 'bio milch 1l': { productId: 'p1', categoryId: 'c1', merchantId: 'm1' } });
		const r = await ordneAusGedaechtnis([zeile('i1', 'BIO MILCH 1L')], 'm1', 'h1', d);
		expect(r.offen).toHaveLength(0);
		expect(r.zugeordnet[0]).toMatchObject({ itemId: 'i1', categoryId: 'c1', source: 'rule' });
	});

	// Stufe 2: derselbe Text bei einem ANDEREN Haendler ist ein schwaecherer Hinweis.
	// Er wird genutzt, aber mit niedrigerer Konfidenz — das entscheidet spaeter, ob die
	// Zeile in der Pruef-Ansicht auffaellt.
	it('nutzt einen Alias von einem anderen Haendler mit niedrigerer Konfidenz', async () => {
		const d = deps({ 'bio milch 1l': { productId: 'p1', categoryId: 'c1', merchantId: 'm2' } });
		const r = await ordneAusGedaechtnis([zeile('i1', 'BIO MILCH 1L')], 'm1', 'h1', d);
		const a = r.zugeordnet[0];
		expect(a.source).toBe('rule');
		expect(a.confidence).toBeLessThan(100);
	});

	it('laesst offen, was das Gedaechtnis nicht kennt', async () => {
		const d = deps({});
		const r = await ordneAusGedaechtnis([zeile('i1', 'NEUES PRODUKT')], 'm1', 'h1', d);
		expect(r.zugeordnet).toHaveLength(0);
		expect(r.offen.map((z) => z.id)).toEqual(['i1']);
	});

	// Pfand, Leergut und Rabatt sind keine Produkte. Sie durchs Modell zu schicken waere
	// verschwendetes Geld und wuerde falsche Aliasse lernen.
	it('ordnet Pfand, Leergut und Rabatt ohne Gedaechtnis und ohne Modell zu', async () => {
		const d = deps({});
		const r = await ordneAusGedaechtnis(
			[zeile('i1', 'PFAND', 'deposit'), zeile('i2', 'LEERGUT', 'deposit_return'), zeile('i3', 'RABATT', 'discount')],
			'm1',
			'h1',
			d
		);
		expect(r.offen).toHaveLength(0);
		expect(r.zugeordnet).toHaveLength(3);
		for (const z of r.zugeordnet) expect(z.source).toBe('rule');
	});

	// Infozeilen tragen keinen Geldwert und gehoeren in keine Auswertung.
	it('laesst Infozeilen ohne Kategorie, statt etwas zu behaupten', async () => {
		const d = deps({});
		const r = await ordneAusGedaechtnis([zeile('i1', 'Vielen Dank', 'info')], 'm1', 'h1', d);
		expect(r.offen).toHaveLength(0);
		expect(r.zugeordnet[0]).toMatchObject({ categoryId: null, source: 'none' });
	});

	// Ohne Haendler (Name nicht gelesen) faellt Stufe 1 aus, Stufe 2 muss trotzdem greifen.
	it('kommt ohne Haendler aus', async () => {
		const d = deps({ 'bio milch 1l': { productId: 'p1', categoryId: 'c1', merchantId: 'm2' } });
		const r = await ordneAusGedaechtnis([zeile('i1', 'BIO MILCH 1L')], null, 'h1', d);
		expect(r.zugeordnet).toHaveLength(1);
	});

	it('wirft nie, sondern laesst im Fehlerfall alles offen', async () => {
		const d = {
			aliasSuchen: vi.fn(async () => {
				throw new Error('Datenbank weg');
			}),
			slugAufloesen: vi.fn(async () => 'cat-unsortiert')
		};
		const r = await ordneAusGedaechtnis([zeile('i1', 'IRGENDWAS')], 'm1', 'h1', d as never);
		expect(r.offen).toHaveLength(1);
		expect(r.zugeordnet).toHaveLength(0);
	});

	// ===== Review Aufgabe 5 (task-5-review.md) — Nachbesserungen =====

	// Befund 1/A (Kritisch): confidence darf NIE behauptet werden, wenn categoryId
	// null ist. Prueft die Kopplung selbst (fuer JEDE erzeugte Zuordnung), nicht nur
	// die zwei im Review nachgewiesenen Einzelfaelle — genau das war die Kritik am
	// urspruenglichen Zustand ("nicht bloss die zwei Faelle").
	it('behauptet nie eine Konfidenz ohne Kategorie — fuer jede erzeugte Zuordnung (Befund A)', async () => {
		const d = {
			// Fall B: Alias trifft ein Produkt, dessen Kategorie geloescht wurde
			// (schema.ts erlaubt das ausdruecklich per onDelete: 'set null').
			aliasSuchen: vi.fn(async (schluessel: string) =>
				schluessel === 'geloeschte kategorie' ? { productId: 'p1', categoryId: null, merchantId: 'm1' } : null
			),
			// Fall A: der Pfand-/Rabatt-Slug laesst sich nicht (mehr) aufloesen —
			// simuliert z.B. eine kuenftige Slug-Drift zwischen kaskade.ts und baum.ts.
			slugAufloesen: vi.fn(async () => null)
		};
		const r = await ordneAusGedaechtnis(
			[
				zeile('i1', 'PFAND', 'deposit'),
				zeile('i2', 'RABATT', 'discount'),
				zeile('i3', 'GELOESCHTE KATEGORIE'),
				zeile('i4', 'Vielen Dank', 'info')
			],
			'm1',
			'h1',
			d
		);
		// Die Invariante selbst, ueber ALLE erzeugten Zuordnungen hinweg.
		for (const z of r.zugeordnet) {
			if (z.categoryId === null) expect(z.confidence, `itemId=${z.itemId}`).toBeNull();
		}
		// Und konkret, damit die Schleife oben auch wirklich etwas zu pruefen hatte:
		expect(r.zugeordnet.find((z) => z.itemId === 'i1')).toMatchObject({ categoryId: null, confidence: null });
		expect(r.zugeordnet.find((z) => z.itemId === 'i2')).toMatchObject({ categoryId: null, confidence: null });
		expect(r.zugeordnet.find((z) => z.itemId === 'i3')).toMatchObject({
			productId: 'p1',
			categoryId: null,
			confidence: null
		});
	});

	// Befund 2/B (Wichtig): wirft der Slug-Nachschlag WAEHREND einer Pfand-/Rabatt-Zeile
	// (z.B. DB-Aussetzer), darf die Zeile ihre feste Regel nicht verlieren — sie darf
	// NIE in "offen" (und damit potenziell ans Modell, Aufgabe 8) landen.
	it('behandelt Pfand/Rabatt weiterhin per fester Regel, wenn der Slug-Nachschlag wirft (Befund B)', async () => {
		const d = {
			aliasSuchen: vi.fn(async () => null),
			slugAufloesen: vi.fn(async () => {
				throw new Error('DB weg beim Slug-Lookup');
			})
		};
		const r = await ordneAusGedaechtnis(
			[zeile('i1', 'PFAND', 'deposit'), zeile('i2', 'RABATT', 'discount')],
			'm1',
			'h1',
			d
		);
		expect(r.offen).toHaveLength(0);
		expect(r.zugeordnet).toHaveLength(2);
		for (const z of r.zugeordnet) {
			expect(z).toMatchObject({ source: 'rule', categoryId: null, confidence: null });
		}
	});

	// Befund 3/C (Wichtig): die von echteKaskadeDeps verwendete Abfrage muss eine
	// explizite Reihenfolge tragen, statt sie dem Query-Planer zu ueberlassen — sonst
	// waere die Auswahl unter mehreren Treffern (z.B. derselbe Rohtext bei zwei
	// Haendlern, ab Aufgabe 7 moeglich) nicht reproduzierbar. Ohne Datenbankzugriff
	// pruefbar: `.toSQL()` kompiliert die Abfrage, ohne sie auszufuehren.
	it('bestellt Alias-Kandidaten mit einem expliziten ORDER BY (Befund C)', () => {
		const { sql } = aliasKandidatenQuery('irgendwas', 'h1').toSQL();
		expect(sql.toLowerCase()).toContain('order by');
	});

	// Befund 4/D (Klein): Konfidenzwerte sind benannte Konstanten statt verstreuter
	// Zahlen — hier an den tatsaechlich erzeugten Werten nachgewiesen (kein bisheriger
	// Test prueft die KONKRETEN Zahlen 100/60, nur "kleiner als 100" bzw. "rule").
	it('vergibt die dokumentierten Konfidenzwerte 100/60 (Befund D)', async () => {
		const gleich = deps({ 'bio milch 1l': { productId: 'p1', categoryId: 'c1', merchantId: 'm1' } });
		const rGleich = await ordneAusGedaechtnis([zeile('i1', 'BIO MILCH 1L')], 'm1', 'h1', gleich);
		expect(rGleich.zugeordnet[0].confidence).toBe(100);

		const anders = deps({ 'bio milch 1l': { productId: 'p1', categoryId: 'c1', merchantId: 'm2' } });
		const rAnders = await ordneAusGedaechtnis([zeile('i1', 'BIO MILCH 1L')], 'm1', 'h1', anders);
		expect(rAnders.zugeordnet[0].confidence).toBe(60);

		const regel = deps({});
		const rRegel = await ordneAusGedaechtnis([zeile('i1', 'PFAND', 'deposit')], 'm1', 'h1', regel);
		expect(rRegel.zugeordnet[0].confidence).toBe(100);
	});
});
